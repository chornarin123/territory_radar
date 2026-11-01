import { Module } from '@nestjs/common';
import { PlacesModule } from '../places/places.module.js';
import { ScoringModule } from '../scoring/scoring.module.js';
import { SignalsModule } from '../signals/signals.module.js';
import { DiscoverService } from './discover.service.js';
import { EnrichService } from './enrich.service.js';
import { ScanPipelineService } from './scan.service.js';
import { ScoreRunService } from './score.service.js';

/**
 * The scanning pipeline: discover → enrich → score. Deliberately free of queue
 * workers, so importing it never means competing for queued jobs — the handlers
 * live in `apps/worker`, which is the only process that consumes the queue.
 */
@Module({
  imports: [PlacesModule, SignalsModule, ScoringModule],
  providers: [DiscoverService, EnrichService, ScoreRunService, ScanPipelineService],
  exports: [DiscoverService, EnrichService, ScoreRunService, ScanPipelineService],
})
export class ScanModule {}
