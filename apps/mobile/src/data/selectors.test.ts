import { describe, expect, it } from 'vitest';
import raw from '../../../../data/data.json';
// The same scoping the mock server applies, so these tests see what the app sees.
import { createWorkspace } from '../../../../scripts/mock-workspace.mjs';
import {
  EMPTY_FILTERS,
  QUICK_VIEWS,
  activeFilterCount,
  buildProspectViews,
  chipCounts,
  isOnRadar,
  matchesFilters,
  matchesListControls,
  sortViews,
  type FilterState,
} from './selectors';
import type { Workspace } from './types';

async function officerWorkspace(officerId = 'officer_001'): Promise<Workspace> {
  const { handle } = createWorkspace(raw);
  let body: unknown;
  const url = new URL(`http://x/workspace?officerId=${officerId}`);
  await handle({ method: 'GET' } as never, {} as never, url, (_: number, data: unknown) => {
    body = data;
  });
  return body as Workspace;
}

const ws = await officerWorkspace();
const views = buildProspectViews(ws);

describe('workspace scoping', () => {
  it('only contains the officer’s own prospects', () => {
    expect(ws.prospects).toHaveLength(32);
    expect(ws.prospects.every((p) => p.assignmentOfficerId === 'officer_001')).toBe(true);
  });

  it('gives a second officer only theirs', async () => {
    const other = await officerWorkspace('officer_002');
    expect(other.prospects.every((p) => p.assignmentOfficerId === 'officer_002')).toBe(true);
    expect(other.prospects.some((p) => ws.prospects.some((q) => q.id === p.id))).toBe(false);
  });
});

describe('area codes', () => {
  it('place every located prospect in a commune, by its pin', () => {
    const located = views.filter((v) => v.p.location);
    expect(located.every((v) => /^\d{6}$/.test(v.communeCode ?? ''))).toBe(true);
    expect(views.filter((v) => !v.p.location).every((v) => v.communeCode === null)).toBe(true);
  });

  it('filter by an area at any level', () => {
    const inChamkarMon = views.filter((v) => v.communeCode?.startsWith('1201'));
    expect(inChamkarMon.length).toBeGreaterThan(0);
    const f: FilterState = { ...EMPTY_FILTERS, area: ['1201'] };
    expect(views.filter((v) => matchesFilters(v, f))).toEqual(inChamkarMon);
    const all: FilterState = { ...EMPTY_FILTERS, area: ['12'] };
    expect(views.filter((v) => matchesFilters(v, all)).length).toBeGreaterThan(inChamkarMon.length);
  });
});

describe('prospect views', () => {
  it('skip the directory listing when picking the signal to show', () => {
    expect(views.every((v) => v.signal?.type !== 'directory_presence')).toBe(true);
    expect(views.filter((v) => v.signal).length).toBe(32);
  });

  it('give every signal a Radar group', () => {
    expect(views.filter((v) => !v.signalGroup)).toEqual([]);
  });

  it('resolve commune names and the rank-1 product', () => {
    const lotus = views.find((v) => v.name === 'Lotus Corner Café')!;
    expect(lotus.commune).toBe('Tonle Basak');
    expect(lotus.communeCode).toBe('120101');
    expect(lotus.product?.id).toBe('product_002');
  });
});

describe('chip counts', () => {
  it('ignore the group’s own selection, so picking more never empties it', () => {
    const f: FilterState = { ...EMPTY_FILTERS, area: ['120101'] };
    const counts = chipCounts(
      views,
      f,
      'area',
      ['120101', '120408'] as const,
      (v, a) => v.communeCode === a,
    );
    // Boeng Kak Ti Pir still shows its real count even though only Tonle Basak is selected.
    expect(counts['120408']).toBe(views.filter((v) => v.communeCode === '120408').length);
    expect(counts['120101']).toBeGreaterThan(0);
  });

  it('respect the other groups', () => {
    const f: FilterState = { ...EMPTY_FILTERS, band: ['low'] };
    const counts = chipCounts(views, f, 'area', ['120101'] as const, (v, a) => v.communeCode === a);
    const expected = views.filter((v) => v.band === 'low' && v.communeCode === '120101').length;
    expect(counts['120101']).toBe(expected);
  });

  it('sum to the total when the group is unfiltered', () => {
    const communes = [...new Set(views.map((v) => v.commune))];
    const counts = chipCounts(views, EMPTY_FILTERS, 'area', communes, (v, a) => v.commune === a);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(views.length);
  });
});

describe('filters', () => {
  it('pass everything when empty', () => {
    expect(views.filter((v) => matchesFilters(v, EMPTY_FILTERS))).toHaveLength(32);
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
  });

  it('"Needs checking" finds flagged or stale prospects only', () => {
    const check = QUICK_VIEWS.find((q) => q.id === 'check')!.filters;
    const hits = views.filter((v) => matchesFilters(v, check));
    expect(hits.length).toBeGreaterThan(0);
    expect(
      hits.every((v) => v.p.dataQuality.flags.length > 0 || v.signal?.freshness === 'stale'),
    ).toBe(true);
  });

  it('"Has a map location" drops prospects without coordinates', () => {
    const pinned = views.filter((v) => matchesFilters(v, { ...EMPTY_FILTERS, pinned: true }));
    expect(pinned.every((v) => v.p.location)).toBe(true);
    expect(pinned.length).toBe(views.length - views.filter((v) => !v.p.location).length);
  });
});

describe('Prospects list controls', () => {
  const base = { status: 'active' as const, minScoreOn: false, minScore: 60, hideNoNeed: false };

  it('"All active" excludes closed only', () => {
    const hits = views.filter((v) => matchesListControls(v, base));
    expect(hits.some((v) => v.status === 'closed')).toBe(false);
    expect(hits.some((v) => v.status === 'not_interested')).toBe(true);
  });

  it('"Hide no-need" does not hide them when you asked for the closed set', () => {
    const closed = views.filter((v) =>
      matchesListControls(v, { ...base, status: 'closedset', hideNoNeed: true }),
    );
    expect(closed.some((v) => v.status === 'not_interested')).toBe(true);
  });

  it('"Priority ≥ 60" applies the threshold', () => {
    const hits = views.filter((v) => matchesListControls(v, { ...base, minScoreOn: true }));
    expect(hits.every((v) => v.score >= 60)).toBe(true);
  });
});

describe('radar', () => {
  it('excludes closed and no-need prospects', () => {
    const live = views.filter(isOnRadar);
    expect(live.some((v) => v.status === 'closed' || v.status === 'not_interested')).toBe(false);
  });
});

describe('sorting', () => {
  it('orders by priority, then name', () => {
    const s = sortViews(views, 'priority');
    for (let i = 1; i < s.length; i++) expect(s[i - 1]!.score).toBeGreaterThanOrEqual(s[i]!.score);
  });
});
