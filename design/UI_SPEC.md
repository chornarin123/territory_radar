# Territory Radar — Mobile UI Spec (v2)

Source of truth for the Expo app (`apps/mobile`). Visual reference: the HTML prototypes in
`design/prototype/*.dc.html` (open in a browser, or read the markup — every style is inline).
Data: `data.json` via `scripts/mock-server.mjs`. Do not invent fields; use the names below.

## 1. Design tokens (create `apps/mobile/src/theme/tokens.ts`)

| Token | Value | Use |
|---|---|---|
| navy | #12305A | primary, header bg, selected chips, High band |
| navyDeep | #1D3F70 | stat tiles on navy |
| navyLine | #3A5684 | borders on navy |
| blue | #5B83BE | Medium band |
| blueTint | #E6EDF7 | status pill bg |
| grey | #9AA0AA | Low band |
| bg | #F3F4F6 | screen background |
| surface | #FFFFFF | cards |
| border | #E2E4E9 | card border |
| borderStrong | #C5CCD8 | unselected chip / outline button |
| divider | #EEF1F5 | row separators |
| text | #15171C | primary text |
| text2 | #3B3F47 | body |
| text3 | #555A64 | captions |
| warnBg / warnText / warnDot | #FBEBD3 / #6B3005 / #C2620F | demo banner, flags |
| okBg / okText | #E5F2E8 / #1F5E33 | confirmed |
| pendBg / pendText | #FDF0E3 / #8A3F06 | interest unconfirmed |

Type: IBM Plex Sans (400/500/600/700) for UI, IBM Plex Mono 600 for numbers (scores, times, km),
Noto Sans Khmer for km labels. Use `@expo-google-fonts/ibm-plex-sans`, `.../ibm-plex-mono`, `.../noto-sans-khmer`.
Sizes: screen title 22/700, card title 15/700, item title 16/600, body 13–14, caption 12, pill 11/600.
Radius: card 16, button 12, chip 999 (filter-row chips) or 12 (filter-screen chips), pill 6.
Spacing: screen padding 16, card padding 14, gap 8–12. Touch targets ≥ 44 px.
Icons: `lucide-react-native` (already installed), stroke 2, size 22 in tab bar.

## 2. Shared components (`apps/mobile/src/components/ui/`)

- `DemoBanner` — amber strip "Demo data · fictional businesses"; show when `settings.showSyntheticDataBanner`.
- `TabBar` — 5 tabs from `uiCopy[locale]`: home/Today, radar/Radar, pipeline/Prospects, visits/Visits, profile/Profile.
- `ScoreBadge` — 40×40, radius 12, mono 15/600 white on band color (high navy / medium blue / low grey).
- `StatusPill` — label from status map below, blueTint bg.
- `InterestPill` — confirmed → ok, not_interested → grey, unknown → pend. Labels: "Interest confirmed" / "No financing need" / "Interest unconfirmed".
- `FlagPill` — outlined orange "⚠ <label>" for each `dataQuality.flags[]`.
- `Chip` (selected / unselected / disabled-with-0-count) with optional count badge.
- `Card`, `SectionLabel` (12/700, letter-spacing 0.05em, uppercase), `PrimaryButton`, `OutlineButton`, `Toggle`.

Status labels: new New · contacted Contacted · qualified Qualified · visit_planned Visit planned ·
follow_up Follow-up · unreachable Unreachable · application_referred Referred · not_interested Not interested · closed Closed.
Flag labels: limited_operating_history Limited history · missing_coordinates No map pin ·
stale_evidence Stale evidence · conflicting_address Address conflict.

## 3. Screens

Navigation: bottom tabs (Today, Radar, Prospects, Visits, Profile) + stack for ProspectDetail and Filters (modal).
Only show prospects of the signed-in officer (`assignmentOfficerId`), default `metadata.defaultOfficerId`.
"Now" = `metadata.asOf` when `fixedClock` is true.

1. **Today** (`Today.dc.html`) — navy header: date, branch, "Good morning, <first name>", avatar initials;
   3 stat tiles (active prospects, status=new, visits today). Alerts list from `notifications` (unread = navy border + orange dot; tap marks read).
   "Today's visits" card from `visits` of today's route. "Follow-ups" checklist from `tasks` (overdue in orange-red).
2. **Radar** (`Radar.dc.html`) — signal-type chips (Expansion, Equipment, Stock & trade, New opening, Housing & employer)
   map pins = `location`, colored by `priority.band`, label = score; selected pin orange ring + bottom card.
   Exclude closed / not_interested. Prospects with `location: null` are list-only — say how many in the card footer.
3. **Prospects** (`Prospects.dc.html`) — title + **Filters** button (opens screen 4); status chips row;
   toggles "Priority ≥ 60" (`settings.defaultProspectFilter.minScore`) and "Hide no-need" (`excludeNotInterestedFromRecommendations`).
   Card: ScoreBadge, name, sector · commune, StatusPill, signal line (first non-directory signal title, "weak signal" suffix, ⏱ if stale),
   InterestPill, "Discuss: <product short name>", FlagPills. Sorted by score desc. Empty state uses `uiCopy.emptyTitle` / `emptyAction`.
4. **Filters** (`Filters.dc.html`) — modal. Quick views (New to review, Ready to visit, Needs checking, Trade & stock);
   multi-select chip groups: Sangkat, Discussion category, Signal, Pipeline status (grouped), Priority band, Financing interest;
   toggles: hide flagged, fresh evidence only, has map location; sort (priority / newest signal / name).
   **Each chip shows the count it would leave given the other active filters; 0 = disabled style.**
   Live top-3 preview, sticky footer "N filters active · X of Y prospects" + "Show X prospects". Reset clears all.
   Filter state lives in a shared store/context so Prospects + Radar use it.
5. **ProspectDetail** (`Prospect.dc.html`) — name, sector, commune, operating months; pills (status, interest, "Needs officer verification" if `dataQuality.requiresOfficerVerification`).
   **Visit priority** navy card: score/100 + caption "Not a loan probability" + 5 factor bars from `priority.factors` / `priority.maxPoints`.
   Signals & evidence: each signal title, strength pill, `interpretation`, evidence source + date + verification; footer note from `signal.limitations`.
   **Suggested discussion** from `productMatches` (rank 1): product name, caption "Not an eligibility decision", segmented tabs
   Opening line (`suggestedOpening`) / Ask (`discoveryQuestions`) / Still to verify (`unverifiedRequirements`).
   Record outcome: "Interest confirmed" / "No financing need" buttons; "Move to" buttons = `stateTransitions[currentStatus]`; activity log from `activities`.
   Footer: "Plan a visit" primary; Call disabled when `!contact.canCall || !settings.allowExternalContactActions`.
6. **Visits** (`Visits.dc.html`) — route map (start = `routePlans[].startLocation`), stat bar (visits, straight-line km, completed);
   "Optimize route order" = nearest-neighbour on haversine, labelled "Simulated straight-line distances, not real road navigation";
   visit cards: number, name, time, objective, contact/location verified pills, Check in → outcome buttons (Interested / Follow-up / No need).
7. **Profile** (`Profile.dc.html`) — officer header, language EN/ខ្មែរ (km = labels only per `metadata.translationCoverage`),
   territory sangkats with prospect counts, safeguards list (settings flags), discussion categories with placeholder disclaimer, data disclaimer.

## 4. Rules that must hold
- Never show a score as a loan probability or "% chance".
- Never auto-set financing interest; only officer actions change it.
- Never show prospects outside the officer's territory.
- Demo banner and product placeholder disclaimer stay visible.
- Works on web (`pnpm mobile:web`) and Android at 390 px width.
