import { describe, expect, it } from 'vitest';
import raw from '../../../../../data/data.json';
import { createWorkspace } from '../../../../../scripts/mock-workspace.mjs';
import { buildProspectViews, type ProspectView } from '../../data/selectors';
import type { Task, Workspace } from '../../data/types';
import {
  buildRows,
  distanceKm,
  inTab,
  metaLine,
  needsActionToday,
  nextAction,
  nextSort,
  nowOf,
  sections,
  signalCategory,
  sortRows,
  stageOf,
  summaryText,
  tabCounts,
  type ActionContext,
} from './selectors';

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
const ws = await workspace();
const views = buildProspectViews(ws);
const branch = ws.branch!.location;
const TODAY = '2026-10-15';

const ctx = (over: Partial<ActionContext> = {}): ActionContext => ({
  today: TODAY,
  visitTimes: new Map(),
  tasks: new Map(),
  ...over,
});
const view = (status: ProspectView['status'], flags: string[] = []) => {
  const v = views.find((x) => x.status === status) ?? views[0]!;
  return {
    ...v,
    status,
    p: { ...v.p, dataQuality: { ...v.p.dataQuality, flags } },
  } as ProspectView;
};
const task = (dueAt: string, type = 'follow_up', status: Task['status'] = 'open'): Task =>
  ({
    id: 't',
    prospectId: 'x',
    officerId: 'o',
    type,
    title: '',
    description: '',
    dueAt,
    status,
    priority: 'normal',
    completedAt: null,
  }) as Task;
const withTask = (v: ProspectView, t: Task) => ctx({ tasks: new Map([[v.id, [t]]]) });

describe('clock', () => {
  it('uses the demo clock when fixed', () => {
    expect(nowOf(ws)).toBe(ws.metadata.asOf);
    const live = { metadata: { ...ws.metadata, fixedClock: false } };
    expect(nowOf(live, new Date('2027-01-01T00:00:00Z'))).toBe('2027-01-01T00:00:00.000Z');
  });
});

describe('nextAction', () => {
  it('puts a visit today first', () => {
    const v = view('qualified');
    const a = nextAction(
      v,
      ctx({
        visitTimes: new Map([[v.id, '10:00']]),
        tasks: new Map([[v.id, [task('2026-10-01T08:00:00+07:00')]]]),
      }),
    );
    expect(a).toEqual({ tone: 'visit', text: 'Visit today at 10:00' });
  });

  it('reads open tasks: overdue, today, referral check, tomorrow', () => {
    const v = view('follow_up');
    expect(nextAction(v, withTask(v, task('2026-10-14T08:30:00+07:00')))).toEqual({
      tone: 'overdue',
      text: 'Follow-up overdue · due 14 Oct',
    });
    expect(nextAction(v, withTask(v, task('2026-10-15T17:00:00+07:00'))).text).toBe(
      'Follow-up due today',
    );
    expect(
      nextAction(v, withTask(v, task('2026-10-15T09:00:00+07:00', 'check_referral'))).text,
    ).toBe('Check referral status today');
    expect(nextAction(v, withTask(v, task('2026-10-16T08:30:00+07:00')))).toEqual({
      tone: 'neutral',
      text: 'Follow-up due tomorrow',
    });
  });

  it('ignores done tasks and tasks further out, falling back to the stage', () => {
    const v = view('contacted');
    expect(
      nextAction(v, withTask(v, task('2026-10-14T08:30:00+07:00', 'follow_up', 'done'))).text,
    ).toBe('Ask whether financing is needed');
    expect(nextAction(v, withTask(v, task('2026-10-20T08:30:00+07:00'))).text).toBe(
      'Ask whether financing is needed',
    );
  });

  it('says what each stage calls for', () => {
    expect(nextAction(view('new'), ctx()).text).toBe('Make first contact');
    expect(nextAction(view('new', ['stale_evidence']), ctx()).text).toBe(
      'Verify data, then make first contact',
    );
    expect(nextAction(view('qualified'), ctx()).text).toBe('Plan a visit');
    expect(nextAction(view('application_referred'), ctx()).text).toBe('Waiting on referral');
    expect(nextAction(view('not_interested'), ctx())).toEqual({
      tone: 'muted',
      text: 'No financing need recorded',
    });
    expect(nextAction(view('closed'), ctx())).toEqual({ tone: 'muted', text: 'Closed' });
  });

  it('counts overdue, today and visits as needing action today', () => {
    expect(needsActionToday({ tone: 'overdue', text: '' })).toBe(true);
    expect(needsActionToday({ tone: 'today', text: '' })).toBe(true);
    expect(needsActionToday({ tone: 'visit', text: '' })).toBe(true);
    expect(needsActionToday({ tone: 'neutral', text: '' })).toBe(false);
  });
});

