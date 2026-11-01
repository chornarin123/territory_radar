#!/usr/bin/env node
// Bulk-loads sangkat census + purchasing-power data into the API.
//
//   node scripts/import-areas.mjs areas.json
//
// Input: a JSON array of objects matching the PUT /areas schema:
//   [{ "sangkatCode": "120101", "nameEn": "Phsar Thmey 1", "nameKm": "ផ្សារថ្មី១",
//      "districtCode": "1201", "provinceCode": "12", "households": 1234,
//      "population": 5678, "ppiScore": 0.72, "ppiComponents": { "income": 0.8 } }]
//
// ppiScore must already be normalised to 0..1.

import { readFile } from 'node:fs/promises';

const { API_URL = 'http://localhost:3000', API_KEY } = process.env;
const [file] = process.argv.slice(2);

if (!file) {
  console.error('Usage: node scripts/import-areas.mjs <areas.json>');
  process.exit(1);
}
if (!API_KEY) {
  console.error('Set API_KEY (the same value the API is running with).');
  process.exit(1);
}

const areas = JSON.parse(await readFile(file, 'utf8'));
if (!Array.isArray(areas)) {
  console.error('Expected the file to contain a JSON array of areas.');
  process.exit(1);
}

const response = await fetch(`${API_URL}/areas`, {
  method: 'PUT',
  headers: { 'content-type': 'application/json', 'x-api-key': API_KEY },
  body: JSON.stringify(areas),
});

const body = await response.json().catch(() => ({}));
if (!response.ok) {
  console.error(`Import failed (HTTP ${response.status}):`, JSON.stringify(body, null, 2));
  process.exit(1);
}

console.log(`Imported ${body.imported} areas.`);
