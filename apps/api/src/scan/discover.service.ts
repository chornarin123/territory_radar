import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, notExists, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { DB } from '../database/database.module.js';
import type { Database } from '../database/database.module.js';
import { gridCells, places } from '../database/schema.js';
import { SCAN_CATEGORIES } from '../places/categories.js';
import { diffCellScan, NEW_OPENING_CONFIDENCE } from '../places/diff.js';
import type { KnownPlace } from '../places/diff.js';
import { GooglePlacesClient, NEARBY_PAGE_SIZE } from '../places/google-places.client.js';
import { isWithin, subdivide } from '../places/grid.js';
import type { CellCircle } from '../places/grid.js';
import { PgBossService } from '../queue/pg-boss.service.js';
import { QUEUES } from '../queue/queue.constants.js';
import type { DiscoverCellJob } from '../queue/queue.constants.js';
import { SignalsService } from '../signals/signals.service.js';

export interface DiscoverCellResult {
  placesFound: number;
  newPlaces: number;
  newOpenings: number;
  saturated: boolean;
  /**
   * Cells created by splitting a saturated cell. Returned rather than queued so
   * the caller decides the transport: the worker enqueues them, the CLI scans
   * them inline.
   */
  childJobs: DiscoverCellJob[];
}

/**
 * scan.discover — walks the grid and records what is there.
 *
 * The fan-out is one queue job per (cell × category): an unfiltered Nearby
 * Search in a dense street returns 20 of whatever Google ranks highest and
 * nothing else, so each category is asked for separately.
 */
@Injectable()
export class DiscoverService {
  private readonly logger = new Logger(DiscoverService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly client: GooglePlacesClient,
    private readonly queue: PgBossService,
    private readonly signals: SignalsService,
  ) {}

  /** Enqueues one job per cell per category. Returns how many were queued. */
  async enqueueAll(runId: string, sangkatCode?: string): Promise<number> {
    const cells = await this.leafCells(sangkatCode);
    if (cells.length === 0) {
      this.logger.warn(`No grid cells to scan${sangkatCode ? ` for ${sangkatCode}` : ''}`);
      return 0;
    }

    const jobs: DiscoverCellJob[] = [];
    for (const cell of cells) {
      for (const category of SCAN_CATEGORIES) {
        jobs.push({ ...cell, runId, category });
      }
    }

    await this.queue.sendMany(QUEUES.discoverCell, jobs);
    this.logger.log(
      `Queued ${jobs.length} jobs (${cells.length} cells × ${SCAN_CATEGORIES.length} categories)`,
    );
    return jobs.length;
  }

  /**
   * Scans one cell for one category. This is the worker body, and also what the
   * CLI calls directly so a demo run needs no queue.
   */
  async scanCell(job: DiscoverCellJob, now = new Date()): Promise<DiscoverCellResult> {
    const circle: CellCircle = { lat: job.lat, lng: job.lng, radiusM: job.radiusM };
    const returned = await this.client.searchNearby(circle, job.category);
    const saturated = returned.length >= NEARBY_PAGE_SIZE;

    const childJobs = saturated
      ? await this.splitCell(job.cellId, job.sangkatCode, circle, job.runId)
      : [];

    const known = await this.knownPlacesNear(job.sangkatCode, circle);
    const diff = diffCellScan(
      {
        cell: circle,
        previouslyScannedComplete: job.previouslyScannedComplete,
        truncated: saturated,
      },
      returned,
      known,
    );

    if (diff.newPlaces.length > 0 || diff.seen.length > 0) {
      await this.db
        .insert(places)
        .values(
          [...diff.newPlaces, ...diff.seen].map((p) => ({
            placeId: p.placeId,
            sangkatCode: job.sangkatCode,
            lat: p.location.lat,
            lng: p.location.lng,
            primaryType: p.primaryType,
            firstSeen: now,
            lastSeen: now,
            status: 'active' as const,
            missingCount: 0,
          })),
        )
        .onConflictDoUpdate({
          target: places.placeId,
          // sangkat_code is deliberately not updated: the first cell to find a
          // place owns it, so a place near a boundary does not flip each run.
          set: {
            lat: sql`excluded.lat`,
            lng: sql`excluded.lng`,
            primaryType: sql`excluded.primary_type`,
            lastSeen: sql`excluded.last_seen`,
            status: sql`excluded.status`,
            missingCount: sql`excluded.missing_count`,
          },
        });
    }

    for (const change of diff.statusChanges) {
      await this.db
        .update(places)
        .set({ status: change.status, missingCount: change.missingCount })
        .where(eq(places.placeId, change.placeId));
    }

    for (const opening of diff.newOpenings) {
      await this.signals.record(
        opening.placeId,
        {
          type: 'new_opening',
          confidence: NEW_OPENING_CONFIDENCE,
          evidence: `First seen in ${job.category} scan of a cell last scanned complete`,
        },
        now,
      );
    }

    await this.db
      .update(gridCells)
      .set({ lastScannedAt: now, saturated })
      .where(eq(gridCells.id, job.cellId));

    return {
      placesFound: returned.length,
      newPlaces: diff.newPlaces.length,
      newOpenings: diff.newOpenings.length,
      saturated,
      childJobs,
    };
  }

