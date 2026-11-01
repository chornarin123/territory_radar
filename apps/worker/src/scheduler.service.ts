import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ScanPipelineService, TIMEZONE } from '@territory-radar/api';

/**
 * The weekly pipeline, in Cambodian local time. Sunday night because scanning
 * is the expensive step and nobody is waiting on it — officers pick up the new
 * routes on Monday morning.
 *
 * Stages are separate crons rather than one chain: each writes its own job_runs
 * row, and a failure in one does not swallow the next.
 */
@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(private readonly pipeline: ScanPipelineService) {}

  /** Sunday 22:00 — fan out one job per grid cell per category. */
  @Cron('0 22 * * 0', { name: 'scan.discover', timeZone: TIMEZONE })
  async discover(): Promise<void> {
    const summary = await this.pipeline.start('scan.discover');
    this.logger.log(`scan.discover queued ${summary.queued ?? 0} jobs (run ${summary.runId})`);
  }

  /** Sunday 23:00 — Place Details for new and rotating places. */
  @Cron('0 23 * * 0', { name: 'scan.enrich', timeZone: TIMEZONE })
  async enrich(): Promise<void> {
    const summary = await this.pipeline.start('scan.enrich');
    this.logger.log(`scan.enrich queued ${summary.queued ?? 0} places (run ${summary.runId})`);
  }

  /** Sunday 23:30 — score, cluster into walking routes, assign to officers. */
  @Cron('30 23 * * 0', { name: 'scan.score', timeZone: TIMEZONE })
  async score(): Promise<void> {
    const summary = await this.pipeline.start('scan.score');
    this.logger.log(`scan.score processed ${summary.itemsProcessed ?? 0} (run ${summary.runId})`);
  }

  /**
   * Daily 04:00 — clears coordinates past Google's 30-day caching window.
   * Local bookkeeping, so it is not part of the weekly scan.
   */
  @Cron('0 4 * * *', { name: 'retention', timeZone: TIMEZONE })
  async retention(): Promise<void> {
    await this.pipeline.start('retention');
  }
}
