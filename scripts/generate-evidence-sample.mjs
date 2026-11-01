/**
 * Writes data/evidence_sample.json: deterministic SAMPLE facts behind each
 * Phnom Penh sangkat's demand score, until the real scan pipeline produces them.
 * Same input, same file.
 *
 *   node scripts/generate-evidence-sample.mjs
 *
 * Per sangkat: new loan-type businesses (OSM-diff style records), census
 * household density, and new vs closed places over 90 days. Everything is
 * invented and marked as such: names start with "Sample", and records carry no
 * OSM ids, so nothing links to a real, unrelated OpenStreetMap object.
 * Run generate-area-demand.mjs first: previous scores are derived from it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data');
const read = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));

const SCAN_DATE = '2026-10-03';
const PREVIOUS_SCAN_DATE = '2026-09-03';
const PROVINCE = '12'; // Phnom Penh: where the demo territory is

/** Deterministic 0–1 from a string (FNV-1a, then mulberry32). */
function rand(seed) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  let t = h + 0x6d2b79f5;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (seed, lo, hi) => lo + Math.floor(rand(seed) * (hi - lo + 1));

const NOUN = { '*': 'workshop', car: 'car dealer', trade: 'trade supplier', works: 'factory' };

/** "shop=car_repair" → "car repair"; "craft=*" → "workshop". */
const tagNoun = (tag) => {
  const v = tag.split('=')[1];
  return NOUN[v] ?? v.replace(/_/g, ' ');
};

function daysBefore(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

const config = read('evidence_config.json');
const demand = read('area_demand.json');
const province = read('address.json').find((p) => p.code === PROVINCE);
const communes = province.districts.flatMap((d) => d.communes);
const types = Object.keys(config.loanTypes);

const out = {};
for (const c of communes) {
  const [minLng, minLat, maxLng, maxLat] = c.bbox;
  const score = demand.communes[c.code]?.score ?? {};
  const newBusinesses = {};
  for (const t of types) {
    // More new businesses where the sample demand score is higher, plus noise.
    const n = Math.max(
      0,
      Math.round(((score[t] ?? 50) / 100) * 6 + (rand(`${c.code}:${t}:n`) - 0.5) * 3),
    );
    const tags = config.loanTypes[t].osmTags;
    newBusinesses[t] = Array.from({ length: n }, (_, i) => {
      const tag = tags[int(`${c.code}:${t}:${i}:tag`, 0, tags.length - 1)];
      return {
        name: `Sample ${tagNoun(tag)} ${i + 1}`,
        tag,
        when: daysBefore(SCAN_DATE, int(`${c.code}:${t}:${i}:when`, 2, 88)),
        lat: +(minLat + rand(`${c.code}:${t}:${i}:lat`) * (maxLat - minLat)).toFixed(5),
        lng: +(minLng + rand(`${c.code}:${t}:${i}:lng`) * (maxLng - minLng)).toFixed(5),
      };
    });
  }
  out[c.code] = {
    // About 1 in 12 sangkats has no census row, so some packs run on fewer signals.
    householdsPerKm2:
      rand(`${c.code}:census:missing`) < 0.08 ? null : int(`${c.code}:hh`, 800, 9500),
    newPlaces90d: int(`${c.code}:new`, 3, 40),
    closedPlaces90d: int(`${c.code}:closed`, 0, 25),
    previousScore: Object.fromEntries(
      types.map((t) => [
        t,
        Math.max(0, Math.min(100, (score[t] ?? 50) + int(`${c.code}:${t}:prev`, -12, 8))),
      ]),
    ),
    newBusinesses,
  };
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};
const cityMedian = {
  newBusinesses: Object.fromEntries(
    types.map((t) => [t, median(Object.values(out).map((c) => c.newBusinesses[t].length))]),
  ),
  householdsPerKm2: median(
    Object.values(out)
      .map((c) => c.householdsPerKm2)
      .filter((v) => v !== null),
  ),
  netNewPlaces90d: median(Object.values(out).map((c) => c.newPlaces90d - c.closedPlaces90d)),
};

const file = {
  sample: true,
  scanDate: SCAN_DATE,
  previousScanDate: PREVIOUS_SCAN_DATE,
  cityMedian,
  communes: out,
};
fs.writeFileSync(path.join(DATA, 'evidence_sample.json'), JSON.stringify(file) + '\n');
console.log(
  `Wrote data/evidence_sample.json: ${communes.length} Phnom Penh sangkats, sample data.`,
);
