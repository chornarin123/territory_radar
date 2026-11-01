import { describe, expect, it } from 'vitest';
import {
  FACTOR_KEYS,
  FACTORS,
  PILLAR_WEIGHTS,
  PILLARS,
  scoreLead,
  toDisplayScore,
} from '../src/index.js';
import type { ScoringInputs } from '../src/index.js';

const allOf = (value: number | null): ScoringInputs =>
  Object.fromEntries(FACTOR_KEYS.map((k) => [k, value])) as ScoringInputs;

const inputs = (overrides: Partial<ScoringInputs>): ScoringInputs => ({
  ...allOf(0),
  ...overrides,
});

describe('weights', () => {
  it('match the agreed formula', () => {
    expect(PILLAR_WEIGHTS).toEqual({ need: 0.4, capacity: 0.35, bankability: 0.25 });
    expect(Object.fromEntries(FACTOR_KEYS.map((k) => [k, FACTORS[k].weight]))).toEqual({
      newOpening: 0.35,
      velocitySpike: 0.3,
      lowStock: 0.2,
      hoursExtended: 0.15,
      logReviews: 0.4,
      priceLevel: 0.3,
      areaPpi: 0.3,
      hasWebOrPage: 0.4,
      categoryLendable: 0.3,
      isMultiBranch: 0.3,
    });
  });

  it('sum to 1 within each pillar and across pillars, so scores stay in 0..1', () => {
    for (const pillar of PILLARS) {
      const sum = FACTOR_KEYS.filter((k) => FACTORS[k].pillar === pillar).reduce(
        (s, k) => s + FACTORS[k].weight,
        0,
      );
      expect(sum, pillar).toBeCloseTo(1, 12);
    }
    expect(PILLARS.reduce((s, p) => s + PILLAR_WEIGHTS[p], 0)).toBeCloseTo(1, 12);
  });
});

describe('scoreLead', () => {
  it('scores all-zero inputs as 0 with nothing to explain', () => {
    expect(scoreLead(allOf(0))).toMatchObject({
      need: 0,
      capacity: 0,
      bankability: 0,
      total: 0,
      topFactors: [],
      missing: [],
    });
  });

  it('scores all-one inputs as 1', () => {
    const s = scoreLead(allOf(1));
    expect([s.need, s.capacity, s.bankability, s.total].map((x) => +x.toFixed(12))).toEqual([
      1, 1, 1, 1,
    ]);
  });

  it('matches a hand-computed example', () => {
    const s = scoreLead(
      inputs({
        newOpening: 1,
        velocitySpike: 0.5,
        logReviews: 0.6,
        priceLevel: 0.5,
        areaPpi: 0.8,
        hasWebOrPage: 1,
        categoryLendable: 1,
      }),
    );
    expect(s.need).toBeCloseTo(0.35 + 0.3 * 0.5); // 0.50
    expect(s.capacity).toBeCloseTo(0.4 * 0.6 + 0.3 * 0.5 + 0.3 * 0.8); // 0.63
    expect(s.bankability).toBeCloseTo(0.4 + 0.3); // 0.70
    expect(s.total).toBeCloseTo(0.4 * 0.5 + 0.35 * 0.63 + 0.25 * 0.7); // 0.5955
    expect(toDisplayScore(s.total)).toBe(60);
  });

  it('explains the score with the three largest contributions, largest first', () => {
    const s = scoreLead(inputs({ newOpening: 1, hasWebOrPage: 1, areaPpi: 0.5, priceLevel: 0.25 }));
    expect(s.topFactors.map((f) => [f.factor, +f.contribution.toFixed(6)])).toEqual([
      ['newOpening', 0.14], //    0.40 × 0.35 × 1
      ['hasWebOrPage', 0.1], //   0.25 × 0.40 × 1
      ['areaPpi', 0.0525], //     0.35 × 0.30 × 0.5
    ]);
    expect(s.topFactors[0]).toMatchObject({
      pillar: 'need',
      label: FACTORS.newOpening.label,
      value: 1,
    });
  });

  it('has contributions that add up exactly to the total — nothing hidden', () => {
    const s = scoreLead({
      newOpening: 0.2,
      velocitySpike: 0.9,
      lowStock: 0.4,
      hoursExtended: 1,
      logReviews: 0.33,
      priceLevel: 0.75,
      areaPpi: 0.61,
      hasWebOrPage: 0,
      categoryLendable: 0.8,
      isMultiBranch: 1,
    });
    expect(s.contributions.map((c) => c.factor)).toEqual(FACTOR_KEYS);
    expect(s.contributions.reduce((sum, c) => sum + c.contribution, 0)).toBeCloseTo(s.total, 12);
    expect(s.topFactors).toEqual(
      [...s.contributions].sort((a, b) => b.contribution - a.contribution).slice(0, 3),
    );
  });

  it('breaks ties in contribution by factor order, so explanations are stable', () => {
    // velocitySpike: 0.40 × 0.30 = 0.12; isMultiBranch 1 → 0.25 × 0.30 = 0.075;
    // categoryLendable 1 → 0.075 (tie with isMultiBranch; categoryLendable comes first).
    const s = scoreLead(inputs({ velocitySpike: 1, categoryLendable: 1, isMultiBranch: 1 }));
    expect(s.topFactors.map((f) => f.factor)).toEqual([
      'velocitySpike',
      'categoryLendable',
      'isMultiBranch',
    ]);
  });

  it('returns fewer than three factors when fewer contributed', () => {
    expect(scoreLead(inputs({ lowStock: 1 })).topFactors.map((f) => f.factor)).toEqual([
      'lowStock',
    ]);
  });

  it('scores unknown inputs as 0 and reports them as missing', () => {
    const s = scoreLead(inputs({ logReviews: null, priceLevel: null, newOpening: 1 }));
    expect(s.missing).toEqual(['logReviews', 'priceLevel']);
    expect(s.total).toBeCloseTo(scoreLead(inputs({ newOpening: 1 })).total);
  });

  it.each([
    ['above 1', 1.2],
    ['negative', -0.1],
    ['NaN', Number.NaN],
  ])('rejects an input that is %s', (_, bad) => {
    expect(() => scoreLead(inputs({ areaPpi: bad }))).toThrow(/areaPpi/);
  });
});
