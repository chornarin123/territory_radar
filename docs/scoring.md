# The scoring model

Three questions about a business, in the order a lending decision asks them:

1. **Need** — is something happening that creates a financing need _now_?
2. **Capacity** — can it service a loan?
3. **Bankability** — can we actually underwrite it?

A business with all three is worth a visit today. One with capacity but no need
is worth a visit eventually, which is why need carries the most weight.

```
need        = 0.35·newOpening + 0.30·velocitySpike + 0.20·lowStock + 0.15·hoursExtended
capacity    = 0.40·logReviews + 0.30·priceLevel    + 0.30·areaPpi
bankability = 0.40·hasWebOrPage + 0.30·categoryLendable + 0.30·isMultiBranch
total       = 0.40·need + 0.35·capacity + 0.25·bankability
```

Implementation: [`packages/shared/src/scoring.ts`](../packages/shared/src/scoring.ts).
Weights within each pillar sum to 1, and the pillar weights sum to 1, so every
pillar and the total land in 0..1. A test enforces that; if you retune the
weights and it fails, the scale has drifted.

## Inputs

Each factor is normalised to 0..1 before the formula sees it
([`features.ts`](../packages/shared/src/features.ts)).

| Factor             | Source                   | Normalisation                                                                               |
| ------------------ | ------------------------ | ------------------------------------------------------------------------------------------- |
| `newOpening`       | `signals`                | Strongest matching signal in the last 30 days (confidence 0..1).                            |
| `velocitySpike`    | `signals`                | ditto                                                                                       |
| `lowStock`         | `signals` (Claude)       | ditto                                                                                       |
| `hoursExtended`    | `signals`                | ditto                                                                                       |
| `logReviews`       | latest snapshot          | `log(1+n) / log(1+500)`, capped — the 10th review says more than the 400th.                 |
| `priceLevel`       | latest snapshot          | Google's 0..4 ÷ 4.                                                                          |
| `areaPpi`          | `areas.ppi_score`        | Stored already normalised.                                                                  |
| `hasWebOrPage`     | latest snapshot          | Boolean → 1/0.                                                                              |
| `categoryLendable` | `places.primary_type`    | Lookup table, [`category-lendability.ts`](../apps/api/src/scoring/category-lendability.ts). |
| `isMultiBranch`    | `places.is_multi_branch` | Boolean → 1/0.                                                                              |

Missing inputs (`null`) score 0 and are reported in `missing`. That distinction
matters: a never-enriched place looks identical to a genuinely weak one until
you can see which inputs were absent.

## Explainability

`scoreLead` returns a `contribution` per factor — `pillarWeight × factorWeight ×
value` — so contributions add up to the total exactly. `topFactors` is the three
largest, which is what `scores.top_factors` stores and the app shows. Ties break
by the order in `FACTORS`, so the same inputs always produce the same
explanation.

An officer should be able to read the score off the reasons. If the top factors
ever look unrelated to the number, that is a bug, not a modelling nuance.

## Retuning

The weights are business judgement, not fitted parameters — no outcome data
existed when they were written. Once `leads.status` has enough won/declined
outcomes, check each factor against them and retune. Two rules:

- Keep the weights in `FACTORS`/`PILLAR_WEIGHTS` and keep them summing to 1.
- Change the numbers, not the shape, unless you also update the tests that pin
  the formula — they exist so a retune is a deliberate act.

The same applies to the detector thresholds in
[`detectors.ts`](../apps/api/src/signals/detectors.ts): a velocity spike is
"≥3 new reviews and ≥2× the previous rate", which is a guess that should be
checked against real Cambodian SME data.

## Review-derived signals

Claude's review mining emits `new_opening` and `low_stock`, which feed the
existing `newOpening` and `lowStock` factors (the strongest signal of a type
wins, whatever its source).

It also emits five types the formula does **not** weight yet:
`expansion`, `second_branch`, `renovation`, `long_queue`, `price_increase`.
They are stored and shown to officers. Adding them to `scoreLead` means choosing
weights and updating the tests that pin the formula — a deliberate decision, not a
side effect. Obvious candidates: `long_queue` into need, `second_branch` into
bankability alongside `isMultiBranch`.
