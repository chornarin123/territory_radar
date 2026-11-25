/**
 * "Why this score": the evidence pack behind a sangkat's demand score, and the
 * checks that keep Ask Radar to public data only. Pure functions, no I/O;
 * tested in apps/mobile/src/data/evidence.test.ts.
 *
 * Contest data-safety rule: only PUBLIC data may reach a model (OSM/Overpass,
 * NIS Census 2019, Radar's own public-data scan). A pack is built from those
 * sources alone and checked against an allowlist of fields before it is served
 * or put in a prompt. Officer feedback, officer identities and device location
 * never enter a pack's prompt form.
 */

// ─── Allowlist ────────────────────────────────────────────────────────────────

const PACK_FIELDS = new Set([
  'communeCode',
  'name',
  'districtName',
  'loanType',
  'score',
  'scanDate',
  'previousScanDate',
  'previousScore',
  'confidence',
  'signalsAvailable',
  'signalsTotal',
  'breakdown',
  'limitations',
  'sample',
  // Officer feedback counts: served to the app, never put in a prompt.
  'groundTruth',
]);
const ITEM_FIELDS = new Set([
  'id',
  'n',
  'title',
  'points',
  'line',
  'source',
  'sourceUrl',
  'date',
  'records',
  'totalRecords',
]);
const RECORD_FIELDS = new Set(['name', 'tag', 'when', 'lat', 'lng', 'osmId', 'prospectId']);
const GROUND_TRUTH_FIELDS = new Set(['agree', 'disagree']);

/** Fields allowed in a prompt: the public pack minus coordinates and feedback. */
const PROMPT_PACK_FIELDS = new Set([...PACK_FIELDS].filter((f) => f !== 'groundTruth'));
const PROMPT_RECORD_FIELDS = new Set(['name', 'tag', 'when', 'prospectId']);

function checkKeys(obj, allowed, where, problems) {
  for (const k of Object.keys(obj)) if (!allowed.has(k)) problems.push(`${where}.${k}`);
}

/**
 * Every field outside the allowlist, as paths like "breakdown[2].records[0].phone".
 * `forPrompt` applies the stricter prompt allowlist.
 */
export function packViolations(pack, { forPrompt = false } = {}) {
  const problems = [];
  checkKeys(pack, forPrompt ? PROMPT_PACK_FIELDS : PACK_FIELDS, 'pack', problems);
  if (pack.groundTruth)
    checkKeys(pack.groundTruth, GROUND_TRUTH_FIELDS, 'pack.groundTruth', problems);
  (pack.breakdown ?? []).forEach((item, i) => {
    checkKeys(item, ITEM_FIELDS, `breakdown[${i}]`, problems);
    (item.records ?? []).forEach((r, j) =>
      checkKeys(
        r,
        forPrompt ? PROMPT_RECORD_FIELDS : RECORD_FIELDS,
        `breakdown[${i}].records[${j}]`,
        problems,
      ),
    );
  });
  return problems;
}

/** Throws if the pack carries anything outside the allowlist. */
export function assertPublicPack(pack, opts) {
  const problems = packViolations(pack, opts);
  if (problems.length)
    throw new Error(`Evidence pack has non-allowlisted fields: ${problems.join(', ')}`);
  return pack;
}

/** The pack as it may appear in a prompt: no coordinates, no officer feedback. */
export function promptPack(pack) {
  const rest = { ...pack };
  delete rest.groundTruth;
  const out = {
    ...rest,
    breakdown: pack.breakdown.map((item) => ({
      ...item,
      records: item.records.map(({ name, tag, when, prospectId }) =>
        prospectId ? { name, tag, when, prospectId } : { name, tag, when },
      ),
    })),
  };
  return assertPublicPack(out, { forPrompt: true });
}

// ─── Scoring maths ────────────────────────────────────────────────────────────

/** Whole numbers proportional to `weights` that sum to exactly `total`. */
export function allocate(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (total <= 0 || sum <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (w / sum) * total);
  const out = exact.map(Math.floor);
  const short = total - out.reduce((a, b) => a + b, 0);
  exact
    .map((v, i) => [v - Math.floor(v), i])
    .sort((a, b) => b[0] - a[0] || a[1] - b[1])
    .slice(0, short)
    .forEach(([, i]) => (out[i] += 1));
  return out;
}

