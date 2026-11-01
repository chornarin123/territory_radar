import { Injectable, Logger } from '@nestjs/common';
import { JobRunTracker } from '../common/job-run-tracker.service.js';
import { AppConfig } from '../config/app-config.service.js';
import { PgBossService } from '../queue/pg-boss.service.js';
import { QUEUES } from '../queue/queue.constants.js';
import { RetentionService } from '../places/retention.service.js';
import { DiscoverService } from './discover.service.js';
import { EnrichService } from './enrich.service.js';
import { ScoreRunService } from './score.service.js';

export const JOB_NAMES = ['scan.discover', 'scan.enrich', 'scan.score', 'retention'] as const;
export type JobName = (typeof JOB_NAMES)[number];

export interface JobStartSummary {
  jobName: JobName;
  runId: string | null;
  /** Jobs pushed onto the queue, for the fan-out stages. */
  queued?: number;
  /** Set when the stage ran to completion inline. */
  itemsProcessed?: number;
  skipped?: 'kill_switch';
}

/**
 * Starts a pipeline stage: opens its job_runs row, fans the work out onto the
 * queue, and schedules the finalizer that will close the row when the queue
 * drains. Returns as soon as the work is queued — the stages themselves run in
 * the workers.
 */
@Injectable()
export class ScanPipelineService {
  private readonly logger = new Logger(ScanPipelineService.name);

  constructor(
    private readonly config: AppConfig,
    private readonly queue: PgBossService,
    private readonly runs: JobRunTracker,
    private readonly discover: DiscoverService,
    private readonly enrich: EnrichService,
    private readonly score: ScoreRunService,
    private readonly retention: RetentionService,
  ) {}

  async start(jobName: JobName, sangkatCode?: string): Promise<JobStartSummary> {
    // Retention is local bookkeeping, so it still runs with the kill switch on.
    if (this.config.killSwitch && jobName !== 'retention') {
      this.logger.warn(`${jobName} skipped: KILL_SWITCH is on`);
      return {
        jobName,
        runId: await this.runs.skip(jobName, 'KILL_SWITCH'),
        skipped: 'kill_switch',
      };
    }

    const runId = await this.runs.start(jobName);

    switch (jobName) {
      case 'scan.discover': {
        const queued = await this.discover.enqueueAll(runId, sangkatCode);
        await this.watch(runId, QUEUES.discoverCell, queued);
        return { jobName, runId, queued };
      }
      case 'scan.enrich': {
        const queued = await this.enrich.enqueueAll(runId, sangkatCode);
        await this.watch(runId, QUEUES.enrichPlace, queued);
        return { jobName, runId, queued };
      }
      case 'scan.score': {
        // Scoring is database-only and quick, so it runs inline.
        const result = await this.score.run(new Date(), sangkatCode);
        await this.runs.record(runId, { items: result.itemsProcessed });
        for (const error of result.errors) await this.runs.addError(runId, error);
        await this.runs.finish(runId);
        this.logger.log(
          `scan.score: ${result.scored} scored, ${result.routes} routes, ${result.leadsAssigned} leads`,
        );
        return { jobName, runId, itemsProcessed: result.itemsProcessed };
      }
      case 'retention': {
        const result = await this.retention.run();
        await this.runs.record(runId, { items: result.itemsProcessed });
        await this.runs.finish(runId);
        return { jobName, runId, itemsProcessed: result.itemsProcessed };
      }
    }
  }

  /** Nothing queued means nothing to wait for — close the run now. */
  private async watch(
    runId: string,
    watching: (typeof QUEUES)[keyof typeof QUEUES],
    queued: number,
  ) {
    if (queued === 0) {
      await this.runs.finish(runId);
      return;
    }
    await this.queue.send(QUEUES.finalize, { runId, watching, attempt: 0 });
  }
}
