import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DB } from '../database/database.module.js';
import type { Database } from '../database/database.module.js';
import { jobRuns } from '../database/schema.js';
import type { JobError } from '../database/schema.js';

/**
 * Every job writes to job_runs: when it started, how many items it handled,
 * which billable calls it made, and anything that went wrong.
 *
 * Fan-out jobs run across many workers at once, so the counters are updated
 * with SQL arithmetic rather than read-modify-write — two workers finishing at
 * the same moment must not lose each other's counts.
 */
@Injectable()
export class JobRunTracker {
  private readonly logger = new Logger(JobRunTracker.name);

  constructor(@Inject(DB) private readonly db: Database) {}

  async start(jobName: string, startedAt = new Date()): Promise<string> {
    const [run] = await this.db
      .insert(jobRuns)
      .values({ jobName, startedAt })
      .returning({ id: jobRuns.id });
    this.logger.log(`${jobName} started (run ${run!.id})`);
    return run!.id;
  }

  /** Adds to items_processed and merges per-SKU call counts. Safe to call concurrently. */
  async record(
    runId: string,
    { items = 0, apiCalls = {} }: { items?: number; apiCalls?: Record<string, number> },
  ): Promise<void> {
    const entries = Object.entries(apiCalls);
    if (items === 0 && entries.length === 0) return;

    // jsonb || jsonb keeps existing keys, so add each SKU's delta explicitly.
    let merged = sql`${jobRuns.apiCalls}`;
    for (const [sku, count] of entries) {
      merged = sql`jsonb_set(${merged}, ARRAY[${sku}]::text[], to_jsonb(coalesce((${jobRuns.apiCalls} ->> ${sku})::int, 0) + ${count}))`;
    }

    await this.db
      .update(jobRuns)
      .set({
        itemsProcessed: sql`${jobRuns.itemsProcessed} + ${items}`,
        ...(entries.length > 0 ? { apiCalls: merged } : {}),
      })
      .where(eq(jobRuns.id, runId));
  }

  async addError(runId: string, error: JobError): Promise<void> {
    await this.db
      .update(jobRuns)
      .set({ errors: sql`${jobRuns.errors} || ${JSON.stringify([error])}::jsonb` })
      .where(eq(jobRuns.id, runId));
  }

  async finish(runId: string, finishedAt = new Date()): Promise<void> {
    await this.db.update(jobRuns).set({ finishedAt }).where(eq(jobRuns.id, runId));
  }

  /** Marks a run finished immediately — for jobs that skipped without doing work. */
  async skip(jobName: string, reason: string): Promise<string> {
    const runId = await this.start(jobName);
    await this.addError(runId, { message: `skipped: ${reason}`, at: new Date().toISOString() });
    await this.finish(runId);
    return runId;
  }
}
