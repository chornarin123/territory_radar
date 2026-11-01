# Data policy

Two separate rules apply: Google's terms for Places content, and PPCBank's rule
about what may go into an AI tool.

## What we store

| Data                                         | Where            | Retention                                                                                          |
| -------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------- |
| `place_id`                                   | `places`         | Indefinite — exempt from Google's caching limits.                                                  |
| Coordinates                                  | `places.lat/lng` | **30 days.** Refreshed by each scan; the `retention` job nulls them for places unseen for 30 days. |
| Grid cells, statuses, signals, scores, leads | everywhere else  | Ours. No limit.                                                                                    |

Never stored: business names, addresses, phone numbers, review text, photos.
The app gets them from `GET /places/:placeId/live`, which calls Google on every
request and sends `Cache-Control: no-store`.

Business names are held in memory during enrichment and never written. To spot
chains, only a one-way hash of the normalised name is kept (`places.name_hash`,
SHA-256 truncated to 128 bits); `is_multi_branch` is set when the same hash appears
at two or more place ids. The name cannot be recovered from the hash — but a
common name ("Coffee Shop") can be confirmed by hashing a guess, so treat
`name_hash` as derived-but-sensitive and include it in the legal review.

Discovery uses the cheap field mask (`places.id,places.location,places.primaryType`),
so no name ever reaches the discovery step at all.

## Open questions — decide before production

**1. The `snapshots` table.** It stores `review_count`, `rating`, `price_level`
and `open_hours`, and `places.primary_type`. These are values copied from Google,
not values we derived, so they sit outside the "place_id + coordinates + our own
metrics" rule this project set itself. The Places policies say only place IDs are
exempt from the caching restriction.

Two ways to resolve it:

- Get written confirmation from Google or legal that keeping them is acceptable.
- Or store only derived values: the review-count _delta_ between enrichments
  rather than the count, an "hours extended" boolean rather than the schedule, a
  price band rather than Google's level. Velocity and hours signals both work
  from deltas. `logReviews` (capacity) genuinely needs an absolute count, so that
  factor would have to be re-thought or dropped.

The second option is the safer default if the answer is slow to arrive.

**2. Maps must be Google.** Service Specific Terms §14.2: Places content must not
be shown in conjunction with a non-Google map. The Expo app must therefore use
Google Maps (`react-native-maps` with `PROVIDER_GOOGLE`), not Apple Maps or an
OSM tile layer. Worth settling before the map screen is built.

**3. Review text and Claude.** Review text is sent to the Anthropic API for
`low_stock` classification and is not retained by us. The terms reviewed here
don't address sending Places content to a third-party model, and §10 covers a
different arrangement (Google's own grounded output). Confirm this use is
acceptable before the pilot, and note that what we keep is the model's own
paraphrase, never the review.

Sources: [Places policies](https://developers.google.com/maps/documentation/places/web-service/policies),
[Service Specific Terms §14](https://cloud.google.com/maps-platform/terms/maps-service-terms).
Neither is legal advice — this is a summary for the team, to be checked.

## Claude review mining

During `scan.enrich`, the reviews that come back with Place Details are read by
`claude-sonnet-4-6` to extract signals and write a Khmer opening line for the
officer.

**What Claude receives:** public Google review text for up to 5 places per call,
with an opaque key per place (`P1`, `P2`…) — not the place id, name or address.

**Where review text lives:** in process memory only, for a few seconds. It is
never written to Postgres, logs or `job_runs` — and deliberately never passed
through the pg-boss queue, whose jobs are stored in Postgres. That is why reviews
are batched in memory rather than as queued jobs.

**What we keep** (`review_analyses` and `signals`):

| Field                            | Nature                                               |
| -------------------------------- | ---------------------------------------------------- |
| `signals.evidence`               | Claude's English paraphrase, under 25 words          |
| `review_analyses.summary_km`     | One Khmer sentence for the officer, a paraphrase     |
| `review_analyses.business_scale` | `micro` / `small` / `medium`                         |
| `review_analyses.reviews_hash`   | SHA-256 of the normalised review set — the cache key |

**How "never a quote" is enforced, not just requested:** every evidence string and
summary is compared against the reviews it came from. A run of 30 or more
characters copied from any review (case- and whitespace-insensitive, and working
for Khmer, which has no spaces) rejects that place's result. It is retried once,
then skipped — nothing is stored for it.

`reviews_hash` is non-reversible, but like `name_hash` it can confirm a guessed
review set. Include both in the legal review.

## The bank's rule

> Never put customer information, account or transaction data, ID documents, or
> confidential bank documents into any AI tool.

What the system sends to Claude: public Google review text, nothing else. In
particular `leads.outcome_note` — an officer's free-text notes after a visit,
which may well name a customer — is stored and shown back to that officer, and
never sent anywhere. If a future feature wants to summarise officer notes, that
is the rule it has to clear first.
