/**
 * Visit priority for prospects, derived from their own evidence.
 *
 * Each prospect gets five factor points (the bars on the prospect screen):
 *   signalStrength  /35  from its signals' grades (strong / moderate / weak)
 *   freshness       /20  from the age of its newest signal
 *   businessMaturity/20  from the seed data (operating history)
 *   productRelevance/15  from the seed data (product match)
 *   evidenceQuality /10  from its evidence's verification status:
 *                        unverified evidence can't score above 5
 * They add up to `rawScore` (0–100). The visit priority shown in the app is
 * that raw score ranked within the officer's own prospects, so the list
 * spreads out instead of everyone sitting at 90: roughly the top 15% score 85+.
 *
 * Visit priority is never a loan probability.
 */

export const MAX_POINTS = {
  signalStrength: 35,
  freshness: 20,
  businessMaturity: 20,
  productRelevance: 15,
  evidenceQuality: 10,
};

const GRADE_POINTS = { strong: 30, moderate: 20, weak: 10 };
const EXTRA_POINTS = { strong: 3, moderate: 3, weak: 1 };

/** Best signal's grade, plus a little for each further signal that backs it up. */
export function signalStrengthPoints(signals) {
  const graded = signals
    .map((s) => s.strength)
    .filter((g) => g in GRADE_POINTS)
    .sort((a, b) => GRADE_POINTS[b] - GRADE_POINTS[a]);
  if (!graded.length) return 0;
  const [best, ...rest] = graded;
  const extra = rest.reduce((a, g) => a + EXTRA_POINTS[g], 0);
  return Math.min(MAX_POINTS.signalStrength, GRADE_POINTS[best] + extra);
}

/** Days old the newest signal is, from detectedAt. */
export function newestSignalAgeDays(signals, nowIso) {
  const times = signals.map((s) => Date.parse(s.detectedAt)).filter(Number.isFinite);
  if (!times.length) return null;
  return Math.max(0, (Date.parse(nowIso) - Math.max(...times)) / 86_400_000);
}

/** 20 for a signal seen today, falling linearly to 0 at 60 days. */
export const FRESH_FOR_DAYS = 60;
export function freshnessPoints(signals, nowIso) {
  const age = newestSignalAgeDays(signals, nowIso);
  if (age === null) return 0;
  return Math.round(MAX_POINTS.freshness * Math.max(0, 1 - age / FRESH_FOR_DAYS));
}

/** Highest evidence quality an unverified item can reach. */
export const UNVERIFIED_MAX = 5;

/**
 * verified: 8, +2 with a second independent source type.
 * unverified: 3, +1 per further independent source type, never above 5.
 * Any conflicting evidence: 2.
 */
export function evidenceQualityPoints(evidence) {
  if (!evidence.length) return 0;
  if (evidence.some((e) => e.verificationStatus === 'conflicting')) return 2;
  const sources = new Set(evidence.map((e) => e.sourceType)).size;
  const verified = evidence.filter((e) => e.verificationStatus === 'verified');
  if (verified.length === evidence.length) return Math.min(10, 8 + (sources > 1 ? 2 : 0));
  if (verified.length) return 6;
  return Math.min(UNVERIFIED_MAX, 3 + (sources - 1));
}

/** The five factors for one prospect. */
export function priorityFactors(prospect, signals, evidence, nowIso) {
  const seed = prospect.priority?.factors ?? {};
  return {
    signalStrength: signalStrengthPoints(signals),
    freshness: freshnessPoints(signals, nowIso),
    businessMaturity: Math.min(MAX_POINTS.businessMaturity, seed.businessMaturity ?? 0),
    productRelevance: Math.min(MAX_POINTS.productRelevance, seed.productRelevance ?? 0),
    evidenceQuality: evidenceQualityPoints(evidence),
  };
}

/**
 * Visit priority from raw scores: 10–99 by rank, ties sharing a rank.
 * @param {number[]} raws
 * @returns {number[]}
 */
export function rankScale(raws) {
  return raws.map((x) => {
    let below = 0;
    let equal = 0;
    for (const v of raws) {
      if (v < x) below += 1;
      else if (v === x) equal += 1;
    }
    const p = raws.length > 1 ? (below + (equal - 1) / 2) / (raws.length - 1) : 1;
    return 10 + Math.round(89 * p);
  });
}

export const bandOf = (score) => (score >= 75 ? 'high' : score >= 50 ? 'medium' : 'low');

/**
 * Rewrites every prospect's `priority` in place from its evidence, ranking
 * each officer's prospects among themselves.
 */
export function applyPriorities(db, nowIso) {
  const signalsOf = new Map();
  for (const s of db.signals) {
    if (!signalsOf.has(s.prospectId)) signalsOf.set(s.prospectId, []);
    signalsOf.get(s.prospectId).push(s);
  }
  const evidenceOf = new Map();
  for (const e of db.evidence) {
    if (!evidenceOf.has(e.prospectId)) evidenceOf.set(e.prospectId, []);
    evidenceOf.get(e.prospectId).push(e);
  }

  const byOfficer = new Map();
  for (const p of db.prospects) {
    const factors = priorityFactors(
      p,
      signalsOf.get(p.id) ?? [],
      evidenceOf.get(p.id) ?? [],
      nowIso,
    );
    const rawScore = Object.values(factors).reduce((a, b) => a + b, 0);
    p.priority = { ...p.priority, factors, maxPoints: MAX_POINTS, rawScore };
    const key = p.assignmentOfficerId ?? '';
    if (!byOfficer.has(key)) byOfficer.set(key, []);
    byOfficer.get(key).push(p);
  }

  for (const group of byOfficer.values()) {
    const scores = rankScale(group.map((p) => p.priority.rawScore));
    group.forEach((p, i) => {
      const above = group.filter((q) => q.priority.rawScore > p.priority.rawScore).length;
      p.priority = {
        ...p.priority,
        score: scores[i],
        band: bandOf(scores[i]),
        rank: above + 1,
        rankOf: group.length,
        computedAt: nowIso,
      };
    });
  }
}
