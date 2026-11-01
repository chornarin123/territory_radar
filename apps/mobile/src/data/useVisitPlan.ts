import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { localDay } from './time';
import { seedPlanIds, type Snoozes } from './today';
import type { Origin } from './useOrigin';
import { useLoadedWorkspace } from './WorkspaceProvider';

/** Today's visit plan, kept on the device so it survives an app restart. */
export interface VisitPlan {
  /** Local day it belongs to; a plan from another day is dropped. */
  day: string;
  /** Selected prospect ids, in the order they were ticked. */
  ids: string[];
  /** 'route' once "Plan route" was tapped; back returns to 'select'. */
  stage: 'select' | 'route';
  optimized: boolean;
  checkedIn: string[];
  /** Fixed when the route is planned, so the route doesn't move under the officer. */
  start: Origin | null;
  /** Things to verify at a stop, by prospect id ("Verify on visit" on Today). */
  checks: Record<string, string[]>;
}

const empty = (day: string, seed: string[]): VisitPlan => ({
  day,
  ids: seed,
  stage: seed.length ? 'route' : 'select',
  optimized: false,
  checkedIn: [],
  start: null,
  checks: {},
});

// One shared copy: Today and Visits are both mounted, and must never disagree.
const plans = new Map<string, VisitPlan>();
const loading = new Set<string>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/**
 * null while the saved plan loads. With nothing saved for today, the plan starts
 * from `seed`, the day's server route.
 */
export function useVisitPlan(officerId: string, day: string, seed: string[] = []) {
  const key = `territory-radar:visit-plan:${officerId}`;
  const plan = useSyncExternalStore(subscribe, () => {
    const p = plans.get(key);
    return p?.day === day ? p : null;
  });

  useEffect(() => {
    if (plans.get(key)?.day === day || loading.has(key)) return;
    loading.add(key);
    AsyncStorage.getItem(key)
      .then((raw) => {
        const saved = raw ? (JSON.parse(raw) as VisitPlan) : null;
        plans.set(key, saved?.day === day ? { ...empty(day, []), ...saved } : empty(day, seed));
      })
      .catch(() => plans.set(key, empty(day, seed))) // unreadable: start fresh
      .finally(() => {
        loading.delete(key);
        notify();
      });
  }, [key, day]);

  const update = useCallback(
    (change: (p: VisitPlan) => VisitPlan) => {
      const prev = plans.get(key);
      if (!prev) return;
      const next = change(prev);
      plans.set(key, next);
      notify();
      // Best effort: a failed write only loses the plan on the next restart.
      AsyncStorage.setItem(key, JSON.stringify(next)).catch(() => undefined);
    },
    [key],
  );

  return { plan, update };
}

/** Today's plan for the signed-in officer. */
export function useTodayPlan() {
  const { ws } = useLoadedWorkspace();
  const day = localDay(ws.metadata.asOf);
  const seed = useMemo(() => seedPlanIds(ws, day), [ws, day]);
  return useVisitPlan(ws.officer.id, day, seed);
}

// ─── Snoozed Today actions ───────────────────────────────────────────────────

let snoozes: Snoozes = {};
let snoozesLoaded = false;
const SNOOZE_KEY = 'territory-radar:today-snoozes';

/** Items hidden from "Needs your action", until the day stored for each. */
export function useSnoozes() {
  const value = useSyncExternalStore(subscribe, () => snoozes);

  useEffect(() => {
    if (snoozesLoaded) return;
    snoozesLoaded = true;
    AsyncStorage.getItem(SNOOZE_KEY)
      .then((raw) => {
        if (raw) snoozes = { ...(JSON.parse(raw) as Snoozes), ...snoozes };
        notify();
      })
      .catch(() => undefined);
  }, []);

  const snooze = useCallback((itemKey: string, until: string) => {
    snoozes = { ...snoozes, [itemKey]: until };
    notify();
    AsyncStorage.setItem(SNOOZE_KEY, JSON.stringify(snoozes)).catch(() => undefined);
  }, []);

  return { snoozes: value, snooze };
}
