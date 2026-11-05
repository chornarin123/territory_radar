# apps/mobile

The loan officer's app, built to [design/UI_SPEC.md](../../design/UI_SPEC.md) and the
HTML prototypes in `design/prototype/`. Five tabs — Today, Radar, Prospects, Visits,
Profile — plus a prospect detail screen and a Filters modal.

```bash
# from the repo root, in two terminals
pnpm mock:server        # serves data/data.json on :3002
pnpm mobile:web         # Expo web on :8081 — the demo target
```

The mock server keeps changes in memory. **Restart it to reset the demo** to its
starting state after a rehearsal.

**On a phone (Expo Go):** run `pnpm mobile` instead of `mobile:web` and scan the
QR code. Phone and computer must be on the same Wi-Fi. The app swaps
`localhost` in `EXPO_PUBLIC_API_URL` for the address in the QR code, so there's
nothing to edit. If the address under the QR code isn't your Wi-Fi IP (VMware
or VPN adapters can win), start with that IP set:
`$env:REACT_NATIVE_PACKAGER_HOSTNAME="192.168.x.x"; pnpm mobile`.

## Where the data comes from

The app reads one bundle, `GET /workspace?officerId=…`, from
`scripts/mock-server.mjs`, and writes back through a few small actions. Those
endpoints live in [scripts/mock-workspace.mjs](../../scripts/mock-workspace.mjs).

| Action             | Endpoint                                 |
| ------------------ | ---------------------------------------- |
| Mark alert read    | `PATCH /notifications/:id`               |
| Tick a follow-up   | `PATCH /tasks/:id`                       |
| Record interest    | `POST /prospects/:id/interest`           |
| Move pipeline step | `POST /prospects/:id/transition`         |
| Check in / outcome | `POST /visits/:id/check-in` · `/outcome` |

After every write the app refetches the workspace rather than patching its own
copy — the data set is small, and it can't drift from the server that way.

**This is not the NestJS API.** The spec is built on `data.json`'s model; `apps/api`
serves places, scores and leads, which no screen reads yet. The Khmer opener from
review mining (`summary_km`) is therefore not in the app today.

## Rules the code enforces (spec §4)

- **Territory.** The server only sends prospects that are assigned to the officer
  _and_ inside their territory. Every write is checked against the same set, so a
  prospect outside it can't be read or changed from the app.
- **No inferred interest.** Financing interest only changes from an officer action:
  the two "Record outcome" buttons, or a visit outcome.
- **Legal moves only.** "Move to" lists `stateTransitions[current]` from data.json;
  the server rejects anything else with a 409.
- **Never a probability.** Scores are labelled "Visit priority … Not a loan
  probability" wherever the number appears large.
- **Disclaimers.** The spec's demo banner ("Demo data · fictional businesses")
  was removed at the owner's request, so `settings.showSyntheticDataBanner` no
  longer does anything. The fictional-data disclaimer and the product placeholder
  note are on Profile. Say the data is synthetic when presenting.
- **Time is fixed.** "Now" is `metadata.asOf`, always read in Phnom Penh time, so a
  phone set to another zone sees the same "today" and the same overdue tasks.

## Layout

```
src/
  api/client.ts           fetch wrapper + one function per endpoint
  data/types.ts           data.json's shapes — field names unchanged
  data/selectors.ts       pure: filtering, per-chip counts, sorting, route order
  data/selectors.test.ts  vitest, against the real data.json
  data/WorkspaceProvider  loads the workspace, runs writes, holds the locale
  data/FilterContext      one filter state shared by Filters, Prospects and Radar
  theme/tokens.ts         every colour, font and size from spec §1
  components/ui/          spec §2 components (ScoreBadge, pills, Chip, Toggle…)
  components/map/         Leaflet map: iframe on web, WebView on Android
  screens/                one file per screen
```

## Behaviour worth knowing

- **Filter counts.** Each chip shows how many prospects it would leave given the
  _other_ active filters, and 0 renders in the disabled style. The counts also
  apply the Prospects screen's "Priority ≥ 60" and "Hide no-need" toggles, so
  "Show X prospects" is exactly what the list then shows; the footer says when
  those toggles are on.
- **Radar** uses the shared filters too, but not those two list-only toggles. It
  shows every live prospect, excluding closed and no-need, so a low-priority
  pin can appear there and not in the list.
- **Sample prospects.** `node scripts/add-sample-prospects.mjs` adds 60 generated
  prospects (`prospect_s001`…) to `data.json` for officer_001, 15 in each demo
  sangkat, each pinned inside its sangkat's real polygon, with a signal, evidence
  and product match. All synthetic; re-running replaces the batch.
