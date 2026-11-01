import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { jobError } from '../../common/job-result.js';
import { JobRunTracker } from '../../common/job-run-tracker.service.js';
import { AppConfig } from '../../config/app-config.service.js';
import { DB } from '../../database/database.module.js';
import type { Database } from '../../database/database.module.js';
import { reviewAnalyses } from '../../database/schema.js';
import { UsageService } from '../../usage/usage.service.js';
import { SignalsService } from '../signals.service.js';
import { createAiClient, isAiRetryable } from './ai-client.js';
import type { AiClient } from './ai-client.js';
import { hashReviewSet, parseModelText, validatePlaceResult } from './review-mining.logic.js';
import type { ValidAnalysis } from './review-mining.logic.js';
import { PROMPT_VERSION } from './review-mining.schema.js';

/** Places per AI call. Output is roughly 300 tokens per place, most of it Khmer. */
export const BATCH_SIZE = 5;
/** A partial batch is sent after this long, so the last few places are not stranded. */
export const FLUSH_AFTER_MS = 3_000;

interface PendingPlace {
  runId: string;
  placeId: string;
  /** Held in memory only, never written anywhere — not even the job queue. */
  reviews: string[];
  hash: string;
  attempt: 0 | 1;
}

export interface MiningStats {
  queued: number;
  unchanged: number;
  analysed: number;
  failed: number;
  calls: number;
  signals: number;
}

export type SubmitOutcome = 'queued' | 'unchanged' | 'no_reviews';

/**
 * Reads public reviews with Claude or Gemini and stores only what it derives: signals
 * with paraphrased evidence, a business scale, and a one-sentence Khmer summary
 * for the loan officer.
 *
 * Places are batched in memory (review text cannot go through pg-boss, whose
 * jobs live in Postgres) and cached by a hash of the review set, so unchanged
 * reviews are never analysed twice.
 */
@Injectable()
export class ReviewMiningService implements OnApplicationShutdown {
  private readonly logger = new Logger(ReviewMiningService.name);
  private readonly client: AiClient;
  private pending: PendingPlace[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly inFlight = new Set<Promise<void>>();
  readonly stats: MiningStats = {
    queued: 0,
    unchanged: 0,
    analysed: 0,
    failed: 0,
    calls: 0,
    signals: 0,
  };

  constructor(
    @Inject(DB) private readonly db: Database,
    config: AppConfig,
    private readonly usage: UsageService,
    private readonly signals: SignalsService,
    private readonly runs: JobRunTracker,
  ) {
    this.client = createAiClient(config);
  }

  /**
   * Queues a place's reviews unless this exact set was already analysed.
   * Returns without waiting for AI — call drain() at the end of a run.
   */
  async submit(runId: string, placeId: string, reviews: readonly string[]): Promise<SubmitOutcome> {
    const hash = hashReviewSet(reviews, `${this.client.model}|${PROMPT_VERSION}`);
    if (!hash) return 'no_reviews';

    const [cached] = await this.db
      .select({ reviewsHash: reviewAnalyses.reviewsHash })
      .from(reviewAnalyses)
      .where(eq(reviewAnalyses.placeId, placeId));
    if (cached?.reviewsHash === hash) {
      this.stats.unchanged += 1;
      return 'unchanged';
    }

    this.pending.push({ runId, placeId, reviews: [...reviews], hash, attempt: 0 });
    this.stats.queued += 1;
    if (this.pending.length >= BATCH_SIZE) this.flush();
    else this.scheduleFlush();
    return 'queued';
  }

  /** Sends everything still waiting and resolves once every batch has finished. */
  async drain(): Promise<void> {
    while (this.pending.length > 0 || this.inFlight.size > 0) {
      if (this.pending.length > 0) this.flush();
      await Promise.allSettled([...this.inFlight]);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.drain();
  }

  private scheduleFlush(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), FLUSH_AFTER_MS);
    // Never keep a finished CLI process alive just for this timer.
    this.timer.unref?.();
  }

