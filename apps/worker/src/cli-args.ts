import { JOB_NAMES } from '@territory-radar/api';
import type { JobName } from '@territory-radar/api';

export const USAGE = `
Usage: pnpm worker run <job> [--sangkat=CODE] [--limit=N] [--queue]

Jobs: ${JOB_NAMES.join(', ')}

  --sangkat=CODE  Only this sangkat (e.g. 120101).
  --limit=N       Stop after N units of paid work (cells or places). Caps demo cost.
  --queue         Hand the work to the queue instead of running it here.

Runs inline by default, printing progress as it goes, and writes a job_runs row
exactly like the scheduled job does.
`;

export interface CliArgs {
  job: JobName;
  sangkat?: string;
  limit?: number;
  queue: boolean;
}

/**
 * Parsed before anything is constructed, so a typo on stage fails in
 * milliseconds with usage text instead of after a database connection.
 */
export function parseArgs(argv: string[]): CliArgs {
  // Nest passes its own flags through when run via `nest start`; the job
  // arguments are everything from "run" onwards.
  const runAt = argv.indexOf('run');
  const args = runAt >= 0 ? argv.slice(runAt) : argv;

  const positional = args.filter((a) => !a.startsWith('--'));
  const flags = new Map(
    args
      .filter((a) => a.startsWith('--'))
      .map((a) => {
        const [key, value] = a.slice(2).split('=');
        return [key!, value ?? 'true'] as const;
      }),
  );

  const [command, job] = positional;
  if (command !== 'run' || !job || !(JOB_NAMES as readonly string[]).includes(job)) {
    throw new Error(USAGE);
  }

  const limit = flags.has('limit') ? Number(flags.get('limit')) : undefined;
  if (limit !== undefined && !(Number.isInteger(limit) && limit > 0)) {
    throw new Error('--limit must be a positive integer');
  }

  return {
    job: job as JobName,
    sangkat: flags.get('sangkat'),
    limit,
    queue: flags.has('queue'),
  };
}
