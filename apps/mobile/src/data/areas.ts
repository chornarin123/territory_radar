// Cambodia's provinces → districts → communes for the area filter. Pure functions,
// unit-tested in areas.test.ts. Codes nest by prefix: "12" ⊃ "1201" ⊃ "120101".

export interface AddressArea {
  code: string;
  name_en: string;
  name_km: string;
  lat: number;
  lng: number;
  /** [minLng, minLat, maxLng, maxLat] */
  bbox: [number, number, number, number];
  geo_quality: string;
}
export type AddressCommune = AddressArea;
export interface AddressDistrict extends AddressArea {
  communes: AddressCommune[];
}
export interface AddressProvince extends AddressArea {
  districts: AddressDistrict[];
}

export type BoundaryLevel = 'provinces' | 'districts' | 'communes';
export interface BoundaryFeature {
  type: 'Feature';
  properties: { code: string; name_en: string };
  geometry: unknown;
}
export interface BoundaryCollection {
  type: 'FeatureCollection';
  features: BoundaryFeature[];
}

export type AreaLevel = 'province' | 'district' | 'commune';
export interface AreaNode extends AddressArea {
  level: AreaLevel;
  parent: AreaNode | null;
  children: AreaNode[];
}
export interface AreaTree {
  roots: AreaNode[];
  byCode: Map<string, AreaNode>;
  /** Provinces, then districts, then communes: the search order. */
  all: AreaNode[];
}

export function buildAreaTree(provinces: AddressProvince[]): AreaTree {
  const byCode = new Map<string, AreaNode>();
  const levels: AreaNode[][] = [[], [], []];
  const node = (a: AddressArea, level: AreaLevel, parent: AreaNode | null): AreaNode => {
    const { code, name_en, name_km, lat, lng, bbox, geo_quality } = a;
    const n: AreaNode = {
      code,
      name_en,
      name_km,
      lat,
      lng,
      bbox,
      geo_quality,
      level,
      parent,
      children: [],
    };
    byCode.set(code, n);
    levels[code.length / 2 - 1]!.push(n);
    return n;
  };
  const roots = provinces.map((p) => {
    const pn = node(p, 'province', null);
    pn.children = p.districts.map((d) => {
      const dn = node(d, 'district', pn);
      dn.children = d.communes.map((c) => node(c, 'commune', dn));
      return dn;
    });
    return pn;
  });
  return { roots, byCode, all: levels.flat() };
}

/** Boundary file for an area code: 2 digits province, 4 district, 6 commune. */
export const boundaryLevelOf = (code: string): BoundaryLevel =>
  code.length === 2 ? 'provinces' : code.length === 4 ? 'districts' : 'communes';

// ─── Wording ─────────────────────────────────────────────────────────────────
// Phnom Penh is the Capital, split into khans and sangkats; every other
// province into districts and communes.

const isCapital = (code: string) => code.startsWith('12');

const NOUNS = {
  capital: { province: 'Capital', district: 'Khan', commune: 'Sangkat' },
  province: { province: 'Province', district: 'District', commune: 'Commune' },
} as const;

export const kindOf = (n: AreaNode): string =>
  NOUNS[isCapital(n.code) ? 'capital' : 'province'][n.level];