export const daysBetween = (fromIso, toIso) =>
  Math.floor((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000);

/**
 * high: all 3 scored signals point the same way as the score; medium: 2;
 * low: 1 or none, or the scan is older than `staleAfterDays`.
 */
export function confidenceOf(agreeing, scanDate, today, staleAfterDays = 30) {
  if (daysBetween(scanDate, today) > staleAfterDays) return 'low';
  if (agreeing >= 3) return 'high';
  if (agreeing === 2) return 'medium';
  return 'low';
}

// ─── Area score ───────────────────────────────────────────────────────────────

/** A sangkat with every signal at the city median scores this. */
export const AREA_BASELINE = 50;
/**
 * Most points each signal can add (top of the city) or take away (bottom).
 * They sum to 50, so 50 ± 50 always stays inside 0–100: no clamping, and the
 * breakdown always adds up to the score.
 */
export const AREA_WEIGHTS = { businesses: 24, households: 13, growth: 13 };
/** With low confidence the score can't go above this (shown as its own line). */
export const LOW_CONFIDENCE_CAP = 75;

/** Linear-interpolated quantile, q in 0–1. */
export function quantile(values, q) {
  if (!values.length) return 0;
  const v = [...values].sort((x, y) => x - y);
  const i = (v.length - 1) * q;
  const lo = Math.floor(i);
  return v[lo] + (v[Math.min(lo + 1, v.length - 1)] - v[lo]) * (i - lo);
}

/** Median and the 5th/95th percentiles: where a signal reaches ±its full weight. */
export function spreadOf(values) {
  return {
    median: quantile(values, 0.5),
    low: quantile(values, 0.05),
    high: quantile(values, 0.95),
  };
}

/**
 * Points for a value against the city: exactly 0 at the median, rising
 * linearly to +weight at the 95th percentile, falling to −weight at the 5th,
 * and no further beyond them.
 */
export function relativePoints(spread, x, weight) {
  const { median, low, high } = spread;
  let t = 0;
  if (x > median) t = high > median ? Math.min(1, (x - median) / (high - median)) : 1;
  else if (x < median) t = low < median ? -Math.min(1, (median - x) / (median - low)) : -1;
  return Math.round(weight * t);
}

const distributions = new WeakMap();
/** Median and spread of each signal across every sangkat in the sample. */
export function cityValues(sample) {
  if (!distributions.has(sample)) {
    const all = Object.values(sample.communes);
    const businesses = {};
    for (const c of all) {
      for (const [t, list] of Object.entries(c.newBusinesses)) {
        (businesses[t] ??= []).push(list.length);
      }
    }
    distributions.set(sample, {
      businesses: Object.fromEntries(Object.entries(businesses).map(([t, v]) => [t, spreadOf(v)])),
      households: spreadOf(all.map((c) => c.householdsPerKm2).filter((v) => v !== null)),
      growth: spreadOf(all.map((c) => c.newPlaces90d - c.closedPlaces90d)),
    });
  }
  return distributions.get(sample);
}

/**
 * The demand score for one sangkat and loan type from its public signals,
 * relative to every sangkat in the sample. The map and the evidence pack both
 * use this, so they always show the same number.
 *
 * @returns {{ score: number, points: { businesses: number, households: number|null, growth: number }, agreeing: number, capped: number, confidence: string }}
 */
export function areaScore({ facts, sample, loanType, today, staleAfterDays = 30 }) {
  const city = cityValues(sample);
  const points = {
    businesses: relativePoints(
      city.businesses[loanType] ?? spreadOf([]),
      (facts.newBusinesses[loanType] ?? []).length,
      AREA_WEIGHTS.businesses,
    ),
    households:
      facts.householdsPerKm2 === null
        ? null
        : relativePoints(city.households, facts.householdsPerKm2, AREA_WEIGHTS.households),
    growth: relativePoints(
      city.growth,
      facts.newPlaces90d - facts.closedPlaces90d,
      AREA_WEIGHTS.growth,
    ),
  };
  const values = Object.values(points).filter((v) => v !== null);
  const raw = AREA_BASELINE + values.reduce((a, b) => a + b, 0);
  const up = raw >= AREA_BASELINE;
  const agreeing = values.filter((v) => (up ? v > 0 : v < 0)).length;
  const confidence = confidenceOf(agreeing, sample.scanDate, today, staleAfterDays);
  const capped = confidence === 'low' && raw > LOW_CONFIDENCE_CAP ? LOW_CONFIDENCE_CAP - raw : 0;
  return { score: raw + capped, points, agreeing, capped, confidence };
}

/** "+12", "−4", "0": signed points for display. */
export const signedPoints = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');

// ─── Pack ────────────────────────────────────────────────────────────────────

const SHOWN_RECORDS = 5;

const fmt = (n) => n.toLocaleString('en-US');
/** Medians of counts can be halves: show 5.5, not 5.50 or 6. */
const fmtMedian = (n) => Math.round(n * 10) / 10;

/**
 * The previous scan's score on today's scale. The sample stores previous scores
 * from the old percentile model, so keep its change (old score → old previous)
 * and apply it to the new score.
 */
export function previousOnScale(score, oldScore, oldPrevious) {
  if (oldPrevious === null || oldPrevious === undefined || oldScore === undefined) return null;
  return Math.max(0, Math.min(100, score - (oldScore - oldPrevious)));
}

/**
 * Builds the evidence pack for one sangkat and loan type, or null when there
 * is no evidence for it. The score is areaScore()'s, and the breakdown lines
 * add up to it exactly: baseline 50, each scored signal's points (negative
 * when below the city median), and the low-confidence cap if it applied.
 *
 * @param {object} p
 * @param {string} p.code       commune code
 * @param {string} p.loanType
 * @param {object} p.commune    { name_en, district: { name_en } } from address.json
 * @param {number} [p.oldScore] the area_demand.json score, only to carry the previous scan's change over
 * @param {object} p.sample     data/evidence_sample.json
 * @param {object} p.config     data/evidence_config.json
 * @param {object[]} p.leads    the officer's open leads in this sangkat: { prospectId, name, lat, lng, signals: [{ type, detectedAt }] }
 * @param {string} p.today      ISO date, for staleness
 */
export function buildEvidencePack({
  code,
  loanType,
  commune,
  oldScore,
  sample,
  config,
  leads,
  today,
}) {
  const facts = sample.communes[code];
  const typeConfig = config.loanTypes[loanType];
  if (!facts || !typeConfig) return null;
  const city = cityValues(sample);
  const scored = areaScore({
    facts,
    sample,
    loanType,
    today,
    staleAfterDays: config.staleAfterDays,
  });

  const signals = [];

  // 1. New loan-type businesses (OSM diff).
  const found = facts.newBusinesses[loanType] ?? [];
  signals.push({
    id: 'businesses',
    title: typeConfig.businessTitle,
    points: scored.points.businesses,
    line: `${found.length} new in 90 days · city median ${fmtMedian(city.businesses[loanType]?.median ?? 0)}`,
    source: 'osm',
    records: found.map(({ name, tag, when, lat, lng }) => ({ name, tag, when, lat, lng })),
  });

  // 2. Household density (census). Missing for some sangkats: not scored then.
  if (scored.points.households !== null) {
    signals.push({
      id: 'households',
      title: 'Household density',
      points: scored.points.households,
      line: `${fmt(facts.householdsPerKm2)} households/km² · city median ${fmt(Math.round(city.households.median))}`,
      source: 'census',
      records: [],
    });
  }

  // 3. Commercial growth: new vs closed places (OSM diff).
  const net = facts.newPlaces90d - facts.closedPlaces90d;
  signals.push({
    id: 'growth',
    title: 'Commercial growth',
    points: scored.points.growth,
    line: `${facts.newPlaces90d} new vs ${facts.closedPlaces90d} closed places in 90 days (net ${net >= 0 ? '+' : '−'}${Math.abs(net)}) · city median net ${signedPoints(fmtMedian(city.growth.median))}`,
    source: 'osm',
    records: [],
  });

  // 4. The officer's open Radar leads that fit this loan type. Context only:
  // the area score is the same for every officer, so it doesn't count.
  const wanted = new Set(config.leadSignals[loanType] ?? []);
  const matching = leads
    .map((l) => ({ ...l, hit: l.signals.find((x) => wanted.has(x.type)) }))
    .filter((l) => l.hit);
  signals.push({
    id: 'leads',
    title: 'Your open leads with matching signals',
    points: 0,
    line: `${matching.length} open lead${matching.length === 1 ? '' : 's'} with ${[...wanted].map((t) => t.replace(/_/g, ' ')).join(', ')} signals · context, not scored`,
    source: 'radar',
    records: matching.map((l) => ({
      name: l.name,
      tag: l.hit.type,
      when: l.hit.detectedAt.slice(0, 10),
      ...(l.lat !== undefined ? { lat: l.lat, lng: l.lng } : {}),
      prospectId: l.prospectId,
    })),
  });

  const src = (key) => config.sources[key];
  const breakdown = [
    {
      id: 'baseline',
      n: 0,
      title: 'City median',
      points: AREA_BASELINE,
      line: 'A sangkat with every signal at the Phnom Penh median scores 50',
      source: 'Radar model',
      sourceUrl: null,
      date: sample.scanDate,
      records: [],
      totalRecords: 0,
    },
    ...signals.map((x, i) => ({
      id: x.id,
      n: i + 1,
      title: x.title,
      points: x.points,
      line: x.line,
      source: src(x.source).label,
      sourceUrl: src(x.source).url,
      date: sample.scanDate,
      records: x.records.slice(0, SHOWN_RECORDS),
      totalRecords: x.records.length,
    })),
  ];
  if (scored.capped) {
    breakdown.push({
      id: 'cap',
      n: breakdown.length,
      title: 'Low-confidence cap',
      points: scored.capped,
      line: `Few signals agree, so the score is held at ${LOW_CONFIDENCE_CAP} until more evidence does`,
      source: 'Radar model',
      sourceUrl: null,
      date: sample.scanDate,
      records: [],
      totalRecords: 0,
    });
  }

  return assertPublicPack({
    communeCode: code,
    name: commune.name_en,
    districtName: commune.district.name_en,
    loanType,
    score: scored.score,
    scanDate: sample.scanDate,
    previousScanDate: sample.previousScanDate,
    previousScore: previousOnScale(scored.score, oldScore, facts.previousScore[loanType]),
    confidence: scored.confidence,
    signalsAvailable: signals.filter((x) => x.id !== 'leads').length,
    signalsTotal: 3,
    breakdown,
    limitations: config.limitations,
    sample: sample.sample === true,
  });
}

// ─── Area pulse ───────────────────────────────────────────────────────────────

export const PULSE_MIN_CHANGE = 5;

/**
 * The biggest score increase since the last scan among `packs`, with the largest
 * signal behind the score, or null if none rose by PULSE_MIN_CHANGE.
 */
export function pickPulse(packs) {
  let best = null;
  for (const p of packs) {
    if (p.previousScore === null) continue;
    const rise = p.score - p.previousScore;
    if (rise < PULSE_MIN_CHANGE) continue;
    if (!best || rise > best.score - best.previousScore) best = p;
  }
  if (!best) return null;
  const top = [...best.breakdown]
    .filter((i) => i.n > 0 && i.points > 0)
    .sort((a, b) => b.points - a.points)[0];
  const detail = top?.line.split(' · ')[0];
  return {
    communeCode: best.communeCode,
    name: best.name,
    loanType: best.loanType,
    oldScore: best.previousScore,
    newScore: best.score,
    reason: !top
      ? null
      : top.id === 'businesses' || top.id === 'households'
        ? `${top.title} (${detail})`
        : detail,
    sample: best.sample,
  };
}

// ─── Ask Radar: prompt and answer checks ──────────────────────────────────────

export const ASK_SYSTEM = `You are Radar, an assistant for PPCBank loan officers. Answer ONLY from the evidence pack provided. Cite evidence by its number in square brackets, e.g. [1]. If the pack doesn't contain the answer, say what is missing and suggest a field check — never guess numbers, names or trends. Be brief: max 120 words, plain language, bullet points when listing. You can suggest one action from: show_on_map, plan_visits, compare_area.

Reply with JSON only, no other text: {"answer": string, "citations": [number], "action": null | {"type": "show_on_map" | "plan_visits" | "compare_area", "label": string, "communeCodes"?: [string], "prospectIds"?: [string]}}. Write the answer as plain text with no markdown; start a bullet with "- ". Use prospectIds only from the "prospectId" fields in the evidence, and communeCodes only from the packs' "communeCode".

Citing: put the evidence number in square brackets right after each fact you take from it, e.g. "5 new car businesses [1]", and list every number you used in "citations". Evidence numbers are the "n" fields of "breakdown" only. The "limitations" list is not numbered evidence: you may repeat a limitation, but never cite it with a number. In a comparison, cite the compared area's evidence by its own numbers, which start at 10. Never write prospect ids in the answer text; name the business instead.`;

/** Evidence numbers of a compared pack start here, so citations stay unique. */
export const COMPARE_OFFSET = 10;

/** A compared pack, renumbered from COMPARE_OFFSET. */
export function offsetPack(pack, by) {
  return { ...pack, breakdown: pack.breakdown.map((i) => ({ ...i, n: i.n + by })) };
}

/**
 * The model's messages: earlier turns as text, then one user turn with the
 * evidence in <evidence> tags and the question. Nothing but packs, the question
 * and prior chat text goes in.
 *
 * @param {{ pack: object, comparePack?: object | null, question: string, history?: { role: string, content: string }[] }} input
 */
export function buildAskMessages({ pack, comparePack = null, question, history = [] }) {
  const blocks = [
    `<evidence area="${pack.name}">\n${JSON.stringify(promptPack(pack))}\n</evidence>`,
  ];
  if (comparePack) {
    blocks.push(
      `<evidence area="${comparePack.name}" note="compared area; its evidence numbers start at ${COMPARE_OFFSET}">\n${JSON.stringify(promptPack(offsetPack(comparePack, COMPARE_OFFSET)))}\n</evidence>`,
    );
  }
  return [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: `${blocks.join('\n\n')}\n\nQuestion: ${question}` },
  ];
}

