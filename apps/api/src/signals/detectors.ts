// Opening-hours signal. Pure — no I/O, no clock — unit-tested in detectors.spec.ts.
// Review velocity lives in velocity.ts.

import type { SignalType } from '@territory-radar/shared';
import type { OpeningPeriod } from '../database/schema.js';

export interface DetectedSignal {
  type: SignalType;
  /** 0..1 */
  confidence: number;
  /** Our own words — never quoted review text. */
  evidence: string;
}

export interface HoursPoint {
  at: Date;
  openHours: OpeningPeriod[] | null;
}

/** Extra weekly minutes that count as extended hours (5 hours). */
export const HOURS_EXTENDED_MIN_MINUTES = 300;

const WEEK_MINUTES = 7 * 24 * 60;

/** Longer opening hours are a cheap proxy for a business taking on more trade. */
export function detectHoursExtended(series: readonly HoursPoint[]): DetectedSignal | null {
  const points = series.filter((p) => p.openHours !== null);
  if (points.length < 2) return null;

  const before = weeklyOpenMinutes(points.at(-2)!.openHours!);
  const after = weeklyOpenMinutes(points.at(-1)!.openHours!);
  const gained = after - before;
  if (gained < HOURS_EXTENDED_MIN_MINUTES) return null;

  return {
    type: 'hours_extended',
    confidence: round2(Math.min(0.9, 0.5 + gained / (2 * WEEK_MINUTES))),
    evidence: `Open ${round1(after / 60)}h/week, up from ${round1(before / 60)}h`,
  };
}

/** Total minutes open per week. A period with no close means open around the clock. */
export function weeklyOpenMinutes(periods: readonly OpeningPeriod[]): number {
  let total = 0;
  for (const period of periods) {
    if (!period.close) return WEEK_MINUTES;
    const open = period.open.day * 1440 + period.open.hour * 60 + period.open.minute;
    const close = period.close.day * 1440 + period.close.hour * 60 + period.close.minute;
    let span = close - open;
    if (span <= 0) span += WEEK_MINUTES; // wraps past Sunday midnight
    total += span;
  }
  return Math.min(total, WEEK_MINUTES);
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
