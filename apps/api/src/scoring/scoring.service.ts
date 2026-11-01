import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  booleanInput,
  normaliseLogReviews,
  normalisePriceLevel,
  scoreLead,
  SIGNAL_LOOKBACK_DAYS,
  signalStrength,
} from '@territory-radar/shared';
import type { ScoringInputs, SignalObservation } from '@territory-radar/shared';
import { and, eq, gte, inArray, max, sql } from 'drizzle-orm';
import { jobError } from '../common/job-result.js';
import type { JobResult } from '../common/job-result.js';
import { daysAgo, localDate } from '../common/time.js';
import { DB } from '../database/database.module.js';
import type { Database } from '../database/database.module.js';
import { areas, places, scores, signals, snapshots } from '../database/schema.js';
import { categoryLendability, isExcludedType } from './category-lendability.js';

const CHUNK_SIZE = 500;

interface SnapshotRow {
  placeId: string;
  reviewCount: number | null;
  priceLevel: number | null;
  hasWebOrPage: boolean | null;
}

/**
 * Scores places and stores the result with the three factors that drove it, so
 * an officer can always see why a lead ranks where it does. All the arithmetic
 * lives in @territory-radar/shared and is unit-tested there.
 */
@Injectable()
export class ScoringService {
  private readonly logger = new Logger(ScoringService.name);

  constructor(@Inject(DB) private readonly db: Database) {}

  async scorePlaces(placeIds: readonly string[], now = new Date()): Promise<JobResult> {
    const result: JobResult = { itemsProcessed: 0, errors: [] };
    if (placeIds.length === 0) return result;

    const scanDate = localDate(now);
    this.logger.log(`Scoring ${placeIds.length} places for ${scanDate}`);

    for (let i = 0; i < placeIds.length; i += CHUNK_SIZE) {
      const ids = placeIds.slice(i, i + CHUNK_SIZE);
      try {
        result.itemsProcessed += await this.scoreChunk(ids, scanDate, now);
      } catch (err) {
        result.errors.push(jobError(err, { chunkStart: i, size: ids.length }));
      }
    }

    return result;
  }

  private async scoreChunk(ids: string[], scanDate: string, now: Date): Promise<number> {
    const candidates = await this.db
      .select({
        placeId: places.placeId,
        primaryType: places.primaryType,
        isMultiBranch: places.isMultiBranch,
        ppiScore: areas.ppiScore,
      })
      .from(places)
      .innerJoin(areas, eq(areas.sangkatCode, places.sangkatCode))
      .where(inArray(places.placeId, ids));

    // Temples, schools and ATMs are not lending prospects.
    const scorable = candidates.filter((c) => !isExcludedType(c.primaryType));
    if (scorable.length === 0) return 0;

    const scorableIds = scorable.map((c) => c.placeId);
    const [latestSnapshots, recentSignals] = await Promise.all([
      this.latestSnapshots(scorableIds),
      this.recentSignals(scorableIds, now),
    ]);

    const rows = scorable.map((place) => {
      const snapshot = latestSnapshots.get(place.placeId);
      const observed = recentSignals.get(place.placeId) ?? [];
      const inputs: ScoringInputs = {
        newOpening: signalStrength(observed, 'new_opening', { now }),
        velocitySpike: signalStrength(observed, 'velocity_spike', { now }),
        lowStock: signalStrength(observed, 'low_stock', { now }),
        hoursExtended: signalStrength(observed, 'hours_extended', { now }),
        logReviews: normaliseLogReviews(snapshot?.reviewCount ?? null),
        priceLevel: normalisePriceLevel(snapshot?.priceLevel ?? null),
        areaPpi: place.ppiScore,
        hasWebOrPage: booleanInput(snapshot?.hasWebOrPage ?? null),
        categoryLendable: categoryLendability(place.primaryType),
        isMultiBranch: booleanInput(place.isMultiBranch),
      };
      const score = scoreLead(inputs);
      return {
        placeId: place.placeId,
        scanDate,
        need: score.need,
        capacity: score.capacity,
        bankability: score.bankability,
        total: score.total,
        topFactors: score.topFactors,
      };
    });

    await this.db
      .insert(scores)
      .values(rows)
      .onConflictDoUpdate({
        target: [scores.placeId, scores.scanDate],
        set: {
          need: sqlExcluded('need'),
          capacity: sqlExcluded('capacity'),
          bankability: sqlExcluded('bankability'),
          total: sqlExcluded('total'),
          topFactors: sqlExcluded('top_factors'),
        },
      });

    return rows.length;
  }

  private async latestSnapshots(placeIds: string[]): Promise<Map<string, SnapshotRow>> {
    if (placeIds.length === 0) return new Map();

    const latest = this.db
      .select({ placeId: snapshots.placeId, lastAt: max(snapshots.scannedAt).as('last_at') })
      .from(snapshots)
      .where(inArray(snapshots.placeId, placeIds))
      .groupBy(snapshots.placeId)
      .as('latest');

    const rows = await this.db
      .select({
        placeId: snapshots.placeId,
        reviewCount: snapshots.reviewCount,
        priceLevel: snapshots.priceLevel,
        hasWebOrPage: snapshots.hasWebOrPage,
      })
      .from(snapshots)
      .innerJoin(
        latest,
        and(eq(snapshots.placeId, latest.placeId), eq(snapshots.scannedAt, latest.lastAt)),
      );

    return new Map(rows.map((r) => [r.placeId, r]));
  }

  private async recentSignals(
    placeIds: string[],
    now: Date,
  ): Promise<Map<string, SignalObservation[]>> {
    if (placeIds.length === 0) return new Map();

    const rows = await this.db
      .select({
        placeId: signals.placeId,
        type: signals.signalType,
        detectedAt: signals.detectedAt,
        confidence: signals.confidence,
      })
      .from(signals)
      .where(
        and(
          inArray(signals.placeId, placeIds),
          gte(signals.detectedAt, daysAgo(now, SIGNAL_LOOKBACK_DAYS)),
        ),
      );

    const byPlace = new Map<string, SignalObservation[]>();
    for (const row of rows) {
      const list = byPlace.get(row.placeId) ?? [];
      list.push({ type: row.type, detectedAt: row.detectedAt, confidence: row.confidence });
      byPlace.set(row.placeId, list);
    }
    return byPlace;
  }
}

function sqlExcluded(column: string) {
  return sql.raw(`excluded.${column}`);
}