describe('stage and distance', () => {
  it('groups pipeline statuses', () => {
    expect(stageOf('new')).toBe('new');
    expect(stageOf('application_referred')).toBe('referred');
    expect(stageOf('not_interested')).toBe('closed');
    expect(stageOf('closed')).toBe('closed');
    expect(stageOf('contacted')).toBe('working');
    expect(stageOf('unreachable')).toBe('working');
  });

  it('measures km from the branch, to one decimal', () => {
    expect(distanceKm(branch, branch)).toBe(0);
    // 0.01° of latitude is ~1.11 km.
    expect(distanceKm({ lat: branch.lat + 0.01, lng: branch.lng }, branch)).toBe(1.1);
    expect(distanceKm(null, branch)).toBeNull();
    expect(distanceKm(branch, null)).toBeNull();
  });

  it('labels the card', () => {
    expect(signalCategory('equipment_purchase')).toBe('EQUIPMENT');
    expect(signalCategory('imports')).toBe('STOCK & TRADE');
    expect(signalCategory('housing_project')).toBe('HOUSING');
    expect(signalCategory('new_employer')).toBe('EMPLOYER');
    const v = views.find((x) => !x.p.location)!;
    expect(metaLine(v, null)).toMatch(/· no map pin$/);
  });
});

describe('tabs, sections, sorting', () => {
  const rows = buildRows(views, ctx({ visitTimes: new Map([[views[0]!.id, '10:00']]) }), branch);

  it('lists each prospect once in All, with today winning', () => {
    const groups = sections(rows, 'all', 'priority');
    const ids = groups.flatMap((g) => g.data.map((r) => r.v.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(groups[0]!.title).toBe('Needs action today');
    expect(groups[0]!.data.map((r) => r.v.id)).toContain(views[0]!.id);
    expect(ids.some((id) => rows.find((r) => r.v.id === id)!.stage === 'closed')).toBe(false);
  });

  it('counts each tab from the same rows', () => {
    const counts = tabCounts(rows);
    expect(counts.today).toBe(rows.filter((r) => r.today).length);
    expect(counts.closed).toBe(rows.filter((r) => inTab(r, 'closed')).length);
    expect(sections(rows, 'new', 'priority')[0]!.data).toHaveLength(counts.new);
  });

  it('sorts by priority then km, by km with no pin last, or by name', () => {
    const byPriority = sortRows(rows, 'priority');
    for (let i = 1; i < byPriority.length; i++) {
      expect(byPriority[i - 1]!.v.score).toBeGreaterThanOrEqual(byPriority[i]!.v.score);
    }
    const nearest = sortRows(rows, 'nearest');
    expect(nearest.at(-1)!.km).toBeNull();
    const kms = nearest.filter((r) => r.km !== null).map((r) => r.km!);
    expect(kms).toEqual([...kms].sort((a, b) => a - b));
    const names = sortRows(rows, 'name').map((r) => r.v.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it('cycles the sort button and describes the switches', () => {
    expect(['priority', 'nearest', 'name', 'fresh'].map((s) => nextSort(s as never))).toEqual([
      'nearest',
      'name',
      'priority',
      'priority',
    ]);
    expect(summaryText(true, 60, true)).toBe('Showing priority ≥ 60, hiding no-need');
    expect(summaryText(false, 60, false)).toBe('No filters applied');
    expect(summaryText(false, 60, true)).toBe('Hiding no-need');
  });
});
