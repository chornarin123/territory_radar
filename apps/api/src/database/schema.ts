/*
 * ─── DATA RETENTION: GOOGLE PLACES TERMS ─────────────────────────────────────
 *
 * Google Maps Platform terms restrict caching of Places API content. This schema
 * persists only:
 *   • place_id     — exempt from caching limits; may be stored indefinitely.
 *   • lat / lng    — may be cached for at most 30 consecutive calendar days
 *                    (Service Specific Terms §14.3, Places API). They are
 *                    refreshed on every scan, and the `retention` job nulls
 *                    them for any place not seen in 30 days.
 *   • our own derived metrics — grid cells, statuses, signals, scores, leads,
 *     and review_analyses (Claude's paraphrases and Khmer summary).
 *
 * Business names, addresses, phone numbers, review text and photos are NEVER
 * stored. They are fetched live at display time (GET /places/:placeId/live)
 * and review text is passed to Claude in memory only.
 *
 * ⚠ OPEN COMPLIANCE QUESTION — `snapshots` (review_count, rating, price_level,
 * open_hours) and `places.primary_type` hold values copied from Google, not
 * values we derived. Confirm with legal that these are permitted, or replace
 * them with derived-only fields (e.g. review-count delta, "hours extended"
 * flag) before production. See docs/data-policy.md.
 *
 * Also note §14.2: Places content must not be shown on a non-Google map.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  BUSINESS_SCALES,
  LEAD_STATUSES,
  PLACE_STATUSES,
  SIGNAL_TYPES,
} from '@territory-radar/shared';
import type { FactorContribution } from '@territory-radar/shared';
import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

export const placeStatus = pgEnum('place_status', PLACE_STATUSES);
export const signalType = pgEnum('signal_type', SIGNAL_TYPES);
export const leadStatus = pgEnum('lead_status', LEAD_STATUSES);
export const businessScale = pgEnum('business_scale', BUSINESS_SCALES);

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

/** Cambodian sangkats (communes) with census data. Loaded via PUT /areas. */
export const areas = pgTable(
  'areas',
  {
    sangkatCode: text('sangkat_code').primaryKey(),
    nameEn: text('name_en').notNull(),
    nameKm: text('name_km').notNull(),
    districtCode: text('district_code').notNull(),
    provinceCode: text('province_code').notNull(),
    households: integer('households'),
    population: integer('population'),
    /** Purchasing power index, normalised to 0..1. */
    ppiScore: doublePrecision('ppi_score'),
    ppiComponents: jsonb('ppi_components').$type<Record<string, number>>(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [index('areas_district_idx').on(t.districtCode)],
);

/**
 * Circles scanned with Nearby Search. A search returns at most 20 places, so a
 * cell that comes back full is marked `saturated` and split into 4 children.
 * Leaves (cells without children) are what gets scanned.
 */
export const gridCells = pgTable(
  'grid_cells',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sangkatCode: text('sangkat_code')
      .notNull()
      .references(() => areas.sangkatCode),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    radiusM: integer('radius_m').notNull(),
    saturated: boolean('saturated').notNull().default(false),
    parentCellId: uuid('parent_cell_id').references((): AnyPgColumn => gridCells.id),
    lastScannedAt: timestamptz('last_scanned_at'),
  },
  (t) => [
    index('grid_cells_sangkat_idx').on(t.sangkatCode),
    index('grid_cells_parent_idx').on(t.parentCellId),
  ],
);

export const places = pgTable(
  'places',
  {
    placeId: text('place_id').primaryKey(),
    sangkatCode: text('sangkat_code')
      .notNull()
      .references(() => areas.sangkatCode),
    /** Nullable: cleared after 30 days without a refresh (see header). */
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    primaryType: text('primary_type'),
    /**
     * Derived: one-way hash of the normalised business name, set during
     * enrichment. Lets chains be spotted across runs without storing the name.
     */
    nameHash: text('name_hash'),
    /** Derived: this name_hash appears at 2+ place_ids. */
    isMultiBranch: boolean('is_multi_branch').notNull().default(false),
    firstSeen: timestamptz('first_seen').notNull(),
    lastSeen: timestamptz('last_seen').notNull(),
    status: placeStatus('status').notNull().default('active'),
    missingCount: integer('missing_count').notNull().default(0),
  },
  (t) => [
    index('places_sangkat_status_idx').on(t.sangkatCode, t.status),
    index('places_last_seen_idx').on(t.lastSeen),
    index('places_name_hash_idx').on(t.nameHash),
  ],
);

/** One row per Place Details enrichment. See the compliance note in the header. */
export const snapshots = pgTable(
  'snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    placeId: text('place_id')
      .notNull()
      .references(() => places.placeId),
    scannedAt: timestamptz('scanned_at').notNull(),
    /**
     * Calendar date in Cambodia. One snapshot per place per day, so a retried
     * enrich job overwrites its own row instead of inserting a near-duplicate
     * that would flatten the review-velocity interval to zero.
     */
    scanDate: date('scan_date').notNull(),
    reviewCount: integer('review_count'),
    rating: real('rating'),
    /** 0 (free) … 4 (very expensive). */
    priceLevel: smallint('price_level'),
    openHours: jsonb('open_hours').$type<OpeningPeriod[]>(),
    /** Derived: the listing has a website or social page. The URL itself is not kept. */
    hasWebOrPage: boolean('has_web_or_page'),
  },
  (t) => [
    index('snapshots_place_scanned_idx').on(t.placeId, t.scannedAt),
    uniqueIndex('snapshots_place_day_uniq').on(t.placeId, t.scanDate),
  ],
);

