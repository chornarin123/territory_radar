#!/usr/bin/env node
// Lays the initial scan grid over each sangkat, from a GeoJSON of boundaries.
//
//   node scripts/seed-grid.mjs sangkats.geojson [radiusM]
//
// Input: a GeoJSON FeatureCollection where each feature has a `sangkatCode`
// property (or `sangkat_code`) and a Polygon/MultiPolygon geometry. Only the
// bounding box is used — cells are circles laid over that box, so they spill
// into neighbouring sangkats. A place is attributed to whichever cell finds it
// first; see "Known limitations" in the README.
//
// Areas must be imported first (grid_cells references areas).

import { readFile } from 'node:fs/promises';

const { API_URL = 'http://localhost:3000', API_KEY } = process.env;
const [file, radiusArg] = process.argv.slice(2);

if (!file) {
  console.error('Usage: node scripts/seed-grid.mjs <sangkats.geojson> [radiusM]');
  process.exit(1);
}
if (!API_KEY) {
  console.error('Set API_KEY (the same value the API is running with).');
  process.exit(1);
}

const radiusM = radiusArg ? Number(radiusArg) : undefined;
const geojson = JSON.parse(await readFile(file, 'utf8'));
const features = geojson.features ?? [];

function bboxOf(geometry) {
  const bbox = { south: 90, west: 180, north: -90, east: -180 };
  const visit = (coords) => {
    if (typeof coords[0] === 'number') {
      const [lng, lat] = coords;
      bbox.south = Math.min(bbox.south, lat);
      bbox.north = Math.max(bbox.north, lat);
      bbox.west = Math.min(bbox.west, lng);
      bbox.east = Math.max(bbox.east, lng);
      return;
    }
    for (const part of coords) visit(part);
  };
  visit(geometry.coordinates);
  return bbox;
}

let seeded = 0;
let skipped = 0;

for (const feature of features) {
  const sangkatCode = feature.properties?.sangkatCode ?? feature.properties?.sangkat_code;
  if (!sangkatCode || !feature.geometry) {
    console.warn('Skipping feature with no sangkatCode or geometry');
    skipped += 1;
    continue;
  }

  const response = await fetch(`${API_URL}/places/grid`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify({
      sangkatCode,
      bbox: bboxOf(feature.geometry),
      ...(radiusM ? { radiusM } : {}),
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.warn(`${sangkatCode}: HTTP ${response.status} — ${body.message ?? 'failed'}`);
    skipped += 1;
    continue;
  }

  console.log(`${sangkatCode}: ${body.cells} cells`);
  seeded += body.cells;
}

console.log(`\nSeeded ${seeded} cells; skipped ${skipped} sangkats.`);