  private flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    while (this.pending.length > 0) {
      const batch = this.pending.splice(0, BATCH_SIZE);
      const task: Promise<void> = this.analyseBatch(batch)
        .catch((err: unknown) => {
          this.logger.error(`Review batch crashed: ${err instanceof Error ? err.message : err}`);
        })
        .finally(() => {
          this.inFlight.delete(task);
        });
      this.inFlight.add(task);
    }
  }

  /**
   * One AI call for the batch, then per-place validation. Places that fail —
   * a bad entry, missing from the response, or the whole call failing — are
   * retried once together. A second failure skips that place for this run.
   */
  private async analyseBatch(batch: PendingPlace[]): Promise<void> {
    const keyed = batch.map((place, index) => ({ ...place, key: `P${index + 1}` }));

    let entries: Map<string, unknown> | null = null;
    let callError: unknown = null;
    try {
      entries = await this.callModel(keyed);
    } catch (err) {
      callError = err;
      if (!isAiRetryable(err)) {
        for (const place of batch) await this.skip(place, messageOf(err));
        return;
      }
    }

    const retry: PendingPlace[] = [];
    for (const place of keyed) {
      const raw = entries?.get(place.key);
      const verdict =
        raw === undefined
          ? {
              ok: false as const,
              reason: entries ? 'missing from the response' : messageOf(callError),
            }
          : validatePlaceResult(raw, place.reviews);

      if (verdict.ok) {
        await this.persist(place, verdict.analysis);
      } else if (place.attempt === 0) {
        retry.push({
          runId: place.runId,
          placeId: place.placeId,
          reviews: place.reviews,
          hash: place.hash,
          attempt: 1,
        });
      } else {
        await this.skip(place, verdict.reason);
      }
    }

    if (retry.length > 0) {
      this.logger.warn(`Retrying ${retry.length} place(s) once`);
      await this.analyseBatch(retry);
    }
  }

  /** Returns the model's entries keyed by place_key. Throws if the call or its JSON fails. */
  private async callModel(
    batch: readonly (PendingPlace & { key: string })[],
  ): Promise<Map<string, unknown>> {
    const sku = this.client.provider === 'gemini' ? 'gemini.generateContent' : 'anthropic.messages';
    await this.usage.authorize(sku); // honours KILL_SWITCH

    const response = await this.client.call(batch);

    this.stats.calls += 1;
    const { inputTokens, outputTokens, callSku } = response;
    await this.runs.record(batch[0]!.runId, {
      apiCalls: {
        [callSku]: 1,
        [`${this.client.provider}.input_tokens`]: inputTokens,
        [`${this.client.provider}.output_tokens`]: outputTokens,
      },
    });
    this.logger.log(
      `${this.client.provider} (${this.client.model}) read reviews for ${batch.length} place(s): ${inputTokens} in / ${outputTokens} out`,
    );

    const body: unknown =
      typeof response.body === 'string' ? parseModelText(response.body) : response.body;

    const places = (body as { places?: unknown } | null)?.places;
    if (!Array.isArray(places)) throw new Error('the response was not the expected JSON');

    const byKey = new Map<string, unknown>();
    for (const entry of places) {
      const key = (entry as { place_key?: unknown } | null)?.place_key;
      if (typeof key === 'string' && !byKey.has(key)) byKey.set(key, entry);
    }
    return byKey;
  }

  /** Signals first, cache row last: a crash in between re-analyses rather than losing signals. */
  private async persist(place: PendingPlace, analysis: ValidAnalysis): Promise<void> {
    const now = new Date();
    for (const extracted of analysis.signals) {
      if (await this.signals.record(place.placeId, extracted, now)) this.stats.signals += 1;
    }

    const row = {
      reviewsHash: place.hash,
      model: this.client.model,
      businessScale: analysis.businessScale,
      summaryKm: analysis.summaryKm,
      analyzedAt: now,
    };
    await this.db
      .insert(reviewAnalyses)
      .values({ placeId: place.placeId, ...row })
      .onConflictDoUpdate({ target: reviewAnalyses.placeId, set: row });
    this.stats.analysed += 1;
  }

  /** Skips a place for this run. No cache row is written, so the next run tries again. */
  private async skip(place: PendingPlace, reason: string): Promise<void> {
    this.stats.failed += 1;
    this.logger.warn(`Review mining skipped ${place.placeId}: ${reason}`);
    await this.runs.addError(
      place.runId,
      jobError(new Error(`review mining skipped: ${reason}`), { placeId: place.placeId }),
    );
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
