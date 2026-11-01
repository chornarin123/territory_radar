// Pure diff between what a cell scan returned and what we already knew.
// No I/O, no clock — unit-tested in diff.spec.ts.

import type { PlaceStatus } from '@territory-radar/shared';
import { isWithin } from './grid.js';
import type { CellCircle, LatLng } from './grid.js';

export type BusinessStatus = 'OPERATIONAL' | 'CLOSED_TEMPORARILY' | 'CLOSED_PERMANENTLY';

/**
 * A place as the discovery scan sees it. The cheap field mask returns only id,
 * location and type — no name, no business status. Closure is therefore decided
 * during enrichment, never here.
 */
export interface ReturnedPlace {
  placeId: string;
  location: LatLng;
  primaryType: string | null;
}

export interface KnownPlace {
  placeId: string;
  location: LatLng | null;
  status: PlaceStatus;
  missingCount: number;
}

export interface StatusChange {
  placeId: string;
  status: PlaceStatus;
  missingCount: number;
}

export interface CellDiff {
  /** Places we had never seen before. */
  newPlaces: ReturnedPlace[];
  /** Subset of newPlaces that count as genuine openings (see below). */
  newOpenings: ReturnedPlace[];
  /** Known places returned again — refresh coordinates, clear any missing streak. */
  seen: ReturnedPlace[];
  statusChanges: StatusChange[];
}

/**
 * Consecutive scans a place must be absent from before its status changes.
 * Google listings flicker: a single miss means nothing.
 */
export const MISSING_RUNS_BEFORE_MISSING = 2;

/** Confidence attached to a new_opening signal. */
export const NEW_OPENING_CONFIDENCE = 0.9;

export interface CellScanContext {
  cell: CellCircle;
  /** The cell was scanned before and returned a complete (unsaturated) result. */
  previouslyScannedComplete: boolean;
  /**
   * Google capped this result at 20 places, so absence proves nothing and new
   * places may just have been ranked out of view last time.
   */
  truncated: boolean;
}

/**
 * Compares one cell scan against the places we already hold near that cell.
 *
 * Two rules keep this honest:
 *  • Absence is not closure. A place missing from a scan increments a counter;
 *    only MISSING_RUNS_BEFORE_MISSING consecutive misses change its status, and
 *    nothing here ever marks a place closed — that needs an explicit
 *    CLOSED_PERMANENTLY from Place Details during enrichment.
 *  • A first sighting is not an opening. New places only count as openings when
 *    the cell had a complete scan before, so the baseline scan of a new area
 *    does not report every business in it as newly opened.
 */
export function diffCellScan(
  context: CellScanContext,
  returned: readonly ReturnedPlace[],
  known: readonly KnownPlace[],
): CellDiff {
  const knownById = new Map(known.map((k) => [k.placeId, k]));
  const returnedIds = new Set(returned.map((r) => r.placeId));

  const diff: CellDiff = { newPlaces: [], newOpenings: [], seen: [], statusChanges: [] };

  for (const place of returned) {
    const existing = knownById.get(place.placeId);

    if (existing) {
      diff.seen.push(place);
      if (existing.status !== 'active' || existing.missingCount > 0) {
        diff.statusChanges.push({ placeId: place.placeId, status: 'active', missingCount: 0 });
      }
      continue;
    }

    diff.newPlaces.push(place);
    if (context.previouslyScannedComplete && !context.truncated) {
      diff.newOpenings.push(place);
    }
  }

  if (!context.truncated) {
    for (const place of known) {
      if (place.status === 'closed' || returnedIds.has(place.placeId)) continue;
      // Without coordinates we cannot tell whether this cell should have covered it.
      if (!place.location || !isWithin(context.cell, place.location)) continue;

      const missingCount = place.missingCount + 1;
      const status: PlaceStatus =
        missingCount >= MISSING_RUNS_BEFORE_MISSING ? 'missing' : place.status;
      // One miss only bumps the counter; the row is otherwise left alone.
      if (status !== place.status || missingCount !== place.missingCount) {
        diff.statusChanges.push({ placeId: place.placeId, status, missingCount });
      }
    }
  }

  return diff;
}

/** Deduplicates places found by several categories or overlapping cells. */
export function dedupeByPlaceId(places: readonly ReturnedPlace[]): ReturnedPlace[] {
  const byId = new Map<string, ReturnedPlace>();
  for (const place of places) if (!byId.has(place.placeId)) byId.set(place.placeId, place);
  return [...byId.values()];
}
