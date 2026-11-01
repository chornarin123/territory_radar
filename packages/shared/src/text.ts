// Khmer-safe text helpers. Pure and dependency-free: they run in the API and in
// the Expo app. No Intl.Segmenter and no \p{} regex escapes — Hermes support for
// both is unreliable — so the cluster rules for the scripts we show are explicit.
//
// Why this exists: Khmer stacks consonants with a COENG sign (U+17D2) and puts
// vowels after the consonant they belong to. Cutting a string by UTF-16 length
// ("text.slice(0, 40)") can strand a coeng or a vowel sign, which renders as
// broken text — it looks exactly like encoding corruption.

const COENG = 0x17d2;
const ZWJ = 0x200d;

/** True when `cp` belongs to the same user-visible character as the one before it. */
function attachesToPrevious(cp: number, previous: number | undefined): boolean {
  if (previous === COENG || previous === ZWJ) return true; // subscript consonant / joined emoji
  return (
    (cp >= 0x17b4 && cp <= 0x17d3) || // Khmer dependent vowels and signs, incl. coeng
    cp === 0x17dd ||
    (cp >= 0x0300 && cp <= 0x036f) || // combining diacritical marks
    cp === 0x200c ||
    cp === ZWJ ||
    (cp >= 0xfe00 && cp <= 0xfe0f) // variation selectors
  );
}

/** Splits text into user-visible characters (grapheme clusters) for Khmer, Latin and emoji. */
export function splitGraphemes(text: string): string[] {
  const clusters: string[] = [];
  let previous: number | undefined;
  for (const char of text) {
    const cp = char.codePointAt(0)!;
    if (clusters.length > 0 && attachesToPrevious(cp, previous)) {
      clusters[clusters.length - 1] += char;
    } else {
      clusters.push(char);
    }
    previous = cp;
  }
  return clusters;
}

export function countGraphemes(text: string): number {
  return splitGraphemes(text).length;
}

/** Shortens text to at most `max` visible characters without breaking a cluster. */
export function truncateGraphemes(text: string, max: number, ellipsis = '…'): string {
  if (!Number.isInteger(max) || max < 0) throw new RangeError('max must be a non-negative integer');
  const clusters = splitGraphemes(text);
  if (clusters.length <= max) return text;
  return clusters.slice(0, max).join('') + ellipsis;
}

function isKhmer(cp: number): boolean {
  return (cp >= 0x1780 && cp <= 0x17ff) || (cp >= 0x19e0 && cp <= 0x19ff);
}

function isLatinLetter(cp: number): boolean {
  return (cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a) || (cp >= 0xc0 && cp <= 0x24f);
}

/**
 * Share of script characters that are Khmer, 0..1. Digits, punctuation and
 * spaces are ignored, so "ហាង ABC ២៤ម៉ោង" still counts as mostly Khmer.
 */
export function khmerShare(text: string): number {
  let khmer = 0;
  let latin = 0;
  for (const char of text) {
    const cp = char.codePointAt(0)!;
    if (isKhmer(cp)) khmer += 1;
    else if (isLatinLetter(cp)) latin += 1;
  }
  return khmer + latin === 0 ? 0 : khmer / (khmer + latin);
}
