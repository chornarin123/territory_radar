#!/usr/bin/env node
// Round-trips Khmer through the REAL database the API uses — run once per
// environment (local, Neon) before trusting summary_km in the app:
//
//   pnpm --filter @territory-radar/api check:khmer
//
// Reads DATABASE_URL from the environment, or from apps/api/.env. Uses a
// temporary table, so it leaves nothing behind.

import { readFileSync } from 'node:fs';
import pg from 'pg';

const SAMPLES = {
  sentence: 'ហាងនេះមានអតិថិជនច្រើន ប៉ុន្តែទំនិញខ្លះអស់ពីស្តុក។',
  coengStack: 'ស្ត្រី',
  // Built from its code point: a literal zero-width space is invisible in source.
  zeroWidthSpace: `ភ្នំ${String.fromCodePoint(0x200b)}ពេញ`,
  mixed: 'ហាង Samsung ២៤ម៉ោង ☕',
};

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
    const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='));
    return line?.slice('DATABASE_URL='.length).trim();
  } catch {
    return undefined;
  }
}

const url = databaseUrl();
if (!url) {
  console.error('DATABASE_URL is not set (environment or apps/api/.env).');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
let failures = 0;

try {
  await client.connect();
  const { rows: enc } = await client.query(
    "select current_setting('server_encoding') as server, current_setting('client_encoding') as client",
  );
  console.log(`server_encoding=${enc[0].server} client_encoding=${enc[0].client}`);
  if (enc[0].server !== 'UTF8') {
    console.error(
      'FAIL server_encoding is not UTF8 — Khmer cannot be stored. Recreate the database with ENCODING UTF8.',
    );
    failures += 1;
  }

  await client.query('create temp table khmer_check (label text, t text, j jsonb)');
  for (const [label, text] of Object.entries(SAMPLES)) {
    await client.query('insert into khmer_check values ($1, $2, $3)', [label, text, { s: text }]);
    const { rows } = await client.query(
      "select t, j->>'s' as js, octet_length(t) as bytes from khmer_check where label = $1",
      [label],
    );
    const row = rows[0];
    const expectedBytes = Buffer.byteLength(text, 'utf8');
    const ok = row.t === text && row.js === text && Number(row.bytes) === expectedBytes;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${label.padEnd(15)} ${expectedBytes} bytes  ${row.t}`);
    if (!ok) failures += 1;
  }
} catch (err) {
  console.error(`FAIL ${err.message}`);
  failures += 1;
} finally {
  await client.end().catch(() => {});
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nKhmer round-trips intact through this database.');
