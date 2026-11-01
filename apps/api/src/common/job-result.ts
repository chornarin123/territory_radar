import type { JobError } from '../database/schema.js';

/** What every pipeline step reports back; written to job_runs. */
export interface JobResult {
  itemsProcessed: number;
  errors: JobError[];
}

export function jobError(err: unknown, context?: Record<string, unknown>): JobError {
  return {
    message: err instanceof Error ? err.message : String(err),
    at: new Date().toISOString(),
    ...(context ? { context } : {}),
  };
}
