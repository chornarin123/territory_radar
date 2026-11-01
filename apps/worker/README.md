# apps/worker

The service that actually runs the scan. Two jobs, and nothing else:

- **Queue handlers** (`scan.workers.ts`) — consumes `scan.discover.cell`,
  `scan.enrich.place` and `scan.finalize` from pg-boss.
- **Cron schedule** (`scheduler.service.ts`) — Sunday 22:00 / 23:00 / 23:30 and
  a daily 04:00 retention sweep, in `Asia/Phnom_Penh`.

Plus a CLI (`cli.ts`) that runs any stage inline, which is the Demo Day path.

```bash
pnpm worker:start                                  # the service
pnpm worker run scan.discover --sangkat=120101     # one stage, by hand
```

The domain — database, Google client, signals, scoring, the scan stages — comes
from `@territory-radar/api`, which exports it through
[`src/index.ts`](../api/src/index.ts). This app adds only the two things a web
server must not do. If it ever needs a controller, that is the signal the domain
should move into a package of its own.

## Why it is separate

`@nestjs/schedule` fires in every process that loads it. With the crons in the
API, a second API instance would run each Sunday job twice — and the web server
would be spending money on Google while serving requests. So: scale the API,
run **exactly one** worker.

## Idempotency

pg-boss retries a job that throws (3 attempts, exponential backoff), so every
handler has to be safe to run twice:

- places are upserted by `place_id`; `first_seen` is only set on insert
- a place gets one snapshot per day
- signals dedupe within 7 days of the same type
- `job_runs` counters merge with `jsonb_set` rather than being overwritten
- review analyses are keyed by a hash of the review set, so a replay costs nothing

Budget exhaustion and `KILL_SWITCH` are _not_ retried — they would fail the same
way and, for Google calls, bill again. They are recorded on the run and the
handler returns.

## Configuration

Reads `apps/api/.env` (resolved from the api package, not the working directory),
so both processes share one file. A `.env` in the working directory wins, which
is how a deployment overrides it.

## Review mining

Enrichment gets the reviews for free — they arrive inside the Place Details call
that is already being billed — so mining them costs no extra Google quota.

`EnrichService` hands each place's reviews to `ReviewMiningService.submit()`,
which batches up to 5 places per model call. The batching is **in memory, not on
the queue**: pg-boss stores job payloads in Postgres, and putting review text
there would persist it. The cost is that a crash mid-batch loses that batch —
those places are simply analysed again next run, because the cache row is only
written after a place succeeds.

Two places drain the last partial batch, and both live in this app:

- the finalizer, before it closes the run's `job_runs` row
- the CLI, after its enrich loop

A place whose result fails validation is retried once, then skipped with the
reason recorded on the run. The rest of the batch is unaffected, and no cache
row is written, so the next run tries it again.