const ACTIONS = new Set(['show_on_map', 'plan_visits', 'compare_area']);

/** Pulls a JSON object out of a reply, tolerating code fences. Null if none. */
export function parseJsonReply(raw) {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return null;
  const text = raw.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Checks a parsed reply against the packs: [n] markers and citations must be
 * evidence numbers that exist, prospect ids must be in the packs' records,
 * commune codes must be the packs'. Unknown ones are removed. Null if the
 * reply has no usable answer.
 */
export function validateAnswer(reply, packs) {
  if (!reply || typeof reply.answer !== 'string' || !reply.answer.trim()) return null;
  const ids = new Set(packs.flatMap((p) => p.breakdown.map((i) => i.n)));
  const prospects = new Set(
    packs
      .flatMap((p) => p.breakdown.flatMap((i) => i.records.map((r) => r.prospectId)))
      .filter(Boolean),
  );
  const codes = new Set(packs.map((p) => p.communeCode));

  // "[1]", "[1, 2]": keep the known numbers, drop the marker if none are.
  const answer = reply.answer
    // Made-up citation formats, e.g. [area="Tonle Basak"] or [score]: only [n] is
    // a citation, so any other bracketed text goes.
    .replace(/\[(?!\s*\d+(?:\s*,\s*\d+)*\s*\])[^\]]*\]/g, '')
    .replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, (_, list) => {
      const kept = list
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => ids.has(n));
      return kept.map((n) => `[${n}]`).join('');
    })
    .replace(/[ \t]+([.,;:)])/g, '$1')
    .replace(/\([ \t]*\)/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  const cited = new Set(
    [...answer.matchAll(/\[(\d+)\]/g)]
      .map((m) => Number(m[1]))
      .concat(Array.isArray(reply.citations) ? reply.citations.map(Number) : []),
  );
  const citations = [...cited].filter((n) => ids.has(n)).sort((a, b) => a - b);

  let action = null;
  const a = reply.action;
  if (a && ACTIONS.has(a.type) && typeof a.label === 'string' && a.label.trim()) {
    const prospectIds = (a.prospectIds ?? []).filter((id) => prospects.has(id));
    const communeCodes = (a.communeCodes ?? []).filter((c) => codes.has(c));
    const usable =
      a.type === 'plan_visits'
        ? prospectIds.length > 0
        : a.type === 'compare_area'
          ? communeCodes.length > 0
          : true;
    if (usable) {
      action = {
        type: a.type,
        label: a.label.trim().slice(0, 60),
        ...(communeCodes.length ? { communeCodes } : {}),
        ...(prospectIds.length ? { prospectIds } : {}),
      };
    }
  }
  return { answer, citations, action };
}

