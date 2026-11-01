// Pure functions over the workspace: no React, no I/O. Unit-tested in selectors.test.ts.

import {
  STAGE_STATUSES,
  productShortName,
  signalGroupOf,
  type SignalGroup,
  type Stage,
} from './labels';
import { inAreas } from './areas';
import type {
  InterestStatus,
  PriorityBand,
  Product,
  Prospect,
  ProspectStatus,
  Signal,
  Workspace,
} from './types';

/** One prospect with everything a list row, pin or filter needs, resolved once. */
export interface ProspectView {
  p: Prospect;
  id: string;
  name: string;
  status: ProspectStatus;
  score: number;
  band: PriorityBand;
  interest: InterestStatus;
  commune: string;
  /** Official commune code the pin falls in; null without a location. */
  communeCode: string | null;
  /** First seen since the last scan, still new, and not marked "Not relevant". */
  isNewLead: boolean;
  /** First signal that is not a directory listing — the one worth talking about. */
  signal: Signal | null;
  signalGroup: SignalGroup | null;
  product: Product | null;
  /** Newest signal date, for "Newest signal" sorting. */
  latestSignalAt: string;
}

export function buildProspectViews(ws: Workspace): ProspectView[] {
  const area = new Map(ws.administrativeAreas.map((a) => [a.id, a]));
  const product = new Map(ws.products.map((p) => [p.id, p]));
  const signalsBy = groupBy(ws.signals, (s) => s.prospectId);
  const matchBy = new Map(
    ws.productMatches.filter((m) => m.rank === 1).map((m) => [m.prospectId, m]),
  );

  return ws.prospects.map((p) => {
    const sigs = signalsBy.get(p.id) ?? [];
    const signal = sigs.find((s) => s.type !== 'directory_presence') ?? null;
    const match = matchBy.get(p.id);
    return {
      p,
      id: p.id,
      name: p.displayName,
      status: p.pipelineStatus,
      score: p.priority.score,
      band: p.priority.band,
      interest: p.financing.interestStatus,
      commune:
        p.address.communeName ||
        (p.address.communeId && area.get(p.address.communeId)?.nameEn) ||
        '—',
      communeCode: p.address.communeCode ?? null,
      isNewLead:
        p.pipelineStatus === 'new' &&
        !p.lead_feedback &&
        Date.parse(p.first_seen_at) >= Date.parse(ws.metadata.lastScanAt),
      signal,
      signalGroup: signal ? signalGroupOf(signal.type) : null,
      product: (match && product.get(match.productId)) || null,
      latestSignalAt: sigs.reduce((max, s) => (s.detectedAt > max ? s.detectedAt : max), ''),
    };
  });
}

export const productName = (v: ProspectView) =>
  v.product ? productShortName(v.product.name) : '—';
export const isStale = (v: ProspectView) =>
  v.signal?.freshness === 'stale' || v.p.dataQuality.flags.includes('stale_evidence');

// ─── Filters (shared by Filters, Prospects and Radar) ─────────────────────────

export type SortKey = 'priority' | 'fresh' | 'name';

export interface FilterState {
  area: string[]; // area codes at any level: "12", "1201", "120101"
  prod: string[]; // product ids
  sig: SignalGroup[];
  stage: Stage[];
  band: PriorityBand[];
  int: InterestStatus[];
  hideFlag: boolean;
  fresh: boolean;
  pinned: boolean;
  /** Set by the "Needs checking" quick view: flagged or stale prospects only. */
  needsCheck: boolean;
  /** Only leads first seen since the last scan (Today's "New to review"). */
  newLeads: boolean;
  sort: SortKey;
}

export const EMPTY_FILTERS: FilterState = {
  area: [],
  prod: [],
  sig: [],
  stage: [],
  band: [],
  int: [],
  hideFlag: false,
  fresh: false,
  pinned: false,
  needsCheck: false,
  newLeads: false,
  sort: 'priority',
};

export type ChipGroup = 'area' | 'prod' | 'sig' | 'stage' | 'band' | 'int';

/**
 * Does `v` pass every active filter? `skip` ignores one chip group — that is how
 * each chip's count is "what this group would leave given the OTHER filters"
 * (spec §3.4): selecting more in a group widens it, so its own selection must not
 * shrink its own counts.
 */
