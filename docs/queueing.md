# Queueing: why pg-boss, not BullMQ

The scanning pipeline fans out into thousands of small jobs — one Nearby Search
per grid cell per category — so it needs a queue. BullMQ and pg-boss both do the
job. We chose **pg-boss**, running against the Neon database we already have.

## The reasons

**One less thing to run.** BullMQ needs Redis. That is a second managed service
to provision, secure, pay for and keep alive — and on Demo Day, a second thing
that can be down when a judge names a sangkat. pg-boss keeps its tables in a
`pgboss` schema in the same Postgres, created automatically on start.

**The work is slow, not high-throughput.** Every job is bottlenecked on Google's
rate limit (`PLACES_MAX_QPS`, default 8/s). Redis's speed advantage is
irrelevant when the queue is waiting on an HTTP call anyway. A few thousand jobs
a week is well within what Postgres handles comfortably.

**Jobs and results live together.** Queue state, `job_runs`, places and
snapshots are in one database. You can inspect a run's progress with one SQL
query, back it all up together, and never wonder whether Redis and Postgres
disagree about what happened.

**Cost.** One Neon database fits the contest's budget; Neon plus a Redis host
does not add much capability for what it costs.

## What we gave up

- **Latency.** Workers poll every 2 seconds instead of being pushed jobs
  instantly. Irrelevant for a weekly batch.
- **Neon compute hours.** Polling keeps the database awake while `apps/worker`
  runs, so it will not scale to zero. The API does not poll, so it is only the
  worker that holds the database open. For a pilot this is a small cost; if it
  ever matters, run the worker only during the Sunday-night window.
- **Ecosystem.** BullMQ has richer dashboards. `GET /jobs/runs` and the
  `pgboss.job` table cover what the demo needs.

## Neon specifics

- Set `QUEUE_DATABASE_URL` to the **direct** (non-`-pooler`) connection string if
  you see connection errors. The queue holds polling sessions, which fit PgBouncer
  transaction pooling awkwardly.
- `useListenNotify` is off: LISTEN/NOTIFY needs a session-pinned connection that
  the pooler cannot give. pg-boss falls back to polling, which it always does as a
  correctness floor anyway.

## Switching to BullMQ later

The queue is behind `PgBossService` (`send`, `sendMany`, `sendAfter`, `work`,
`depth`). Replace that one class and `ScanWorkers` keeps working. Nothing else
imports pg-boss — and because the handlers live in `apps/worker`, swapping the
queue never touches the HTTP server.