- **Today** says what to do next: next visit, actions, new leads, area pulse. Its
  numbers come from the shared visit plan and workspace, so they match Visits and
  Radar. With nothing saved for the day, the plan starts from the server's route.
  `why_now`, `ask_about`, `first_seen_at` and `lastScanAt` are **sample** fields
  (`scripts/add-today-sample-fields.mjs`). Snoozes and the plan live on the device,
  so restarting the mock server doesn't reset them; clear the app's storage to
  rehearse from the start. "Not relevant" is stored on the prospect; no scan reads
  it yet.
- **Visits** opens on **Plan visits**: live prospects within 500 m – 5 km of the
  officer's GPS position (`expo-location`, watched only while the tab is focused,
  updates under 50 m ignored), ticked into today's plan, then shown as a route.
  The position never leaves the device. With location off, "Use my branch
  instead" measures from the branch. Today's plan (ticks, order, check-ins) is
  kept in AsyncStorage. Distances are straight-line and the "optimized" order is
  greedy nearest-neighbour (`src/data/visitPlan.ts`), not road routing. Check-ins
  here are local to the plan and don't call the server's visit endpoints.
- **Area demand** (Radar's second view): sangkats shaded by predicted demand for
  one loan type, plus each sangkat's loan mix. Its scope follows the shared area
  filter (a khan, or the whole province). The numbers come only from
  `getAreaDemand()` (`src/data/useAreaDemand.ts`), which today reads
  `data/area_demand.json`, a deterministic **sample** written by
  `node scripts/generate-area-demand.mjs`; swap the source there for the model's
  output. Khan outlines are the union of their sangkat polygons (`@turf/union`,
  server side), not `boundaries/districts.geojson`, whose older outlines don't
  match today's sangkats. Sangkats with only a point in `address.json` (e.g. 2 in
  Saensokh) are drawn as shaded circles.
- **Why this score / Ask Radar** (from the Area demand sangkat card): the
  evidence behind a score, and a chat that answers only from it. The mock server
  builds each pack (`scripts/evidence.mjs`) from **sample** public facts in
  `data/evidence_sample.json` (Phnom Penh only; regenerate with
  `node scripts/generate-evidence-sample.mjs`) and the OSM tags per loan type in
  `data/evidence_config.json`. Points always sum to the score. A field allowlist
  is checked before a pack is served and, stricter, before it enters a prompt
  (no coordinates, no officer feedback). Ask Radar (`scripts/radar-ask.mjs`)
  uses the coach's model setup (Claude, else Gemini, else answers built from the
  pack), refuses customer details, allows 30 questions an hour per officer,
  strips citations the pack doesn't have, and logs no answer text. Feedback is
  kept in memory, one per officer, area, loan type and scan.
- **Area filter on Radar**: the button at the top right opens a sheet over all
  of Cambodia (`data/address.json`: 25 provinces, 210 districts, 1,652
  communes), with drill-down, breadcrumb and search in English or Khmer. The
  filter stores area codes at any level ("12", "1201", "120101"), shared with
  the Sangkat chips on the Filters screen. Ticks merge into the parent once every
  sibling is ticked and split when you untick inside a ticked area
  (`src/data/areas.ts`). Prospects only have lat/lng, so the mock server finds
  each one's commune by point-in-polygon when it loads
  (`scripts/area-codes.mjs`); the app never downloads the commune polygons for
  that. After Apply the map frames the picked areas and outlines them, loading
  `GET /boundaries/{provinces|districts|communes}` only for the levels picked.
- **Signal groups** come from `signal.type`, not from matching words in the
  title as the prototype does. `directory_presence` is context, not a signal.
- **"Needs checking"** shows flagged or stale prospects, matching its own
  label. The prototype selected medium and low priority instead.
- **The map** opens on Esri World Imagery (satellite, with road and place
  labels). The layer switcher under the zoom buttons changes it to OpenStreetMap's
  standard tiles. Neither needs an API key. All the coordinates shown are synthetic.

## Khmer

`ខ្មែរ` on Profile switches the labels (`uiCopy.km`). The data's
`translationCoverage` says _labels only_, so signals and notes stay in English. Any
text containing Khmer switches to Noto Sans Khmer automatically (`Txt`), with extra
line height so stacked consonants aren't clipped.

## Checks

```bash
pnpm --filter @territory-radar/mobile typecheck
pnpm --filter @territory-radar/mobile test
```

Verified on web at 390 × 844. **Not yet checked on an Android device** — open it in
Expo Go to confirm the map's WebView and the Khmer fonts.
