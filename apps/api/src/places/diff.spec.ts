import { describe, expect, it } from 'vitest';
import { dedupeByPlaceId, diffCellScan, MISSING_RUNS_BEFORE_MISSING } from './diff.js';
import type { CellScanContext, KnownPlace, ReturnedPlace } from './diff.js';
import type { CellCircle } from './grid.js';

const cell: CellCircle = { lat: 11.555, lng: 104.905, radiusM: 350 };
const inside = { lat: 11.5551, lng: 104.9051 };
const outside = { lat: 11.57, lng: 104.93 };

const context = (overrides: Partial<CellScanContext> = {}): CellScanContext => ({
  cell,
  previouslyScannedComplete: true,
  truncated: false,
  ...overrides,
});

const returned = (overrides: Partial<ReturnedPlace> = {}): ReturnedPlace => ({
  placeId: 'p1',
  location: inside,
  primaryType: 'restaurant',
  ...overrides,
});

const known = (overrides: Partial<KnownPlace> = {}): KnownPlace => ({
  placeId: 'p1',
  location: inside,
  status: 'active',
  missingCount: 0,
  ...overrides,
});

describe('diffCellScan — openings', () => {
  it('treats an unseen place in a previously complete cell as a new opening', () => {
    const diff = diffCellScan(context(), [returned()], []);
    expect(diff.newPlaces.map((p) => p.placeId)).toEqual(['p1']);
    expect(diff.newOpenings.map((p) => p.placeId)).toEqual(['p1']);
  });

  it('does not call anything an opening on a cell scanned for the first time', () => {
    const diff = diffCellScan(
      context({ previouslyScannedComplete: false }),
      [returned(), returned({ placeId: 'p2' })],
      [],
    );
    expect(diff.newPlaces).toHaveLength(2);
    expect(diff.newOpenings).toEqual([]);
  });

  it('does not call anything an opening when the result was capped at 20', () => {
    const diff = diffCellScan(context({ truncated: true }), [returned()], []);
    expect(diff.newPlaces).toHaveLength(1);
    expect(diff.newOpenings).toEqual([]);
  });
});

describe('diffCellScan — Google listings flicker', () => {
  it('does not change status after a single miss, only the counter', () => {
    const diff = diffCellScan(context(), [], [known()]);
    expect(diff.statusChanges).toEqual([{ placeId: 'p1', status: 'active', missingCount: 1 }]);
  });

  it(`marks a place missing after ${MISSING_RUNS_BEFORE_MISSING} consecutive misses`, () => {
    const diff = diffCellScan(context(), [], [known({ missingCount: 1 })]);
    expect(diff.statusChanges).toEqual([{ placeId: 'p1', status: 'missing', missingCount: 2 }]);
  });

  it('never marks a place closed however long it has been missing', () => {
    const diff = diffCellScan(context(), [], [known({ status: 'missing', missingCount: 40 })]);
    expect(diff.statusChanges).toEqual([{ placeId: 'p1', status: 'missing', missingCount: 41 }]);
    expect(diff.statusChanges.some((c) => c.status === 'closed')).toBe(false);
  });

  it('leaves already-closed places alone', () => {
    expect(diffCellScan(context(), [], [known({ status: 'closed' })]).statusChanges).toEqual([]);
  });

  it('never counts absence against a result capped at 20', () => {
    const diff = diffCellScan(context({ truncated: true }), [], [known()]);
    expect(diff.statusChanges).toEqual([]);
  });

  it('ignores known places outside the cell or without coordinates', () => {
    const diff = diffCellScan(
      context(),
      [],
      [known({ placeId: 'far', location: outside }), known({ placeId: 'nc', location: null })],
    );
    expect(diff.statusChanges).toEqual([]);
  });

  it('resets the streak when a missing place reappears', () => {
    const diff = diffCellScan(
      context(),
      [returned()],
      [known({ status: 'missing', missingCount: 3 })],
    );
    expect(diff.seen.map((p) => p.placeId)).toEqual(['p1']);
    expect(diff.statusChanges).toEqual([{ placeId: 'p1', status: 'active', missingCount: 0 }]);
  });

  it('leaves an unchanged active place alone', () => {
    const diff = diffCellScan(context(), [returned()], [known()]);
    expect(diff.seen).toHaveLength(1);
    expect(diff.statusChanges).toEqual([]);
  });
});

describe('dedupeByPlaceId', () => {
  it('keeps the first occurrence of each place', () => {
    const deduped = dedupeByPlaceId([
      returned({ placeId: 'a', primaryType: 'cafe' }),
      returned({ placeId: 'b' }),
      returned({ placeId: 'a', primaryType: 'restaurant' }),
    ]);
    expect(deduped.map((p) => [p.placeId, p.primaryType])).toEqual([
      ['a', 'cafe'],
      ['b', 'restaurant'],
    ]);
  });
});
