import { describe, expect, it } from 'vitest';
import { clusterWalkingRoutes, MAX_LEG_METERS } from './routes.js';
import type { RouteCandidate } from './routes.js';

// ~111 m per 0.001° of latitude.
const lead = (placeId: string, northMetres: number, score: number): RouteCandidate => ({
  placeId,
  location: { lat: 11.55 + northMetres / 111_320, lng: 104.9 },
  score,
});

describe('clusterWalkingRoutes', () => {
  it('starts each route at the best remaining lead', () => {
    const routes = clusterWalkingRoutes([lead('weak', 0, 0.2), lead('best', 100, 0.9)]);
    expect(routes[0]!.stops[0]!.placeId).toBe('best');
  });

  it('walks to the nearest lead next, not the next-best score', () => {
    const routes = clusterWalkingRoutes([
      lead('start', 0, 0.9),
      lead('far-but-good', 400, 0.8),
      lead('near-but-weak', 50, 0.1),
    ]);
    expect(routes[0]!.stops.map((s) => s.placeId)).toEqual([
      'start',
      'near-but-weak',
      'far-but-good',
    ]);
  });

  it('splits leads that are too far apart to walk between', () => {
    const routes = clusterWalkingRoutes([
      lead('a', 0, 0.9),
      lead('b', 100, 0.8),
      lead('c', 100 + MAX_LEG_METERS + 200, 0.7),
    ]);
    expect(routes.map((r) => r.stops.map((s) => s.placeId))).toEqual([['a', 'b'], ['c']]);
  });

  it('caps a route at maxStops and starts another', () => {
    const leads = Array.from({ length: 5 }, (_, i) => lead(`p${i}`, i * 50, 1 - i / 10));
    const routes = clusterWalkingRoutes(leads, { maxStops: 3 });
    expect(routes.map((r) => r.stops.length)).toEqual([3, 2]);
  });

  it('adds up the walking distance between stops', () => {
    const routes = clusterWalkingRoutes([
      lead('a', 0, 0.9),
      lead('b', 100, 0.8),
      lead('c', 250, 0.7),
    ]);
    expect(routes[0]!.totalMeters).toBeGreaterThan(245);
    expect(routes[0]!.totalMeters).toBeLessThan(255);
  });

  it('places every lead in exactly one route', () => {
    const leads = Array.from({ length: 30 }, (_, i) =>
      lead(`p${i}`, (i * 137) % 2000, (i % 7) / 7),
    );
    const routes = clusterWalkingRoutes(leads, { maxStops: 4 });
    const placed = routes.flatMap((r) => r.stops.map((s) => s.placeId)).sort();
    expect(placed).toEqual(leads.map((l) => l.placeId).sort());
  });

  it('is deterministic when scores and distances tie', () => {
    const leads = [lead('b', 0, 0.5), lead('a', 0, 0.5), lead('c', 100, 0.5)];
    expect(clusterWalkingRoutes(leads)).toEqual(clusterWalkingRoutes([...leads].reverse()));
    expect(clusterWalkingRoutes(leads)[0]!.stops[0]!.placeId).toBe('a');
  });

  it('returns nothing for no leads', () => {
    expect(clusterWalkingRoutes([])).toEqual([]);
  });

  it('rejects nonsensical options', () => {
    expect(() => clusterWalkingRoutes([], { maxStops: 0 })).toThrow(RangeError);
    expect(() => clusterWalkingRoutes([], { maxLegMeters: 0 })).toThrow(RangeError);
  });
});
