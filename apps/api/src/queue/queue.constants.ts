import type { ScanCategory } from '../places/categories.js';

/**
 * Queue names. pg-boss requires each to be created before use — see PgBossService.
 * One queue per unit of work, so depth and failures are visible per stage.
 */
export const QUEUES = {
  /** One job per (grid cell × category). */
  discoverCell: 'scan.discover.cell',
  /** One job per place to enrich. */
  enrichPlace: 'scan.enrich.place',
  /** Watches a fan-out and closes its job_runs row when the queue drains. */
  finalize: 'scan.finalize',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface DiscoverCellJob {
  runId: string;
  cellId: string;
  sangkatCode: string;
  lat: number;
  lng: number;
  radiusM: number;
  category: ScanCategory;
  /** The cell had a complete (unsaturated) scan before, so new places are real openings. */
  previouslyScannedComplete: boolean;
}

export interface EnrichPlaceJob {
  runId: string;
  placeId: string;
}

export interface FinalizeJob {
  runId: string;
  /** Queue to wait on before closing the run. */
  watching: QueueName;
  attempt: number;
}
