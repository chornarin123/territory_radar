import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, gte, inArray, or, sql } from 'drizzle-orm';
import { jobError } from '../common/job-result.js';
import type { JobResult } from '../common/job-result.js';
import { daysAgo, localDate } from '../common/time.js';
import { DB } from '../database/database.module.js';
import type { Database } from '../database/database.module.js';
import { leads, officers, places, scores, snapshots } from '../database/schema.js';
import { ScoringService } from '../scoring/scoring.service.js';
import { clusterWalkingRoutes } from './routes.js';
import type { RouteCandidate } from './routes.js';

/** A snapshot older than this is not "fresh" and its place is not re-scored. */
export const FRESH_SNAPSHOT_DAYS = 8;
/** Leads per sangkat considered for routing. */
export const ROUTE_CANDIDATES_PER_SANGKAT = 24;
/** How many open leads an officer should hold. */
export const OPEN_LEAD_TARGET = 20;
/** Do not re-offer a place that was won this recently. */
export const WON_COOLDOWN_DAYS = 180;
/** Do not re-offer a place an officer declined this recently. */
export const DECLINED_COOLDOWN_DAYS = 90;

const OPEN_STATUSES = ['new', 'visited', 'revisit'] as const;

export interface ScoreRunResult extends JobResult {
  scored: number;
  routes: number;
  leadsAssigned: number;
}

/**
 * scan.score — scores places with fresh data, groups the best of each sangkat
 * into walking routes, and hands those routes to the officer who covers them.
 */
@Injectable()
export class ScoreRunService {
  private readonly logger = new Logger(ScoreRunService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly scoring: ScoringService,
  ) {}

  async run(now = new Date(), sangkatCode?: string): Promise<ScoreRunResult> {
    const result: ScoreRunResult = {
      itemsProcessed: 0,
      errors: [],
      scored: 0,
      routes: 0,
      leadsAssigned: 0,
    };

    const fresh = await this.placesWithFreshSnapshots(now, sangkatCode);
    if (fresh.length === 0) {
      this.logger.warn('No places with fresh snapshots — run scan.enrich first');
      return result;
    }

    const scoring = await this.scoring.scorePlaces(fresh, now);
    result.scored = scoring.itemsProcessed;
    result.errors.push(...scoring.errors);
    result.itemsProcessed = scoring.itemsProcessed;

    try {
      const assignment = await this.assignRoutes(now, sangkatCode);
      result.routes = assignment.routes;
      result.leadsAssigned = assignment.leadsAssigned;
    } catch (err) {
      result.errors.push(jobError(err, { stage: 'assignRoutes' }));
    }

    return result;
  }

  /**
   * Clusters each sangkat's best leads into walking routes, then assigns whole
   * routes to the officer covering that sangkat — an officer should get a
   * street to walk, not twelve pins scattered across the district.
   */
  private async assignRoutes(
    now: Date,
    sangkatCode?: string,
  ): Promise<{ routes: number; leadsAssigned: number }> {
    const scanDate = localDate(now);
    const roster = await this.db.select().from(officers);
    const alreadyOpen = await this.unavailablePlaceIds(now);

    let routeCount = 0;
    let leadsAssigned = 0;

    for (const officer of roster) {
      const sangkats = sangkatCode
        ? officer.assignedSangkats.filter((code) => code === sangkatCode)
        : officer.assignedSangkats;
      if (sangkats.length === 0) continue;

      const openForOfficer = await this.countOpenLeads(officer.id);
      let capacity = OPEN_LEAD_TARGET - openForOfficer;
      if (capacity <= 0) continue;

      for (const sangkat of sangkats) {
        if (capacity <= 0) break;

        const candidates = await this.routeCandidates(sangkat, scanDate, alreadyOpen);
        if (candidates.length === 0) continue;

        for (const route of clusterWalkingRoutes(candidates)) {
          if (capacity <= 0) break;
          const stops = route.stops.slice(0, capacity);
          const routeId = `${scanDate}:${sangkat}:${routeCount + 1}`;

          await this.db.insert(leads).values(
            stops.map((stop, index) => ({
              placeId: stop.placeId,
              officerId: officer.id,
              assignedAt: now,
              routeId,
              routePosition: index + 1,
            })),
          );

          for (const stop of stops) alreadyOpen.add(stop.placeId);
          capacity -= stops.length;
          leadsAssigned += stops.length;
          routeCount += 1;
          this.logger.log(
            `Route ${routeId}: ${stops.length} stops, ${route.totalMeters}m walking → ${officer.name}`,
          );
        }
      }
    }

    return { routes: routeCount, leadsAssigned };
  }

  private async placesWithFreshSnapshots(now: Date, sangkatCode?: string): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ placeId: places.placeId })
      .from(places)
      .innerJoin(snapshots, eq(snapshots.placeId, places.placeId))
      .where(
        and(
          eq(places.status, 'active'),
          gte(snapshots.scannedAt, daysAgo(now, FRESH_SNAPSHOT_DAYS)),
          ...(sangkatCode ? [eq(places.sangkatCode, sangkatCode)] : []),
        ),
      );
    return rows.map((r) => r.placeId);
  }

  /** Top-scoring places in a sangkat that nobody is already working. */
  private async routeCandidates(
    sangkatCode: string,
    scanDate: string,
    exclude: ReadonlySet<string>,
  ): Promise<RouteCandidate[]> {
    const rows = await this.db
      .select({
        placeId: scores.placeId,
        total: scores.total,
        lat: places.lat,
        lng: places.lng,
      })
      .from(scores)
      .innerJoin(places, eq(places.placeId, scores.placeId))
      .where(
        and(
          eq(scores.scanDate, scanDate),
          eq(places.sangkatCode, sangkatCode),
          eq(places.status, 'active'),
        ),
      )
      .orderBy(desc(scores.total))
      .limit(ROUTE_CANDIDATES_PER_SANGKAT * 3);

    return rows
      .filter((row) => !exclude.has(row.placeId) && row.lat !== null && row.lng !== null)
      .slice(0, ROUTE_CANDIDATES_PER_SANGKAT)
      .map((row) => ({
        placeId: row.placeId,
        location: { lat: row.lat!, lng: row.lng! },
        score: row.total,
      }));
  }

  /** Places being worked, or closed out recently enough that re-offering them is noise. */
  private async unavailablePlaceIds(now: Date): Promise<Set<string>> {
    const rows = await this.db
      .select({ placeId: leads.placeId })
      .from(leads)
      .where(
        or(
          inArray(leads.status, [...OPEN_STATUSES]),
          and(eq(leads.status, 'won'), gte(leads.assignedAt, daysAgo(now, WON_COOLDOWN_DAYS))),
          and(
            eq(leads.status, 'declined'),
            gte(leads.assignedAt, daysAgo(now, DECLINED_COOLDOWN_DAYS)),
          ),
        ),
      );
    return new Set(rows.map((r) => r.placeId));
  }

  private async countOpenLeads(officerId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(leads)
      .where(and(eq(leads.officerId, officerId), inArray(leads.status, [...OPEN_STATUSES])));
    return row?.n ?? 0;
  }
}
