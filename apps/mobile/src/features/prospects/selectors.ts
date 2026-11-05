// Prospects screen: what the officer should do next with each prospect, and how
// the list is grouped and sorted. Pure functions; tested in selectors.test.ts.
// A score is a visit priority, never a loan probability, so nothing here turns
// it into a percentage.

import { productShortName, sectorLabel, signalGroupOf } from '../../data/labels';
import type { ProspectTab, ProspectView, SortKey } from '../../data/selectors';
import { localDay, shortDate } from '../../data/time';
import type { LatLng, ProspectStatus, Task, Workspace } from '../../data/types';
import { haversine } from '../../data/visitPlan';

/** The fixed demo clock when metadata.fixedClock is set, else the real time. */
export const nowOf = (ws: Pick<Workspace, 'metadata'>, real = new Date()) =>
  ws.metadata.fixedClock ? ws.metadata.asOf : real.toISOString();

// ─── Next action ─────────────────────────────────────────────────────────────

export type Tone = 'overdue' | 'today' | 'visit' | 'neutral' | 'muted';
export interface NextAction {
  tone: Tone;
  text: string;
}

export interface ActionContext {
  /** "2026-10-15", the officer's day in Phnom Penh time. */
  today: string;
  /** Prospect id → "10:00", for visits planned today. */
  visitTimes: ReadonlyMap<string, string>;
  /** Open tasks, by prospect id. */
  tasks: ReadonlyMap<string, Task[]>;
}

const DAY_MS = 86_400_000;
const nextDay = (day: string) => new Date(Date.parse(day) + DAY_MS).toISOString().slice(0, 10);

const BY_STATUS: Partial<Record<ProspectStatus, NextAction>> = {
  qualified: { tone: 'neutral', text: 'Plan a visit' },
  contacted: { tone: 'neutral', text: 'Ask whether financing is needed' },
  application_referred: { tone: 'neutral', text: 'Waiting on referral' },
  not_interested: { tone: 'muted', text: 'No financing need recorded' },
  closed: { tone: 'muted', text: 'Closed' },
};

/**
 * The one thing to do next: a visit today, then the earliest open task, then
 * what the pipeline stage calls for.
 */
export function nextAction(v: ProspectView, ctx: ActionContext): NextAction {
  const time = ctx.visitTimes.get(v.id);
  if (time) return { tone: 'visit', text: `Visit today at ${time}` };

  const task = [...(ctx.tasks.get(v.id) ?? [])]
    .filter((t) => t.status === 'open')
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0];
  if (task) {
    const due = localDay(task.dueAt);
    if (due < ctx.today)
      return { tone: 'overdue', text: `Follow-up overdue · due ${shortDate(task.dueAt)}` };
    if (due === ctx.today) {
      return {
        tone: 'today',
        text:
          task.type === 'check_referral' ? 'Check referral status today' : 'Follow-up due today',
      };
    }
    if (due === nextDay(ctx.today)) return { tone: 'neutral', text: 'Follow-up due tomorrow' };
  }

  if (v.status === 'new') {
    return {
      tone: 'neutral',
      text: v.p.dataQuality.flags.length
        ? 'Verify data, then make first contact'
        : 'Make first contact',
    };
  }
  return BY_STATUS[v.status] ?? { tone: 'neutral', text: 'Plan a visit' };
}

export const needsActionToday = (a: NextAction) =>
  a.tone === 'overdue' || a.tone === 'today' || a.tone === 'visit';

// ─── Stage, distance ─────────────────────────────────────────────────────────

export type Stage = 'new' | 'working' | 'referred' | 'closed';

export function stageOf(status: ProspectStatus): Stage {
  if (status === 'new') return 'new';
  if (status === 'application_referred') return 'referred';
  if (status === 'not_interested' || status === 'closed') return 'closed';
  return 'working';
}

/** Straight-line km from the branch, to 1 decimal; null without a pin or branch. */
export function distanceKm(location: LatLng | null, from: LatLng | null): number | null {
  if (!location || !from) return null;
  return Math.round(haversine(from, location) / 100) / 10;
}

// ─── Card text ───────────────────────────────────────────────────────────────

const CATEGORY: Record<string, string> = {
  exp: 'EXPANSION',
  equip: 'EQUIPMENT',
  stock: 'STOCK & TRADE',
  newbiz: 'NEW OPENING',
  housing_project: 'HOUSING',
  new_employer: 'EMPLOYER',
};

/** "EQUIPMENT", from the signal type. */
export function signalCategory(type: string): string {
  return CATEGORY[type] ?? CATEGORY[signalGroupOf(type) ?? ''] ?? 'SIGNAL';
}

/** "Retail · Tonle Basak · 1.2 km", or "· no map pin". */
export function metaLine(v: ProspectView, km: number | null): string {
  return [
    sectorLabel(v.p.sector),
    v.commune,
    km === null ? 'no map pin' : `${km.toFixed(1)} km`,
  ].join(' · ');
}

