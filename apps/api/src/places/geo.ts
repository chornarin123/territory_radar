export interface LatLng {
  lat: number;
  lng: number;
}

export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface Circle extends LatLng {
  radiusM: number;
}

const EARTH_RADIUS_M = 6_371_008.8;
const METERS_PER_DEGREE_LAT = 111_320;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in metres (haversine). */
export function distanceM(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Moves a point by metres north/east. Accurate enough at city scale. */
export function offset(p: LatLng, northM: number, eastM: number): LatLng {
  return {
    lat: p.lat + northM / METERS_PER_DEGREE_LAT,
    lng: p.lng + eastM / (METERS_PER_DEGREE_LAT * Math.cos(toRad(p.lat))),
  };
}

/** The lat/lng box enclosing a circle — for cheap indexed pre-filtering before `distanceM`. */
export function circleBBox(c: Circle): BBox {
  const sw = offset(c, -c.radiusM, -c.radiusM);
  const ne = offset(c, c.radiusM, c.radiusM);
  return { south: sw.lat, west: sw.lng, north: ne.lat, east: ne.lng };
}
