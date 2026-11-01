import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as Location from 'expo-location';
import { movedEnough, type Point } from './visitPlan';

export interface Origin {
  point: Point;
  kind: 'gps' | 'branch';
  /** GPS accuracy in metres; null for the branch. */
  accuracy: number | null;
}

export type OriginState =
  | { status: 'loading' }
  | { status: 'denied'; canAskAgain: boolean; reason: string | null }
  | { status: 'ready'; origin: Origin };

/**
 * Where distances on Plan visits are measured from. The device position stays
 * on the device: it is used here to measure distance and is never sent anywhere.
 * GPS is watched only while the screen is focused, and an update closer than
 * MOVE_THRESHOLD_M to the last one is ignored, so distances don't churn.
 */
export function useOrigin(
  branch: Point | null,
  /** false: use location if already allowed, but never prompt from this screen. */
  { prompt = true }: { prompt?: boolean } = {},
) {
  const [state, setState] = useState<OriginState>({ status: 'loading' });
  const [useBranch, setUseBranch] = useState(false);
  // Bumped to try again: from "Turn on location", or on return from Settings.
  const [attempt, setAttempt] = useState(0);

  useFocusEffect(
    useCallback(() => {
      if (useBranch) return;
      let live = true;
      let sub: Location.LocationSubscription | null = null;

      const apply = (pos: Location.LocationObject) => {
        if (!live) return;
        const point = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setState((prev) =>
          prev.status === 'ready' && !movedEnough(prev.origin.point, point)
            ? prev
            : {
                status: 'ready',
                origin: { point, kind: 'gps', accuracy: pos.coords.accuracy ?? null },
              },
        );
      };

      void (async () => {
        try {
          // Ask only when it hasn't been asked yet, or the officer tapped to ask.
          let perm = await Location.getForegroundPermissionsAsync();
          if (
            perm.status !== 'granted' &&
            ((prompt && perm.status === 'undetermined') || attempt > 0)
          ) {
            perm = await Location.requestForegroundPermissionsAsync();
          }
          if (!live) return;
          if (perm.status !== 'granted') {
            setState({ status: 'denied', canAskAgain: perm.canAskAgain, reason: null });
            return;
          }
          apply(await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
          const s = await Location.watchPositionAsync(
            { accuracy: Location.Accuracy.Balanced, distanceInterval: 50 },
            apply,
          );
          if (live) sub = s;
          else s.remove();
        } catch (e) {
          // Permission granted but no fix, e.g. location services switched off.
          if (live) {
            setState({
              status: 'denied',
              canAskAgain: true,
              reason: e instanceof Error ? e.message : 'Location is unavailable.',
            });
          }
        }
      })();

      return () => {
        live = false;
        sub?.remove();
      };
    }, [useBranch, attempt, prompt]),
  );

  // Back from the Settings app: try again, in case location was switched on there.
  // Only when retrying can't show a prompt (blocked for good, or services off):
  // on some phones the permission prompt itself backgrounds the app, and
  // retrying after a plain "Deny" would prompt again in a loop.
  const settingsOnly = state.status === 'denied' && (!state.canAskAgain || state.reason !== null);
  useEffect(() => {
    if (!settingsOnly) return;
    const s = AppState.addEventListener('change', (next) => {
      if (next === 'active') setAttempt((a) => a + 1);
    });
    return () => s.remove();
  }, [settingsOnly]);

  const turnOn = useCallback(() => {
    setUseBranch(false);
    if (state.status === 'denied' && !state.canAskAgain) void Linking.openSettings();
    else setAttempt((a) => a + 1);
  }, [state]);

  const result: OriginState =
    useBranch && branch
      ? { status: 'ready', origin: { point: branch, kind: 'branch', accuracy: null } }
      : state;

  return {
    state: result,
    turnOn,
    useBranch: branch ? () => setUseBranch(true) : null,
  };
}
