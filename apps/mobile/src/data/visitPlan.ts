// Visit planning maths: straight-line distances from the officer's position.
// Pure functions, no React or I/O; unit-tested in visitPlan.test.ts.

export interface Point {
  lat: number;
  lng: number;
}

/** Search radii offered on Plan visits, in metres. */
export const RADII = [500, 1000, 2000, 5000] as const;
export type Radius = (typeof RADII)[number];

/** Minutes on site per visit, for the plan's time estimate. */
export const MINUTES_PER_VISIT = 30;

/** Distances are recomputed only when the officer moves further than this. */
export const MOVE_THRESHOLD_M = 50;

const EARTH_M = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres. */
export function haversine(a: Point, b: Point): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.sqrt(h));
}

/** "430 m" under a kilometre (to 10 m), "1.1 km" above. */
export function formatDistance(m: number): string {
  if (Math.round(m / 10) * 10 < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

/** "500 m", "2 km": a radius as the controls show it. */
export const formatRadius = (r: number) => (r < 1000 ? `${r} m` : `${r / 1000} km`);

export const movedEnough = (from: Point | null, to: Point) =>
  !from || haversine(from, to) > MOVE_THRESHOLD_M;

/** Every item with its distance from `origin`, nearest first. */
export function withDistances<T extends Point>(
  items: readonly T[],
  origin: Point,
): (T & { distance: number })[] {
  return items
    .map((x) => ({ ...x, distance: haversine(origin, x) }))
    .sort((a, b) => a.distance - b.distance);
}

/** Items within `radius` metres of `origin`, nearest first, with `distance`. */
export function filterByRadius<T extends Point>(
  items: readonly T[],
  origin: Point,
  radius: number,
): (T & { distance: number })[] {
  return withDistances(items, origin).filter((x) => x.distance <= radius);
}

/** The next radius up, or null at the widest. */
export const nextRadius = (r: Radius): Radius | null => RADII[RADII.indexOf(r) + 1] ?? null;

/** Highest priority first; nearest breaks ties. */
export const byPriority = <T extends { score: number; distance: number }>(a: T, b: T) =>
  b.score - a.score || a.distance - b.distance;

/**
 * Greedy nearest-neighbour from the origin: always the closest stop not yet
 * visited. Simulated: straight lines, not roads, and not always optimal.
 */
export function nearestNeighbourOrder<T extends Point>(origin: Point, stops: readonly T[]): T[] {
  const left = [...stops];
  const out: T[] = [];
  let cur = origin;
  while (left.length) {
    let best = 0;
    for (let i = 1; i < left.length; i++) {
      if (haversine(cur, left[i]!) < haversine(cur, left[best]!)) best = i;
    }
    cur = left.splice(best, 1)[0]!;
    out.push(cur as T);
  }
  return out;
}

/** Metres along origin → stop 1 → stop 2 → … in the given order. */
export function routeLength(origin: Point, ordered: readonly Point[]): number {
  let total = 0;
  let cur = origin;
  for (const s of ordered) {
    total += haversine(cur, s);
    cur = s;
  }
  return total;
}

/** "10:00", "11:00", … : one slot an hour from 10:00, in route order. */
export const timeSlot = (i: number) => `${String(10 + i).padStart(2, '0')}:00`;
