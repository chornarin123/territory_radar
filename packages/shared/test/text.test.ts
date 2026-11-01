import { describe, expect, it } from 'vitest';
import { countGraphemes, khmerShare, splitGraphemes, truncateGraphemes } from '../src/index.js';

// Invisible and combining characters are built from code points. Typed
// literally they are invisible in source and trivially corrupted by editors.
const cp = (...points: number[]) => String.fromCodePoint(...points);
const ZERO_WIDTH_SPACE = cp(0x200b);
const COENG = cp(0x17d2);
/** One emoji made of three code points joined by a ZWJ. */
const TECHNOLOGIST = cp(0x1f469, 0x200d, 0x1f4bb);

/** "This shop has many customers, but some goods are out of stock." */
const SENTENCE = 'ហាងនេះមានអតិថិជនច្រើន ប៉ុន្តែទំនិញខ្លះអស់ពីស្តុក។';
/** "woman" — a double coeng stack that is ONE visible character. */
const STACK = 'ស្ត្រី';
/** "Phnom Penh" with the zero-width space Khmer uses between words. */
const PHNOM_PENH = `ភ្នំ${ZERO_WIDTH_SPACE}ពេញ`;

describe('splitGraphemes', () => {
  it('keeps a double coeng stack and its vowel as one character', () => {
    expect(splitGraphemes(STACK)).toEqual([STACK]);
  });

  it('attaches dependent vowels to their consonant', () => {
    expect(splitGraphemes('ហាង')).toEqual(['ហា', 'ង']);
  });

  it('never starts a cluster with a coeng or a vowel sign', () => {
    const marks = new Set(
      [0x17d2, 0x17b6, 0x17b8, 0x17bb, 0x17c1, 0x17c6, 0x17c9].map((p) => cp(p)),
    );
    for (const cluster of splitGraphemes(SENTENCE)) {
      expect(marks.has(Array.from(cluster)[0]!), `cluster "${cluster}"`).toBe(false);
    }
  });

  it('is lossless — joining the clusters gives back the exact string', () => {
    for (const text of [SENTENCE, STACK, PHNOM_PENH, 'Café ☕ ២៤ម៉ោង', `${TECHNOLOGIST} ok`]) {
      expect(splitGraphemes(text).join('')).toBe(text);
    }
  });

  it('treats the zero-width space as its own break point', () => {
    expect(splitGraphemes(PHNOM_PENH)).toEqual(['ភ្នំ', ZERO_WIDTH_SPACE, 'ពេ', 'ញ']);
  });

  it('keeps a ZWJ emoji sequence together', () => {
    expect(countGraphemes(TECHNOLOGIST)).toBe(1);
  });
});

describe('truncateGraphemes', () => {
  it('shows why this exists: String.slice strands the coeng', () => {
    expect(STACK.slice(0, 2)).toBe(`ស${COENG}`); // broken: a dangling subscript sign
    expect(truncateGraphemes(STACK + STACK, 1)).toBe(`${STACK}…`);
  });

  it('returns the text unchanged when it already fits', () => {
    expect(truncateGraphemes(SENTENCE, 1_000)).toBe(SENTENCE);
  });

  it('cuts only on cluster boundaries', () => {
    const clusters = splitGraphemes(SENTENCE);
    for (let n = 0; n < clusters.length; n++) {
      expect(truncateGraphemes(SENTENCE, n, '')).toBe(clusters.slice(0, n).join(''));
    }
  });

  it('rejects a negative or fractional length', () => {
    expect(() => truncateGraphemes(SENTENCE, -1)).toThrow(RangeError);
    expect(() => truncateGraphemes(SENTENCE, 1.5)).toThrow(RangeError);
  });
});

describe('khmerShare', () => {
  it('is 1 for pure Khmer', () => {
    expect(khmerShare(SENTENCE)).toBe(1);
  });

  it('is 0 for English', () => {
    expect(khmerShare('The shop ran out of rice.')).toBe(0);
  });

  it('ignores digits, punctuation and spaces', () => {
    expect(khmerShare('ហាង ២៤ ម៉ោង 24/7!')).toBe(1);
  });

  it('counts a Latin brand name against the Khmer', () => {
    const share = khmerShare('ហាងលក់ទូរស័ព្ទ Samsung');
    expect(share).toBeGreaterThan(0.5);
    expect(share).toBeLessThan(1);
  });

  it('is 0 for text with no letters at all', () => {
    expect(khmerShare('123 !!')).toBe(0);
  });
});
