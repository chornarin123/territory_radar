import pg from '../apps/api/node_modules/pg/lib/index.js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Load .env
const envPath = resolve('apps/api/.env');
if (existsSync(envPath)) {
  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim();
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('DATABASE_URL is not set!');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: dbUrl });

async function seed() {
  console.log('Seeding Territory Radar demo data...');

  // 1. Areas
  console.log('1. Inserting areas...');
  await pool.query(`
    INSERT INTO areas (sangkat_code, name_en, name_km, district_code, province_code, households, population, ppi_score, ppi_components)
    VALUES
      ('120201', 'Boeng Keng Kang 1', 'បឹងកេងកងទី១', '1202', '12', 4500, 18500, 0.88, '{"income": 0.92, "density": 0.84}'),
      ('120101', 'Tonle Bassac', 'ទន្លេបាសាក់', '1201', '12', 5200, 22000, 0.82, '{"income": 0.85, "density": 0.79}'),
      ('120501', 'Tuol Toumpoung 1', 'ទួលទំពូងទី១', '1205', '12', 3800, 15000, 0.75, '{"income": 0.76, "density": 0.74}')
    ON CONFLICT (sangkat_code) DO UPDATE SET
      name_en = EXCLUDED.name_en,
      name_km = EXCLUDED.name_km,
      ppi_score = EXCLUDED.ppi_score;
  `);

  // 1.5 Grid Cells for Overpass scanning
  console.log('1.5 Inserting grid cells for Overpass scanning...');
  await pool.query(`
    INSERT INTO grid_cells (sangkat_code, lat, lng, radius_m)
    VALUES
      ('120201', 11.5545, 104.9225, 350),
      ('120201', 11.5500, 104.9250, 350),
      ('120201', 11.5580, 104.9200, 350),
      ('120101', 11.5450, 104.9300, 350),
      ('120101', 11.5480, 104.9350, 350)
    ON CONFLICT DO NOTHING;
  `);

  // 2. Officers
  console.log('2. Inserting officers...');
  const officerResult = await pool.query(`
    INSERT INTO officers (name, branch, assigned_sangkats)
    VALUES
      ('Sokha Chan', 'PPCBank BKK Branch', ARRAY['120201', '120101']),
      ('Vanna Meas', 'PPCBank Main Branch', ARRAY['120501'])
    ON CONFLICT DO NOTHING
    RETURNING id, name;
  `);

  let sokhaId;
  let vannaId;
  if (officerResult.rows.length >= 2) {
    sokhaId = officerResult.rows[0].id;
    vannaId = officerResult.rows[1].id;
  } else {
    const existing = await pool.query(`SELECT id, name FROM officers ORDER BY name ASC LIMIT 2;`);
    sokhaId = existing.rows[0]?.id;
    vannaId = existing.rows[1]?.id || sokhaId;
  }
  console.log(`Officer Sokha Chan ID: ${sokhaId}, Vanna Meas ID: ${vannaId}`);

  // 3. Demo Places (Phnom Penh real cluster in BKK1 / Tonle Bassac)
  console.log('3. Inserting demo places...');
  const demoPlaces = [
    {
      placeId: 'osm:node:182564',
      sangkatCode: '120201',
      lat: 11.5455068,
      lng: 104.9117457,
      primaryType: 'cafe',
      summaryKm: 'ហាងកាហ្វេមានអតិថិជនច្រើនណែន និងមានគម្រោងពង្រីកសាខាទីពីរក្នុងតំបន់បឹងកេងកង។',
      need: 0.85,
      capacity: 0.80,
      bankability: 0.88,
      total: 0.84,
      topFactors: [
        { factor: 'new_opening', value: 0.9, contribution: 0.315 },
        { factor: 'price_level', value: 0.8, contribution: 0.24 },
        { factor: 'has_web_or_page', value: 1.0, contribution: 0.16 },
      ],
      routePos: 1,
      routeId: '2026-09-20:120201:1',
      status: 'new',
    },
    {
      placeId: 'osm:node:182566',
      sangkatCode: '120201',
      lat: 11.5534447,
      lng: 104.9216423,
      primaryType: 'supermarket',
      summaryKm: 'ផ្សារទំនើបខ្នាតតូចមានលំហូរសាច់ប្រាក់ថេរ និងត្រូវការដើមទុនបន្ថែមសម្រាប់នាំចូលទំនិញថ្មីៗ។',
      need: 0.72,
      capacity: 0.86,
      bankability: 0.85,
      total: 0.80,
      topFactors: [
        { factor: 'velocity_spike', value: 0.85, contribution: 0.255 },
        { factor: 'category_lendable', value: 1.0, contribution: 0.255 },
        { factor: 'area_ppi', value: 0.88, contribution: 0.264 },
      ],
      routePos: 2,
      routeId: '2026-09-20:120201:1',
      status: 'new',
    },
    {
      placeId: 'osm:node:182568',
      sangkatCode: '120201',
      lat: 11.5545483,
      lng: 104.9246626,
      primaryType: 'supermarket',
      summaryKm: 'ហាងដំណើរការ ២៤ម៉ោងលើ២៤ម៉ោង មានការគ្រប់គ្រងច្បាស់លាស់ និងមានសក្តានុពលកម្ចីអាជីវកម្មខ្ពស់។',
      need: 0.78,
      capacity: 0.82,
      bankability: 0.80,
      total: 0.79,
      topFactors: [
        { factor: 'hours_extended', value: 1.0, contribution: 0.15 },
        { factor: 'area_ppi', value: 0.88, contribution: 0.264 },
        { factor: 'category_lendable', value: 1.0, contribution: 0.255 },
      ],
      routePos: 3,
      routeId: '2026-09-20:120201:1',
      status: 'visited',
    },
    {
      placeId: 'osm:node:445211391',
      sangkatCode: '120201',
      lat: 11.5553367,
      lng: 104.9222996,
      primaryType: 'supermarket',
      summaryKm: 'អតិថិជនច្រើន ប៉ុន្តែទំនិញខ្លះឆាប់អស់ពីស្តុក ដែលបង្ហាញពីតម្រូវការទុនបង្វិលបន្ទាន់។',
      need: 0.88,
      capacity: 0.75,
      bankability: 0.70,
      total: 0.79,
      topFactors: [
        { factor: 'low_stock', value: 1.0, contribution: 0.20 },
        { factor: 'velocity_spike', value: 0.8, contribution: 0.24 },
        { factor: 'category_lendable', value: 1.0, contribution: 0.255 },
      ],
      routePos: 4,
      routeId: '2026-09-20:120201:1',
      status: 'won',
    },
    {
      placeId: 'osm:node:445968487',
      sangkatCode: '120201',
      lat: 11.5575212,
      lng: 104.9236327,
      primaryType: 'restaurant',
      summaryKm: 'ភោជនីយដ្ឋានពេញនិយមនៅពេលល្ងាច មានផែនការកែលម្អទីតាំងនិងបរិក្ខារផ្ទះបាយ។',
      need: 0.80,
      capacity: 0.78,
      bankability: 0.75,
      total: 0.78,
      topFactors: [
        { factor: 'velocity_spike', value: 0.85, contribution: 0.255 },
        { factor: 'price_level', value: 0.75, contribution: 0.225 },
        { factor: 'has_web_or_page', value: 1.0, contribution: 0.16 },
      ],
      routePos: 5,
      routeId: '2026-09-20:120201:1',
      status: 'new',
    },
    {
      placeId: 'osm:node:444695426',
      sangkatCode: '120201',
      lat: 11.5561030,
      lng: 104.9207291,
      primaryType: 'car_repair',
      summaryKm: 'យានដ្ឋានជួសជុលរថយន្តមានម៉ាស៊ីនទំនើប និងមានតម្រូវការទិញឧបករណ៍បន្ថែមសម្រាប់សេវាកម្ម។',
      need: 0.75,
      capacity: 0.72,
      bankability: 0.70,
      total: 0.73,
      topFactors: [
        { factor: 'new_opening', value: 0.7, contribution: 0.245 },
        { factor: 'category_lendable', value: 1.0, contribution: 0.255 },
        { factor: 'area_ppi', value: 0.88, contribution: 0.264 },
      ],
      routePos: 6,
      routeId: '2026-09-20:120201:1',
      status: 'new',
    },
    // Tonle Bassac route
    {
      placeId: 'osm:node:444667445',
      sangkatCode: '120101',
      lat: 11.5448815,
      lng: 104.9297278,
      primaryType: 'restaurant',
      summaryKm: 'ភោជនីយដ្ឋានចិនលំដាប់ខ្ពស់ទទួលភ្ញៀវក្រុមហ៊ុនច្រើន និងមានចំណូលទៀងទាត់គួរឱ្យទុកចិត្ត។',
      need: 0.65,
      capacity: 0.92,
      bankability: 0.90,
      total: 0.80,
      topFactors: [
        { factor: 'price_level', value: 1.0, contribution: 0.30 },
        { factor: 'has_web_or_page', value: 1.0, contribution: 0.16 },
        { factor: 'area_ppi', value: 0.82, contribution: 0.246 },
      ],
      routePos: 1,
      routeId: '2026-09-20:120101:1',
      status: 'new',
    },
    {
      placeId: 'osm:node:444701854',
      sangkatCode: '120101',
      lat: 11.5492837,
      lng: 104.9286685,
      primaryType: 'clothing_store',
      summaryKm: 'ហាងលក់សម្លៀកបំពាក់ម៉ាកល្បីមានអតិថិជនគាំទ្រច្រើន និងកំពុងត្រៀមបើកសាខាថ្មីនៅផ្សារទំនើប។',
      need: 0.82,
      capacity: 0.75,
      bankability: 0.78,
      total: 0.78,
      topFactors: [
        { factor: 'velocity_spike', value: 0.8, contribution: 0.24 },
        { factor: 'price_level', value: 0.75, contribution: 0.225 },
        { factor: 'category_lendable', value: 0.9, contribution: 0.23 },
      ],
      routePos: 2,
      routeId: '2026-09-20:120101:1',
      status: 'new',
    },
  ];

  const todayStr = new Date().toISOString().slice(0, 10);

  for (const p of demoPlaces) {
    // Upsert place
    await pool.query(`
      INSERT INTO places (place_id, sangkat_code, lat, lng, primary_type, first_seen, last_seen, status)
      VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), 'active')
      ON CONFLICT (place_id) DO UPDATE SET
        lat = EXCLUDED.lat,
        lng = EXCLUDED.lng,
        last_seen = NOW();
    `, [p.placeId, p.sangkatCode, p.lat, p.lng, p.primaryType]);

    // Upsert snapshot
    await pool.query(`
      INSERT INTO snapshots (place_id, scanned_at, scan_date, review_count, rating, price_level, has_web_or_page)
      VALUES ($1, NOW(), $2, 45, 4.4, 2, true)
      ON CONFLICT (place_id, scan_date) DO NOTHING;
    `, [p.placeId, todayStr]);

    // Upsert review analysis
    await pool.query(`
      INSERT INTO review_analyses (place_id, reviews_hash, model, business_scale, summary_km, analyzed_at)
      VALUES ($1, 'demo_hash', 'gemini-2.5-flash', 'small', $2, NOW())
      ON CONFLICT (place_id) DO UPDATE SET
        summary_km = EXCLUDED.summary_km;
    `, [p.placeId, p.summaryKm]);

    // Upsert score
    await pool.query(`
      INSERT INTO scores (place_id, scan_date, need, capacity, bankability, total, top_factors)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (place_id, scan_date) DO UPDATE SET
        total = EXCLUDED.total,
        need = EXCLUDED.need,
        capacity = EXCLUDED.capacity,
        bankability = EXCLUDED.bankability;
    `, [p.placeId, todayStr, p.need, p.capacity, p.bankability, p.total, JSON.stringify(p.topFactors)]);

    // Upsert lead
    await pool.query(`
      INSERT INTO leads (place_id, officer_id, assigned_at, status, route_id, route_position)
      VALUES ($1, $2, NOW(), $3, $4, $5)
      ON CONFLICT DO NOTHING;
    `, [p.placeId, sokhaId, p.status, p.routeId, p.routePos]);
  }

  // 4. Sample Job Runs for proof of scheduling telemetry
  console.log('4. Inserting telemetry job runs...');
  await pool.query(`
    INSERT INTO job_runs (job_name, started_at, finished_at, items_processed, api_calls)
    VALUES
      ('scan.discover', NOW() - INTERVAL '2 hours', NOW() - INTERVAL '1 hour 50 minutes', 142, '{"places.nearby_pro": 24}'),
      ('scan.enrich', NOW() - INTERVAL '1 hour 45 minutes', NOW() - INTERVAL '1 hour 30 minutes', 38, '{"places.details_atmosphere": 38}'),
      ('scan.score', NOW() - INTERVAL '1 hour 25 minutes', NOW() - INTERVAL '1 hour 20 minutes', 38, '{"scoring.computed": 38}')
    ON CONFLICT DO NOTHING;
  `);

  console.log('Demo data successfully seeded!');
  await pool.end();
}

seed().catch((err) => {
  console.error('Seeding error:', err);
  process.exit(1);
});
