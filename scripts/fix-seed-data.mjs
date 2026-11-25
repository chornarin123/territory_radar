/**
 * Cleans the synthetic seed data in data/data.json. Safe to run again: the
 * same input gives the same file.
 *
 *   node scripts/fix-seed-data.mjs
 *
 * 1. Territory: every seed area gets its official code from address.json and
 *    the official spelling (Tonle Bassac → Tonle Basak), so territory joins by
 *    code, never by name.
 * 2. Pins: every prospect gets a point inside its assigned sangkat's real
 *    polygon, spread across it (seeded by prospect id, so deterministic). That
 *    also puts every prospect inside the territory the app says it is in.
 * 3. Sectors follow the business name (an auto repair shop is Automotive).
 *
 * Everything here is fictional demo data. No real customer data.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import { loadBoundaries } from './area-codes.mjs';

const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data');
const FILE = path.join(DATA, 'data.json');
const db = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const tree = JSON.parse(fs.readFileSync(path.join(DATA, 'address.json'), 'utf8'));

// ─── 1. Official codes and spellings ─────────────────────────────────────────

/** Seed area id → official code (address.json). Names come from there too. */
const OFFICIAL = {
  area_pp: '12',
  area_d1: '1201', // Chamkar Mon
  area_d2: '1204', // Tuol Kouk
  area_d3: '1210', // Chrouy Changvar
  area_c1: '120101', // Tonle Basak (seed spelling: Tonle Bassac)
  area_c2: '120110', // Tuol Tumpung Ti Muoy
  area_c3: '120407', // Boeng Kak Ti Muoy
  area_c4: '120408', // Boeng Kak Ti Pir
  area_c5: '121001', // Chrouy Changvar
};

const official = new Map();
for (const p of tree) {
  official.set(p.code, p);
  for (const d of p.districts) {
    official.set(d.code, d);
    for (const c of d.communes) official.set(c.code, c);
  }
}

const renamed = new Map(); // old seed name → official name
for (const a of db.administrativeAreas) {
  const code = OFFICIAL[a.id];
  if (!code) continue;
  const o = official.get(code);
  if (!o) throw new Error(`No official area ${code} for ${a.id}`);
  if (a.nameEn !== o.name_en) renamed.set(a.nameEn, o.name_en);
  a.officialCode = code;
  a.nameEn = o.name_en;
}
for (const p of db.prospects) {
  for (const [from, to] of renamed) {
    p.address.display = p.address.display.replace(`, ${from},`, `, ${to},`);
  }
}

// ─── 2. Pins inside the assigned sangkat ─────────────────────────────────────

/** Deterministic 0–1 stream from a string (FNV-1a, then mulberry32). */
function rng(seed) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  let t = h >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), t | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const polygons = new Map(loadBoundaries('communes').features.map((f) => [f.properties.code, f]));

function bboxOf(feature) {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  const walk = (c) => {
    if (typeof c[0] === 'number') {
      minX = Math.min(minX, c[0]);
      maxX = Math.max(maxX, c[0]);
      minY = Math.min(minY, c[1]);
      maxY = Math.max(maxY, c[1]);
    } else c.forEach(walk);
  };
  walk(feature.geometry.coordinates);
  return { minX, minY, maxX, maxY };
}

/**
 * A point inside the polygon, away from its edge: it must stay inside when
 * nudged ~60 m in each direction, so the pin is clearly in the sangkat.
 */
function pointIn(feature, seed) {
  const r = rng(seed);
  const b = bboxOf(feature);
  const inside = (lng, lat) => booleanPointInPolygon([lng, lat], feature);
  const m = 0.00055; // ~60 m
  for (let i = 0; i < 2000; i++) {
    const lng = b.minX + r() * (b.maxX - b.minX);
    const lat = b.minY + r() * (b.maxY - b.minY);
    if (
      inside(lng, lat) &&
      inside(lng + m, lat) &&
      inside(lng - m, lat) &&
      inside(lng, lat + m) &&
      inside(lng, lat - m)
    ) {
      return { lat: Number(lat.toFixed(5)), lng: Number(lng.toFixed(5)) };
    }
  }
  throw new Error(`No point found inside ${feature.properties.code}`);
}

const areaById = new Map(db.administrativeAreas.map((a) => [a.id, a]));
let moved = 0;
for (const p of db.prospects) {
  const communeId = p.address.communeId;
  const code = areaById.get(communeId)?.officialCode;
  const feature = code && polygons.get(code);
  if (!feature) throw new Error(`${p.id}: no polygon for ${communeId}`);
  const at = pointIn(feature, `${p.id}|${code}`);
  if (!p.location || p.location.lat !== at.lat || p.location.lng !== at.lng) moved += 1;
  p.location = { ...(p.location ?? {}), ...at, accuracy: 'synthetic_approximate' };
}

// ─── 3. Sector from the business name ────────────────────────────────────────

/** First match wins. Names not listed keep their sector. */
const SECTOR_BY_NAME = [
  [/auto repair|tire shop|motor parts|spoke workshop|garage/i, 'automotive'],
  [/salon|laundry|repair lab|print house|fitness|pixel studio/i, 'services'],
  [/tuition|learning hub|school/i, 'education'],
  [/pharmacy|dental|clinic/i, 'healthcare'],
  [/café|cafe|coffee|roastery|eatery|noodle|bakery|kitchen|juice/i, 'food_beverage'],
  [/guesthouse/i, 'services'],
  [/wood studio|wood workshop|garments|textile|tailor|packaging(?! depot)/i, 'manufacturing'],
];
const sectorChanges = [];
for (const p of db.prospects) {
  if (['property_project', 'employer', 'logistics', 'wholesale'].includes(p.sector)) continue;
  const hit = SECTOR_BY_NAME.find(([re]) => re.test(p.displayName));
  if (hit && hit[1] !== p.sector) {
    sectorChanges.push(`${p.displayName}: ${p.sector} → ${hit[1]}`);
    p.sector = hit[1];
  }
}

fs.writeFileSync(FILE, `${JSON.stringify(db, null, 2)}\n`);
console.log(`Areas renamed: ${[...renamed].map(([a, b]) => `${a} → ${b}`).join(', ') || 'none'}`);
console.log(`Pins placed inside their sangkat: ${moved} moved of ${db.prospects.length}`);
console.log(`Sectors fixed (${sectorChanges.length}):\n  ${sectorChanges.join('\n  ')}`);