export function matchesFilters(v: ProspectView, f: FilterState, skip?: ChipGroup): boolean {
  if (skip !== 'area' && !inAreas(v.communeCode, f.area)) return false;
  if (skip !== 'prod' && f.prod.length && !(v.product && f.prod.includes(v.product.id)))
    return false;
  if (skip !== 'sig' && f.sig.length && !(v.signalGroup && f.sig.includes(v.signalGroup)))
    return false;
  if (
    skip !== 'stage' &&
    f.stage.length &&
    !f.stage.some((g) => STAGE_STATUSES[g].includes(v.status))
  )
    return false;
  if (skip !== 'band' && f.band.length && !f.band.includes(v.band)) return false;
  if (skip !== 'int' && f.int.length && !f.int.includes(v.interest)) return false;
  if (f.hideFlag && v.p.dataQuality.flags.length) return false;
  if (f.fresh && isStale(v)) return false;
  if (f.pinned && !v.p.location) return false;
  if (f.needsCheck && !(v.p.dataQuality.flags.length || isStale(v))) return false;
  if (f.newLeads && !v.isNewLead) return false;
  return true;
}

/** Count per option of one chip group, given every other active filter. */
export function chipCounts<T extends string>(
  views: ProspectView[],
  f: FilterState,
  group: ChipGroup,
  options: readonly T[],
  test: (v: ProspectView, option: T) => boolean,
  base: (v: ProspectView) => boolean = () => true,
): Record<T, number> {
  const pool = views.filter((v) => base(v) && matchesFilters(v, f, group));
  return Object.fromEntries(
    options.map((o) => [o, pool.filter((v) => test(v, o)).length]),
  ) as Record<T, number>;
}

export function activeFilterCount(f: FilterState): number {
  return (
    f.area.length +
    f.prod.length +
    f.sig.length +
    f.stage.length +
    f.band.length +
    f.int.length +
    [f.hideFlag, f.fresh, f.pinned, f.needsCheck, f.newLeads].filter(Boolean).length
  );
}

export function sortViews(views: ProspectView[], sort: SortKey): ProspectView[] {
  const byName = (a: ProspectView, b: ProspectView) => a.name.localeCompare(b.name);
  const byScore = (a: ProspectView, b: ProspectView) => b.score - a.score || byName(a, b);
  const cmp =
    sort === 'name'
      ? byName
      : sort === 'fresh'
        ? (a: ProspectView, b: ProspectView) =>
            b.latestSignalAt.localeCompare(a.latestSignalAt) || byScore(a, b)
        : byScore;
  return [...views].sort(cmp);
}

// ─── Prospects-screen quick controls ──────────────────────────────────────────

export type ListStatus = 'active' | ProspectStatus | 'closedset';

export interface ListControls {
  status: ListStatus;
  /** "Priority ≥ N" toggle; N = settings.defaultProspectFilter.minScore. */
  minScoreOn: boolean;
  minScore: number;
  /** "Hide no-need" toggle (settings.excludeNotInterestedFromRecommendations). */
  hideNoNeed: boolean;
}

export function matchesListControls(v: ProspectView, c: ListControls): boolean {
  if (c.status === 'active') {
    if (v.status === 'closed') return false;
  } else if (c.status === 'closedset') {
    if (v.status !== 'closed' && v.status !== 'not_interested') return false;
  } else if (v.status !== c.status) {
    return false;
  }
  if (c.minScoreOn && v.score < c.minScore) return false;
  // Viewing the closed set means asking for no-need prospects, so don't hide them.
  if (c.hideNoNeed && c.status !== 'closedset' && v.status === 'not_interested') return false;
  return true;
}

/** Radar shows live prospects only: closed and no-need are excluded (spec §3.2). */
export const isOnRadar = (v: ProspectView) =>
  v.status !== 'closed' && v.status !== 'not_interested';

// ─── Quick views (Filters screen) ─────────────────────────────────────────────

export const QUICK_VIEWS: { id: string; label: string; sub: string; filters: FilterState }[] = [
  {
    id: 'new',
    label: 'New to review',
    sub: 'New · high · unconfirmed',
    filters: { ...EMPTY_FILTERS, stage: ['open'], band: ['high'], int: ['unknown'] },
  },
  {
    id: 'ready',
    label: 'Ready to visit',
    sub: 'Interest confirmed · pinned',
    filters: { ...EMPTY_FILTERS, int: ['confirmed'], pinned: true, stage: ['open', 'visit'] },
  },
  {
    id: 'check',
    label: 'Needs checking',
    sub: 'Flagged or stale data',
    filters: { ...EMPTY_FILTERS, needsCheck: true },
  },
  {
    id: 'trade',
    label: 'Trade & stock',
    sub: 'Trade / working capital',
    // Working Capital and Trade Finance in data.json.
    filters: {
      ...EMPTY_FILTERS,
      prod: ['product_001', 'product_006'],
      stage: ['open', 'visit', 'referred'],
    },
  },
];

export const sameFilters = (a: FilterState, b: FilterState) =>
  JSON.stringify(a) === JSON.stringify(b);

function groupBy<T, K>(items: T[], key: (t: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const it of items) {
    const k = key(it);
    const list = m.get(k);
    if (list) list.push(it);
    else m.set(k, [it]);
  }
  return m;
}
