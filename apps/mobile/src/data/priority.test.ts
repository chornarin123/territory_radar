import { describe, expect, it } from 'vitest';
import raw from '../../../../data/data.json';
import {
  MAX_POINTS,
  UNVERIFIED_MAX,
  applyPriorities,
  evidenceQualityPoints,
  freshnessPoints,
  rankScale,
  signalStrengthPoints,
} from '../../../../scripts/prospect-priority.mjs';
import { quantileScale } from './areaDemand';

const NOW = '2026-10-15T08:30:00+07:00';
const sig = (strength: string, detectedAt = '2026-10-10T08:30:00+07:00') => ({
  strength,
  detectedAt,
});
const ev = (verificationStatus: string, sourceType = 'business_social_post') => ({
  verificationStatus,
  sourceType,
});

describe('signal strength comes from the signal grades', () => {
  it('ranks strong over moderate over weak', () => {
    expect(signalStrengthPoints([sig('strong')])).toBeGreaterThan(
      signalStrengthPoints([sig('moderate')]),
    );
    expect(signalStrengthPoints([sig('moderate')])).toBeGreaterThan(
      signalStrengthPoints([sig('weak')]),
    );
    expect(signalStrengthPoints([])).toBe(0);
  });

  it('one moderate and one weak signal is nowhere near the top', () => {
    const pts = signalStrengthPoints([sig('moderate'), sig('weak')]);
    expect(pts).toBeLessThanOrEqual(0.65 * MAX_POINTS.signalStrength);
  });

  it('never exceeds the maximum', () => {
    expect(signalStrengthPoints(Array(10).fill(sig('strong')))).toBe(MAX_POINTS.signalStrength);
  });
});

describe('evidence quality comes from verification status', () => {
  it('caps unverified evidence at 5/10, however many items', () => {
    const many = ['a', 'b', 'c', 'd', 'e'].map((t) => ev('unverified_demo', t));
    expect(evidenceQualityPoints(many)).toBeLessThanOrEqual(UNVERIFIED_MAX);
    expect(evidenceQualityPoints([ev('unverified_demo')])).toBeLessThanOrEqual(UNVERIFIED_MAX);
  });

  it('scores verified evidence above unverified, and conflicting lowest', () => {
    expect(evidenceQualityPoints([ev('verified')])).toBeGreaterThan(UNVERIFIED_MAX);
    expect(evidenceQualityPoints([ev('verified'), ev('conflicting')])).toBe(2);
    expect(evidenceQualityPoints([])).toBe(0);
  });
});

describe('freshness comes from the newest signal age', () => {
  it('is full for today, lower with age, zero after 60 days', () => {
    expect(freshnessPoints([sig('weak', NOW)], NOW)).toBe(MAX_POINTS.freshness);
    expect(freshnessPoints([sig('weak', '2026-09-15T08:30:00+07:00')], NOW)).toBe(10);
    expect(freshnessPoints([sig('weak', '2026-07-01T08:30:00+07:00')], NOW)).toBe(0);
    // The newest signal counts.
    expect(
      freshnessPoints(
        [sig('weak', '2026-07-01T08:30:00+07:00'), sig('weak', '2026-10-15T08:30:00+07:00')],
        NOW,
      ),
    ).toBe(MAX_POINTS.freshness);
  });
});

describe('visit priority', () => {
  const db = JSON.parse(JSON.stringify(raw));
  applyPriorities(db, NOW);

  it('Angkor Wood Studio: sub-scores match its own evidence', () => {
    const p = db.prospects.find((x: { id: string }) => x.id === 'prospect_003');
    // Signals: one moderate, one weak. Evidence: both unverified demo items.
    expect(p.priority.factors.signalStrength).toBeLessThan(25);
    expect(p.priority.factors.evidenceQuality).toBeLessThanOrEqual(UNVERIFIED_MAX);
    const sum = Object.values(p.priority.factors as Record<string, number>).reduce(
      (a, b) => a + b,
      0,
    );
    expect(p.priority.rawScore).toBe(sum);
  });

  it('spreads each officer’s prospects: roughly the top 10–20% score 85+', () => {
    const officer = db.officers[0].id;
    const scores = db.prospects
      .filter((p: { assignmentOfficerId: string }) => p.assignmentOfficerId === officer)
      .map((p: { priority: { score: number } }) => p.priority.score);
    const share = scores.filter((s: number) => s >= 85).length / scores.length;
    expect(share).toBeGreaterThan(0.05);
    expect(share).toBeLessThan(0.2);
    // No pile-up on one value.
    const mostCommon = Math.max(
      ...[...new Set(scores)].map((v) => scores.filter((s: number) => s === v).length),
    );
    expect(mostCommon / scores.length).toBeLessThan(0.15);
  });

  it('keeps the raw order', () => {
    expect(rankScale([10, 50, 30])).toEqual([10, 99, 55]);
    expect(rankScale([40, 40])).toEqual([55, 55]);
  });
});

describe('map colours by quintile', () => {
  it('puts about a fifth of the areas in each shade, even when scores bunch up', () => {
    const scores = Array.from({ length: 100 }, (_, i) => 90 + (i % 10)); // all 90–99
    const scale = quantileScale(scores);
    const counts = [0, 0, 0, 0, 0];
    for (const s of scores) counts[scale.bin(s)]! += 1;
    expect(counts.every((c) => c > 0)).toBe(true);
    expect(scale.min).toBe(90);
    expect(scale.max).toBe(99);
    expect(scale.light(99)).toBe(true);
    expect(scale.light(90)).toBe(false);
  });
});
