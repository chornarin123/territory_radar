import { Module } from '@nestjs/common';
import { PipelineModule } from './pipeline.module.js';
import { ScanWorkersModule } from './scan-workers.module.js';
import { SchedulerModule } from './scheduler.module.js';

/** The long-running service: the pipeline, plus the two things that start it. */
@Module({
  imports: [PipelineModule, ScanWorkersModule, SchedulerModule],
})
export class WorkerModule {}
