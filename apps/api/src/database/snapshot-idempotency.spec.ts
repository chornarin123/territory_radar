import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { localDate } from '../common/time.js';
import { computeReviewVelocity } from '../signals/velocity.js';
import * as schema from './schema.js';
import { areas, places, snapshots } from './schema.js';

// pg-boss retries a handler that throws, so enriching the same place twice in
// one run has to leave the same history behind. Run against a real Postgres
// engine because the guarantee is a unique index, not application code.

const PLACE_ID = 'ChIJ-retry-test';
let client: PGlite;
let db: PgliteDatabase<typeof schema>;

/** The same write the enrich worker makes. */
async function writeSnapshot(at: Date, reviewCount: number) {
  const row = { placeId: PLACE_ID, scannedAt: at, scanDate: localDate(at), reviewCount };
  await db
    .insert(snapshots)
    .values(row)
    .onConflictDoUpdate({
      target: [snapshots.placeId, snapshots.scanDate],
      set: { scannedAt: row.scannedAt, reviewCount: row.reviewCount },
    });
}

beforeAll(async () => {
  client = await PGlite.create();
  db = drizzle({ client, schema });
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
  });
  await db.insert(areas).values({
    sangkatCode: '120101',
    nameEn: 'Phsar Thmei I',
    nameKm: 'ផ្សារថ្មីទី១',
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

describe('snapshots are idempotent per day', () => {
  it('keeps one row per place per day when a job is retried', async () => {
    const first = new Date('2026-03-01T15:00:00Z');
    // A retry minutes later — same Cambodian calendar day.
    await writeSnapshot(first, 40);
    await writeSnapshot(new Date('2026-03-01T15:04:00Z'), 41);

    const rows = await db.select().from(snapshots).where(eq(snapshots.placeId, PLACE_ID));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reviewCount).toBe(41);
  });

  it('still records the next scan as a separate day', async () => {
    await writeSnapshot(new Date('2026-03-08T15:00:00Z'), 48);
    const rows = await db.select().from(snapshots).where(eq(snapshots.placeId, PLACE_ID));
    expect(rows).toHaveLength(2);
  });

  it('leaves review velocity measurable, which a duplicate would not', async () => {
    // Three weekly points: 41 → 48 → 70. The spike is in the last interval.
    await writeSnapshot(new Date('2026-03-15T15:00:00Z'), 70);
    // The retry that used to insert a near-duplicate.
    await writeSnapshot(new Date('2026-03-15T15:03:00Z'), 70);

    const series = await db
      .select({ at: snapshots.scannedAt, reviewCount: snapshots.reviewCount })
      .from(snapshots)
      .where(eq(snapshots.placeId, PLACE_ID))
      .orderBy(asc(snapshots.scannedAt));

    expect(series).toHaveLength(3);
    const reading = computeReviewVelocity(series);
    expect(reading).not.toBeNull();
    expect(reading!.delta).toBe(22);
    expect(reading!.isSpike).toBe(true);
  });
});
