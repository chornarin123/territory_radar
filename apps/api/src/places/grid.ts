// Pure geometry for grid scanning. No I/O, no clock — unit-tested in grid.spec.ts.

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

export interface CellCircle {
  lat: number;
  lng: number;
  radiusM: number;
}

const EARTH_RADIUS_M = 6_371_008.8;
const METERS_PER_DEGREE_LAT = 111_320;

/** Below this, splitting further costs more than it finds. */
export const MIN_RADIUS_M = 50;

export function metersToLatDegrees(meters: number): number {
  return meters / METERS_PER_DEGREE_LAT;
}

export function metersToLngDegrees(meters: number, atLat: number): number {
  const scale = Math.cos((atLat * Math.PI) / 180);
  if (scale <= 1e-6) throw new RangeError('Longitude scaling breaks down at the poles');
  return meters / (METERS_PER_DEGREE_LAT * scale);
}

export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isWithin(cell: CellCircle, point: LatLng): boolean {
  return haversineMeters({ lat: cell.lat, lng: cell.lng }, point) <= cell.radiusM;
}

/**
 * Circles of `radiusM` covering `bbox`, laid out so each circle covers one
 * square of side radius·√2 — the largest square that fits inside it. Circles
 * spill past the bbox edges, which is why places are attributed to the sangkat
 * of the cell that found them (see README, "Known limitations").
 */
export function seedCells(bbox: BBox, radiusM: number, maxCells = 5_000): CellCircle[] {
  if (!(radiusM >= MIN_RADIUS_M)) {
    throw new RangeError(`radiusM must be at least ${MIN_RADIUS_M}`);
  }
  if (bbox.south >= bbox.north || bbox.west >= bbox.east) {
    throw new RangeError('bbox must have south < north and west < east');
  }

  const side = radiusM * Math.SQRT2;
  const midLat = (bbox.south + bbox.north) / 2;
  const dLat = metersToLatDegrees(side);
  const dLng = metersToLngDegrees(side, midLat);
  const rows = Math.max(1, Math.ceil((bbox.north - bbox.south) / dLat));
  const cols = Math.max(1, Math.ceil((bbox.east - bbox.west) / dLng));

  if (rows * cols > maxCells) {
    throw new RangeError(
      `Seeding would create ${rows * cols} cells (max ${maxCells}); use a larger radius`,
    );
  }

  const cells: CellCircle[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      cells.push({
        lat: bbox.south + (row + 0.5) * dLat,
        lng: bbox.west + (col + 0.5) * dLng,
        radiusM,
      });
    }
  }
  return cells;
}

/**
 * Four circles covering a saturated cell. Each child covers one quadrant of the
 * parent's bounding square, so together they cover the parent circle completely.
 * Returns [] when the children would be below MIN_RADIUS_M.
 */
export function subdivide(cell: CellCircle): CellCircle[] {
  const childRadius = cell.radiusM / Math.SQRT2;
  if (childRadius < MIN_RADIUS_M) return [];

  const offsetLat = metersToLatDegrees(cell.radiusM / 2);
  const offsetLng = metersToLngDegrees(cell.radiusM / 2, cell.lat);
  return [
    { lat: cell.lat - offsetLat, lng: cell.lng - offsetLng, radiusM: childRadius },
    { lat: cell.lat - offsetLat, lng: cell.lng + offsetLng, radiusM: childRadius },
    { lat: cell.lat + offsetLat, lng: cell.lng - offsetLng, radiusM: childRadius },
    { lat: cell.lat + offsetLat, lng: cell.lng + offsetLng, radiusM: childRadius },
  ];
}
