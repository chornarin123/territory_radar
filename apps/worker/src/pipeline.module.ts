import { Module } from '@nestjs/common';
import {
  AppConfigModule,
  CommonModule,
  DatabaseModule,
  PlacesModule,
  QueueModule,
  ScanModule,
  ScoringModule,
  SignalsModule,
  UsageModule,
} from '@territory-radar/api';

/**
 * Everything the pipeline needs and nothing that starts work on its own: no
 * queue handlers, no cron, no HTTP. The CLI loads exactly this, so a manual run
 * never steals a queued job from the running worker.
 */
@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    CommonModule,
    UsageModule,
    QueueModule,
    PlacesModule,
    SignalsModule,
    ScoringModule,
    ScanModule,
  ],
})
export class PipelineModule {}
