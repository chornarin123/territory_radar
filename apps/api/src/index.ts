/**
 * The pipeline surface `apps/worker` builds on.
 *
 * The API package owns the domain — database, Google client, signals, scoring,
 * the scan stages — because the HTTP layer needs most of it too (a lead list
 * needs scores; `POST /jobs/:name/run` needs the pipeline). The worker adds the
 * two things a web server must not do: register queue handlers and run crons.
 *
 * Nothing HTTP is exported. If the worker ever needs a controller, that is the
 * signal the domain should move to a package of its own.
 */
export { AppConfig } from './config/app-config.service.js';
export { AppConfigModule } from './config/config.module.js';
export { DB, DatabaseModule } from './database/database.module.js';
export type { Database } from './database/database.module.js';

export { CommonModule } from './common/common.module.js';
export { jobError } from './common/job-result.js';
export type { JobResult } from './common/job-result.js';
export { TIMEZONE } from './common/time.js';
export { JobRunTracker } from './common/job-run-tracker.service.js';

export { UsageModule } from './usage/usage.module.js';
export { BudgetExceededError, KillSwitchError, UsageService } from './usage/usage.service.js';

export { QueueModule } from './queue/queue.module.js';
export { PgBossService } from './queue/pg-boss.service.js';
export { QUEUES } from './queue/queue.constants.js';
export type {
  DiscoverCellJob,
  EnrichPlaceJob,
  FinalizeJob,
  QueueName,
} from './queue/queue.constants.js';

export { PlacesModule } from './places/places.module.js';
export { SCAN_CATEGORIES } from './places/categories.js';
export type { ScanCategory } from './places/categories.js';
export { RetentionService } from './places/retention.service.js';

export { SignalsModule } from './signals/signals.module.js';
export { ReviewMiningService } from './signals/review-mining/review-mining.service.js';
export { ScoringModule } from './scoring/scoring.module.js';

export { ScanModule } from './scan/scan.module.js';
export { DiscoverService } from './scan/discover.service.js';
export { EnrichService } from './scan/enrich.service.js';
export { ScoreRunService } from './scan/score.service.js';
export { JOB_NAMES, ScanPipelineService } from './scan/scan.service.js';
export type { JobName, JobStartSummary } from './scan/scan.service.js';
