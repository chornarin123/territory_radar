// Area demand: predicted loan demand per commune, for Radar's choropleth.
// Pure helpers, unit-tested in areaDemand.test.ts. The numbers come from
// getAreaDemand() only (useAreaDemand.ts; sample data until the model's output).

import type { AreaNode, AreaTree, BoundaryCollection } from './areas';

export const LOAN_TYPES = [
  'car',
  'home',
  'payroll',
  'songkhoem',
  'sme_soben',
  'personal',
  'trade_finance',
] as const;
export type LoanType = (typeof LOAN_TYPES)[number];

export const LOAN_LABEL: Record<LoanType, string> = {
  car: 'Car loan',
  home: 'Home loan',
  payroll: 'Payroll loan',
  songkhoem: 'Songkhoem',
  sme_soben: 'SME Soben',
  personal: 'Personal loan',
  trade_finance: 'Trade Finance',
};

export interface CommuneDemand {
  /** 0–100: demand for each loan type relative to other communes. */
  score: Record<LoanType, number>;
  /** % share of the commune's own predicted demand; sums to 100. */
  mix: Record<LoanType, number>;
}

export interface AreaDemand {
  sample: boolean;
  scan_date: string;
  loan_types: LoanType[];
  communes: Record<string, CommuneDemand>;
  /** Every province's average commune score, to shade the provinces around one.
   *  Optional: an older server or another data source may not send it. */
  provinces?: Record<string, Record<LoanType, number>>;
}

/** What Area demand draws for one province: demand, sangkat shapes, khan outlines. */
export interface DemandMapData {
  demand: AreaDemand;
  communes: BoundaryCollection;
  outlines: BoundaryCollection;
  /** All 25 provinces, drawn faded around the one in view. */
  provinces: BoundaryCollection;
}

// ─── Shading ─────────────────────────────────────────────────────────────────

/** Five bins: <20, <40, <60, <80, ≥80. */
export const BIN_COLORS = ['#e3eaf5', '#bccde6', '#89a7d4', '#4b72b3', '#1c3a72'] as const;
export const OUTSIDE_COLOR = '#d3d9e1';

export const binOf = (score: number) => Math.min(4, Math.max(0, Math.floor(score / 20)));
export const fillFor = (score: number) => BIN_COLORS[binOf(score)];
/** White text on the two darkest bins, navy on the rest. */
export const lightTextOn = (score: number) => binOf(score) >= 3;

// ─── Names ───────────────────────────────────────────────────────────────────

const ORDINALS: [RegExp, string][] = [
  [/ Ti Muoy$/i, ' 1'],
  [/ Ti Pir$/i, ' 2'],
  [/ Ti Bei$/i, ' 3'],
  [/ Ti Buon$/i, ' 4'],
];

/** "Boeng Kak Ti Muoy" → "Boeng Kak 1": short enough to label a map. */
export function shortName(name: string): string {
  for (const [re, n] of ORDINALS) if (re.test(name)) return name.replace(re, n);
  return name;
}

// ─── Scope ───────────────────────────────────────────────────────────────────

/**
 * What Area demand shows for the shared area filter: a khan/district, or a whole
 * province, plus the commune to focus if one was picked.
 */
export function demandScope(
  sel: readonly string[],
  tree: AreaTree,
  fallbackProvince: string,
): { scope: AreaNode; focus: string | null } {
  const nodes = sel.map((c) => tree.byCode.get(c)).filter((n) => n !== undefined);
  const province = (code: string) => tree.byCode.get(code.slice(0, 2))!;
  if (!nodes.length) {
    const p = tree.byCode.get(fallbackProvince) ?? tree.roots[0]!;
    return { scope: p, focus: null };
  }
  if (nodes.length === 1) {
    const n = nodes[0]!;
    if (n.level === 'commune') return { scope: n.parent!, focus: n.code };
    return { scope: n, focus: null };
  }
  const districts = new Set(nodes.map((n) => n.code.slice(0, 4)));
  if (districts.size === 1 && nodes.every((n) => n.code.length >= 4)) {
    return { scope: tree.byCode.get([...districts][0]!)!, focus: null };
  }
  return { scope: province(nodes[0]!.code), focus: null };
}

/** Communes inside the scope, at any depth. */
export function communesIn(scope: AreaNode): AreaNode[] {
  if (scope.level === 'commune') return [scope];
  return scope.children.flatMap(communesIn);
}

/** Communes in scope with demand data, highest score for `type` first. */
export function rankCommunes(
  communes: AreaNode[],
  demand: AreaDemand,
  type: LoanType,
): { node: AreaNode; score: number }[] {
  return communes
    .filter((n) => demand.communes[n.code])
    .map((n) => ({ node: n, score: demand.communes[n.code]!.score[type] }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        // Rounded scores tie at the top: the bigger share still ranks first.
        demand.communes[b.node.code]!.mix[type] - demand.communes[a.node.code]!.mix[type] ||
        a.node.name_en.localeCompare(b.node.name_en),
    );
}

/** Average score of the communes with data, rounded; null when none have any. */
export function averageScore(
  communes: AreaNode[],
  demand: AreaDemand,
  type: LoanType,
): number | null {
  const scores = communes
    .map((n) => demand.communes[n.code]?.score[type])
    .filter((s) => s !== undefined);
  return scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
}

/** A commune's loan mix, largest share first. */
export function mixRows(d: CommuneDemand): { type: LoanType; pct: number }[] {
  return LOAN_TYPES.map((type) => ({ type, pct: d.mix[type] ?? 0 })).sort((a, b) => b.pct - a.pct);
}

/** Bar width for a mix share: the share itself, so 25% fills a quarter of the bar. */
export const mixBarWidth = (pct: number) => Math.max(0, Math.min(100, pct));

/**
 * What a score means in words. A score ranks this loan type's share of an area's
 * demand (`pct`) against its share in every commune in Cambodia.
 */
export function scoreMeaning(score: number, pct: number, label: string): string {
  const share = `${label} is ${pct}% of predicted loan demand here`;
  if (score >= 100) return `${share}, one of the biggest shares of any area in Cambodia.`;
  if (score <= 0) return `${share}, one of the smallest shares of any area in Cambodia.`;
  return `${share}, a bigger share than in ${score}% of areas in Cambodia.`;
}
