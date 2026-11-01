// Today screen logic: what the officer should do next, derived from the same
// workspace and visit plan the other tabs use. Pure; tested in today.test.ts.

import type { LoanType } from './areaDemand';
import { isOnRadar, type ProspectView } from './selectors';
import { localDay } from './time';
import type { Workspace } from './types';
import { haversine, nearestNeighbourOrder, type Point } from './visitPlan';

export interface AreaPulse {
  communeCode: string;
  name: string;
  loanType: LoanType;
  oldScore: number;
  newScore: number;
  reason: string | null;
  sample: boolean;
}

/** Today's server route as prospect ids: the plan until the officer changes it. */
export function seedPlanIds(ws: Workspace, today: string): string[] {
  const route = ws.routePlans.find((r) => r.date === today);
  if (!route) return [];
  const byId = new Map(ws.visits.map((v) => [v.id, v.prospectId]));
  return route.visitIds.map((id) => byId.get(id)).filter((id) => id !== undefined);
}

/** The plan's stops in route order, as the Visits route shows them. */
export function routeOrder<T extends Point & { id: string }>(
  plan: { ids: string[]; optimized: boolean },
  candidates: readonly T[],
  start: Point | null,
): T[] {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const planned = plan.ids.map((id) => byId.get(id)).filter((c) => c !== undefined);
  return plan.optimized && start ? nearestNeighbourOrder(start, planned) : planned;
}

/** The first stop not checked in, with its slot in the route and what follows it. */
export function nextStop<T extends { id: string }>(order: readonly T[], checkedIn: string[]) {
  const done = new Set(checkedIn);
  const index = order.findIndex((s) => !done.has(s.id));
  if (index < 0) return null;
  return {
    stop: order[index]!,
    index,
    remaining: order.slice(index + 1).filter((s) => !done.has(s.id)).length,
  };
}

/** The planned stop closest to `point`; the first stop if `point` is unknown. */
export function nearestStop<T extends Point>(stops: readonly T[], point: Point | null): T | null {
  if (!stops.length) return null;
  if (!point) return stops[0]!;
  return stops.reduce((best, s) => (haversine(point, s) < haversine(point, best) ? s : best));
}

export const directionsUrl = ({ lat, lng }: Point) =>
  `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

const DAY_MS = 86_400_000;

/** Whole days between two timestamps, by Phnom Penh calendar day. */
export const daysAgo = (iso: string, now: string) =>
  Math.round((Date.parse(localDay(now)) - Date.parse(localDay(iso))) / DAY_MS);

export const ageText = (days: number) =>
  days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;

/** "2026-10-16": a calendar day plus `n` days. */
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(day) + n * DAY_MS).toISOString().slice(0, 10);
}

/** "Equipment upgrade mentioned 10 days ago." */
export function whyNowText(v: ProspectView, now: string): string | null {
  if (!v.p.why_now) return null;
  return v.signal
    ? `${v.p.why_now} ${ageText(daysAgo(v.signal.detectedAt, now))}.`
    : `${v.p.why_now}.`;
}

// ─── Needs your action ───────────────────────────────────────────────────────

export type ActionKind = 'overdue' | 'signal' | 'check';

export interface ActionItem {
  key: string;
  kind: ActionKind;
  title: string;
  body: string;
  prospectId: string | null;
  taskId?: string;
  /** Oldest first within a kind. */
  at: string;
}

const ORDER: Record<ActionKind, number> = { overdue: 0, signal: 1, check: 2 };

/** A snooze is the first day an item may show again. */
export type Snoozes = Record<string, string>;
/** "Skip": never again. */
export const FOREVER = '9999-12-31';

/**
 * Overdue tasks and open alerts, one list: OVERDUE, then SIGNAL, then CHECK,
 * oldest first. The follow-up-due alert only repeats its task, so it is left out.
 */
export function actionItems(ws: Workspace, now: string, snoozes: Snoozes): ActionItem[] {
  const today = localDay(now);
  const names = new Map(ws.prospects.map((p) => [p.id, p.displayName]));
  const items: ActionItem[] = [];

  for (const t of ws.tasks) {
    if (t.status !== 'open' || localDay(t.dueAt) >= today) continue;
    const days = daysAgo(t.dueAt, now);
    items.push({
      key: `task:${t.id}`,
      kind: 'overdue',
      title: t.title,
      body: `Was due ${localDay(t.dueAt)} (${days} day${days === 1 ? '' : 's'} ago). ${t.description}`,
      prospectId: t.prospectId,
      taskId: t.id,
      at: t.dueAt,
    });
  }
  for (const n of ws.notifications) {
    const kind = n.type === 'new_signal' ? 'signal' : n.type === 'data_quality' ? 'check' : null;
    if (!kind) continue;
    const name = n.prospectId ? names.get(n.prospectId) : null;
    items.push({
      key: `alert:${n.id}`,
      kind,
      title: kind === 'check' && name ? `${n.title}: ${name}` : n.title,
      body: `${n.body} Raised ${ageText(daysAgo(n.createdAt, now))}.`,
      prospectId: n.prospectId ?? null,
      at: n.createdAt,
    });
  }
  return items
    .filter((i) => !(snoozes[i.key] && snoozes[i.key]! > today))
    .sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || a.at.localeCompare(b.at));
}

/** Follow-ups still open that aren't overdue, which the action list doesn't show. */
export function upcomingTasks(ws: Workspace, now: string) {
  const today = localDay(now);
  const open = ws.tasks.filter((t) => t.status === 'open' && localDay(t.dueAt) >= today);
  return { dueToday: open.filter((t) => localDay(t.dueAt) === today).length, total: open.length };
}

// ─── New in your territory ───────────────────────────────────────────────────

/** Leads first seen since the last scan: highest priority, then nearest if known. */
export function newLeads(
  views: readonly ProspectView[],
  from: Point | null = null,
): ProspectView[] {
  const away = (v: ProspectView) =>
    from && v.p.location ? haversine(from, v.p.location) : Infinity;
  return views
    .filter((v) => v.isNewLead)
    .sort((a, b) => b.score - a.score || away(a) - away(b) || a.name.localeCompare(b.name));
}

export const activeCount = (views: readonly ProspectView[]) => views.filter(isOnRadar).length;
