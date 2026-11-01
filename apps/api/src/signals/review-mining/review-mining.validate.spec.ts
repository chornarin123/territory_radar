import { describe, expect, it } from 'vitest';
import { validatePlaceResult } from './review-mining.logic.js';

const ZWSP = String.fromCodePoint(0x200b);
const REVIEW_KM = 'ហាងនេះមានអតិថិជនច្រើនណាស់ ហើយទំនិញខ្លះអស់ពីស្តុកជាញឹកញាប់';
const REVIEW_EN =
  'Great little shop but they ran out of rice again this week, had to go elsewhere.';
const PARAPHRASE_KM = 'អាជីវកម្មកំពុងរីកចម្រើន ហើយអាចត្រូវការដើមទុនបន្ថែម។';
const EVIDENCE = 'Several reviewers mention staple goods selling out';

const entry = (overrides: Record<string, unknown> = {}) => ({
  signals: [{ type: 'low_stock', evidence: EVIDENCE, confidence: 0.8 }],
  business_scale: 'small',
  summary_km: PARAPHRASE_KM,
  ...overrides,
});

const signal = (type: string, evidence: string, confidence: number) => ({
  type,
  evidence,
  confidence,
});

describe('validatePlaceResult — accepts', () => {
  it('a valid entry, normalising the Khmer summary', () => {
    const result = validatePlaceResult(entry({ summary_km: `  ${PARAPHRASE_KM}  ` }), [REVIEW_EN]);
    expect(result).toEqual({
      ok: true,
      analysis: {
        signals: [{ type: 'low_stock', evidence: EVIDENCE, confidence: 0.8 }],
        businessScale: 'small',
        summaryKm: PARAPHRASE_KM,
      },
    });
  });

  it('dropping "none" and keeping the strongest signal of each type', () => {
    const result = validatePlaceResult(
      entry({
        signals: [
          signal('none', '', 0),
          signal('long_queue', 'Busy at lunchtime', 0.4),
          signal('long_queue', 'Queues out the door most evenings', 0.9),
        ],
      }),
      [REVIEW_EN],
    );
    expect(result.ok && result.analysis.signals).toEqual([
      signal('long_queue', 'Queues out the door most evenings', 0.9),
    ]);
  });

  it('a Khmer summary with a zero-width space, kept intact', () => {
    const summary = `ភ្នំ${ZWSP}ពេញ មានអតិថិជនច្រើន។`;
    const result = validatePlaceResult(entry({ summary_km: summary }), [REVIEW_EN]);
    expect(result.ok && result.analysis.summaryKm).toBe(summary);
  });
});

describe('validatePlaceResult — rejects', () => {
  it.each([
    [
      'confidence above 1',
      entry({ signals: [signal('expansion', 'Added a room', 1.4)] }),
      /confidence/,
    ],
    ['an unknown signal type', entry({ signals: [signal('bankrupt', 'x y z', 0.5)] }), /type/],
    ['a summary in English', entry({ summary_km: 'This shop is growing quickly.' }), /Khmer/],
    ['a multi-line summary', entry({ summary_km: `${PARAPHRASE_KM}\n${PARAPHRASE_KM}` }), /single/],
    ['a missing business_scale', entry({ business_scale: undefined }), /business_scale/],
    [
      'a real signal with no evidence',
      entry({ signals: [signal('renovation', '', 0.6)] }),
      /evidence/,
    ],
  ])('%s', (_, raw, reason) => {
    const result = validatePlaceResult(raw, [REVIEW_EN]);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(reason);
  });

  it('evidence that quotes a review', () => {
    const raw = entry({
      signals: [signal('low_stock', 'they ran out of rice again this week', 0.9)],
    });
    expect(validatePlaceResult(raw, [REVIEW_EN])).toEqual({
      ok: false,
      reason: 'evidence for low_stock copies review text',
    });
  });

  it('a Khmer summary that quotes a Khmer review', () => {
    expect(validatePlaceResult(entry({ summary_km: `${REVIEW_KM}។` }), [REVIEW_KM])).toEqual({
      ok: false,
      reason: 'summary_km copies review text',
    });
  });

  it('without ever putting review text in the reason', () => {
    const result = validatePlaceResult(entry({ summary_km: `${REVIEW_KM}។` }), [REVIEW_KM]);
    expect(!result.ok && result.reason).not.toContain(REVIEW_KM.slice(0, 10));
  });
});