/**
 * Answer built from the pack alone, for when no model is available or its
 * reply failed the checks twice. Never guesses: unknown questions say what
 * the evidence lacks.
 */
export function offlineAnswer(question, pack, comparePack = null) {
  const q = question.toLowerCase();
  const signals = pack.breakdown.filter((i) => i.n > 0 && i.id !== 'leads' && i.id !== 'cap');
  const top = [...signals].sort((a, b) => Math.abs(b.points) - Math.abs(a.points)).slice(0, 3);

  if (comparePack) {
    return {
      answer: `${pack.name} scores ${pack.score}, ${comparePack.name} scores ${comparePack.score}.\n${top
        .map((i) => `- ${pack.name}: ${i.title}, ${signedPoints(i.points)} [${i.n}]`)
        .join('\n')}`,
      citations: top.map((i) => i.n),
      action: null,
    };
  }
  if (/\b(visit|who|first|lead)/.test(q)) {
    const leads = pack.breakdown.find((i) => i.id === 'leads');
    if (leads && leads.records.length) {
      return {
        answer: `Open leads that fit this loan type [${leads.n}]:\n${leads.records.map((r) => `- ${r.name} (${r.tag.replace(/_/g, ' ')})`).join('\n')}\nThe evidence doesn't rank them; check each in person.`,
        citations: [leads.n],
        action: {
          type: 'plan_visits',
          label: 'Plan these visits',
          prospectIds: leads.records.map((r) => r.prospectId).filter(Boolean),
        },
      };
    }
    return {
      answer: `There are no open Radar leads for this loan type in ${pack.name} in the evidence. A field walk would show which businesses to visit.`,
      citations: leads ? [leads.n] : [],
      action: null,
    };
  }
  if (/\b(change|since|last scan|trend|before)/.test(q)) {
    if (pack.previousScore === null) {
      return {
        answer: 'The evidence has no previous score to compare with.',
        citations: [],
        action: null,
      };
    }
    const d = pack.score - pack.previousScore;
    return {
      answer: `The score went from ${pack.previousScore} on ${pack.previousScanDate} to ${pack.score} on ${pack.scanDate} (${d >= 0 ? '+' : ''}${d}). The evidence doesn't say which signal moved; compare the cards with what you see on the ground.`,
      citations: [],
      action: null,
    };
  }
  if (/\b(why|high|low|drive|score|demand)/.test(q)) {
    return {
      answer: `${pack.name} scores ${pack.score}. The biggest contributions, against a city-median baseline of 50:\n${top
        .map((i) => `- ${i.title}: ${signedPoints(i.points)} [${i.n}]`)
        .join('\n')}`,
      citations: top.map((i) => i.n),
      action: null,
    };
  }
  return {
    answer: `That's not in the evidence for ${pack.name}. The pack covers new businesses, household density, open leads and commercial growth. A field check would answer this.`,
    citations: [],
    action: null,
  };
}
