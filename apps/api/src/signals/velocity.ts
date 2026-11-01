// Review velocity: our proxy for foot traffic, and the basis of velocity_spike.
// Pure — no I/O, no clock — unit-tested in velocity.spec.ts.

export interface ReviewPoint {
  at: Date;
  reviewCount: number | null;
}

export interface VelocityReading {
  /** Reviews per week over the most recent interval. */
  velocityPerWeek: number;
  /** Reviews per week over the 8 weeks before that interval. */
  trailingAvgPerWeek: number;
  /** New reviews in the most recent interval. */
  delta: number;
  isSpike: boolean;
  /** 0..1, higher when the jump is both large and sharp. */
  confidence: number;
  /** Our own words — numbers only, never review text. */
  evidence: string;
}

/** Baseline window, as the spec requires. */
export const TRAILING_WEEKS = 8;
/** A spike is a rate more than this multiple of the trailing average. */
export const SPIKE_MULTIPLE = 2;
/** Below this many new reviews the ratio is noise, not a signal. */
export const MIN_REVIEW_DELTA = 3;

const WEEK_MS = 7 * 86_400_000;

/**
 * `series` must be sorted oldest-first. Returns null when there is not enough
 * history to compare against — a brand new place has no baseline, and guessing
 * one would manufacture signals.
 */
export function computeReviewVelocity(series: readonly ReviewPoint[]): VelocityReading | null {
  const points = series.filter((p) => p.reviewCount !== null);
  if (points.length < 3) return null;

  const latest = points.at(-1)!;
  const previous = points.at(-2)!;
  const weeks = (latest.at.getTime() - previous.at.getTime()) / WEEK_MS;
  if (weeks <= 0) return null;

  const delta = latest.reviewCount! - previous.reviewCount!;
  const velocityPerWeek = delta / weeks;

  // Baseline: everything in the 8 weeks leading up to the previous snapshot.
  const windowStart = previous.at.getTime() - TRAILING_WEEKS * WEEK_MS;
  const baseline = points.filter(
    (p) => p.at.getTime() >= windowStart && p.at.getTime() <= previous.at.getTime(),
  );
  const earliest = baseline[0]!;
  const baselineWeeks = (previous.at.getTime() - earliest.at.getTime()) / WEEK_MS;
  if (baselineWeeks <= 0) return null;

  const trailingAvgPerWeek = (previous.reviewCount! - earliest.reviewCount!) / baselineWeeks;
  const isSpike =
    delta >= MIN_REVIEW_DELTA && velocityPerWeek > SPIKE_MULTIPLE * Math.max(trailingAvgPerWeek, 0);

  const ratio =
    trailingAvgPerWeek > 0 ? velocityPerWeek / trailingAvgPerWeek : Number.POSITIVE_INFINITY;
  const ratioScore = Math.min(1, (Math.min(ratio, 10) - SPIKE_MULTIPLE) / 4);
  const volumeScore = Math.min(1, delta / 15);
  const confidence = round2(0.5 + 0.5 * Math.max(0, Math.max(ratioScore, volumeScore)));

  return {
    velocityPerWeek: round2(velocityPerWeek),
    trailingAvgPerWeek: round2(trailingAvgPerWeek),
    delta,
    isSpike,
    confidence,
    evidence:
      `+${delta} reviews in ${round1(weeks)} weeks ` +
      `(${round2(velocityPerWeek)}/week vs ${round2(trailingAvgPerWeek)}/week over the prior ${TRAILING_WEEKS} weeks)`,
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
