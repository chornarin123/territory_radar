import React, { createContext, useContext, useMemo, useState } from 'react';
import { EMPTY_FILTERS, type FilterState, type ListControls, type ListStatus } from './selectors';
import type { Settings } from './types';

// One filter state for Filters, Prospects and Radar (spec §3.4: "Filter state lives
// in a shared store/context so Prospects + Radar use it").

interface FilterValue {
  filters: FilterState;
  setFilters: (f: FilterState | ((prev: FilterState) => FilterState)) => void;
  list: ListControls;
  setListStatus: (s: ListStatus) => void;
  toggleMinScore: () => void;
  toggleHideNoNeed: () => void;
  /** Prospects empty state "Clear filters": everything back to wide open. */
  clearAll: () => void;
}

const Ctx = createContext<FilterValue | null>(null);

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
    status: 'active',
    minScoreOn: true,
    minScore: settings.defaultProspectFilter.minScore,
    hideNoNeed: settings.excludeNotInterestedFromRecommendations,
  });

  const value = useMemo<FilterValue>(
    () => ({
      filters,
      setFilters,
      list,
      setListStatus: (status) => setList((l) => ({ ...l, status })),
      toggleMinScore: () => setList((l) => ({ ...l, minScoreOn: !l.minScoreOn })),
      toggleHideNoNeed: () => setList((l) => ({ ...l, hideNoNeed: !l.hideNoNeed })),
      clearAll: () => {
        setFilters(EMPTY_FILTERS);
        setList((l) => ({ ...l, status: 'active', minScoreOn: false, hideNoNeed: false }));
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
