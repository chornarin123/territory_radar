import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from './schema.js';
import { areas, places, reviewAnalyses, signals } from './schema.js';

// A real Postgres engine (PGlite: Postgres compiled to WASM), not a mock. The
// early proof that Khmer survives the database byte-for-byte — and that every
// migration in ./drizzle applies cleanly, which nothing else tests.
//
// This covers the database engine. The network driver to Neon is checked by
// `pnpm --filter @territory-radar/api check:khmer` against the real database.

const ZWSP = String.fromCodePoint(0x200b);
const SAMPLES: Record<string, string> = {
  sentence: 'ហាងនេះមានអតិថិជនច្រើន ប៉ុន្តែទំនិញខ្លះអស់ពីស្តុក។',
  coengStack: 'ស្ត្រី',
  zeroWidthSpace: `ភ្នំ${ZWSP}ពេញ`,
  mixedScripts: 'ហាង Samsung ២៤ម៉ោង ☕',
};
const SANGKAT_KM = 'ផ្សារថ្មីទី១';
const PLACE_ID = 'ChIJ-khmer-test';

let client: PGlite;
let db: PgliteDatabase<typeof schema>;

beforeAll(async () => {
  client = await PGlite.create();
  db = drizzle({ client, schema });
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
  });
  await db.insert(areas).values({
    sangkatCode: '120101',
    nameEn: 'Phsar Thmei I',
    nameKm: SANGKAT_KM,
    districtCode: '1201',
    provinceCode: '12',
  });
  const now = new Date();
  await db
    .insert(places)
    .values({ placeId: PLACE_ID, sangkatCode: '120101', firstSeen: now, lastSeen: now });
}, 120_000);

afterAll(async () => {
  await client?.close();
});

describe('Khmer in Postgres', () => {
  it('runs on a UTF8 database', async () => {
    const { rows } = await client.query<{ encoding: string }>(
      "select current_setting('server_encoding') as encoding",
    );
    expect(rows[0]!.encoding).toBe('UTF8');
  });

  it.each(Object.entries(SAMPLES))(
    'round-trips %s through summary_km byte-for-byte',
    async (_, text) => {
      const row = {
        reviewsHash: 'hash',
        model: 'claude-sonnet-4-6',
        businessScale: 'small' as const,
        summaryKm: text,
        analyzedAt: new Date(),
      };
      await db
        .insert(reviewAnalyses)
        .values({ placeId: PLACE_ID, ...row })
        .onConflictDoUpdate({ target: reviewAnalyses.placeId, set: row });

      const [stored] = await db
        .select({
          summaryKm: reviewAnalyses.summaryKm,
          bytes: sql<number>`octet_length(${reviewAnalyses.summaryKm})`,
          chars: sql<number>`char_length(${reviewAnalyses.summaryKm})`,
        })
        .from(reviewAnalyses)
        .where(eq(reviewAnalyses.placeId, PLACE_ID));

      expect(stored!.summaryKm).toBe(text);
      expect(Number(stored!.bytes)).toBe(Buffer.byteLength(text, 'utf8'));
      expect(Number(stored!.chars)).toBe(Array.from(text).length);
    },
  );

  it('round-trips the Khmer sangkat name', async () => {
    const [area] = await db.select({ nameKm: areas.nameKm }).from(areas);
    expect(area!.nameKm).toBe(SANGKAT_KM);
  });

  it('round-trips Khmer inside jsonb, where top_factors and job errors live', async () => {
    const { rows } = await client.query<{ value: string }>("select ($1::jsonb)->>'s' as value", [
      JSON.stringify({ s: SAMPLES.sentence }),
    ]);
    expect(rows[0]!.value).toBe(SAMPLES.sentence);
  });

  it('accepts every signal type the review miner can emit (migration 0002)', async () => {
    const types = [
      'expansion',
      'second_branch',
      'renovation',
      'long_queue',
      'price_increase',
    ] as const;
    await db.insert(signals).values(
      types.map((signalType) => ({
        placeId: PLACE_ID,
        detectedAt: new Date(),
        signalType,
        evidence: 'Paraphrased evidence',
        confidence: 0.7,
      })),
    );
    const stored = await db.select({ type: signals.signalType }).from(signals);
    expect(stored.map((s) => s.type).sort()).toEqual([...types].sort());
  });
});
