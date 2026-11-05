/**
 * Adds SAMPLE prospects to data/data.json so the demo map has more to show.
 * Same input, same file; re-running replaces the earlier batch.
 *
 *   node scripts/add-sample-prospects.mjs
 *
 * Every record is invented and marked synthetic, like the rest of data.json: ids
 * start "prospect_s", contacts are example.com, evidence links are example.com,
 * and nothing claims to be verified. Each prospect gets one signal, one piece of
 * evidence and a rank-1 product match, in the same shape as the hand-made ones,
 * and a pin inside the real polygon of its sangkat.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import { ASK_ABOUT, ASK_DEFAULT } from './add-today-sample-fields.mjs';
import { loadBoundaries } from './area-codes.mjs';

const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/data.json');
const PREFIX = 'prospect_s';
const PER_COMMUNE = 15;
const OFFICER = 'officer_001';
const AS_OF = '2026-10-15T08:30:00+07:00';
const LAST_SCAN_DAYS = ['2026-10-12', '2026-10-13', '2026-10-14'];

// The officer's four demo sangkats: data.json area ids and their real codes.
const COMMUNES = [
  {
    code: '120101',
    commune: 'area_c1',
    district: 'area_d1',
    villages: ['area_v11', 'area_v12'],
    name: 'Tonle Bassac',
  },
  {
    code: '120110',
    commune: 'area_c2',
    district: 'area_d1',
    villages: ['area_v21', 'area_v22'],
    name: 'Tuol Tumpung Ti Muoy',
  },
  {
    code: '120407',
    commune: 'area_c3',
    district: 'area_d2',
    villages: ['area_v31', 'area_v32'],
    name: 'Boeng Kak Ti Muoy',
  },
  {
    code: '120408',
    commune: 'area_c4',
    district: 'area_d2',
    villages: ['area_v41', 'area_v42'],
    name: 'Boeng Kak Ti Pir',
  },
];

// What each kind of signal looks like, and what it suggests discussing.
const KINDS = {
  new_branch: {
    title: 'Second location announced',
    product: 'product_002',
    sector: 'retail',
    purpose: 'expansion',
    nouns: ['Mini Mart', 'Coffee', 'Pharmacy', 'Phone Shop'],
    interpretation: 'Expansion may create a funding need; the business may also be self-funded.',
  },
  renovation: {
    title: 'Premises renovation announced',
    product: 'product_002',
    sector: 'food_beverage',
    purpose: 'renovation',
    nouns: ['Noodle House', 'Bakery', 'Salon', 'Guesthouse'],
    interpretation: 'Ask about the scope of the work and how it is being paid for.',
  },
  hiring: {
    title: 'Additional staff recruitment',
    product: 'product_002',
    sector: 'services',
    purpose: 'working_capital',
    nouns: ['Clinic', 'Tuition Centre', 'Print House', 'Laundry'],
    interpretation: 'Hiring can mean growth; it does not show a financing need on its own.',
  },
  equipment_purchase: {
    title: 'Equipment upgrade mentioned',
    product: 'product_003',
    sector: 'manufacturing',
    purpose: 'machinery',
    nouns: ['Auto Repair', 'Wood Workshop', 'Tailor', 'Print House'],
    interpretation: 'Ask whether the upgrade is already funded or still being evaluated.',
  },
  inventory_growth: {
    title: 'Larger stock range advertised',
    product: 'product_001',
    sector: 'retail',
    purpose: 'working_capital',
    nouns: ['Fresh Mart', 'Hardware', 'Tire Shop', 'Fashion'],
    interpretation: 'More stock can stretch cash flow; ask how purchases are paid for.',
  },
  imports: {
    title: 'New imported product line',
    product: 'product_006',
    sector: 'wholesale',
    purpose: 'trade',
    nouns: ['Trading', 'Import Supply', 'Motor Parts', 'Electronics'],
    interpretation: 'Importing may need trade finance; ask about supplier terms.',
  },
  purchase_order: {
    title: 'Larger orders invited',
    product: 'product_006',
    sector: 'wholesale',
    purpose: 'trade',
    nouns: ['Packaging', 'Supply Depot', 'Building Materials', 'Wholesale'],
    interpretation: 'Larger orders can mean a working-capital gap between paying and being paid.',
  },
  new_opening: {
    title: 'Opening announcement found',
    product: 'product_001',
    sector: 'food_beverage',
    purpose: 'working_capital',
    nouns: ['Café', 'Eatery', 'Juice Bar', 'Bakery'],
    interpretation: 'A new business may need setup funds, but has little trading history.',
  },
};
const TYPES = Object.keys(KINDS);

const PLACES = [
  'Mekong',
  'Bayon',
  'Naga',
  'Sokha',
  'Monivong',
  'Riverside',
  'Golden Lotus',
  'Silk Road',
  'Sunrise',
  'Royal Palm',
  'Kampuchea',
  'Orchid',
  'Rice Field',
  'Lucky Star',
  'Blue River',
  'Jade',
  'Lotus Bay',
  'Morning Star',
  'Bassac',
  'Angkor Gate',
];

// Pipeline mix, as a share of each sangkat's batch.
const STATUSES = [
  'new',
  'new',
  'new',
  'new',
  'new',
  'new',
  'qualified',
  'qualified',
  'qualified',
  'contacted',
  'contacted',
  'follow_up',
  'follow_up',
  'application_referred',
  'unreachable',
];

/** Deterministic 0–1 from a string (FNV-1a, then mulberry32). */
function rand(seed) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  let t = h + 0x6d2b79f5;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (seed, list) => list[Math.floor(rand(seed) * list.length)];
const int = (seed, lo, hi) => lo + Math.floor(rand(seed) * (hi - lo + 1));

