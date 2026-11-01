// Groups a sangkat's best leads into routes an officer can walk in one visit.
// Pure — no I/O, no clock — unit-tested in routes.spec.ts.

import { haversineMeters } from '../places/grid.js';
import type { LatLng } from '../places/grid.js';

export interface RouteCandidate {
  placeId: string;
  location: LatLng;
  /** 0..1 lead score; the highest-scoring candidate seeds each route. */
  score: number;
}

export interface WalkingRoute {
  /** In visiting order. */
  stops: RouteCandidate[];
  /** Sum of the walking legs between stops, in metres. */
  totalMeters: number;
}

/** A morning of visits. */
export const MAX_STOPS_PER_ROUTE = 8;
/** Further than this between two stops and it stops being a walk. */
export const MAX_LEG_METERS = 500;

export interface RouteOptions {
  maxStops?: number;
  maxLegMeters?: number;
}

/**
 * Greedy nearest-neighbour chaining: start from the best unrouted lead, then
 * keep walking to the closest lead still within reach. Not the optimal tour —
 * that is TSP — but it keeps the strongest lead first, which is what matters
 * when an officer only gets through half the list.
 *
 * Deterministic: candidates are ordered by score then place id, and ties in
 * distance break by place id, so the same input always yields the same routes.
 */
export function clusterWalkingRoutes(
  candidates: readonly RouteCandidate[],
  { maxStops = MAX_STOPS_PER_ROUTE, maxLegMeters = MAX_LEG_METERS }: RouteOptions = {},
): WalkingRoute[] {
  if (maxStops < 1) throw new RangeError('maxStops must be at least 1');
  if (maxLegMeters <= 0) throw new RangeError('maxLegMeters must be positive');

  const remaining = [...candidates].sort(
    (a, b) => b.score - a.score || compare(a.placeId, b.placeId),
  );
  const routes: WalkingRoute[] = [];

  while (remaining.length > 0) {
    const seed = remaining.shift()!;
    const stops = [seed];
    let totalMeters = 0;

    while (stops.length < maxStops && remaining.length > 0) {
      const from = stops.at(-1)!;
      let bestIndex = -1;
      let bestDistance = Number.POSITIVE_INFINITY;

      for (let i = 0; i < remaining.length; i++) {
        const distance = haversineMeters(from.location, remaining[i]!.location);
        if (distance > maxLegMeters) continue;
        if (
          distance < bestDistance ||
          (distance === bestDistance &&
            bestIndex >= 0 &&
            compare(remaining[i]!.placeId, remaining[bestIndex]!.placeId) < 0)
        ) {
          bestDistance = distance;
          bestIndex = i;
        }
      }

      if (bestIndex < 0) break; // nothing else within walking distance
      stops.push(remaining.splice(bestIndex, 1)[0]!);
      totalMeters += bestDistance;
    }

    routes.push({ stops, totalMeters: Math.round(totalMeters) });
  }

  return routes;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
