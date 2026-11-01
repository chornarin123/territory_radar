import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../database/database.module.js';
import * as schema from '../database/schema.js';
import { areas, leads, officers, places, reviewAnalyses, scores } from '../database/schema.js';
import { LeadsService } from './leads.service.js';

// The officer's Khmer opening line makes one trip: Claude writes it into
// review_analyses, LeadsService reads it back, Fastify serialises it. The
// database and the HTTP layer are covered on their own; this is the join
// between them, which is where a wrong collation or a stray escape would show.
//
// Real Postgres (PGlite) and the real service, not a mock query.

const ZWSP = String.fromCodePoint(0x200b);
// A coeng stack, a zero-width space, Khmer digits and Latin in one sentence —
// each of which breaks differently when an encoding is wrong.
const SUMMARY_KM = `ហាងនេះនៅ${ZWSP}ភ្នំពេញ បើកបាន ៦ ខែ ហើយអតិថិជនកើនឡើង`;
const PLACE_ID = 'ChIJ-lead-khmer';
const OFFICER_ID = '11111111-1111-4111-8111-111111111111';

let client: PGlite;
let service: LeadsService;

beforeAll(async () => {
  client = await PGlite.create();
  const db: PgliteDatabase<typeof schema> = drizzle({ client, schema });
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
  });

  const now = new Date();
  await db.insert(areas).values({
    sangkatCode: '120101',
    nameEn: 'Phsar Thmei I',
    nameKm: 'ផ្សារថ្មីទី១',
    districtCode: '1201',
    provinceCode: '12',
  });
  await db.insert(places).values({
    placeId: PLACE_ID,
    sangkatCode: '120101',
    lat: 11.5564,
    lng: 104.9282,
    primaryType: 'convenience_store',
    firstSeen: now,
    lastSeen: now,
  });
  await db.insert(officers).values({
    id: OFFICER_ID,
    name: 'Sok Dara',
    branch: 'Daun Penh',
    assignedSangkats: ['120101'],
  });
  await db.insert(leads).values({
    placeId: PLACE_ID,
    officerId: OFFICER_ID,
    assignedAt: now,
    routeId: '2026-09-20:120101:1',
    routePosition: 1,
  });
  await db.insert(scores).values({
    placeId: PLACE_ID,
    scanDate: '2026-09-20',
    need: 0.6,
    capacity: 0.4,
    bankability: 0.5,
    total: 0.51,
    topFactors: [
      {
        factor: 'newOpening',
        pillar: 'need',
        label: 'New opening',
        value: 0.9,
        contribution: 0.126,
      },
    ],
  });
  // Exactly the row ReviewMiningService.persist() writes.
  await db.insert(reviewAnalyses).values({
    placeId: PLACE_ID,
    reviewsHash: 'sha256-test',
    model: 'claude-sonnet-4-6',
    businessScale: 'micro',
    summaryKm: SUMMARY_KM,
    analyzedAt: now,
  });

  service = new LeadsService(db as unknown as Database);
}, 120_000);

afterAll(async () => {
  await client?.close();
});

describe('Khmer reaches the officer intact', () => {
  it('returns summary_km byte-for-byte from the lead query', async () => {
    const [lead] = await service.listForOfficer(OFFICER_ID);

    expect(lead).toBeDefined();
    expect(lead!.summaryKm).toBe(SUMMARY_KM);
    expect(lead!.businessScale).toBe('micro');
    // Length in code units and in UTF-8 bytes — a lossy round trip changes one
    // or the other even when the string still looks right.
    expect(lead!.summaryKm!.length).toBe(SUMMARY_KM.length);
    expect(Buffer.byteLength(lead!.summaryKm!, 'utf8')).toBe(Buffer.byteLength(SUMMARY_KM, 'utf8'));
  });

  it('keeps the zero-width space that separates the stacked syllables', async () => {
    const [lead] = await service.listForOfficer(OFFICER_ID);
    expect(lead!.summaryKm).toContain(ZWSP);
  });

  it('serialises to JSON as real Khmer, not escapes', async () => {
    const [lead] = await service.listForOfficer(OFFICER_ID);
    const body = JSON.stringify(lead);

    // Fastify sends exactly this. Escaped Khmer would still parse, but it is a
    // sign the string was rebuilt somewhere instead of passed through.
    const escapePrefix = String.fromCharCode(92) + 'u17';
    expect(body).not.toContain(escapePrefix);
    expect(body).toContain(SUMMARY_KM);
    expect((JSON.parse(body) as { summaryKm: string }).summaryKm).toBe(SUMMARY_KM);
  });
});
