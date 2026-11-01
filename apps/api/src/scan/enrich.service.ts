import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, count, eq, isNull, max, sql } from 'drizzle-orm';
import { JobRunTracker } from '../common/job-run-tracker.service.js';
import { jobError } from '../common/job-result.js';
import { localDate } from '../common/time.js';
import { AppConfig } from '../config/app-config.service.js';
import { DB } from '../database/database.module.js';
import type { Database } from '../database/database.module.js';
import { places, snapshots } from '../database/schema.js';
import type { OpeningPeriod } from '../database/schema.js';
import { GooglePlacesClient } from '../places/google-places.client.js';
import { hashBusinessName } from '../places/name-hash.js';
import { PgBossService } from '../queue/pg-boss.service.js';
import { QUEUES } from '../queue/queue.constants.js';
import type { EnrichPlaceJob } from '../queue/queue.constants.js';
import { detectHoursExtended } from '../signals/detectors.js';
import { ReviewMiningService } from '../signals/review-mining/review-mining.service.js';
import type { SubmitOutcome } from '../signals/review-mining/review-mining.service.js';
import { SignalsService } from '../signals/signals.service.js';
import { computeReviewVelocity } from '../signals/velocity.js';
import { BudgetExceededError, KillSwitchError } from '../usage/usage.service.js';

export interface EnrichResult {
  snapshotWritten: boolean;
  signals: string[];
  closed: boolean;
  /** What happened to the reviews: queued for Claude, unchanged since last time, or none. */
  reviews: SubmitOutcome | null;
}

/**
 * scan.enrich — Place Details for new places plus a rotating slice of the rest.
 *
 * This is the expensive half of the system: the field mask includes `reviews`,
 * which prices every call at Enterprise + Atmosphere ($40/1,000) with only
 * 1,000 free Enterprise calls a month. Every call is authorised against
 * PLACES_MONTHLY_BUDGET first, and the run halts the moment it is exhausted
 * rather than quietly continuing to bill.
 */
@Injectable()
export class EnrichService {
  private readonly logger = new Logger(EnrichService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly client: GooglePlacesClient,
    private readonly queue: PgBossService,
    private readonly signals: SignalsService,
    private readonly mining: ReviewMiningService,
    private readonly config: AppConfig,
    private readonly runs: JobRunTracker,
  ) {}

  /** Queues one job per place: everything never enriched, plus the rotation slice. */
  async enqueueAll(runId: string, sangkatCode?: string): Promise<number> {
    const targets = await this.selectTargets(sangkatCode);
    const jobs: EnrichPlaceJob[] = targets.map((placeId) => ({ runId, placeId }));
    await this.queue.sendMany(QUEUES.enrichPlace, jobs);
    this.logger.log(`Queued ${jobs.length} places for enrichment`);
    return jobs.length;
  }

