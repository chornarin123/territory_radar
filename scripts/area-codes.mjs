/**
 * Cambodia's administrative areas (data/address.json) and commune boundaries
 * (data/boundaries/*.geojson), for the mobile app's area filter.
 *
 * Prospects only carry lat/lng, so each one gets its commune, district and
 * province codes here, once, by point-in-polygon. The app never has to download
 * the 1.8 MB commune file just to know where a prospect is.
 *
 * Codes nest by prefix: province "12", district "1201", commune "120101".
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import { featureCollection } from '@turf/helpers';
import { union } from '@turf/union';

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data');
export const BOUNDARY_LEVELS = ['provinces', 'districts', 'communes'];

const cache = new Map();
function readJson(rel) {
  if (!cache.has(rel)) {
    cache.set(rel, JSON.parse(fs.readFileSync(path.join(DATA_DIR, rel), 'utf8')));
  }
  return cache.get(rel);
}

/** Provinces → districts → communes, as data/address.json has them. */
export const loadAddressTree = () => readJson('address.json');

/** Sample evidence behind demand scores, and its config (see evidence.mjs). */
export const loadEvidenceSample = () => readJson('evidence_sample.json');
export const loadEvidenceConfig = () => readJson('evidence_config.json');

/** A commune with its district, from address.json; null if unknown. */
export function communeInfo(code) {
  if (!cache.has('communeInfo')) {
    const byCode = new Map();
    for (const p of loadAddressTree()) {
      for (const d of p.districts) {
        for (const c of d.communes) byCode.set(c.code, { ...c, district: d, province: p });
      }
    }
    cache.set('communeInfo', byCode);
  }
  return cache.get('communeInfo').get(code) ?? null;
}

/** One boundaries file, as a GeoJSON FeatureCollection. */
export const loadBoundaries = (level) => readJson(`boundaries/${level}.geojson`);

/** One level's boundaries, or only those inside one province. */
export function boundariesIn(level, provinceCode) {
  const all = loadBoundaries(level);
  if (!provinceCode) return all;
  return {
    type: 'FeatureCollection',
    features: all.features.filter((f) => f.properties.code.startsWith(provinceCode)),
  };
}

/**
 * Each district's outline in a province, as the union of its commune polygons.
 * Not boundaries/districts.geojson: some of those older outlines no longer match
 * today's communes (Saensokh, Ta Khmau). Communes with no polygon add nothing.
 */
export function districtOutlines(provinceCode) {
  const key = `outlines:${provinceCode}`;
  if (!cache.has(key)) {
    const byDistrict = new Map();
    for (const f of boundariesIn('communes', provinceCode).features) {
      const d = f.properties.district_code;
      if (!byDistrict.has(d)) byDistrict.set(d, []);
      byDistrict.get(d).push(f);
    }
    const features = [...byDistrict].map(([code, parts]) => {
      const merged = parts.length === 1 ? parts[0] : union(featureCollection(parts));
      return { type: 'Feature', properties: { code }, geometry: merged.geometry };
    });
    cache.set(key, { type: 'FeatureCollection', features });
  }
  return cache.get(key);
}

/**
 * Predicted loan demand per commune (data/area_demand.json), optionally one
 * province, plus every province's average score per loan type, for shading the
 * provinces around it.
 */
export function areaDemand(provinceCode) {
  const all = readJson('area_demand.json');
  const provinces = provinceAverages();
  if (!provinceCode) return { ...all, provinces };
  return {
    ...all,
    provinces,
    communes: Object.fromEntries(
      Object.entries(all.communes).filter(([code]) => code.startsWith(provinceCode)),
    ),
  };
}

function provinceAverages() {
  if (!cache.has('provinceAverages')) {
    const { loan_types: types, communes } = readJson('area_demand.json');
    const sums = new Map();
    for (const [code, d] of Object.entries(communes)) {
      const p = code.slice(0, 2);
      if (!sums.has(p)) sums.set(p, { n: 0, score: Object.fromEntries(types.map((t) => [t, 0])) });
      const s = sums.get(p);
      s.n += 1;
      for (const t of types) s.score[t] += d.score[t];
    }
    cache.set(
      'provinceAverages',
      Object.fromEntries(
        [...sums].map(([p, s]) => [
          p,
          Object.fromEntries(types.map((t) => [t, Math.round(s.score[t] / s.n)])),
        ]),
      ),
    );
  }
  return cache.get('provinceAverages');
}

/** Communes with their bbox, for a cheap check before the polygon test. */
function communeIndex() {
  if (!cache.has('communeIndex')) {
    const names = new Map();
    for (const p of loadAddressTree()) {
      for (const d of p.districts) {
        for (const c of d.communes) names.set(c.code, { commune: c, district: d, province: p });
      }
    }
    const index = loadBoundaries('communes').features.map((f) => ({
      feature: f,
      bbox: names.get(f.properties.code)?.commune.bbox ?? bboxOf(f.geometry),
      names: names.get(f.properties.code),
    }));
    cache.set('communeIndex', index);
  }
  return cache.get('communeIndex');
}

/**
 * The commune a point falls in, with its district and province, or null when it
 * is outside every polygon (at sea, or across the border).
 */
export function areaAt(lat, lng) {
  for (const c of communeIndex()) {
    const [minLng, minLat, maxLng, maxLat] = c.bbox;
    if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) continue;
    if (!booleanPointInPolygon([lng, lat], c.feature)) continue;
    const { code, district_code, province_code } = c.feature.properties;
    return {
      communeCode: code,
      districtCode: district_code,
      provinceCode: province_code,
      communeName: c.names?.commune.name_en ?? c.feature.properties.name_en,
    };
  }
  return null;
}

function bboxOf(geometry) {
  const rings = geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat();
  const pts = rings.flat();
  const lngs = pts.map((p) => p[0]);
  const lats = pts.map((p) => p[1]);
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}