  /**
   * Splits a saturated cell into four children and queues them for this same
   * run. Children are radius/√2 (≈250m from a 350m parent), the largest size
   * that still covers the parent completely — four 250m circles cannot cover a
   * 400m one, they leave gaps on the axes.
   */
  private async splitCell(
    parentId: string,
    sangkatCode: string,
    parent: CellCircle,
    runId: string,
  ): Promise<DiscoverCellJob[]> {
    const existing = await this.db
      .select({ id: gridCells.id })
      .from(gridCells)
      .where(eq(gridCells.parentCellId, parentId))
      .limit(1);
    if (existing.length > 0) return []; // already split by another category's job

    const children = subdivide(parent);
    if (children.length === 0) return []; // at the floor: cannot resolve further

    const inserted = await this.db
      .insert(gridCells)
      .values(
        children.map((c) => ({
          sangkatCode,
          lat: c.lat,
          lng: c.lng,
          radiusM: Math.round(c.radiusM),
          parentCellId: parentId,
        })),
      )
      .returning({
        id: gridCells.id,
        lat: gridCells.lat,
        lng: gridCells.lng,
        radiusM: gridCells.radiusM,
      });

    const jobs: DiscoverCellJob[] = [];
    for (const child of inserted) {
      for (const category of SCAN_CATEGORIES) {
        jobs.push({
          runId,
          cellId: child.id,
          sangkatCode,
          lat: child.lat,
          lng: child.lng,
          radiusM: child.radiusM,
          category,
          previouslyScannedComplete: false,
        });
      }
    }
    this.logger.log(`Cell ${parentId} saturated — split into ${inserted.length} children`);
    return jobs;
  }

  /** Leaf cells only: a split cell is covered by its children. */
  async leafCells(sangkatCode?: string) {
    const child = alias(gridCells, 'child');
    const rows = await this.db
      .select()
      .from(gridCells)
      .where(
        and(
          notExists(
            this.db
              .select({ one: sql`1` })
              .from(child)
              .where(eq(child.parentCellId, gridCells.id)),
          ),
          ...(sangkatCode ? [eq(gridCells.sangkatCode, sangkatCode)] : []),
        ),
      )
      .orderBy(asc(gridCells.sangkatCode), asc(gridCells.id));

    return rows.map((row) => ({
      cellId: row.id,
      sangkatCode: row.sangkatCode,
      lat: row.lat,
      lng: row.lng,
      radiusM: row.radiusM,
      previouslyScannedComplete: row.lastScannedAt !== null && !row.saturated,
    }));
  }

  /** Places in this sangkat that fall inside the cell being scanned. */
  private async knownPlacesNear(sangkatCode: string, circle: CellCircle): Promise<KnownPlace[]> {
    const rows = await this.db
      .select({
        placeId: places.placeId,
        lat: places.lat,
        lng: places.lng,
        status: places.status,
        missingCount: places.missingCount,
      })
      .from(places)
      .where(eq(places.sangkatCode, sangkatCode));

    return rows
      .map((r) => ({
        placeId: r.placeId,
        location: r.lat !== null && r.lng !== null ? { lat: r.lat, lng: r.lng } : null,
        status: r.status,
        missingCount: r.missingCount,
      }))
      .filter((p) => p.location !== null && isWithin(circle, p.location));
  }
}