  /**
   * Enriches one place: writes a snapshot, then derives signals from the
   * history. This is the worker body and the CLI path.
   */
  async enrichPlace(runId: string, placeId: string, now = new Date()): Promise<EnrichResult> {
    const details = await this.client.fetchEnrichment(placeId);
    const result: EnrichResult = {
      snapshotWritten: false,
      signals: [],
      closed: false,
      reviews: null,
    };

    // An explicit CLOSED_PERMANENTLY is the only thing that closes a place;
    // absence during discovery never does.
    if (details.businessStatus === 'CLOSED_PERMANENTLY') {
      await this.db
        .update(places)
        .set({ status: 'closed', missingCount: 0 })
        .where(eq(places.placeId, placeId));
      result.closed = true;
      return result;
    }

    const snapshot = {
      placeId,
      scannedAt: now,
      scanDate: localDate(now),
      reviewCount: details.reviewCount,
      rating: details.rating,
      priceLevel: details.priceLevel,
      openHours: (details.openHours as OpeningPeriod[] | null) ?? null,
      hasWebOrPage: details.hasWebOrPage,
    };
    // Upsert, not insert: pg-boss retries this job, and a second snapshot the
    // same day would make the latest velocity interval a few minutes wide with
    // a delta of zero — silently hiding the spike we are looking for.
    await this.db
      .insert(snapshots)
      .values(snapshot)
      .onConflictDoUpdate({
        target: [snapshots.placeId, snapshots.scanDate],
        set: {
          scannedAt: snapshot.scannedAt,
          reviewCount: snapshot.reviewCount,
          rating: snapshot.rating,
          priceLevel: snapshot.priceLevel,
          openHours: snapshot.openHours,
          hasWebOrPage: snapshot.hasWebOrPage,
        },
      });
    result.snapshotWritten = true;

    // The name itself is never stored — only a one-way hash, so chains can be
    // spotted across runs without keeping Google content.
    await this.db
      .update(places)
      .set({ nameHash: hashBusinessName(details.displayName), lastSeen: now })
      .where(eq(places.placeId, placeId));

    const history = await this.history(placeId);

    const velocity = computeReviewVelocity(history);
    if (velocity?.isSpike) {
      const written = await this.signals.record(
        placeId,
        { type: 'velocity_spike', confidence: velocity.confidence, evidence: velocity.evidence },
        now,
      );
      if (written) result.signals.push('velocity_spike');
    }

    const hours = detectHoursExtended(history);
    if (hours && (await this.signals.record(placeId, hours, now))) {
      result.signals.push('hours_extended');
    }

    // Reviews came back with this call, so reading them costs no extra Google call.
    // They are batched with other places and analysed after this returns; only
    // derived signals and a Khmer summary are ever stored.
    result.reviews = await this.mining.submit(runId, placeId, details.reviews);

    return result;
  }

  /** Snapshot history, oldest first — the velocity and hours detectors need the series. */
  private async history(placeId: string) {
    const rows = await this.db
      .select({
        at: snapshots.scannedAt,
        reviewCount: snapshots.reviewCount,
        openHours: snapshots.openHours,
      })
      .from(snapshots)
      .where(eq(snapshots.placeId, placeId))
      .orderBy(asc(snapshots.scannedAt));
    return rows;
  }

  /**
   * Everything never enriched, then the stalest ENRICH_ROTATION_PCT of the rest.
   * New places first because a new opening is the strongest signal we have.
   */
  async selectTargets(sangkatCode?: string): Promise<string[]> {
    const activeHere = sangkatCode
      ? and(eq(places.status, 'active'), eq(places.sangkatCode, sangkatCode))
      : eq(places.status, 'active');

    const latest = this.db
      .select({ placeId: snapshots.placeId, lastAt: max(snapshots.scannedAt).as('last_at') })
      .from(snapshots)
      .groupBy(snapshots.placeId)
      .as('latest');

    const never = await this.db
      .select({ placeId: places.placeId })
      .from(places)
      .leftJoin(latest, eq(latest.placeId, places.placeId))
      .where(and(activeHere, isNull(latest.lastAt)));

    const [total] = await this.db.select({ n: count() }).from(places).where(activeHere);
    const rotationSize = Math.ceil(
      ((total?.n ?? 0) * this.config.get('ENRICH_ROTATION_PCT')) / 100,
    );

    const rotation =
      rotationSize > 0
        ? await this.db
            .select({ placeId: places.placeId })
            .from(places)
            .innerJoin(latest, eq(latest.placeId, places.placeId))
            .where(activeHere)
            .orderBy(sql`${latest.lastAt} asc`)
            .limit(rotationSize)
        : [];

    const ids = new Set<string>();
    for (const row of [...never, ...rotation]) ids.add(row.placeId);
    return [...ids];
  }

  /** Marks places whose name hash appears more than once — our chain proxy. */
  async refreshMultiBranchFlags(): Promise<number> {
    const updated = await this.db
      .update(places)
      .set({ isMultiBranch: true })
      .where(
        sql`${places.nameHash} is not null and ${places.nameHash} in (
          select name_hash from places where name_hash is not null group by name_hash having count(*) > 1
        ) and ${places.isMultiBranch} = false`,
      )
      .returning({ placeId: places.placeId });
    return updated.length;
  }

  /** True when the error means we should stop the whole run, not just this place. */
  static isFatal(err: unknown): boolean {
    return err instanceof BudgetExceededError || err instanceof KillSwitchError;
  }

  async recordFailure(runId: string, placeId: string, err: unknown): Promise<void> {
    await this.runs.addError(runId, jobError(err, { placeId }));
  }
}
