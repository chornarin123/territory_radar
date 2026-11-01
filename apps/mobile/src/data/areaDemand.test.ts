import { describe, expect, it } from 'vitest';
import address from '../../../../data/address.json';
import sample from '../../../../data/area_demand.json';
import {
  BIN_COLORS,
  LOAN_TYPES,
  averageScore,
  binOf,
  communesIn,
  demandScope,
  fillFor,
  lightTextOn,
  mixBarWidth,
  mixRows,
  rankCommunes,
  shortName,
  type AreaDemand,
} from './areaDemand';
import { buildAreaTree, type AddressProvince } from './areas';

const tree = buildAreaTree(address as AddressProvince[]);
// The file as the generator writes it; the server adds the province averages.
const demand = { ...(sample as unknown as AreaDemand), provinces: {} } as AreaDemand;

describe('sample demand file', () => {
  it('is marked as sample and covers every commune', () => {
    expect(demand.sample).toBe(true);
    expect(demand.loan_types).toEqual([...LOAN_TYPES]);
    const communes = tree.all.filter((n) => n.level === 'commune');
    expect(communes.every((c) => demand.communes[c.code])).toBe(true);
  });

  it('has scores 0–100 and a mix summing to 100 in every commune', () => {
    for (const d of Object.values(demand.communes)) {
      expect(Object.values(d.mix).reduce((a, b) => a + b, 0)).toBe(100);
      expect(Object.values(d.score).every((s) => s >= 0 && s <= 100)).toBe(true);
    }
  });
});

describe('shading', () => {
  it('bins scores in fifths, with light text on the two darkest', () => {
    expect([0, 19, 20, 59, 60, 79, 80, 100].map(binOf)).toEqual([0, 0, 1, 2, 3, 3, 4, 4]);
    expect(fillFor(85)).toBe(BIN_COLORS[4]);
    expect(lightTextOn(59)).toBe(false);
    expect(lightTextOn(60)).toBe(true);
  });

  it('caps mix bars at full width', () => {
    expect(mixBarWidth(12)).toBe(36);
    expect(mixBarWidth(40)).toBe(100);
  });
});

describe('names', () => {
  it('shortens Ti Muoy … Ti Buon to numbers', () => {
    expect(shortName('Boeng Kak Ti Muoy')).toBe('Boeng Kak 1');
    expect(shortName('Tuol Tumpung Ti Pir')).toBe('Tuol Tumpung 2');
    expect(shortName('Tonle Basak')).toBe('Tonle Basak');
  });
});

describe('scope', () => {
  it('falls back to the province when nothing is selected', () => {
    const { scope, focus } = demandScope([], tree, '12');
    expect(scope.code).toBe('12');
    expect(focus).toBeNull();
  });

  it('shows the khan of a picked sangkat, focused on it', () => {
    const { scope, focus } = demandScope(['120101'], tree, '12');
    expect(scope.code).toBe('1201');
    expect(focus).toBe('120101');
  });

  it('keeps a khan, or widens mixed picks to the province', () => {
    expect(demandScope(['1208'], tree, '12').scope.code).toBe('1208');
    expect(demandScope(['120101', '120102'], tree, '12').scope.code).toBe('1201');
    expect(demandScope(['1201', '1204'], tree, '12').scope.code).toBe('12');
  });

  it('lists every sangkat of the khan, with or without a polygon', () => {
    // Saensokh: 6 sangkats in address.json, 2 of them points only.
    expect(communesIn(tree.byCode.get('1208')!).map((n) => n.code)).toHaveLength(6);
    expect(communesIn(tree.byCode.get('12')!)).toHaveLength(105);
  });
});

describe('ranking', () => {
  const khan = communesIn(tree.byCode.get('1201')!);

  it('ranks by the chosen loan type, highest first', () => {
    for (const type of LOAN_TYPES) {
      const ranked = rankCommunes(khan, demand, type);
      expect(ranked).toHaveLength(khan.length);
      expect(ranked.map((r) => r.score)).toEqual(
        [...ranked.map((r) => r.score)].sort((a, b) => b - a),
      );
    }
  });

  it('re-ranks when the loan type changes', () => {
    const ranks = LOAN_TYPES.map((t) =>
      rankCommunes(khan, demand, t)
        .map((r) => r.node.code)
        .join(),
    );
    expect(new Set(ranks).size).toBeGreaterThan(1);
  });

  it('averages a khan’s scores for its zoomed-out label', () => {
    const scores = khan.map((n) => demand.communes[n.code]!.score.car);
    const mean = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    expect(averageScore(khan, demand, 'car')).toBe(mean);
    expect(averageScore([], demand, 'car')).toBeNull();
  });

  it('sorts the mix largest first', () => {
    const rows = mixRows(demand.communes['120101']!);
    expect(rows).toHaveLength(7);
    expect(rows.map((r) => r.pct)).toEqual([...rows.map((r) => r.pct)].sort((a, b) => b - a));
  });
});
