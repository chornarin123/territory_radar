import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { buildProspectViews, type ProspectView } from './selectors';
import type { Locale, Workspace } from './types';

interface WorkspaceValue {
  ws: Workspace | null;
  views: ProspectView[];
  error: string | null;
  loading: boolean;
  reload: () => Promise<void>;
  /**
   * Runs a write, then refetches the workspace. The data set is small, so a
   * refetch is cheaper than keeping a client-side merge in step with the server.
   * Resolves to an error message, or null on success.
   */
  run: (action: () => Promise<unknown>) => Promise<string | null>;
  busy: boolean;
  locale: Locale;
  setLocale: (l: Locale) => void;
  /** uiCopy for the active locale, falling back to English for keys km lacks. */
  copy: (key: string) => string;
}

const Ctx = createContext<WorkspaceValue | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [ws, setWs] = useState<Workspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [locale, setLocale] = useState<Locale>('en');

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const next = await api.workspace();
      setWs(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // The officer's own preference wins on first load.
  useEffect(() => {
    if (ws?.officer.preferredLocale) setLocale(ws.officer.preferredLocale);
  }, [ws?.officer.preferredLocale]);

  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      setBusy(true);
      try {
        await action();
        await reload();
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const views = useMemo(() => (ws ? buildProspectViews(ws) : []), [ws]);

  const copy = useCallback(
    (key: string) => ws?.uiCopy[locale]?.[key] ?? ws?.uiCopy.en?.[key] ?? key,
    [ws, locale],
  );

  const value = useMemo(
    () => ({ ws, views, error, loading, reload, run, busy, locale, setLocale, copy }),
    [ws, views, error, loading, reload, run, busy, locale, copy],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace(): WorkspaceValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWorkspace must be used inside <WorkspaceProvider>');
  return v;
}

/** For screens rendered only once the workspace has loaded (see RootNavigator). */
export function useLoadedWorkspace() {
  const v = useWorkspace();
  if (!v.ws) throw new Error('Workspace not loaded');
  return { ...v, ws: v.ws };
}
