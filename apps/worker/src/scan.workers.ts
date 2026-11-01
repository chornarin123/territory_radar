import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import {
  BudgetExceededError,
  DiscoverService,
  EnrichService,
  JobRunTracker,
  KillSwitchError,
  PgBossService,
  QUEUES,
  ReviewMiningService,
  UsageService,
  jobError,
} from '@territory-radar/api';
import type { DiscoverCellJob, EnrichPlaceJob, FinalizeJob } from '@territory-radar/api';

/** How long the finalizer waits between checks that a fan-out has drained. */
const FINALIZE_POLL_SECONDS = 20;
/** Give up watching after roughly two hours rather than polling forever. */
const FINALIZE_MAX_ATTEMPTS = 360;

/**
 * Registers the queue handlers. Only the worker service imports this — the API
 * and the CLI call the same services directly, so they never compete for jobs.
 *
 * Every handler is safe to run twice: pg-boss retries on throw, and the work
 * underneath is upsert-shaped. Discovery upserts by place_id; enrichment writes
 * one snapshot per place per day and dedupes signals within 7 days; job_runs
 * counters are merged with jsonb_set rather than overwritten.
 */
@Injectable()
export class ScanWorkers implements OnModuleInit {
  private readonly logger = new Logger(ScanWorkers.name);

  constructor(
    private readonly queue: PgBossService,
    private readonly discover: DiscoverService,
    private readonly enrich: EnrichService,
    private readonly runs: JobRunTracker,
    private readonly usage: UsageService,
    private readonly mining: ReviewMiningService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queue.work<DiscoverCellJob>(QUEUES.discoverCell, (job) => this.onDiscoverCell(job));
    await this.queue.work<EnrichPlaceJob>(QUEUES.enrichPlace, (job) => this.onEnrichPlace(job));
    await this.queue.work<FinalizeJob>(QUEUES.finalize, (job) => this.onFinalize(job), {
      localConcurrency: 1,
    });
    this.logger.log('Scan workers listening');
  }

  private async onDiscoverCell(job: DiscoverCellJob): Promise<void> {
    // The run counter records every billed call, retries included, so job_runs
    // matches what Google actually charges.
    const { result, error, apiCalls } = await this.usage.withRunCounter(() =>
      this.discover.scanCell(job),
    );
    await this.runs.record(job.runId, { items: result?.placesFound ?? 0, apiCalls });

    if (result && result.childJobs.length > 0) {
      // A saturated cell just spawned children; queue them into the same run.
      await this.queue.sendMany(QUEUES.discoverCell, result.childJobs);
    }

    if (error) {
      await this.runs.addError(
        job.runId,
        jobError(error, { cellId: job.cellId, category: job.category }),
      );
      // Budget and kill switch are not this job's fault and retrying will not
      // help, so swallow them; anything else goes back to pg-boss to retry.
      if (error instanceof BudgetExceededError || error instanceof KillSwitchError) {
        this.logger.warn(`Discover halted: ${error.message}`);
        return;
      }
      throw error;
    }
  }

  private async onEnrichPlace(job: EnrichPlaceJob): Promise<void> {
    const { result, error, apiCalls } = await this.usage.withRunCounter(() =>
      this.enrich.enrichPlace(job.runId, job.placeId),
    );
    await this.runs.record(job.runId, { items: result ? 1 : 0, apiCalls });

    if (result && result.signals.length > 0) {
      this.logger.log(`${job.placeId}: ${result.signals.join(', ')}`);
    }

    if (error) {
      await this.enrich.recordFailure(job.runId, job.placeId, error);
      if (EnrichService.isFatal(error)) {
        this.logger.warn(`Enrich halted: ${(error as Error).message}`);
        return;
      }
      throw error;
    }
  }

  /**
   * Closes a run's job_runs row once its fan-out has drained. Without this a run
   * would look like it never finished, which is exactly what the demo shows.
   */
  private async onFinalize(job: FinalizeJob): Promise<void> {
    const depth = await this.queue.depth(job.watching);

    if (depth > 0 && job.attempt < FINALIZE_MAX_ATTEMPTS) {
      await this.queue.sendAfter(
        QUEUES.finalize,
        { ...job, attempt: job.attempt + 1 },
        FINALIZE_POLL_SECONDS,
      );
      return;
    }

    if (depth > 0) {
      await this.runs.addError(job.runId, {
        message: `gave up waiting for ${job.watching}: ${depth} jobs still queued`,
        at: new Date().toISOString(),
      });
    } else if (job.watching === QUEUES.enrichPlace) {
      // Reviews are batched in memory; send the last partial batch before closing.
      await this.mining.drain();
      // Chain detection needs every name hash from this run to be in place.
      const flagged = await this.enrich.refreshMultiBranchFlags();
      if (flagged > 0) this.logger.log(`Flagged ${flagged} places as multi-branch`);
    }

    await this.runs.finish(job.runId);
    this.logger.log(`Run ${job.runId} finished (${job.watching} drained)`);
  }
}
