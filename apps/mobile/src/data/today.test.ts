import { describe, expect, it } from 'vitest';
import raw from '../../../../data/data.json';
import { pickPulse } from '../../../../scripts/evidence.mjs';
import { createWorkspace } from '../../../../scripts/mock-workspace.mjs';
import { EMPTY_FILTERS, buildProspectViews, isOnRadar, matchesFilters } from './selectors';
import { localDay } from './time';
import {
  FOREVER,
  actionItems,
  activeCount,
  addDays,
  ageText,
  daysAgo,
  directionsUrl,
  nearestStop,
  newLeads,
  nextStop,
  routeOrder,
  seedPlanIds,
  upcomingTasks,
  whyNowText,
} from './today';
import type { Workspace } from './types';

type Ws = ReturnType<typeof createWorkspace>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped JSON bodies
async function call(ws: Ws, method: string, path: string, body?: unknown): Promise<any> {
  let out: unknown;
  const req = {
    method,
    on(event: string, cb: (chunk?: Buffer) => void) {
      if (event === 'data' && body !== undefined) cb(Buffer.from(JSON.stringify(body)));
      if (event === 'end') cb();
      return req;
    },
  };
  await ws.handle(
    req as never,
    {} as never,
    new URL(`http://x${path}`),
    (_s: number, d: unknown) => {
      out = d;
    },
  );
  return out;
}

const server = createWorkspace(raw);
const ws = (await call(server, 'GET', '/workspace?officerId=officer_001')) as Workspace;
const views = buildProspectViews(ws);
const now = ws.metadata.asOf;
const today = localDay(now);

describe('plan', () => {
  it('starts from the day’s server route', () => {
    expect(seedPlanIds(ws, today)).toEqual(['prospect_003', 'prospect_009', 'prospect_018']);
    expect(seedPlanIds(ws, '2020-01-01')).toEqual([]);
  });

  it('advances past checked-in stops, keeping route slots', () => {
    const stops = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(nextStop(stops, [])).toEqual({ stop: stops[0], index: 0, remaining: 2 });
    expect(nextStop(stops, ['a'])).toEqual({ stop: stops[1], index: 1, remaining: 1 });
    // Checked in out of order on the route screen: b is still next, c isn't "more".
    expect(nextStop(stops, ['a', 'c'])).toEqual({ stop: stops[1], index: 1, remaining: 0 });
    expect(nextStop(stops, ['a', 'b', 'c'])).toBeNull();
  });

  it('orders stops as the route does', () => {
    const c = [
      { id: 'far', lat: 11.6, lng: 104.9 },
      { id: 'near', lat: 11.55, lng: 104.9 },
    ];
    const start = { lat: 11.54, lng: 104.9 };
    expect(
      routeOrder({ ids: ['far', 'near'], optimized: false }, c, start).map((x) => x.id),
    ).toEqual(['far', 'near']);
    expect(
      routeOrder({ ids: ['far', 'near'], optimized: true }, c, start).map((x) => x.id),
    ).toEqual(['near', 'far']);
    expect(routeOrder({ ids: ['gone'], optimized: false }, c, start)).toEqual([]);
  });

  it('finds the stop nearest a check, or the first without a location', () => {
    const stops = [
      { id: 'a', lat: 11.5, lng: 104.9 },
      { id: 'b', lat: 11.6, lng: 104.9 },
    ];
    expect(nearestStop(stops, { lat: 11.59, lng: 104.9 })?.id).toBe('b');
    expect(nearestStop(stops, null)?.id).toBe('a');
    expect(nearestStop([], null)).toBeNull();
    expect(directionsUrl(stops[0]!)).toContain('destination=11.5,104.9');
  });
});

describe('needs your action', () => {
  const items = actionItems(ws, now, {});

  it('merges overdue, signal, check in that order, without the repeated task alert', () => {
    expect(items.map((i) => i.kind)).toEqual(['overdue', 'signal', 'check']);
    expect(items[0]!.title).toBe('Follow up with Bassac Learning Hub');
    expect(items.some((i) => i.key === 'alert:notification_002')).toBe(false);
    expect(items[2]!.title).toContain('Jasmine Textile House');
  });

  it('hides snoozed items until their day', () => {
    const key = items[0]!.key;
    const snoozed = { [key]: addDays(today, 1) };
    expect(actionItems(ws, now, snoozed)).toHaveLength(2);
    expect(
      actionItems(ws, `${addDays(today, 1)}T09:00:00+07:00`, snoozed).map((i) => i.key),
    ).toContain(key);
    expect(
      actionItems(ws, `${addDays(today, 400)}T09:00:00+07:00`, { [key]: FOREVER }).map(
        (i) => i.key,
      ),
    ).not.toContain(key);
  });

  it('counts follow-ups that are open but not overdue', () => {
    const open = ws.tasks.filter((t) => t.status === 'open').length;
    expect(upcomingTasks(ws, now).total).toBe(open - 1);
    expect(upcomingTasks(ws, now).dueToday).toBeGreaterThan(0);
  });
});

