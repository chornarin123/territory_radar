import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../api/client';
import type { AreaDemand, DemandMapData } from './areaDemand';
import type { BoundaryCollection } from './areas';

/**
 * Predicted loan demand for one province's communes. The one place demand
 * numbers come from: swap the source here when the real model output lands.
 */
export const getAreaDemand = (provinceCode: string): Promise<AreaDemand> =>
  api.areaDemand(provinceCode);

// One fetch per province per app run: demand, sangkat shapes, khan outlines.
// The 25 province shapes (~0.3 MB) are shared by all.
const cache = new Map<string, Promise<DemandMapData>>();
let provinceShapes: Promise<BoundaryCollection> | null = null;

function load(province: string): Promise<DemandMapData> {
  let p = cache.get(province);
  if (!p) {
    provinceShapes ??= api.boundaries('provinces').catch((e: unknown) => {
      provinceShapes = null;
      throw e;
    });
    p = Promise.all([
      getAreaDemand(province),
      api.boundaries('communes', province),
      api.districtOutlines(province),
      provinceShapes,
    ]).then(([demand, communes, outlines, provinces]) => ({
      demand,
      communes,
      outlines,
      provinces,
    }));
    p.catch(() => cache.delete(province)); // let a retry fetch again
    cache.set(province, p);
  }
  return p;
}

export function useAreaDemand(province: string) {
  const [state, setState] = useState<{
    province: string;
    data: DemandMapData | null;
    error: string | null;
  }>({ province, data: null, error: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setState((s) => (s.province === province ? s : { province, data: null, error: null }));
    load(province).then(
      (data) => live && setState({ province, data, error: null }),
      (e: unknown) =>
        live &&
        setState({
          province,
          data: null,
          // 404: a server started before these endpoints existed. Say how to fix it.
          error:
            e instanceof ApiError && e.status === 404
              ? 'The server is out of date: restart it (pnpm mock:server).'
              : e instanceof Error
                ? e.message
                : String(e),
        }),
    );
    return () => {
      live = false;
    };
  }, [province, attempt]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  const current = state.province === province;
  return {
    data: current ? state.data : null,
    error: current ? state.error : null,
    retry,
  };
}
