import { Controller, Get, Inject, Param, Post, Query } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { DB } from '../database/database.module.js';
import type { Database } from '../database/database.module.js';
import { jobRuns } from '../database/schema.js';
import { JOB_NAMES, ScanPipelineService } from '../scan/scan.service.js';
import type { JobName, JobStartSummary } from '../scan/scan.service.js';
import { UsageService } from '../usage/usage.service.js';

const jobNameSchema = z.enum(JOB_NAMES);

@Controller('jobs')
export class JobsController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly pipeline: ScanPipelineService,
    private readonly usage: UsageService,
  ) {}

  /** Recent runs, newest first — the proof that the pipeline runs on schedule. */
  @Get('runs')
  async runs(@Query('jobName') jobName?: string) {
    const query = this.db.select().from(jobRuns).orderBy(desc(jobRuns.startedAt)).limit(50);
    return jobName ? query.where(eq(jobRuns.jobName, jobName)) : query;
  }

  /** Month-to-date Places spend against the configured budget. */
  @Get('usage')
  async usageSummary(): Promise<{ placesSpendUsd: number }> {
    return { placesSpendUsd: Number((await this.usage.monthToDateUsd()).toFixed(2)) };
  }

  /**
   * Manual trigger. `sangkat` limits a scan to one area — handy for demos.
   * Discover and enrich only enqueue here; the worker does the paid work.
   */
  @Post(':jobName/run')
  async trigger(
    @Param('jobName', new ZodValidationPipe(jobNameSchema)) jobName: JobName,
    @Query('sangkat') sangkat?: string,
  ): Promise<JobStartSummary> {
    return this.pipeline.start(jobName, sangkat);
  }
}
