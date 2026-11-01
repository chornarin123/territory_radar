import { describe, expect, it } from 'vitest';
import raw from '../../../../data/data.json';
import {
  byPriority,
  filterByRadius,
  formatDistance,
  formatRadius,
  haversine,
  movedEnough,
  nearestNeighbourOrder,
  nextRadius,
  routeLength,
  timeSlot,
  withDistances,
} from './visitPlan';

const branch = raw.branches[0]!.location;
const prospects = raw.prospects
  .filter((p) => p.location)
  .map((p) => ({ id: p.id, score: p.priority.score, ...p.location! }));

describe('distance', () => {
  it('measures a known distance', () => {
    // One degree of latitude is ~111.2 km anywhere.
    expect(haversine({ lat: 11, lng: 104.9 }, { lat: 12, lng: 104.9 })).toBeCloseTo(111_195, -2);
    expect(haversine(branch, branch)).toBe(0);
  });

  it('formats metres and kilometres', () => {
    expect(formatDistance(432)).toBe('430 m');
    expect(formatDistance(996)).toBe('1.0 km'); // rounds up past 1 km, never "1000 m"
    expect(formatDistance(1149)).toBe('1.1 km');
    expect(formatRadius(500)).toBe('500 m');
    expect(formatRadius(2000)).toBe('2 km');
  });

  it('ignores GPS jitter under 50 m', () => {
    expect(movedEnough(null, branch)).toBe(true);
    expect(movedEnough(branch, { lat: branch.lat + 0.0003, lng: branch.lng })).toBe(false); // ~33 m
    expect(movedEnough(branch, { lat: branch.lat + 0.0006, lng: branch.lng })).toBe(true); // ~67 m
  });
});

describe('radius', () => {
  it('keeps only prospects inside, nearest first', () => {
    const near = filterByRadius(prospects, branch, 2000);
    expect(near.length).toBeGreaterThan(0);
    expect(near.every((p) => p.distance <= 2000)).toBe(true);
    expect(near.map((p) => p.distance)).toEqual(
      [...near.map((p) => p.distance)].sort((a, b) => a - b),
    );
  });

  it('widens with the radius', () => {
    const r2 = filterByRadius(prospects, branch, 2000).length;
    const r5 = filterByRadius(prospects, branch, 5000).length;
    expect(r5).toBeGreaterThan(r2);
    expect(withDistances(prospects, branch)).toHaveLength(prospects.length);
    expect(nextRadius(2000)).toBe(5000);
    expect(nextRadius(5000)).toBeNull();
  });

  it('sorts by priority, then distance', () => {
    const list = filterByRadius(prospects, branch, 5000).sort(byPriority);
    for (let i = 1; i < list.length; i++) {
      const [a, b] = [list[i - 1]!, list[i]!];
      expect(a.score > b.score || (a.score === b.score && a.distance <= b.distance)).toBe(true);
    }
  });
});

describe('route', () => {
  const stops = filterByRadius(prospects, branch, 5000).slice(0, 5).reverse();

  it('visits the nearest stop first', () => {
    const order = nearestNeighbourOrder(branch, stops);
    expect(order).toHaveLength(stops.length);
    const nearest = [...stops].sort((a, b) => haversine(branch, a) - haversine(branch, b))[0];
    expect(order[0]).toBe(nearest);
  });

  it('is never longer than the order it was given, for these stops', () => {
    expect(routeLength(branch, nearestNeighbourOrder(branch, stops))).toBeLessThanOrEqual(
      routeLength(branch, stops),
    );
  });

  it('adds up each leg', () => {
    const [a, b] = [stops[0]!, stops[1]!];
    expect(routeLength(branch, [a, b])).toBeCloseTo(haversine(branch, a) + haversine(a, b));
    expect(routeLength(branch, [])).toBe(0);
  });

  it('slots visits an hour apart from 10:00', () => {
    expect([0, 1, 2].map(timeSlot)).toEqual(['10:00', '11:00', '12:00']);
  });
});
