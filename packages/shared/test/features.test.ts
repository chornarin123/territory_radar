import { describe, expect, it } from 'vitest';
import {
  booleanInput,
  normaliseLogReviews,
  normalisePriceLevel,
  signalStrength,
} from '../src/index.js';
import type { SignalObservation } from '../src/index.js';

const day = (n: number) => new Date(Date.UTC(2026, 8, 1) + n * 86_400_000);

describe('normaliseLogReviews', () => {
  it('is 0 at zero reviews and 1 at saturation', () => {
    expect(normaliseLogReviews(0)).toBe(0);
    expect(normaliseLogReviews(500)).toBeCloseTo(1);
  });

  it('caps at 1 past saturation', () => {
    expect(normaliseLogReviews(50_000)).toBe(1);
  });

  it('rewards early reviews more than later ones', () => {
    const first10 = normaliseLogReviews(10)! - normaliseLogReviews(0)!;
    const next10 = normaliseLogReviews(400)! - normaliseLogReviews(390)!;
    expect(first10).toBeGreaterThan(next10 * 10);
  });

  it('passes unknown through as null', () => {
    expect(normaliseLogReviews(null)).toBeNull();
  });

  it('rejects negative counts', () => {
    expect(() => normaliseLogReviews(-1)).toThrow(RangeError);
  });
});

describe('normalisePriceLevel', () => {
  it.each([
    [0, 0],
    [2, 0.5],
    [4, 1],
    [null, null],
  ])('maps %s to %s', (level, expected) => {
    expect(normalisePriceLevel(level)).toBe(expected);
  });

  it.each([5, -1, 1.5])('rejects %s', (level) => {
    expect(() => normalisePriceLevel(level)).toThrow(RangeError);
  });
});

describe('booleanInput', () => {
  it('maps true/false/unknown', () => {
    expect([booleanInput(true), booleanInput(false), booleanInput(null)]).toEqual([1, 0, null]);
  });
});

describe('signalStrength', () => {
  const now = day(40);
  const signals: SignalObservation[] = [
    { type: 'low_stock', detectedAt: day(35), confidence: 0.6 },
    { type: 'low_stock', detectedAt: day(20), confidence: 0.9 },
    { type: 'low_stock', detectedAt: day(5), confidence: 1 }, // older than 30 days
    { type: 'velocity_spike', detectedAt: day(39), confidence: 0.7 },
    { type: 'low_stock', detectedAt: day(41), confidence: 1 }, // in the future
  ];

  it('takes the strongest signal of that type inside the lookback window', () => {
    expect(signalStrength(signals, 'low_stock', { now })).toBe(0.9);
  });

  it('includes a signal exactly at the window edge and ignores one just outside it', () => {
    const edge: SignalObservation[] = [
      { type: 'low_stock', detectedAt: day(20), confidence: 0.4 },
      { type: 'low_stock', detectedAt: new Date(day(20).getTime() - 1), confidence: 1 },
    ];
    expect(signalStrength(edge, 'low_stock', { now: day(50) })).toBe(0.4);
  });

  it('is 0 when there is no signal of that type', () => {
    expect(signalStrength(signals, 'hours_extended', { now })).toBe(0);
  });

  it('respects a custom lookback', () => {
    expect(signalStrength(signals, 'low_stock', { now, lookbackDays: 7 })).toBe(0.6);
  });
});
