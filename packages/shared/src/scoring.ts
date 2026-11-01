// Lead scoring. Pure and deterministic: the same inputs always give the same
// score and the same explanation, on the server and on the phone.
//
//   need        = 0.35·newOpening + 0.30·velocitySpike + 0.20·lowStock + 0.15·hoursExtended
//   capacity    = 0.40·logReviews + 0.30·priceLevel    + 0.30·areaPpi
//   bankability = 0.40·hasWebOrPage + 0.30·categoryLendable + 0.30·isMultiBranch
//   total       = 0.40·need + 0.35·capacity + 0.25·bankability
//
// Every input is normalised to 0..1 before it gets here (see features.ts), so
// every pillar and the total are also 0..1.

export const PILLARS = ['need', 'capacity', 'bankability'] as const;
export type Pillar = (typeof PILLARS)[number];

export const PILLAR_WEIGHTS: Readonly<Record<Pillar, number>> = {
  need: 0.4,
  capacity: 0.35,
  bankability: 0.25,
};

/** In display order; this order also breaks ties between equal contributions. */
export const FACTORS = {
  newOpening: { pillar: 'need', weight: 0.35, label: 'Newly opened business' },
  velocitySpike: { pillar: 'need', weight: 0.3, label: 'Sudden jump in customer activity' },
  lowStock: { pillar: 'need', weight: 0.2, label: 'Customers report items out of stock' },
  hoursExtended: { pillar: 'need', weight: 0.15, label: 'Opening hours recently extended' },
  logReviews: { pillar: 'capacity', weight: 0.4, label: 'Established customer base' },
  priceLevel: { pillar: 'capacity', weight: 0.3, label: 'Higher price level' },
  areaPpi: { pillar: 'capacity', weight: 0.3, label: 'High purchasing-power area' },
  hasWebOrPage: { pillar: 'bankability', weight: 0.4, label: 'Has a website or business page' },
  categoryLendable: { pillar: 'bankability', weight: 0.3, label: 'Lendable business type' },
  isMultiBranch: { pillar: 'bankability', weight: 0.3, label: 'Operates multiple branches' },
} as const satisfies Record<string, { pillar: Pillar; weight: number; label: string }>;

export type FactorKey = keyof typeof FACTORS;
export const FACTOR_KEYS = Object.keys(FACTORS) as FactorKey[];

/**
 * One value per factor, each in 0..1. `null` means "we don't know" (e.g. the
 * place has never been enriched): it scores as 0 but is reported in `missing`,
 * so a low score from missing data can be told apart from a genuinely weak lead.
 */
export type ScoringInputs = Record<FactorKey, number | null>;

export interface FactorContribution {
  factor: FactorKey;
  pillar: Pillar;
  label: string;
  /** The normalised input, 0..1. */
  value: number;
  /** How much this factor added to `total` — pillar weight × factor weight × value. */
  contribution: number;
}

export interface LeadScore {
  need: number;
  capacity: number;
  bankability: number;
  /** 0..1. Multiply by 100 for display. */
  total: number;
  /**
   * The (up to) three factors that added the most to `total`, largest first.
   * Factors that added nothing are left out, so a weak lead may have fewer than three.
   */
  topFactors: FactorContribution[];
  /** Every factor in FACTORS order. Contributions sum exactly to `total`. */
  contributions: FactorContribution[];
  /** Factors whose input was `null` and were scored as 0. */
  missing: FactorKey[];
}

export const TOP_FACTOR_COUNT = 3;

export function scoreLead(inputs: ScoringInputs): LeadScore {
  const pillars: Record<Pillar, number> = { need: 0, capacity: 0, bankability: 0 };
  const contributions: FactorContribution[] = [];
  const missing: FactorKey[] = [];

  for (const factor of FACTOR_KEYS) {
    const raw = inputs[factor];
    if (raw === null) missing.push(factor);
    const value = raw ?? 0;
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new RangeError(`Scoring input "${factor}" must be in 0..1, got ${value}`);
    }

    const { pillar, weight, label } = FACTORS[factor];
    pillars[pillar] += weight * value;
    contributions.push({
      factor,
      pillar,
      label,
      value,
      contribution: PILLAR_WEIGHTS[pillar] * weight * value,
    });
  }

  const total =
    PILLAR_WEIGHTS.need * pillars.need +
    PILLAR_WEIGHTS.capacity * pillars.capacity +
    PILLAR_WEIGHTS.bankability * pillars.bankability;

  // Array.prototype.sort is stable, so equal contributions keep FACTORS order.
  const topFactors = contributions
    .filter((c) => c.contribution > 0)
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, TOP_FACTOR_COUNT);

  return { ...pillars, total, topFactors, contributions, missing };
}

/** 0..1 → 0..100, rounded — the number officers see. */
export function toDisplayScore(score: number): number {
  return Math.round(score * 100);
}
