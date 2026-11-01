import { Module } from '@nestjs/common';
import { ScanModule } from '../scan/scan.module.js';
import { JobsController } from './jobs.controller.js';

/**
 * Read access to `job_runs` and to spend, plus a manual trigger. The schedule
 * that normally starts these runs lives in `apps/worker` — this module only
 * looks at the results and, on request, kicks one off.
 */
@Module({
  imports: [ScanModule],
  controllers: [JobsController],
})
export class JobsModule {}
