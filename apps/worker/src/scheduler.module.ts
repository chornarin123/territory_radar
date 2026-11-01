import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ScanModule } from '@territory-radar/api';
import { SchedulerService } from './scheduler.service.js';

/**
 * The cron schedule. It lives in the worker alone — `@nestjs/schedule` fires in
 * every process that loads it, so scheduling from the API would run the Sunday
 * jobs once per API instance.
 */
@Module({
  imports: [ScheduleModule.forRoot(), ScanModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}
