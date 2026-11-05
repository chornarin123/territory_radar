# Territory Radar

Lead generation for PPCBank loan officers in Cambodia. The backend scans public
business data area by area, works out which businesses look like they need
credit and could service it, and hands each officer a walking route of the best
prospects to visit.

Built as an entry for PPCBank's internal AI contest, in the Sales and Growth
category.

## Project overview

### The problem

A loan officer's day depends on knowing which businesses to visit, and why now.
Those clues are public but scattered: a new branch, a shop buying equipment, a
business that is hiring. Collecting them by hand takes time that could be spent
meeting customers.

### What Territory Radar does

It turns public signals into a plan for the day, and shows the evidence behind
each suggestion, so the officer can judge it.

| Screen    | What the officer gets                                                                                                       |
| --------- | --------------------------------------------------------------------------------------------------------------------------- |
| Today     | The next visit with why now and what to ask, actions that need attention, new leads, and the biggest change in area demand. |
| Radar     | Prospects on a map, filtered by province, district or sangkat and by signal. **Area demand** shades sangkats by loan type.  |
| Prospects | The full list with filters, and a profile for each business with its signals, evidence and suggested products.              |
| Visits    | Prospects near the officer's location, picked into a day's route, with check-ins. Distances are straight-line, not road.    |
| Profile   | The officer's territory and settings, including Khmer labels.                                                               |

Two AI assistants support this:

- **Discussion coach:** helps the officer prepare for a conversation with a
  specific business.
- **Ask Radar:** answers questions about a sangkat's score only from its evidence,
  citing each point. If the evidence doesn't cover a question, it says so and
  suggests a field check.

A score is a **visit priority, not a loan decision**. Signals are unverified, and
a business may not need financing at all, so the officer always confirms in person.

### Data safety

The contest rule is that customer information, account or transaction data, ID
documents and confidential bank documents must never go into an AI tool.

- Only public data is sent to a model. Officer notes are not.
- Ask Radar's prompt is built from an allowlist of public fields, and a test fails
  if any other field appears.
- Questions containing phone, ID or account numbers are refused before any model
  is called. The device's location stays on the device.

See [docs/data-policy.md](docs/data-policy.md).

### Current status

This is a working demo, not a production system.

- **The app runs on sample data.** Prospects, signals, evidence and area demand
  scores in `data/` are synthetic, and the app labels them as samples. The scores
  are not predictions yet.
- **The app and the scanning backend are not connected.** The app reads a mock
  server. The backend's scan and scoring pipeline is built separately, as described
  below.
- **Before a pilot:** connect the two, replace the sample scores with real model
  output, settle the open legal questions, and add per-officer sign-in.

### Run the demo

From this folder, in two terminals:

```bash
pnpm install
pnpm mock:server   # the demo data and AI endpoints, on port 3002
pnpm mobile:web    # the app in a browser, on port 8081
```

To use a phone, run `pnpm mobile` instead of `pnpm mobile:web` and scan the QR code
with Expo Go. More detail is in [apps/mobile/README.md](apps/mobile/README.md).

## Repository layout

```
territory-radar/
├── apps/
│   ├── api/       NestJS (Fastify) — HTTP: leads, places, officers, job runs
│   ├── worker/    Node service — pg-boss queue handlers, cron schedule, CLI
│   └── mobile/    Expo app for officers — runs against the mock server (see below)
├── packages/
│   └── shared/    Types + the scoring function, used by API and app
├── data/          Synthetic demo workspace, Cambodia's areas and boundaries, sample scores
├── design/        UI_SPEC.md + HTML prototypes: the approved mobile design
├── scripts/       Data loaders, and mock-server.mjs which serves data/data.json
└── docs/          Scoring model, data policy, queueing decision
```

**The mobile app and the backend are two separate demos today.** The app follows
`design/UI_SPEC.md`, which is built on `data/data.json`'s model (prospects,
signals, evidence, visits) served by `scripts/mock-server.mjs`. The NestJS API
serves a different model (places, scores, leads), so nothing in the app reads it
yet. See [apps/mobile/README.md](apps/mobile/README.md).