export const discussLabel = (v: ProspectView) =>
  v.product ? `Discuss: ${productShortName(v.product.name)}` : null;

// ─── Rows, tabs, sections ────────────────────────────────────────────────────

export interface ProspectRow {
  v: ProspectView;
  km: number | null;
  action: NextAction;
  stage: Stage;
  today: boolean;
}

export function buildRows(
  views: readonly ProspectView[],
  ctx: ActionContext,
  from: LatLng | null,
): ProspectRow[] {
  return views.map((v) => {
    const action = nextAction(v, ctx);
    return {
      v,
      km: distanceKm(v.p.location, from),
      action,
      stage: stageOf(v.status),
      today: needsActionToday(action),
    };
  });
}

export function inTab(r: ProspectRow, tab: ProspectTab): boolean {
  switch (tab) {
    case 'all':
      return r.stage !== 'closed';
    case 'today':
      return r.today;
    case 'new':
      return r.stage === 'new';
    case 'working':
      return r.stage === 'working';
    case 'referred':
      return r.stage === 'referred';
    case 'closed':
      return r.stage === 'closed';
  }
}

export const TAB_LABEL: Record<ProspectTab, string> = {
  all: 'All',
  today: 'Action today',
  new: 'New',
  working: 'In progress',
  referred: 'Referred',
  closed: 'Closed',
};

export function tabCounts(rows: readonly ProspectRow[]): Record<ProspectTab, number> {
  const tabs = Object.keys(TAB_LABEL) as ProspectTab[];
  return Object.fromEntries(tabs.map((t) => [t, rows.filter((r) => inTab(r, t)).length])) as Record<
    ProspectTab,
    number
  >;
}

export function sortRows(rows: readonly ProspectRow[], sort: SortKey): ProspectRow[] {
  const byName = (a: ProspectRow, b: ProspectRow) => a.v.name.localeCompare(b.v.name);
  // No pin sorts last.
  const byKm = (a: ProspectRow, b: ProspectRow) => (a.km ?? Infinity) - (b.km ?? Infinity);
  const cmp =
    sort === 'name'
      ? byName
      : sort === 'nearest'
        ? (a: ProspectRow, b: ProspectRow) => byKm(a, b) || b.v.score - a.v.score || byName(a, b)
        : sort === 'fresh'
          ? (a: ProspectRow, b: ProspectRow) =>
              b.v.latestSignalAt.localeCompare(a.v.latestSignalAt) || byName(a, b)
          : (a: ProspectRow, b: ProspectRow) => b.v.score - a.v.score || byKm(a, b) || byName(a, b);
  return [...rows].sort(cmp);
}

export interface Section {
  key: string;
  title: string;
  hint: string | null;
  data: ProspectRow[];
}

/**
 * All: needs action today, new, in progress, referred; each prospect appears
 * once, and "today" wins. Any other tab is one section.
 */
export function sections(rows: readonly ProspectRow[], tab: ProspectTab, sort: SortKey): Section[] {
  if (tab !== 'all') {
    const data = sortRows(
      rows.filter((r) => inTab(r, tab)),
      sort,
    );
    return data.length ? [{ key: tab, title: TAB_LABEL[tab], hint: null, data }] : [];
  }
  const live = rows.filter((r) => r.stage !== 'closed');
  const groups: Section[] = [
    {
      key: 'today',
      title: 'Needs action today',
      hint: 'Do these first',
      data: live.filter((r) => r.today),
    },
    {
      key: 'new',
      title: 'New to review',
      hint: 'First contact',
      data: live.filter((r) => !r.today && r.stage === 'new'),
    },
    {
      key: 'working',
      title: 'In progress',
      hint: null,
      data: live.filter((r) => !r.today && r.stage === 'working'),
    },
    {
      key: 'referred',
      title: 'Referred',
      hint: 'Waiting on application',
      data: live.filter((r) => !r.today && r.stage === 'referred'),
    },
  ];
  return groups.filter((g) => g.data.length).map((g) => ({ ...g, data: sortRows(g.data, sort) }));
}

/** "Showing priority ≥ 60, hiding no-need", or "No filters applied". */
export function summaryText(minScoreOn: boolean, minScore: number, hideNoNeed: boolean): string {
  if (minScoreOn) return `Showing priority ≥ ${minScore}${hideNoNeed ? ', hiding no-need' : ''}`;
  return hideNoNeed ? 'Hiding no-need' : 'No filters applied';
}

export const SORT_ORDER: SortKey[] = ['priority', 'nearest', 'name'];
export const SORT_LABEL: Record<SortKey, string> = {
  priority: 'Priority',
  nearest: 'Nearest',
  name: 'Name',
  fresh: 'Newest',
};
/** Priority → Nearest → Name → Priority. "Newest" (from Filters) goes to Priority. */
export const nextSort = (s: SortKey): SortKey =>
  SORT_ORDER[(SORT_ORDER.indexOf(s) + 1) % SORT_ORDER.length]!;
