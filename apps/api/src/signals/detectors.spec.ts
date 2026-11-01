import { describe, expect, it } from 'vitest';
import { detectHoursExtended, HOURS_EXTENDED_MIN_MINUTES, weeklyOpenMinutes } from './detectors.js';
import type { HoursPoint } from './detectors.js';
import type { OpeningPeriod } from '../database/schema.js';

const day = (n: number) => new Date(Date.UTC(2026, 8, 1) + n * 86_400_000);

/** Open `hours` a day, every day. */
const dailyHours = (hours: number): OpeningPeriod[] =>
  Array.from({ length: 7 }, (_, dayOfWeek) => ({
    open: { day: dayOfWeek, hour: 8, minute: 0 },
    close: { day: dayOfWeek, hour: 8 + hours, minute: 0 },
  }));

describe('weeklyOpenMinutes', () => {
  it('adds up a normal week', () => {
    expect(weeklyOpenMinutes(dailyHours(8))).toBe(7 * 8 * 60);
  });

  it('treats a period with no close as always open', () => {
    expect(weeklyOpenMinutes([{ open: { day: 0, hour: 0, minute: 0 } }])).toBe(7 * 24 * 60);
  });

  it('handles hours that run past midnight', () => {
    const overnight: OpeningPeriod[] = [
      { open: { day: 5, hour: 18, minute: 0 }, close: { day: 6, hour: 2, minute: 0 } },
    ];
    expect(weeklyOpenMinutes(overnight)).toBe(8 * 60);
  });

  it('handles a period that wraps past Sunday', () => {
    const wrap: OpeningPeriod[] = [
      { open: { day: 6, hour: 22, minute: 0 }, close: { day: 0, hour: 2, minute: 0 } },
    ];
    expect(weeklyOpenMinutes(wrap)).toBe(4 * 60);
  });

  it('never reports more than a full week', () => {
    expect(weeklyOpenMinutes(dailyHours(24))).toBe(7 * 24 * 60);
  });
});

describe('detectHoursExtended', () => {
  const withHours = (hours: OpeningPeriod[]): HoursPoint => ({
    at: day(0),
    openHours: hours,
  });

  it('fires when weekly hours grow by the threshold or more', () => {
    const signal = detectHoursExtended([withHours(dailyHours(8)), withHours(dailyHours(10))]);
    expect(signal).not.toBeNull();
    expect(signal!.type).toBe('hours_extended');
    expect(signal!.evidence).toContain('70h/week');
  });

  it('ignores a change below the threshold', () => {
    const barelyMore: OpeningPeriod[] = [
      ...dailyHours(8).slice(1),
      { open: { day: 0, hour: 8, minute: 0 }, close: { day: 0, hour: 12, minute: 0 } },
    ];
    const before = weeklyOpenMinutes(dailyHours(8));
    const after = weeklyOpenMinutes(barelyMore);
    expect(after - before).toBeLessThan(HOURS_EXTENDED_MIN_MINUTES);
    expect(detectHoursExtended([withHours(dailyHours(8)), withHours(barelyMore)])).toBeNull();
  });

  it('ignores shorter hours', () => {
    expect(detectHoursExtended([withHours(dailyHours(12)), withHours(dailyHours(8))])).toBeNull();
  });

  it('needs two snapshots with hours', () => {
    expect(detectHoursExtended([withHours(dailyHours(8))])).toBeNull();
  });

  it('keeps confidence at or below 0.9', () => {
    const signal = detectHoursExtended([withHours(dailyHours(2)), withHours(dailyHours(24))]);
    expect(signal!.confidence).toBeLessThanOrEqual(0.9);
  });
});