## How it works

The pipeline runs every Sunday night (`Asia/Phnom_Penh`) as three cron jobs.
Each opens a `job_runs` row and closes it when its work is done — that table is
the proof the system runs on schedule (`GET /jobs/runs`).

| Job             | When        | What it does                                                                                              |
| --------------- | ----------- | --------------------------------------------------------------------------------------------------------- |
| `scan.discover` | Sun 22:00   | Queues one Nearby Search per grid cell × 12 categories, with the cheap field mask.                        |
| `scan.enrich`   | Sun 23:00   | Place Details for new places + a rotating `ENRICH_ROTATION_PCT` slice. Writes snapshots, detects signals. |
| `scan.score`    | Sun 23:30   | Scores fresh places, clusters each sangkat's best into walking routes, assigns them to officers.          |
| `retention`     | daily 04:00 | Clears coordinates past Google's 30-day window.                                                           |

Discover and enrich fan out onto a **pg-boss** queue in the same Postgres
database — no Redis. Why: [docs/queueing.md](docs/queueing.md). A finalizer job
watches each fan-out and closes its `job_runs` row when the queue drains.

### Two processes

```
apps/api      HTTP. Reads leads and job runs, enqueues on request. Scale freely.
apps/worker   Owns the queue handlers and the cron schedule. Run exactly one.
```

They are separate because `@nestjs/schedule` fires in every process that loads
it: with the crons inside the API, running two API instances would start each
Sunday job twice. Only the worker consumes the queue, so the web server can
never be busy spending money on Google when a request comes in.

The worker depends on `@territory-radar/api` for the domain — database, Google
client, signals, scoring, the scan stages — and adds the two things a web server
must not do. Nothing HTTP is exported across that boundary.

Every handler is safe to run twice, which is what makes pg-boss's retries usable:
places are upserted by `place_id`, a place gets one snapshot per day, signals
dedupe within 7 days, and `job_runs` counters merge with `jsonb_set` instead of
being overwritten.

### Running a job by hand — the Demo Day path

```bash
pnpm worker run scan.discover --sangkat=120101
pnpm worker run scan.enrich   --sangkat=120101 --limit=25
pnpm worker run scan.score    --sangkat=120101
```

Run `pnpm build` first; the script runs the compiled `apps/worker/dist/cli.js`.
During development `pnpm --filter @territory-radar/worker cli:dev -- run scan.score`
compiles first — the `--` matters, or the Nest CLI keeps the arguments for itself
and the job never sees them.

The CLI runs **inline** — no queue, no API server needed — printing each search as
it happens, and writes the same `job_runs` row the cron does. `--limit=N` caps
paid calls so a stage demo can't run up a bill. `--queue` hands the work to the
worker service instead. A mistyped job name or flag prints usage and exits
before touching the database or Google.

### Grid scanning

Nearby Search returns at most 20 places, so a dense street comes back truncated.
A cell that returns exactly 20 is marked `saturated`, split into four children,
and the children are scanned in the same run. Seed cells are 350 m, so children
are ≈250 m — radius ÷ √2, the smallest size that still covers the parent without
gaps (four 250 m circles cannot cover a 400 m one).

Rules that keep the diff honest, all unit-tested:

- **Listings flicker.** One miss only bumps `missing_count`. Two consecutive
  misses set `status = missing`. Discovery **never** marks a place closed — only
  an explicit `CLOSED_PERMANENTLY` from Place Details does.
- **A first sighting is not an opening.** `new_opening` (confidence 0.9) only
  fires when the cell had a complete scan before, so seeding a new area doesn't
  report every business in it as newly opened.
- **A capped result proves nothing.** When a cell returns 20, absence isn't
  counted and new places aren't called openings.

### Cost control

Enrichment requests `reviews`, which prices every call at **Enterprise +
Atmosphere, $40 / 1,000**. Every Google call goes through `UsageService`:

- Authorised against `PLACES_MONTHLY_BUDGET` **before** it is sent — including
  each retry, since retries are billed too. When the budget is exhausted the job
  halts cleanly instead of continuing to bill. Check spend with `GET /jobs/usage`.
- `KILL_SWITCH=true` stops all outbound Google and Anthropic calls; crons skip.
- Rate limited to `PLACES_MAX_QPS` across all workers, with exponential backoff
  on 429/5xx. 4xx errors are not retried — they would fail and bill again.
- Every call is logged with its SKU; per-run counts land in `job_runs.api_calls`.
- Reviews arrive with the enrichment call, so mining them with Claude costs no
  extra Google calls.

Per-SKU prices in `usage.service.ts` are list prices with free tiers ignored, so
the budget errs on the high side. Check them against Google's current pricing.

## Scoring

The formula lives in `packages/shared/src/scoring.ts` as a pure function, so it
runs on the server and in the app and is tested without any I/O:

```
need        = 0.35·newOpening + 0.30·velocitySpike + 0.20·lowStock + 0.15·hoursExtended
capacity    = 0.40·logReviews + 0.30·priceLevel    + 0.30·areaPpi
bankability = 0.40·hasWebOrPage + 0.30·categoryLendable + 0.30·isMultiBranch
total       = 0.40·need + 0.35·capacity + 0.25·bankability
```

Every input is normalised to 0..1 first, so the total is 0..1 (×100 for display).
`scoreLead` returns each factor's contribution and the three largest, which is
what the officer sees as "why this lead". Contributions sum exactly to the total
— there is no hidden term. Unknown inputs score 0 and are listed in `missing`.
See [docs/scoring.md](docs/scoring.md).

**Signals** feeding `need`:

| Signal                                                                          | Detected in | Rule                                                                                               |
| ------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------- |
| `new_opening`                                                                   | discover    | Unseen place in a cell that had a complete scan before. Confidence 0.9.                            |
| `velocity_spike`                                                                | enrich      | Reviews/week in the latest interval > 2× the 8-week trailing average, with at least 3 new reviews. |
| `hours_extended`                                                                | enrich      | Weekly opening hours up by 5 h or more.                                                            |
| `low_stock`, `new_opening`                                                      | enrich      | Claude reads the reviews that came back with Place Details.                                        |
| `expansion`, `second_branch`, `renovation`, `long_queue`, `price_increase`      | enrich      | Also from reviews. Stored and shown; not yet weighted in the score.                                |
| Leads are grouped into **walking routes**: each sangkat's best unworked places, |
| chained nearest-neighbour from the top lead with legs under 500 m and at most 8 |
| stops. Whole routes go to the officer whose `assigned_sangkats` covers them.    |

## Data policy

Google Maps Platform restricts caching of Places content. We store `place_id`
(no limit), coordinates (**30 days**, refreshed by each scan and cleared by the
`retention` job), and our own derived metrics — including a one-way hash of the
business name for chain detection. Names, addresses, phone numbers, review text
and photos are never stored; the app fetches them live via
`GET /places/:placeId/live`.

Open questions for legal — the `snapshots` columns, the name hash, and Google's
rule that Places content must appear on a Google map — are in
[docs/data-policy.md](docs/data-policy.md).

Bank rule, separately: officer notes (`leads.outcome_note`) may contain customer
information and are never sent to Claude. Only public Google review text is.

## Getting started

```bash
pnpm install
cp apps/api/.env.example apps/api/.env   # fill in the secrets
pnpm --filter @territory-radar/shared build
pnpm db:migrate                           # app tables; pg-boss creates its own on start
pnpm dev                                  # shared, API and worker, all in watch mode
```

In production the two run as separate processes:

```bash
pnpm --filter @territory-radar/api start   # HTTP on $PORT — scale as needed
pnpm worker:start                          # queue handlers + crons — exactly one
```

