import { describe, expect, it } from 'vitest';
import { haversineMeters, isWithin, MIN_RADIUS_M, seedCells, subdivide } from './grid.js';
import type { BBox, CellCircle } from './grid.js';

// Roughly 1.1 km square over central Phnom Penh.
const phnomPenh: BBox = { south: 11.55, west: 104.9, north: 11.56, east: 104.91 };

describe('haversineMeters', () => {
  it('measures a known short distance', () => {
    // 0.001° of latitude ≈ 111 m anywhere on Earth.
    const metres = haversineMeters({ lat: 11.55, lng: 104.9 }, { lat: 11.551, lng: 104.9 });
    expect(metres).toBeGreaterThan(110);
    expect(metres).toBeLessThan(112);
  });

  it('is zero for the same point', () => {
    expect(haversineMeters({ lat: 11.55, lng: 104.9 }, { lat: 11.55, lng: 104.9 })).toBe(0);
  });
});

describe('seedCells', () => {
  it('covers every point of the bbox with at least one circle', () => {
    const cells = seedCells(phnomPenh, 400);
    const samples = [
      { lat: phnomPenh.south, lng: phnomPenh.west },
      { lat: phnomPenh.north, lng: phnomPenh.east },
      { lat: phnomPenh.north, lng: phnomPenh.west },
      { lat: 11.5553, lng: 104.9042 },
      { lat: 11.5587, lng: 104.9091 },
    ];
    for (const point of samples) {
      expect(
        cells.some((cell) => isWithin(cell, point)),
        JSON.stringify(point),
      ).toBe(true);
    }
  });

  it('is deterministic', () => {
    expect(seedCells(phnomPenh, 400)).toEqual(seedCells(phnomPenh, 400));
  });

  it('needs fewer cells with a bigger radius', () => {
    expect(seedCells(phnomPenh, 800).length).toBeLessThan(seedCells(phnomPenh, 200).length);
  });

  it('rejects a radius below the floor', () => {
    expect(() => seedCells(phnomPenh, MIN_RADIUS_M - 1)).toThrow(RangeError);
  });

  it('rejects an inverted bbox', () => {
    expect(() => seedCells({ ...phnomPenh, north: 11.5 }, 400)).toThrow(RangeError);
  });

  it('refuses to create more cells than the cap', () => {
    expect(() => seedCells(phnomPenh, 60, 10)).toThrow(/max 10/);
  });
});

describe('subdivide', () => {
  const parent: CellCircle = { lat: 11.555, lng: 104.905, radiusM: 400 };

  it('returns four smaller children', () => {
    const children = subdivide(parent);
    expect(children).toHaveLength(4);
    for (const child of children) {
      expect(child.radiusM).toBeCloseTo(400 / Math.SQRT2);
      expect(child.radiusM).toBeLessThan(parent.radiusM);
    }
  });

  it('covers the whole parent circle, including its edge', () => {
    const children = subdivide(parent);
    for (let bearing = 0; bearing < 360; bearing += 15) {
      const radians = (bearing * Math.PI) / 180;
      // A point just inside the parent's rim.
      const point = {
        lat: parent.lat + (399 / 111_320) * Math.cos(radians),
        lng:
          parent.lng +
          ((399 / 111_320) * Math.sin(radians)) / Math.cos((parent.lat * Math.PI) / 180),
      };
      expect(
        children.some((child) => isWithin(child, point)),
        `bearing ${bearing}`,
      ).toBe(true);
    }
  });

  it('stops splitting once children would be below the floor', () => {
    expect(subdivide({ ...parent, radiusM: MIN_RADIUS_M })).toEqual([]);
  });
});
