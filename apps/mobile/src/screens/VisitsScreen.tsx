import React, { useEffect, useMemo } from 'react';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { MapPinOff } from 'lucide-react-native';
import { OutlineButton, PrimaryButton, Txt } from '../components/ui';
import { useOrigin } from '../data/useOrigin';
import { useTodayPlan } from '../data/useVisitPlan';
import { useLoadedWorkspace } from '../data/WorkspaceProvider';
import type { TabParamList } from '../navigation/types';
import { color, font, type } from '../theme/tokens';
import { PlanVisits } from './visits/PlanVisits';
import { LocationLine, toCandidates } from './visits/shared';
import { VisitRoute } from './visits/VisitRoute';

/**
 * Visits tab: Plan visits (prospects near the officer, picked into today's plan),
 * then the visit route. The plan lives on the device (useVisitPlan); the device
 * location never leaves it (useOrigin).
 */
export function VisitsScreen() {
  const { ws, views } = useLoadedWorkspace();
  const { plan, update } = useTodayPlan();
  const branch = ws.branch?.location ?? null;
  const location = useOrigin(branch);
  const candidates = useMemo(() => toCandidates(views), [views]);

  // Ask Radar's "plan visits" hands over prospects: tick them on Plan visits, once.
  const route = useRoute<RouteProp<TabParamList, 'Visits'>>();
  const navigation = useNavigation();
  const preselect = route.params?.preselect;
  useEffect(() => {
    if (!plan || !preselect?.length) return;
    update((p) => ({ ...p, stage: 'select', ids: [...new Set([...p.ids, ...preselect])] }));
    navigation.setParams({ preselect: undefined } as never);
  }, [plan === null, preselect]);

  if (!plan) return <Centered>{null}</Centered>;

  // A planned route keeps the origin it was planned from, even with GPS off now.
  if (plan.stage === 'route') {
    const start =
      plan.start ??
      (location.state.status === 'ready' ? location.state.origin : null) ??
      (branch ? { point: branch, kind: 'branch' as const, accuracy: null } : null);
    if (start) {
      return (
        <VisitRoute
          start={start}
          candidates={candidates}
          plan={plan}
          update={update}
          zoom={ws.settings.mapDefaultZoom}
        />
      );
    }
  }

  const st = location.state;
  if (st.status === 'loading') {
    return (
      <Centered>
        <LocationLine origin={null} />
      </Centered>
    );
  }

  if (st.status === 'denied') {
    return (
      <View style={[s.screen, s.off]}>
        <View style={s.offIcon}>
          <MapPinOff size={30} color={color.navy} />
        </View>
        <Txt style={s.offTitle}>Turn on location to see prospects near you</Txt>
        <Txt style={[type.body, { textAlign: 'center' }]}>
          Radar uses your position only on this device, to measure distance to prospects. It
          isn&apos;t stored or shared.
        </Txt>
        {st.reason ? <Txt style={[type.caption, { textAlign: 'center' }]}>{st.reason}</Txt> : null}
        <View style={s.offButtons}>
          <PrimaryButton
            label={st.canAskAgain ? 'Turn on location' : 'Turn on location in Settings'}
            onPress={location.turnOn}
          />
          {location.useBranch ? (
            <OutlineButton label="Use my branch instead" onPress={location.useBranch} />
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <PlanVisits
      origin={st.origin}
      candidates={candidates}
      plan={plan}
      update={update}
      center={ws.settings.mapDefaultCenter}
      zoom={ws.settings.mapDefaultZoom}
    />
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <View style={[s.screen, s.centered]}>
      <ActivityIndicator color={color.navy} />
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  centered: { alignItems: 'center', justifyContent: 'center', gap: 12 },
  off: { alignItems: 'center', justifyContent: 'center', gap: 12, padding: 28 },
  offIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: color.blueTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  offTitle: { fontFamily: font.bold, fontSize: 18, color: color.text, textAlign: 'center' },
  offButtons: { alignSelf: 'stretch', gap: 10, paddingTop: 8 },
});