Both read `apps/api/.env`; a `.env` in the working directory overrides it.

Then load data and lay the grid:

```bash
export API_KEY=...                        # same value as in apps/api/.env
node scripts/import-areas.mjs areas.json
node scripts/seed-grid.mjs sangkats.geojson
```

Both processes need a reachable database to start: pg-boss connects on boot.

### Commands

| Command                 | Does                                           |
| ----------------------- | ---------------------------------------------- |
| `pnpm check`            | format check + lint + typecheck + tests        |
| `pnpm test`             | unit tests — no network or database            |
| `pnpm db:generate`      | regenerate migrations after editing the schema |
| `pnpm worker run <job>` | run a pipeline job by hand                     |

`packages/shared` builds to `dist/` and the API imports that, so rebuild it (or
run `pnpm dev`, which watches) after changing shared code.

## Known limitations

- **Sangkat attribution is approximate.** `areas` holds no geometry, so cells are
  laid over a bounding box and a place belongs to whichever cell found it first.
  Places near a boundary can land in the neighbouring sangkat. Proper fix:
  store boundaries and do point-in-polygon (PostGIS).
- **One shared API key.** Fine for the pilot, not for a key shipped inside a
  mobile binary. Per-officer auth is needed before rollout.
- **Run exactly one worker.** The queue is safe across instances, but
  `@nestjs/schedule` is not: two workers would start each Sunday job twice. The
  API scales freely; the worker does not. To lift that, move scheduling into
  pg-boss's own `schedule()`, which is instance-safe.
- **Routes are greedy, not optimal.** Nearest-neighbour keeps the best lead first;
  it is not a shortest-tour solver.

## Review mining

`ReviewMiningService` reads the reviews that arrive with Place Details during
`scan.enrich`. For each place it returns signals with paraphrased evidence, a
business scale, and `summary_km` — one Khmer sentence the officer can open a
conversation with. Reviews are never stored, and never put on the queue.

**Which model.** The reference implementation is `claude-sonnet-4-6` via the
Anthropic SDK. A Gemini client implements the same `AiClient` interface, and the
provider is chosen by whichever key is set — Gemini wins only when
`ANTHROPIC_API_KEY` is absent. Set `AI_PROVIDER` to pin it, `AI_MODEL` to
override the model. Both paths go through the same prompt and the same
per-place Zod validation, so nothing below depends on the provider.

- **Batched.** Up to 5 places per call, collected in memory as enrichment runs.
- **Cached.** Keyed by a hash of the review set (plus model and prompt version),
  so unchanged reviews are never analysed twice.
- **Validated per place.** Structured output, then strict Zod checks on each
  place: confidence range, Khmer script in `summary_km`, single sentence, and no
  copied review text. A failing place is retried once, then skipped — the rest of
  the batch is unaffected.
- **No review text stored**, and none sent through the queue. See
  [docs/data-policy.md](docs/data-policy.md).
- Calls and tokens are counted on the run's `job_runs` row; `KILL_SWITCH` stops them.

Officer notes (`leads.outcome_note`) may contain customer information and are
never sent to any AI tool.

### Khmer

`summary_km` is checked end to end on the server side:

| Check                                            | What it proves                                                                                             |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `src/database/khmer-roundtrip.spec.ts`           | Khmer survives a real Postgres engine (PGlite) byte-for-byte, in text and jsonb — and all migrations apply |
| `pnpm --filter @territory-radar/api check:khmer` | The same against your actual database, including `server_encoding`                                         |
| `src/common/khmer-http.spec.ts`                  | The API serves it as `application/json; charset=utf-8`, unescaped                                          |
| `src/leads/khmer-lead-dto.spec.ts`               | The officer's line survives the join mining writes and `GET /leads` reads, and serialises as real Khmer    |
| `packages/shared/test/text.test.ts`              | `truncateGraphemes` never splits a coeng stack                                                             |

Run `check:khmer` once per environment. A Windows Postgres created with a
non-UTF8 encoding is the most likely way to break it.
