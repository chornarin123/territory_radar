import { AsyncLocalStorage } from 'node:async_hooks';
import { Inject, Injectable } from '@nestjs/common';
import { eq, gte, sql } from 'drizzle-orm';
import { localDate, startOfMonthUtc } from '../common/time.js';
import { AppConfig } from '../config/app-config.service.js';
import { DB } from '../database/database.module.js';
import type { Database } from '../database/database.module.js';
import { jobRuns } from '../database/schema.js';

/**
 * Estimated USD per request, Google list price. Free monthly usage (e.g. the
 * first 1,000 Enterprise calls) is deliberately ignored, so the budget errs high.
 * VERIFY against https://developers.google.com/maps/billing-and-pricing/pricing
 * — the SKU is decided by the most expensive field in the field mask.
 */
export const PLACES_SKU_COST_USD = {
  'places.nearby_pro': 0.032,
  'places.details_pro': 0.017,
  'places.details_enterprise': 0.02,
  'places.details_enterprise_atmosphere': 0.04,
} as const;

export type PlacesSku = keyof typeof PLACES_SKU_COST_USD;
/** AI calls are counted in job_runs for visibility but are not part of the Places budget. */
export type TrackedCall = PlacesSku | 'anthropic.messages' | 'gemini.generateContent';

export class KillSwitchError extends Error {
  constructor() {
    super('KILL_SWITCH is on — outbound API calls are disabled');
  }
}

export class BudgetExceededError extends Error {
  constructor(spentUsd: number, budgetUsd: number) {
    super(
      `Places monthly budget reached: ~$${spentUsd.toFixed(2)} of $${budgetUsd.toFixed(2)} spent`,
    );
  }
}

const CACHE_MS = 5 * 60_000;
const LIVE_JOB_NAME = 'live-display';

type CallCounts = Map<TrackedCall, number>;

/**
 * Gatekeeper for every billable outbound call: enforces KILL_SWITCH and
 * PLACES_MONTHLY_BUDGET, and counts calls so job_runs.api_calls stays accurate.
 */
@Injectable()
export class UsageService {
  private readonly runContext = new AsyncLocalStorage<CallCounts>();
  private readonly inFlight = new Set<CallCounts>();
  private persisted: { usd: number; month: string; fetchedAt: number } | null = null;
  private liveRow: { date: string; id: string } | null = null;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly config: AppConfig,
  ) {}

  /** Runs `fn` with its own call counter; returns the counts to store on the job_runs row. */
  async withRunCounter<T>(
    fn: () => Promise<T>,
  ): Promise<{ result: T | undefined; error: unknown; apiCalls: Record<string, number> }> {
    const counts: CallCounts = new Map();
    this.inFlight.add(counts);
    let result: T | undefined;
    let error: unknown;
    try {
      result = await this.runContext.run(counts, fn);
    } catch (err) {
      error = err;
    } finally {
      this.inFlight.delete(counts);
      // The caller persists these counts to job_runs right away; count them now
      // so the cached month total doesn't dip until the next refresh.
      if (this.persisted) this.persisted.usd += costOf(counts);
    }
    return { result, error, apiCalls: Object.fromEntries(counts) };
  }

  /** Throws if making this call now would breach the kill switch or the monthly budget. */
  async authorize(call: TrackedCall): Promise<void> {
    if (this.config.killSwitch) throw new KillSwitchError();
    if (!isPlacesSku(call)) return;
    const budget = this.config.get('PLACES_MONTHLY_BUDGET');
    const spent = await this.monthToDateUsd();
    if (spent + PLACES_SKU_COST_USD[call] > budget) throw new BudgetExceededError(spent, budget);
  }

  /** Records a call that was sent. Billable even if it failed, so call this before checking the response. */
  async record(call: TrackedCall): Promise<void> {
    const counts = this.runContext.getStore();
    if (counts) {
      counts.set(call, (counts.get(call) ?? 0) + 1);
      return;
    }
    await this.recordStandalone(call);
  }

  async monthToDateUsd(now = new Date()): Promise<number> {
    const month = startOfMonthUtc(now).toISOString();
    if (
      !this.persisted ||
      this.persisted.month !== month ||
      Date.now() - this.persisted.fetchedAt > CACHE_MS
    ) {
      const rows = await this.db
        .select({ apiCalls: jobRuns.apiCalls })
        .from(jobRuns)
        .where(gte(jobRuns.startedAt, startOfMonthUtc(now)));
      const usd = rows.reduce((sum, r) => sum + costOf(new Map(Object.entries(r.apiCalls))), 0);
      this.persisted = { usd, month, fetchedAt: Date.now() };
    }
    let inFlightUsd = 0;
    for (const counts of this.inFlight) inFlightUsd += costOf(counts);
    return this.persisted.usd + inFlightUsd;
  }

  /** Calls made outside a job (live display lookups) go on one job_runs row per day. */
  private async recordStandalone(call: TrackedCall): Promise<void> {
    const id = await this.liveRowId();
    await this.db
      .update(jobRuns)
      .set({
        apiCalls: sql`jsonb_set(${jobRuns.apiCalls}, ARRAY[${call}]::text[], to_jsonb(coalesce((${jobRuns.apiCalls} ->> ${call})::int, 0) + 1))`,
        itemsProcessed: sql`${jobRuns.itemsProcessed} + 1`,
        finishedAt: new Date(),
      })
      .where(eq(jobRuns.id, id));
    if (this.persisted && isPlacesSku(call)) this.persisted.usd += PLACES_SKU_COST_USD[call];
  }

  private async liveRowId(): Promise<string> {
    const today = localDate(new Date());
    if (this.liveRow?.date === today) return this.liveRow.id;
    const [row] = await this.db
      .insert(jobRuns)
      .values({ jobName: LIVE_JOB_NAME })
      .returning({ id: jobRuns.id });
    this.liveRow = { date: today, id: row!.id };
    return row!.id;
  }
}

function isPlacesSku(call: string): call is PlacesSku {
  return call in PLACES_SKU_COST_USD;
}

function costOf(counts: ReadonlyMap<string, number>): number {
  let usd = 0;
  for (const [call, n] of counts) if (isPlacesSku(call)) usd += PLACES_SKU_COST_USD[call] * n;
  return usd;
}
