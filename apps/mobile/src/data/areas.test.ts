import { describe, expect, it } from 'vitest';
import address from '../../../../data/address.json';
import {
  areaLabel,
  buildAreaTree,
  inAreas,
  levelHeading,
  prospectCounts,
  rowMeta,
  searchAreas,
  searchMeta,
  selectionBbox,
  tickOf,
  toggleArea,
  type AddressProvince,
} from './areas';

const tree = buildAreaTree(address as AddressProvince[]);
const at = (code: string) => tree.byCode.get(code)!;
const sorted = (s: Set<string>) => [...s].sort();

// Phnom Penh 12 › Chamkar Mon 1201 › Tonle Basak 120101 (+4 more sangkats).
const CHAMKAR_MON = at('1201').children.map((c) => c.code);

describe('area tree', () => {
  it('nests the whole country', () => {
    expect(tree.roots).toHaveLength(25);
    expect(at('12').children).toHaveLength(14);
    expect(CHAMKAR_MON).toHaveLength(5);
    expect(tree.all[0]!.level).toBe('province');
    expect(tree.all.at(-1)!.level).toBe('commune');
  });

  it('uses capital wording for Phnom Penh only', () => {
    expect(levelHeading(null)).toBe('Provinces & capital');
    expect(levelHeading(at('12'))).toBe('Khans in Phnom Penh');
    expect(levelHeading(at('1201'))).toBe('Sangkats in Chamkar Mon');
    expect(levelHeading(at('02'))).toBe('Districts in Battambang');
    expect(rowMeta(at('1201'), 15)).toBe('5 sangkats · 15 prospects');
    expect(rowMeta(at('1201'), 0)).toBe('5 sangkats');
    expect(rowMeta(at('02'), 1)).toMatch(/^14 districts · \d+ communes · 1 prospect$/);
    expect(searchMeta(at('120101'), 0)).toBe('Sangkat · Chamkar Mon, Phnom Penh');
  });
});

describe('selection', () => {
  it('ticks descendants of a selected area and marks its ancestors partial', () => {
    const sel = new Set(['1201']);
    expect(tickOf(sel, '120101')).toBe('on');
    expect(tickOf(sel, '1201')).toBe('on');
    expect(tickOf(sel, '12')).toBe('partial');
    expect(tickOf(sel, '1202')).toBe('off');
  });

  it('replaces descendants when a parent is ticked', () => {
    const next = toggleArea(new Set(['120101', '120102']), '1201', tree);
    expect(sorted(next)).toEqual(['1201']);
  });

  it('merges into the parent once every sibling is ticked', () => {
    let sel = new Set<string>();
    for (const c of CHAMKAR_MON) sel = toggleArea(sel, c, tree);
    expect(sorted(sel)).toEqual(['1201']);
  });

  it('merges all the way up', () => {
    let sel = new Set<string>();
    for (const d of at('12').children) sel = toggleArea(sel, d.code, tree);
    expect(sorted(sel)).toEqual(['12']);
  });

  it('unticks a directly selected area', () => {
    expect(sorted(toggleArea(new Set(['1201', '1202']), '1201', tree))).toEqual(['1202']);
  });

  it('splits a selected ancestor, keeping the siblings', () => {
    const next = toggleArea(new Set(['1201']), '120101', tree);
    expect(sorted(next)).toEqual(CHAMKAR_MON.filter((c) => c !== '120101').sort());
  });

  it('splits across two levels', () => {
    const next = toggleArea(new Set(['12']), '120101', tree);
    const otherKhans = at('12')
      .children.map((d) => d.code)
      .filter((c) => c !== '1201');
    expect(sorted(next)).toEqual(
      [...otherKhans, ...CHAMKAR_MON.filter((c) => c !== '120101')].sort(),
    );
    expect(tickOf(next, '12')).toBe('partial');
    expect(tickOf(next, '120101')).toBe('off');
  });
});

describe('counts and matching', () => {
  const codes = ['120101', '120101', '120102', '120401', '020101', null];

  it('counts prospects at every level by code prefix', () => {
    const counts = prospectCounts(codes);
    expect(counts.get('120101')).toBe(2);
    expect(counts.get('1201')).toBe(3);
    expect(counts.get('12')).toBe(4);
    expect(counts.get('02')).toBe(1);
  });

  it('matches by prefix, and everything when nothing is selected', () => {
    expect(codes.filter((c) => inAreas(c, ['1201']))).toHaveLength(3);
    expect(codes.filter((c) => inAreas(c, ['1201', '02']))).toHaveLength(4);
    expect(codes.filter((c) => inAreas(c, []))).toHaveLength(6);
  });

  it('labels and frames the selection', () => {
    expect(areaLabel([], tree)).toBe('All areas');
    expect(areaLabel(['1201'], tree)).toBe('Chamkar Mon');
    expect(areaLabel(['1204', '1201', '1202'], tree)).toBe('Chamkar Mon +2');
    const box = selectionBbox(['1201', '1204'], tree)!;
    expect(box[0]).toBe(Math.min(at('1201').bbox[0], at('1204').bbox[0]));
    expect(box[3]).toBe(Math.max(at('1201').bbox[3], at('1204').bbox[3]));
  });
});

describe('search', () => {
  it('finds English names case-insensitively', () => {
    const { results } = searchAreas(tree, 'tonle basak');
    expect(results.map((n) => n.code)).toContain('120101');
  });

  it('finds Khmer names', () => {
    const { results } = searchAreas(tree, 'ទន្លេបាសាក់');
    expect(results.map((n) => n.code)).toContain('120101');
  });

  it('lists provinces, then districts, then communes, capped at 60', () => {
    const { results, total } = searchAreas(tree, 'a');
    expect(total).toBeGreaterThan(60);
    expect(results).toHaveLength(60);
    const order = { province: 0, district: 1, commune: 2 };
    const levels = results.map((n) => order[n.level]);
    expect(levels).toEqual([...levels].sort());
  });
});