describe('new leads and numbers', () => {
  it('agree with the Radar filter behind each tile', () => {
    expect(activeCount(views)).toBe(views.filter(isOnRadar).length);
    const filtered = views.filter((v) => matchesFilters(v, { ...EMPTY_FILTERS, newLeads: true }));
    expect(
      newLeads(views)
        .map((v) => v.id)
        .sort(),
    ).toEqual(filtered.map((v) => v.id).sort());
    expect(filtered).toHaveLength(11);
  });

  it('break priority ties by distance, when location is known', () => {
    const top = Math.max(...views.filter((v) => v.isNewLead).map((v) => v.score));
    const tied = views.filter((v) => v.isNewLead && v.score === top && v.p.location);
    expect(tied.length).toBeGreaterThan(1);
    const last = tied.at(-1)!;
    expect(newLeads(views, last.p.location)[0]!.id).toBe(last.id);
  });

  it('sort by priority', () => {
    const scores = newLeads(views).map((v) => v.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it('drop a lead marked not relevant, and record it for the next scan', async () => {
    const s = createWorkspace(raw);
    const before = buildProspectViews(await call(s, 'GET', '/workspace?officerId=officer_001'));
    const id = newLeads(before)[0]!.id;
    const saved = await call(s, 'POST', `/prospects/${id}/lead-feedback?officerId=officer_001`, {
      verdict: 'not_relevant',
    });
    expect(saved.lead_feedback.verdict).toBe('not_relevant');
    const fresh = await call(s, 'GET', '/workspace?officerId=officer_001');
    expect(newLeads(buildProspectViews(fresh)).map((v) => v.id)).not.toContain(id);
    expect(fresh.activities.some((a: { type: string }) => a.type === 'lead_feedback')).toBe(true);
  });

  it('refuse feedback on another officer’s prospect', async () => {
    const other = raw.prospects.find((p) => p.assignmentOfficerId === 'officer_002')!;
    const r = await call(
      server,
      'POST',
      `/prospects/${other.id}/lead-feedback?officerId=officer_001`,
      {
        verdict: 'not_relevant',
      },
    );
    expect(r.lead_feedback).toBeUndefined();
  });
});

describe('text', () => {
  it('says how old the signal is', () => {
    expect(ageText(daysAgo('2026-10-15T08:00:00+07:00', now))).toBe('today');
    expect(ageText(daysAgo('2026-10-14T08:00:00+07:00', now))).toBe('yesterday');
    expect(ageText(daysAgo('2026-10-05T08:00:00+07:00', now))).toBe('10 days ago');
    const angkor = views.find((v) => v.id === 'prospect_003')!;
    expect(whyNowText(angkor, now)).toBe('Equipment upgrade mentioned 10 days ago.');
  });
});

describe('area pulse', () => {
  const pack = (over: object) => ({
    communeCode: '120101',
    name: 'Tonle Basak',
    loanType: 'car',
    score: 82,
    previousScore: 76,
    sample: true,
    breakdown: [
      { id: 'baseline', n: 0, points: 25, title: 'Baseline', line: 'x' },
      {
        id: 'businesses',
        n: 1,
        points: 40,
        title: 'New garages',
        line: '3 new in 90 days · city median 1',
      },
      { id: 'growth', n: 2, points: 17, title: 'Growth', line: 'y' },
    ],
    ...over,
  });

  it('shows the biggest change, with the top signal for a rise', () => {
    const p = pickPulse([pack({ score: 80, previousScore: 74 }), pack({ communeCode: '120102' })])!;
    expect(p.reason).toBe('New garages (3 new in 90 days)');
    const big = pickPulse([
      pack({}),
      pack({ communeCode: '120103', score: 90, previousScore: 70 }),
    ])!;
    expect(big.communeCode).toBe('120103');
  });

  it('ignores falls and rises under 5', () => {
    expect(pickPulse([pack({ score: 60, previousScore: 70 })])).toBeNull();
    expect(pickPulse([pack({ score: 80, previousScore: 76 })])).toBeNull();
    expect(pickPulse([])).toBeNull();
    // A big fall doesn't beat a smaller rise.
    const p = pickPulse([
      pack({ communeCode: '1', score: 40, previousScore: 70 }),
      pack({ communeCode: '2' }),
    ])!;
    expect(p.communeCode).toBe('2');
  });

  it('comes from the officer’s own sangkats', async () => {
    const { pulse } = await call(server, 'GET', '/area-pulse?officerId=officer_001');
    expect(pulse).not.toBeNull();
    const own = new Set(views.map((v) => v.communeCode));
    expect(own.has(pulse.communeCode)).toBe(true);
    expect(pulse.newScore - pulse.oldScore).toBeGreaterThanOrEqual(5);
  });
});
