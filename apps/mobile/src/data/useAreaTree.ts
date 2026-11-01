import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../api/client';
import {
  boundaryLevelOf,
  buildAreaTree,
  type AreaTree,
  type BoundaryFeature,
  type BoundaryLevel,
} from './areas';

// Fetched once per app run and shared: the tree is ~0.7 MB, the same for everyone.
let tree: AreaTree | null = null;
let pending: Promise<AreaTree> | null = null;

function loadTree(): Promise<AreaTree> {
  pending ??= api
    .areas()
    .then((provinces) => (tree = buildAreaTree(provinces)))
    .catch((e: unknown) => {
      pending = null; // let the next attempt retry
      throw e;
    });
  return pending;
}

/** The area tree, or null while it loads; `error` says why it didn't. */
export function useAreaTree(): { tree: AreaTree | null; error: string | null; retry: () => void } {
  const [state, setState] = useState({ tree, error: null as string | null, attempt: 0 });

  useEffect(() => {
    if (state.tree) return;
    let live = true;
    loadTree().then(
      (t) => live && setState((s) => ({ ...s, tree: t, error: null })),
      (e: unknown) =>
        live &&
        setState((s) => ({
          ...s,
          // 404: a server started before /areas existed. Say how to fix it.
          error:
            e instanceof ApiError && e.status === 404
              ? 'The server is out of date: restart it (pnpm mock:server).'
              : e instanceof Error
                ? e.message
                : String(e),
        })),
    );
    return () => {
      live = false;
    };
  }, [state.tree, state.attempt]);

  const retry = useCallback(
    () => setState((s) => ({ ...s, error: null, attempt: s.attempt + 1 })),
    [],
  );
  return { tree: state.tree, error: state.error, retry };
}

const boundaries = new Map<BoundaryLevel, Promise<Map<string, BoundaryFeature>>>();

/** Polygons for the given area codes, loading only the levels they need. */
export async function loadShapes(codes: readonly string[]): Promise<BoundaryFeature[]> {
  const levels = [...new Set(codes.map(boundaryLevelOf))];
  for (const level of levels) {
    if (boundaries.has(level)) continue;
    const load = api
      .boundaries(level)
      .then((fc) => new Map(fc.features.map((f) => [f.properties.code, f])));
    load.catch(() => boundaries.delete(level));
    boundaries.set(level, load);
  }
  const byLevel = new Map(
    await Promise.all(levels.map(async (l) => [l, await boundaries.get(l)!] as const)),
  );
  return codes.flatMap((c) => byLevel.get(boundaryLevelOf(c))?.get(c) ?? []);
}
