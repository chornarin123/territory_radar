// Turns raw observations into the 0..1 inputs `scoreLead` expects.
// Kept next to the formula so "what does 0.6 mean?" has one answer.

import type { SignalType } from './enums.js';

/** Review count at which `logReviews` reaches 1. Small SMEs rarely pass a few hundred. */
export const REVIEW_SATURATION = 500;

/** log(1 + n) / log(1 + saturation), capped at 1 — the 10th review matters more than the 400th. */
export function normaliseLogReviews(
  reviewCount: number | null,
  saturation = REVIEW_SATURATION,
): number | null {
  if (reviewCount === null) return null;
  if (!(reviewCount >= 0) || !(saturation > 0)) {
    throw new RangeError('reviewCount must be >= 0 and saturation > 0');
  }
  return Math.min(1, Math.log1p(reviewCount) / Math.log1p(saturation));
}

/** Google price level 0 (free) … 4 (very expensive) → 0..1. */
export function normalisePriceLevel(level: number | null): number | null {
  if (level === null) return null;
  if (!Number.isInteger(level) || level < 0 || level > 4) {
    throw new RangeError(`priceLevel must be an integer 0..4, got ${level}`);
  }
  return level / 4;
}

export function booleanInput(value: boolean | null): number | null {
  return value === null ? null : value ? 1 : 0;
}

export interface SignalObservation {
  type: SignalType;
  detectedAt: Date;
  /** 0..1 */
  confidence: number;
}

/** How far back a signal still counts towards the score. */
export const SIGNAL_LOOKBACK_DAYS = 30;

const DAY_MS = 86_400_000;

/**
 * Strength of one signal type for one place: the highest confidence among
 * signals of that type detected in the last `lookbackDays` (inclusive of `now`).
 * No signal is a real 0, not missing data.
 */
export function signalStrength(
  signals: readonly SignalObservation[],
  type: SignalType,
  { now, lookbackDays = SIGNAL_LOOKBACK_DAYS }: { now: Date; lookbackDays?: number },
): number {
  const since = now.getTime() - lookbackDays * DAY_MS;
  let strength = 0;
  for (const s of signals) {
    const at = s.detectedAt.getTime();
    if (s.type !== type || at < since || at > now.getTime()) continue;
    strength = Math.max(strength, Math.min(1, Math.max(0, s.confidence)));
  }
  return strength;
}

const EARTH_RADIUS_KM = 6371;

/** Computes great-circle distance between two coordinates in kilometers. */
export function haversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}