/** "1 sangkat", "5 sangkats". */
export function countOf(n: number, level: AreaLevel, code: string): string {
  const noun = NOUNS[isCapital(code) ? 'capital' : 'province'][level].toLowerCase();
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

export const prospectsText = (n: number) => `${n} prospect${n === 1 ? '' : 's'}`;

/** Heading over a level's list: "Khans in Phnom Penh". */
export function levelHeading(current: AreaNode | null): string {
  if (!current) return 'Provinces & capital';
  const child = current.level === 'province' ? 'district' : 'commune';
  return `${NOUNS[isCapital(current.code) ? 'capital' : 'province'][child]}s in ${current.name_en}`;
}

/** Meta line for a row: "14 khans · 105 sangkats · 29 prospects". */
export function rowMeta(n: AreaNode, prospects: number): string {
  const parts: string[] = [];
  if (n.level === 'province') {
    parts.push(countOf(n.children.length, 'district', n.code));
    const communes = n.children.reduce((sum, d) => sum + d.children.length, 0);
    parts.push(countOf(communes, 'commune', n.code));
  } else if (n.level === 'district') {
    parts.push(countOf(n.children.length, 'commune', n.code));
  }
  if (prospects) parts.push(prospectsText(prospects));
  return parts.join(' · ');
}

/** Meta line for a search result: "Sangkat · Chamkar Mon, Phnom Penh". */
export function searchMeta(n: AreaNode, prospects: number): string {
  const parents: string[] = [];
  for (let p = n.parent; p; p = p.parent) parents.push(p.name_en);
  const kind = parents.length ? `${kindOf(n)} · ${parents.join(', ')}` : kindOf(n);
  return prospects ? `${kind} · ${prospectsText(prospects)}` : kind;
}

// ─── Selection: a set of codes at any level ──────────────────────────────────

export type Tick = 'on' | 'partial' | 'off';

const ancestorCodes = (code: string) =>
  [2, 4].filter((len) => len < code.length).map((len) => code.slice(0, len));

/** On if the code or an ancestor is selected; partial if a descendant is. */
export function tickOf(sel: ReadonlySet<string>, code: string): Tick {
  if (sel.has(code) || ancestorCodes(code).some((a) => sel.has(a))) return 'on';
  for (const c of sel) if (c.length > code.length && c.startsWith(code)) return 'partial';
  return 'off';
}

export function toggleArea(sel: ReadonlySet<string>, code: string, tree: AreaTree): Set<string> {
  const next = new Set(sel);
  const node = tree.byCode.get(code);
  if (!node) return next;

  if (tickOf(sel, code) !== 'on') {
    // Select it whole, then merge upward while every sibling is selected too.
    for (const c of sel) if (c.length > code.length && c.startsWith(code)) next.delete(c);
    next.add(code);
    for (let n = node; n.parent; n = n.parent) {
      if (!n.parent.children.every((s) => next.has(s.code))) break;
      for (const s of n.parent.children) next.delete(s.code);
      next.add(n.parent.code);
    }
    return next;
  }

  if (next.has(code)) {
    next.delete(code);
    return next;
  }

  // On through a selected ancestor: split it, keeping every sibling on the way
  // down. Chamkar Mon selected, untick Tonle Basak → its 4 siblings stay.
  const owner = ancestorCodes(code).find((a) => next.has(a))!;
  next.delete(owner);
  for (let n = tree.byCode.get(owner)!; n.code !== code;) {
    const step = n.children.find((c) => code.startsWith(c.code))!;
    for (const c of n.children) if (c !== step) next.add(c.code);
    n = step;
  }
  return next;
}

/** No selection means everywhere; an unlocated prospect is in no area. */
export const inAreas = (communeCode: string | null, sel: readonly string[]): boolean =>
  !sel.length || (!!communeCode && sel.some((c) => communeCode.startsWith(c)));

/** Prospects per area code, at every level, from their commune codes. */
export function prospectCounts(communeCodes: (string | null)[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const c of communeCodes) {
    if (!c) continue;
    for (const key of [c.slice(0, 2), c.slice(0, 4), c])
      counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** Header button label: "All areas", "Chamkar Mon", "Chamkar Mon +2". */
export function areaLabel(sel: readonly string[], tree: AreaTree | null): string {
  if (!sel.length) return 'All areas';
  const first = [...sel].sort()[0]!;
  const name = tree?.byCode.get(first)?.name_en;
  if (!name) return `${sel.length} area${sel.length === 1 ? '' : 's'}`;
  return sel.length === 1 ? name : `${name} +${sel.length - 1}`;
}

/** Union of the selected areas' bounding boxes, for framing the map. */
export function selectionBbox(
  sel: readonly string[],
  tree: AreaTree,
): [number, number, number, number] | null {
  const boxes = sel.map((c) => tree.byCode.get(c)?.bbox).filter((b) => b !== undefined);
  if (!boxes.length) return null;
  return [
    Math.min(...boxes.map((b) => b[0])),
    Math.min(...boxes.map((b) => b[1])),
    Math.max(...boxes.map((b) => b[2])),
    Math.max(...boxes.map((b) => b[3])),
  ];
}

// ─── Search ──────────────────────────────────────────────────────────────────

export const SEARCH_LIMIT = 60;

/**
 * English names match case-insensitively, Khmer names as an exact substring.
 * Provinces first, then districts, then communes; at most SEARCH_LIMIT shown.
 */
export function searchAreas(tree: AreaTree, query: string): { results: AreaNode[]; total: number } {
  const q = query.trim();
  if (!q) return { results: [], total: 0 };
  const lower = q.toLowerCase();
  const hits = tree.all.filter(
    (n) => n.name_en.toLowerCase().includes(lower) || (n.name_km ?? '').includes(q),
  );
  return { results: hits.slice(0, SEARCH_LIMIT), total: hits.length };
}