const DAY = 86_400_000;
const daysBefore = (days) =>
  new Date(Date.parse(AS_OF) - days * DAY).toISOString().slice(0, 10) + 'T08:30:00+07:00';

/** A point inside the commune's polygon, found by trying points in its bbox. */
function pointIn(feature, seed) {
  const ring =
    feature.geometry.type === 'Polygon'
      ? feature.geometry.coordinates[0]
      : feature.geometry.coordinates.flat(1)[0];
  const pts = feature.geometry.type === 'Polygon' ? ring : feature.geometry.coordinates.flat(2);
  const lngs = pts.map((p) => p[0]);
  const lats = pts.map((p) => p[1]);
  const [minLng, maxLng, minLat, maxLat] = [
    Math.min(...lngs),
    Math.max(...lngs),
    Math.min(...lats),
    Math.max(...lats),
  ];
  for (let i = 0; i < 500; i++) {
    const lng = minLng + rand(`${seed}:x${i}`) * (maxLng - minLng);
    const lat = minLat + rand(`${seed}:y${i}`) * (maxLat - minLat);
    if (booleanPointInPolygon([lng, lat], feature))
      return { lat: +lat.toFixed(5), lng: +lng.toFixed(5) };
  }
  throw new Error(`no point found inside ${feature.properties.code}`);
}

/** Factor points that add up to the score, in proportion to each maximum. */
function factors(score) {
  const max = {
    signalStrength: 35,
    freshness: 20,
    businessMaturity: 20,
    productRelevance: 15,
    evidenceQuality: 10,
  };
  const keys = Object.keys(max);
  const out = Object.fromEntries(keys.map((k) => [k, Math.floor((max[k] * score) / 100)]));
  let short = score - Object.values(out).reduce((a, b) => a + b, 0);
  for (const k of keys) {
    if (short > 0 && out[k] < max[k]) {
      out[k] += 1;
      short -= 1;
    }
  }
  return { factors: out, maxPoints: max };
}

const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));

// Re-running replaces the earlier batch.
const isSample = (id) => id?.startsWith(PREFIX);
data.prospects = data.prospects.filter((p) => !isSample(p.id));
data.signals = data.signals.filter((s) => !isSample(s.prospectId));
data.evidence = data.evidence.filter((e) => !isSample(e.prospectId));
data.productMatches = data.productMatches.filter((m) => !isSample(m.prospectId));

const shapes = new Map(loadBoundaries('communes').features.map((f) => [f.properties.code, f]));
const usedNames = new Set(data.prospects.map((p) => p.displayName));
let n = 0;

