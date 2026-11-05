/**
 * Writes data/area_demand.json: a deterministic SAMPLE of predicted loan demand
 * per commune, until the real model output replaces it. Same input, same file.
 *
 *   node scripts/generate-area-demand.mjs
 *
 * Shape (see apps/mobile/src/data/areaDemand.ts):
 *   mix[type]   %     = share of the commune's own predicted demand; sums to 100.
 *   score[type] 0–100 = how that share compares with every other commune (a
 *                       percentile rank of mix[type] across the country), so the
 *                       top scores are where the loan is the biggest part of demand.
 *
 * The numbers are invented. The only structure in them is a mild urban/rural
 * lean: Phnom Penh sangkats lean to car, home, payroll and personal loans,
 * provincial communes to Songkhoem and SME Soben. Nothing here is a prediction.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data');
const LOAN_TYPES = [
  'car',
  'home',
  'payroll',
  'songkhoem',
  'sme_soben',
  'personal',
  'trade_finance',
];

// Relative weight of each loan type, urban (capital) vs rural.
const LEAN = {
  car: [1.4, 0.6],
  home: [1.3, 0.7],
  payroll: [1.2, 0.6],
  songkhoem: [0.7, 1.4],
  sme_soben: [0.9, 1.3],
  personal: [1.3, 0.9],
  trade_finance: [0.9, 0.8],
};

/** Deterministic 0–1 from a string (FNV-1a hash, then mulberry32). */
function rand(seed) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  let t = h + 0x6d2b79f5;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Whole percentages that sum to exactly 100 (largest remainder). */
function toPercent(values) {
  const total = values.reduce((a, b) => a + b, 0);
  const exact = values.map((v) => (v / total) * 100);
  const out = exact.map(Math.floor);
  const order = exact.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]);
  const short = 100 - out.reduce((a, b) => a + b, 0);
  for (let k = 0; k < short; k++) out[order[k][1]] += 1;
  return out;
}

const address = JSON.parse(fs.readFileSync(path.join(DATA, 'address.json'), 'utf8'));
const codes = address.flatMap((p) => p.districts.flatMap((d) => d.communes.map((c) => c.code)));

const raw = new Map(
  codes.map((code) => {
    const urban = code.startsWith('12') ? 0 : 1;
    return [code, LOAN_TYPES.map((t) => LEAN[t][urban] * (0.35 + 0.65 * rand(`${code}:${t}`)))];
  }),
);

// Mix: each loan type's share of the commune's own demand, in whole percent.
const share = (code, i) => raw.get(code)[i] / raw.get(code).reduce((a, b) => a + b, 0);
const mix = new Map(codes.map((code) => [code, toPercent(raw.get(code))]));

// Score: percentile rank of that loan type's share, among all communes. So the
// highest scores are where the loan makes up the biggest part of demand, and a
// higher percentage never scores lower: ranked by the shown percentage, with the
// exact share breaking ties.
const score = new Map(codes.map((c) => [c, {}]));
LOAN_TYPES.forEach((t, i) => {
  const sorted = [...codes].sort(
    (a, b) => mix.get(a)[i] - mix.get(b)[i] || share(a, i) - share(b, i),
  );
  sorted.forEach((code, rank) => {
    score.get(code)[t] = Math.round((rank / (sorted.length - 1)) * 100);
  });
});

const communes = {};
for (const code of codes) {
  communes[code] = {
    score: score.get(code),
    mix: Object.fromEntries(LOAN_TYPES.map((t, i) => [t, mix.get(code)[i]])),
  };
}

const out = { sample: true, scan_date: '2026-10-03', loan_types: LOAN_TYPES, communes };
fs.writeFileSync(path.join(DATA, 'area_demand.json'), JSON.stringify(out) + '\n');
console.log(`Wrote data/area_demand.json: ${codes.length} communes, sample data.`);