export const signals = pgTable(
  'signals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    placeId: text('place_id')
      .notNull()
      .references(() => places.placeId),
    detectedAt: timestamptz('detected_at').notNull(),
    signalType: signalType('signal_type').notNull(),
    /** Our own words. Never quoted review text. */
    evidence: text('evidence').notNull(),
    /** 0..1 */
    confidence: real('confidence').notNull(),
  },
  (t) => [index('signals_place_type_detected_idx').on(t.placeId, t.signalType, t.detectedAt)],
);

/**
 * The latest Claude reading of a place's reviews. Holds only what Claude
 * derived — never review text. reviews_hash is the cache key: the same reviews
 * under the same model and prompt are not analysed twice.
 */
export const reviewAnalyses = pgTable('review_analyses', {
  placeId: text('place_id')
    .primaryKey()
    .references(() => places.placeId),
  reviewsHash: text('reviews_hash').notNull(),
  model: text('model').notNull(),
  businessScale: businessScale('business_scale').notNull(),
  /** One sentence in Khmer for the officer. A paraphrase, validated not to quote any review. */
  summaryKm: text('summary_km').notNull(),
  analyzedAt: timestamptz('analyzed_at').notNull(),
});

export const scores = pgTable(
  'scores',
  {
    placeId: text('place_id')
      .notNull()
      .references(() => places.placeId),
    scanDate: date('scan_date').notNull(),
    need: real('need').notNull(),
    capacity: real('capacity').notNull(),
    bankability: real('bankability').notNull(),
    total: real('total').notNull(),
    topFactors: jsonb('top_factors').$type<FactorContribution[]>().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.placeId, t.scanDate] }),
    index('scores_date_total_idx').on(t.scanDate, t.total),
  ],
);

export const officers = pgTable('officers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  branch: text('branch').notNull(),
  assignedSangkats: text('assigned_sangkats').array().notNull().default([]),
});

export const leads = pgTable(
  'leads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    placeId: text('place_id')
      .notNull()
      .references(() => places.placeId),
    officerId: uuid('officer_id')
      .notNull()
      .references(() => officers.id),
    assignedAt: timestamptz('assigned_at').notNull().defaultNow(),
    status: leadStatus('status').notNull().default('new'),
    /** Officer's note. May contain customer information — never send it to an AI tool. */
    outcomeNote: text('outcome_note'),
    revisitAfter: date('revisit_after'),
    /** Walking route this lead belongs to, e.g. "2026-09-13:120101:1". */
    routeId: text('route_id'),
    /** 1-based stop order within the route. */
    routePosition: integer('route_position'),
  },
  (t) => [
    index('leads_officer_status_idx').on(t.officerId, t.status),
    index('leads_place_idx').on(t.placeId),
    index('leads_route_idx').on(t.routeId, t.routePosition),
  ],
);

export interface JobError {
  message: string;
  at: string;
  context?: Record<string, unknown>;
}

export const jobRuns = pgTable(
  'job_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobName: text('job_name').notNull(),
    startedAt: timestamptz('started_at').notNull().defaultNow(),
    finishedAt: timestamptz('finished_at'),
    itemsProcessed: integer('items_processed').notNull().default(0),
    /** Billable calls by SKU, e.g. { "places.nearby_pro": 412 }. Drives the budget. */
    apiCalls: jsonb('api_calls').$type<Record<string, number>>().notNull().default({}),
    errors: jsonb('errors').$type<JobError[]>().notNull().default([]),
  },
  (t) => [index('job_runs_name_started_idx').on(t.jobName, t.startedAt)],
);

/** Google `regularOpeningHours.periods` shape — day 0 = Sunday. */
export interface OpeningPeriod {
  open: { day: number; hour: number; minute: number };
  close?: { day: number; hour: number; minute: number };
}