for (const c of COMMUNES) {
  for (let i = 0; i < PER_COMMUNE; i++) {
    n += 1;
    const num = String(n).padStart(3, '0');
    const id = `${PREFIX}${num}`;
    const seed = `${c.code}:${i}`;
    const type = TYPES[(n * 3 + i) % TYPES.length];
    const kind = KINDS[type];

    let name = `${pick(`${seed}:place`, PLACES)} ${pick(`${seed}:noun`, kind.nouns)}`;
    for (let k = 2; usedNames.has(name); k++) name = `${name.replace(/ \d+$/, '')} ${k}`;
    usedNames.add(name);

    const status = STATUSES[i % STATUSES.length];
    const score = int(`${seed}:score`, 45, 92);
    const band = score >= 80 ? 'high' : score >= 55 ? 'medium' : 'low';
    const months = int(`${seed}:months`, 4, 96);
    const signalAgeDays = int(`${seed}:age`, 1, 24);
    const detectedAt = daysBefore(signalAgeDays);
    const village = pick(`${seed}:village`, c.villages);
    const firstSeen =
      status === 'new' && i % 2 === 0
        ? `${LAST_SCAN_DAYS[i % 3]}T08:30:00+07:00`
        : daysBefore(30 + int(`${seed}:seen`, 0, 20));
    const interested =
      status === 'contacted' || status === 'follow_up' || status === 'application_referred';

    data.prospects.push({
      id,
      displayName: name,
      entityType: 'business',
      sector: kind.sector,
      borrowerType: 'individual',
      isSynthetic: true,
      assignmentOfficerId: OFFICER,
      territoryPathIds: ['area_pp', c.district, c.commune, village],
      address: {
        display: `Demo building ${200 + n}, Demo Street ${int(`${seed}:st`, 100, 599)}, ${c.name}, Phnom Penh`,
        villageId: village,
        communeId: c.commune,
        districtId: c.district,
        provinceId: 'area_pp',
        isApproximate: true,
      },
      location: { ...pointIn(shapes.get(c.code), seed), accuracy: 'synthetic_approximate' },
      businessProfile: {
        operatingMonths: months,
        operatingMonthsBasis: 'fictional_demo_assumption',
        operatingStatus: 'active',
        employeeCountEstimate: null,
        revenueEstimate: null,
        registrationVerified: false,
        openingHours: { monFri: '08:00–18:00', sat: '08:00–12:00', sun: 'closed' },
        openingHoursVerified: false,
      },
      contact: {
        name: `Demo contact S${num}`,
        role: 'Business representative',
        phone: null,
        email: `contact-s${num}@example.com`,
        website: `https://example.com/territory-radar-demo/${id}`,
        source: 'fictional_demo',
        consentToContact: 'not_recorded',
        canCall: false,
      },
      pipelineStatus: status,
      dispositionReason: null,
      financing: interested
        ? {
            interestStatus: 'confirmed',
            interestSource: 'officer_demo_conversation',
            interestRecordedAt: daysBefore(int(`${seed}:rec`, 1, 6)),
            purpose: kind.purpose,
            requestedAmount: { value: int(`${seed}:amt`, 3, 60) * 1000, currency: 'USD' },
            desiredTenorMonths: pick(`${seed}:tenor`, [12, 24, 36]),
            timing: 'within_3_months',
            approvalStatus: 'not_assessed',
            note: 'Fictional officer-entered conversation; not extracted from public sources.',
          }
        : {
            interestStatus: 'unknown',
            interestSource: null,
            interestRecordedAt: null,
            purpose: null,
            requestedAmount: null,
            desiredTenorMonths: null,
            timing: 'unknown',
            approvalStatus: 'not_assessed',
            note: 'Ask whether financing is needed before qualification.',
          },
      priority: {
        score,
        band,
        scoreType: 'visit_priority_not_loan_probability',
        ...factors(score),
        explanation: kind.interpretation,
        computedAt: AS_OF,
      },
      signalIds: [`signal_${id}`],
      recommendedProductIds: [kind.product],
      tags: [type, months < 12 ? 'new_business' : 'established_business'],
      dataQuality: {
        flags: months < 12 ? ['limited_operating_history'] : [],
        lastVerifiedAt: null,
        requiresOfficerVerification: true,
      },
      createdAt: firstSeen,
      updatedAt: detectedAt,
      lastActivityAt: null,
      why_now: kind.title,
      ask_about: ASK_ABOUT[type] ?? ASK_DEFAULT,
      first_seen_at: firstSeen,
    });

    data.signals.push({
      id: `signal_${id}`,
      prospectId: id,
      type,
      evidenceIds: [`evidence_${id}`],
      title: kind.title,
      detectedAt,
      eventDate: detectedAt.slice(0, 10),
      strength: score >= 75 ? 'moderate' : 'weak',
      freshness: signalAgeDays <= 14 ? 'fresh' : 'stale',
      interpretation: kind.interpretation,
      limitations: [
        'Synthetic evidence for prototype only',
        'Loan interest cannot be established from this observation',
      ],
      isSynthetic: true,
    });

    data.evidence.push({
      id: `evidence_${id}`,
      prospectId: id,
      sourceType: 'business_social_post',
      sourceName: 'Fictional business page',
      url: `https://example.com/territory-radar-demo/${id}/1`,
      isSynthetic: true,
      isLiveSource: false,
      publishedAt: detectedAt,
      observedAt: detectedAt,
      expiresAt:
        new Date(Date.parse(detectedAt) + 30 * DAY).toISOString().slice(0, 10) + 'T08:30:00+07:00',
      title: `${name}: ${kind.title}`,
      excerpt: `A fictional business update from ${name} in ${c.name}.`,
      verificationStatus: 'unverified_demo',
      language: 'en',
    });

    data.productMatches.push({
      id: `match_${id}`,
      prospectId: id,
      productId: kind.product,
      rank: 1,
      fitLabel: 'discussion_candidate',
      reason: kind.interpretation,
      supportingSignalIds: [`signal_${id}`],
      unverifiedRequirements: [
        'Actual financing need',
        'Repayment capacity',
        'Applicable product eligibility',
        'Existing funding arrangements',
      ],
      discoveryQuestions: [
        'Is this activity already fully funded?',
        'What amount and timing would be useful?',
        'Who decides on financing for the business?',
      ],
      suggestedOpening: `I saw the update from ${name}. Would you be open to discussing your plans and whether any financing is needed?`,
      isEligibilityDecision: false,
      isDemo: true,
    });
  }
}

fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
console.log(`Added ${n} sample prospects (${PREFIX}001–${PREFIX}${String(n).padStart(3, '0')}).`);
