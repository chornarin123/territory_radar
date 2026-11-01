// Pure parts of review mining: cache keys, prompt building, validation.
// No I/O, no clock — unit-tested in review-mining.logic.spec.ts.

import { createHash } from 'node:crypto';
import type { BusinessScale } from '@territory-radar/shared';
import {
  PlaceAnalysisSchema,
  PROMPT_VERSION,
  REVIEW_MINING_MODEL,
} from './review-mining.schema.js';
import type { PersistedReviewSignalType } from './review-mining.schema.js';

/** A copied run this long (in characters) counts as quoting a review. */
export const QUOTE_RUN_CHARS = 30;

// Separators that cannot appear in normalised review text.
const SALT_SEPARATOR = String.fromCharCode(1);
const REVIEW_SEPARATOR = String.fromCharCode(0);

export interface ExtractedSignal {
  type: PersistedReviewSignalType;
  evidence: string;
  confidence: number;
}

export interface ValidAnalysis {
  signals: ExtractedSignal[];
  businessScale: BusinessScale;
  summaryKm: string;
}

export type PlaceValidation = { ok: true; analysis: ValidAnalysis } | { ok: false; reason: string };

/** NFC, single spaces, trimmed. Khmer from different sources can differ only in normalisation. */
export function normaliseText(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim();
}

function fold(text: string): string {
  return normaliseText(text).toLowerCase();
}

/**
 * Cache key for a set of reviews. Order-insensitive (Google does not promise an
 * order), and salted with the model and prompt version so a prompt change
 * re-analyses everything once. Returns null when there is nothing to analyse.
 */
export function hashReviewSet(
  reviews: readonly string[],
  salt = `${REVIEW_MINING_MODEL}|${PROMPT_VERSION}`,
): string | null {
  const normalised = reviews.map(normaliseText).filter((r) => r.length > 0);
  if (normalised.length === 0) return null;
  normalised.sort();
  return createHash('sha256')
    .update(salt + SALT_SEPARATOR + normalised.join(REVIEW_SEPARATOR))
    .digest('hex');
}

/**
 * The first verbatim run shared with any review, or null. This is the
 * mechanical guarantee behind "never persist review text": a paraphrase that
 * copies a clause is rejected rather than trusted.
 */
export function findQuotedRun(
  candidate: string,
  sources: readonly string[],
  minChars = QUOTE_RUN_CHARS,
): string | null {
  const chars = Array.from(fold(candidate));
  if (chars.length < minChars) return null;
  const folded = sources.map(fold);
  for (let i = 0; i + minChars <= chars.length; i++) {
    const window = chars.slice(i, i + minChars).join('');
    if (folded.some((source) => source.includes(window))) return window;
  }
  return null;
}

/** Strict, per-place validation of one entry from the model's response. */
export function validatePlaceResult(raw: unknown, reviews: readonly string[]): PlaceValidation {
  const parsed = PlaceAnalysisSchema.safeParse(raw);
  if (!parsed.success) {
    const reason = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    return { ok: false, reason };
  }

  const summaryKm = normaliseText(parsed.data.summary_km);
  if (findQuotedRun(summaryKm, reviews)) {
    return { ok: false, reason: 'summary_km copies review text' };
  }

  const strongest = new Map<PersistedReviewSignalType, ExtractedSignal>();
  for (const signal of parsed.data.signals) {
    if (signal.type === 'none') continue;
    const evidence = normaliseText(signal.evidence);
    if (findQuotedRun(evidence, reviews)) {
      return { ok: false, reason: `evidence for ${signal.type} copies review text` };
    }
    const existing = strongest.get(signal.type);
    if (!existing || signal.confidence > existing.confidence) {
      strongest.set(signal.type, { type: signal.type, evidence, confidence: signal.confidence });
    }
  }

  return {
    ok: true,
    analysis: {
      signals: [...strongest.values()],
      businessScale: parsed.data.business_scale,
      summaryKm,
    },
  };
}

/** Reviews as JSON, so a review containing markup or quotes cannot break the structure. */
export function buildUserPrompt(
  items: readonly { key: string; reviews: readonly string[] }[],
): string {
  const payload = {
    places: items.map((item) => ({
      place_key: item.key,
      reviews: item.reviews.map(normaliseText).filter((r) => r.length > 0),
    })),
  };
  return `Analyse the reviews for these ${items.length} places. Reviews are JSON data:\n\n${JSON.stringify(payload)}`;
}

/** Fallback when structured parsing is unavailable: tolerates stray markdown fences. */
export function parseModelText(text: string): unknown {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  try {
    return JSON.parse(stripped);
  } catch {
    return null;
  }
}
