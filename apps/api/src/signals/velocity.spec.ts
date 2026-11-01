import { describe, expect, it } from 'vitest';
import { computeReviewVelocity, MIN_REVIEW_DELTA, SPIKE_MULTIPLE } from './velocity.js';
import type { ReviewPoint } from './velocity.js';

const week = (n: number) => new Date(Date.UTC(2026, 6, 5) + n * 7 * 86_400_000);
const at = (weekNumber: number, reviewCount: number | null): ReviewPoint => ({
  at: week(weekNumber),
  reviewCount,
});

describe('computeReviewVelocity', () => {
  it('computes velocity as new reviews per week over the latest interval', () => {
    const reading = computeReviewVelocity([at(0, 10), at(8, 18), at(10, 24)]);
    expect(reading).toMatchObject({ delta: 6, velocityPerWeek: 3 });
  });

  it('averages the trailing rate over the 8 weeks before the latest interval', () => {
    // 8 reviews in the 8 weeks before week 8 → 1/week.
    const reading = computeReviewVelocity([at(0, 10), at(8, 18), at(10, 24)]);
    expect(reading?.trailingAvgPerWeek).toBe(1);
  });

  it(`flags a spike when velocity is more than ${SPIKE_MULTIPLE}× the trailing average`, () => {
    // 3/week against 1/week.
    const reading = computeReviewVelocity([at(0, 10), at(8, 18), at(10, 24)]);
    expect(reading?.isSpike).toBe(true);
    expect(reading?.evidence).toContain('+6 reviews in 2 weeks');
  });

  it('does not flag exactly 2× — the rule is strictly greater', () => {
    // 2/week against 1/week.
    const reading = computeReviewVelocity([at(0, 10), at(8, 18), at(10, 22)]);
    expect(reading?.velocityPerWeek).toBe(2);
    expect(reading?.isSpike).toBe(false);
  });

  it('does not flag steady growth', () => {
    const reading = computeReviewVelocity([at(0, 10), at(4, 20), at(8, 30), at(12, 40)]);
    expect(reading?.isSpike).toBe(false);
  });

  it('ignores history older than the 8-week window when averaging', () => {
    // A burst 20 weeks ago must not inflate the baseline and hide today's spike.
    const reading = computeReviewVelocity([
      at(0, 0),
      at(4, 200),
      at(16, 202),
      at(24, 210),
      at(26, 220),
    ]);
    expect(reading?.trailingAvgPerWeek).toBe(1); // 8 reviews over weeks 16–24
    expect(reading?.isSpike).toBe(true);
  });

  it(`needs at least ${MIN_REVIEW_DELTA} new reviews before calling it a spike`, () => {
    // 2 reviews in one week from a flat baseline is a big ratio but not a signal.
    const reading = computeReviewVelocity([at(0, 10), at(8, 10), at(9, 12)]);
    expect(reading?.isSpike).toBe(false);
  });

  it('flags a spike from a standing start once the delta is large enough', () => {
    const reading = computeReviewVelocity([at(0, 10), at(8, 10), at(9, 15)]);
    expect(reading?.isSpike).toBe(true);
  });

  it('returns null without enough history to have a baseline', () => {
    expect(computeReviewVelocity([at(0, 10), at(1, 30)])).toBeNull();
  });

  it('skips snapshots with no review count', () => {
    expect(computeReviewVelocity([at(0, null), at(8, null), at(10, 24)])).toBeNull();
  });

  it('returns null for two snapshots at the same moment', () => {
    expect(computeReviewVelocity([at(0, 1), at(8, 2), at(8, 30)])).toBeNull();
  });

  it('keeps confidence within 0.5..1 and grows with the size of the jump', () => {
    const small = computeReviewVelocity([at(0, 10), at(8, 18), at(10, 24)])!;
    const large = computeReviewVelocity([at(0, 10), at(8, 18), at(10, 80)])!;
    expect(small.confidence).toBeGreaterThanOrEqual(0.5);
    expect(large.confidence).toBeLessThanOrEqual(1);
    expect(large.confidence).toBeGreaterThan(small.confidence);
  });
});
