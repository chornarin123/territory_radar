import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AreasModule } from './areas/areas.module.js';
import { ApiKeyGuard } from './common/api-key.guard.js';
import { CommonModule } from './common/common.module.js';
import { AppConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health.controller.js';
import { JobsModule } from './jobs/jobs.module.js';
import { LeadsModule } from './leads/leads.module.js';
import { OfficersModule } from './officers/officers.module.js';
import { PlacesModule } from './places/places.module.js';
import { QueueModule } from './queue/queue.module.js';
import { ScanModule } from './scan/scan.module.js';
import { ScoringModule } from './scoring/scoring.module.js';
import { SignalsModule } from './signals/signals.module.js';
import { UsageModule } from './usage/usage.module.js';

/**
 * The HTTP server. It enqueues work and reads results; it never registers a
 * queue handler and never runs a cron — those belong to `apps/worker`, so that
 * running two API instances cannot fire the Sunday jobs twice.
 */
@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    CommonModule,
    UsageModule,
    QueueModule,
    AreasModule,
    PlacesModule,
    SignalsModule,
    ScoringModule,
    LeadsModule,
    OfficersModule,
    ScanModule,
    JobsModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ApiKeyGuard }],
})
export class AppModule {}
