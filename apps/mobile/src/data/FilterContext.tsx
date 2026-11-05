import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  EMPTY_FILTERS,
  PROSPECT_TABS,
  type FilterState,
  type ListControls,
  type ProspectTab,
} from './selectors';
import type { Settings } from './types';

// One filter state for Filters, Prospects and Radar (spec §3.4: "Filter state lives
// in a shared store/context so Prospects + Radar use it").

interface FilterValue {
  filters: FilterState;
  setFilters: (f: FilterState | ((prev: FilterState) => FilterState)) => void;
  list: ListControls;
  setTab: (t: ProspectTab) => void;
  setSearch: (q: string) => void;
  toggleMinScore: () => void;
  toggleHideNoNeed: () => void;
  /** Prospects empty state "Clear filters": everything back to wide open. */
  clearAll: () => void;
}

const Ctx = createContext<FilterValue | null>(null);

const STORAGE_KEY = 'territory-radar:filters';

export function FilterProvider({
  settings,
  children,
}: {
  settings: Settings;
  children: React.ReactNode;
}) {
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  // Defaults come from settings, not constants: the bank decides the threshold.
  const [list, setList] = useState<ListControls>({
    tab: 'all',
    search: '',
    minScoreOn: true,
    minScore: settings.defaultProspectFilter.minScore,
    hideNoNeed: settings.excludeNotInterestedFromRecommendations,
  });

  // The last applied filters come back after a restart. Until the saved copy is
  // read, nothing is written, so it can't be overwritten by the defaults.
  const restored = useRef(false);
  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!live || !raw) return;
        const saved = JSON.parse(raw) as {
          filters?: Partial<FilterState>;
          list?: Partial<ListControls>;
        };
        // New filter fields since the save keep their defaults.
        if (saved.filters) setFilters((f) => ({ ...EMPTY_FILTERS, ...f, ...saved.filters }));
        // Only the switches and the tab come back; search starts empty.
        const s = saved.list;
        if (s) {
          setList((l) => ({
            ...l,
            ...(typeof s.minScoreOn === 'boolean' ? { minScoreOn: s.minScoreOn } : {}),
            ...(typeof s.hideNoNeed === 'boolean' ? { hideNoNeed: s.hideNoNeed } : {}),
            ...(s.tab && PROSPECT_TABS.includes(s.tab) ? { tab: s.tab } : {}),
          }));
        }
      })
      .catch(() => undefined) // unreadable: keep the defaults
      .finally(() => {
        restored.current = true;
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!restored.current) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ filters, list })).catch(() => undefined);
  }, [filters, list]);

  const value = useMemo<FilterValue>(
    () => ({
      filters,
      setFilters,
      list,
      setTab: (tab) => setList((l) => ({ ...l, tab })),
      setSearch: (search) => setList((l) => ({ ...l, search })),
      toggleMinScore: () => setList((l) => ({ ...l, minScoreOn: !l.minScoreOn })),
      toggleHideNoNeed: () => setList((l) => ({ ...l, hideNoNeed: !l.hideNoNeed })),
      clearAll: () => {
        setFilters(EMPTY_FILTERS);
        setList((l) => ({ ...l, tab: 'all', search: '', minScoreOn: false, hideNoNeed: false }));
      },
    }),
    [filters, list],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFilters(): FilterValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useFilters must be used inside <FilterProvider>');
  return v;
}
