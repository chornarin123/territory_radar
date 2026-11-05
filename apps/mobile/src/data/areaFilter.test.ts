import { describe, expect, it } from 'vitest';
import address from '../../../../data/address.json';
import raw from '../../../../data/data.json';
import { createWorkspace } from '../../../../scripts/mock-workspace.mjs';
import {
  buildAreaTree,
  byCount,
  searchByCount,
  selectionSummary,
  toggleArea,
  topCommunes,
  type AddressProvince,
} from './areas';
import {
  EMPTY_FILTERS,
  QUICK_VIEWS,
  areaCounts,
  buildProspectViews,
  matchesFilters,
  matchesListControls,
  type ListControls,
} from './selectors';
import type { Workspace } from './types';

const tree = buildAreaTree(address as AddressProvince[]);

async function workspace(): Promise<Workspace> {
  const { handle } = createWorkspace(raw);
  let body: unknown;
  await handle(
    { method: 'GET' } as never,
    {} as never,
    new URL('http://x/workspace?officerId=officer_001'),
    (_s: number, d: unknown) => {
      body = d;
    },
  );
  return body as Workspace;
}
const views = buildProspectViews(await workspace());
// The Prospects list's defaults (data.json settings): priority ≥ 60, hide no-need.
const list: ListControls = {
  tab: 'all',
  search: '',
  minScoreOn: true,
  minScore: 60,
  hideNoNeed: true,
};
const base = (v: (typeof views)[number]) => matchesListControls(v, list);

describe('faceted area counts', () => {
  const counts = areaCounts(views, EMPTY_FILTERS, base);

  it('roll communes up to districts and provinces by code prefix', () => {
    const khans = tree.byCode.get('12')!.children.map((d) => counts.get(d.code) ?? 0);
    expect(khans.reduce((a, b) => a + b, 0)).toBe(counts.get('12'));
    const sangkats = tree.byCode.get('1204')!.children.map((c) => counts.get(c.code) ?? 0);
    expect(sangkats.reduce((a, b) => a + b, 0)).toBe(counts.get('1204'));
  });

  it('ignore the area filter itself, but honour every other filter', () => {
    const picked = { ...EMPTY_FILTERS, area: ['120101'] };
    expect(areaCounts(views, picked, base)).toEqual(counts);
    const ready = QUICK_VIEWS.find((q) => q.id === 'ready')!.filters;
    const narrowed = areaCounts(views, ready, base);
    expect(narrowed.get('12')).toBeLessThan(counts.get('12')!);
  });

  it('agree with what the filter then shows, e.g. for Boeng Kak Ti Pir', () => {
    const n = counts.get('120408')!;
    expect(n).toBeGreaterThan(0);
    const f = { ...EMPTY_FILTERS, area: ['120408'] };
    expect(views.filter((v) => base(v) && matchesFilters(v, f))).toHaveLength(n);
    expect(selectionSummary(f.area, tree, n)).toEqual({
      title: 'Boeng Kak Ti Pir',
      sub: `Tuol Kouk · ${n} prospects`,
    });
  });

  it('show only provinces with prospects at the top level', () => {
    const shown = tree.roots.filter((p) => counts.get(p.code));
    expect(shown.map((p) => p.name_en)).toEqual(['Phnom Penh']);
  });
});

describe('summary and shortcuts', () => {
  it('names the selection', () => {
    expect(selectionSummary([], tree, 29)).toEqual({
      title: 'All areas',
      sub: 'Cambodia · 29 prospects',
    });
    expect(selectionSummary(['12'], tree, 29).sub).toBe('Cambodia · 29 prospects');
    expect(selectionSummary(['1204', '120101'], tree, 9)).toEqual({
      title: 'Tonle Basak +1 more',
      sub: 'Chamkar Mon, Phnom Penh · 9 prospects',
    });
  });

  it('picks the communes with the most prospects, at most n', () => {
    const counts = new Map([
      ['12', 9],
      ['1201', 9],
      ['120101', 5],
      ['120102', 1],
      ['120103', 3],
      ['120104', 0],
    ]);
    expect(topCommunes(counts, 2)).toEqual(['120101', '120103']);
    expect(topCommunes(counts, 6)).toEqual(['120101', '120103', '120102']);
  });
});

describe('picker lists', () => {
  const counts = new Map([
    ['12', 8],
    ['1204', 6],
    ['1201', 2],
    ['120408', 2],
  ]);

  it('sorts by count, then level, then name', () => {
    const rows = byCount(tree.byCode.get('12')!.children, counts).map((n) => n.code);
    expect(rows.slice(0, 2)).toEqual(['1204', '1201']);
  });

  it('searches every level, most prospects first, hiding empty areas on request', () => {
    const all = searchByCount(tree, 'Tonle', counts, { onlyWithProspects: false, limit: 50 });
    expect(all.results.map((n) => n.name_en)).toContain('Tonle Basak');
    const kak = searchByCount(tree, 'Boeng Kak', counts, { onlyWithProspects: true, limit: 50 });
    expect(kak.results.map((n) => n.code)).toEqual(['120408']);
    expect(kak.hidden).toBeGreaterThan(0);
    const many = searchByCount(tree, 'a', counts, { onlyWithProspects: false, limit: 50 });
    expect(many.results).toHaveLength(50);
    // "Phnom Penh" has no "a"; Chamkar Mon is the match with the most prospects.
    expect(many.results[0]!.code).toBe('1201');
  });

  it('uses the Radar selection rules: siblings merge into the parent', () => {
    let sel = new Set<string>();
    for (const c of tree.byCode.get('1201')!.children) sel = toggleArea(sel, c.code, tree);
    expect([...sel]).toEqual(['1201']);
  });
});
