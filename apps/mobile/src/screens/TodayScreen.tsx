import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ChevronRight } from 'lucide-react-native';
import { api } from '../api/client';
import { OutlineButton, PrimaryButton, Txt } from '../components/ui';
import { LOAN_LABEL } from '../data/areaDemand';
import { useFilters } from '../data/FilterContext';
import { EMPTY_FILTERS, productName, type ProspectView } from '../data/selectors';
import { dayMonth, greeting, localDay, weekday } from '../data/time';
import {
  FOREVER,
  activeCount,
  actionItems,
  addDays,
  directionsUrl,
  nearestStop,
  newLeads,
  nextStop,
  routeOrder,
  upcomingTasks,
  whyNowText,
  type ActionItem,
  type ActionKind,
  type AreaPulse,
} from '../data/today';
import { useOrigin } from '../data/useOrigin';
import { useSnoozes, useTodayPlan } from '../data/useVisitPlan';
import { formatDistance, haversine, timeSlot, type Point } from '../data/visitPlan';
import { useLoadedWorkspace } from '../data/WorkspaceProvider';
import { color, font } from '../theme/tokens';
import { toCandidates } from './visits/shared';

// From the Today spec.
const C = {
  headSoft: '#c9d3e2',
  tile: '#1c3560',
  tileBorder: '#2f4870',
  amber: '#f5a524',
  box: '#f6f8fb',
  label: '#5b6576',
  link: '#1d4ed8',
  ok: '#15803d',
  okBg: '#e5f2e8',
};

const TAG: Record<ActionKind, { text: string; bg: string; fg: string }> = {
  overdue: { text: 'OVERDUE', bg: '#fde8e8', fg: '#9b1c1c' },
  signal: { text: 'SIGNAL', bg: '#e3ebf8', fg: '#1e3a6b' },
  check: { text: 'CHECK', bg: '#eef1f5', fg: '#3d4757' },
};

/** 36px buttons, 44px to the finger. */
const BUTTON_SLOP = { top: 4, bottom: 4, left: 2, right: 2 };

/** Fades its card out, then runs what the officer asked for. */
function useLeave() {
  const opacity = useRef(new Animated.Value(1)).current;
  const leave = useCallback(
    (then: () => void | Promise<unknown>) =>
      Animated.timing(opacity, {
        toValue: 0,
        duration: 180,
        useNativeDriver: Platform.OS !== 'web',
      }).start(() => {
        // Handled cards unmount; one whose action failed comes back.
        void Promise.resolve(then()).finally(() => opacity.setValue(1));
      }),
    [opacity],
  );
  return { opacity, leave };
}

/** The officer's home: what to do next, from the same data as the other tabs. */
export function TodayScreen() {
  const { ws, views, run, reload } = useLoadedWorkspace();
  const nav = useNavigation();
  const { setFilters } = useFilters();
  const { plan, update } = useTodayPlan();
  const { snoozes, snooze } = useSnoozes();
  const [error, setError] = useState<string | null>(null);

  const now = ws.metadata.asOf;
  const today = localDay(now);
  const firstName = ws.officer.displayName.split(' — ')[0] ?? ws.officer.displayName;
  const branch = ws.branch?.location ?? null;

  // Distance only: never prompts from here, and stays on the device.
  const { state: originState } = useOrigin(null, { prompt: false });
  const gps =
    originState.status === 'ready' && originState.origin.kind === 'gps'
      ? originState.origin.point
      : null;

  const byId = useMemo(() => new Map(views.map((v) => [v.id, v])), [views]);
  const candidates = useMemo(() => toCandidates(views), [views]);
  // The same stops, in the same order, as the Visits route.
  const start = plan?.start?.point ?? gps ?? branch;
  const order = useMemo(
    () => (plan ? routeOrder(plan, candidates, start) : []),
    [plan, candidates, start],
  );
  const checkedIn = plan?.checkedIn ?? [];
  const done = order.filter((s) => checkedIn.includes(s.id)).length;
  const next = nextStop(order, checkedIn);
  const nextView = next ? byId.get(next.stop.id) : undefined;

  const actions = useMemo(() => actionItems(ws, now, snoozes), [ws, now, snoozes]);
  const upcoming = useMemo(() => upcomingTasks(ws, now), [ws, now]);
  const leads = useMemo(() => newLeads(views, gps), [views, gps]);

  const [pulse, setPulse] = useState<AreaPulse | null>(null);
  const loadPulse = useCallback(
    () =>
      api.areaPulse().then(
        (r) => setPulse(r.pulse),
        () => setPulse(null), // a nicety: Today works without it
      ),
    [],
  );
  useEffect(() => {
    void loadPulse();
  }, [loadPulse]);

  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([reload(), loadPulse()]);
    setRefreshing(false);
  };

  const openRoute = () => {
    update((p) => ({ ...p, stage: p.ids.length ? 'route' : 'select' }));
    nav.navigate('Tabs', { screen: 'Visits' });
  };
  const openPlanning = () => {
    update((p) => ({ ...p, stage: 'select' }));
    nav.navigate('Tabs', { screen: 'Visits' });
  };
  // Cleared filters, so Radar shows exactly the number on the tile.
  const openRadar = (newOnly: boolean) => {
    setFilters({ ...EMPTY_FILTERS, newLeads: newOnly });
    nav.navigate('Tabs', { screen: 'Radar', params: { view: 'prospects' } });
  };

  const addToToday = (id: string) =>
    update((p) => (p.ids.includes(id) ? p : { ...p, ids: [...p.ids, id] }));
  const canPlan = (id: string | null) => !!id && candidates.some((c) => c.id === id);

  const act = async (fn: () => Promise<unknown>) => setError(await run(fn));

  const callNow = (item: ActionItem) => {
    const p = item.prospectId ? byId.get(item.prospectId)?.p : undefined;
    if (p?.contact.phone && p.contact.canCall) void Linking.openURL(`tel:${p.contact.phone}`);
    else if (item.prospectId) nav.navigate('ProspectDetail', { id: item.prospectId });
    // Today is where follow-ups get closed, so acting on one completes it.
    return item.taskId ? act(() => api.setTaskStatus(item.taskId!, 'done')) : undefined;
  };

  /** Adds a checklist item to the planned stop nearest this prospect. */
  const verifyOnVisit = (item: ActionItem): boolean => {
    const loc = item.prospectId ? byId.get(item.prospectId)?.p.location : null;
    const stop = nearestStop(order, loc ?? null);
    if (!stop) {
      setError('Plan a visit first, then add this check to it.');
      return false;
    }
    update((p) => ({
      ...p,
      checks: { ...p.checks, [stop.id]: [...(p.checks[stop.id] ?? []), item.title] },
    }));
    return true;
  };

  return (
    <ScrollView
      style={s.screen}
      contentContainerStyle={{ paddingBottom: 20 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
    >
      <View style={s.header}>
        <View style={s.headerTop}>
          <View style={{ gap: 2, flex: 1 }}>
            <Txt style={s.headerSub}>
              {dayMonth(now)} · {ws.branch?.name ?? ''}
            </Txt>
            <Txt style={s.hello}>
              {greeting(now)}, {firstName}
            </Txt>
          </View>
          <View style={s.avatar}>
            <Txt style={s.avatarText}>{ws.officer.avatarInitials}</Txt>
          </View>
        </View>
        <View style={s.tiles}>
          <Tile n={activeCount(views)} label="Active prospects" onPress={() => openRadar(false)} />
          <Tile n={leads.length} label="New to review" onPress={() => openRadar(true)} />
          <Tile n={order.length} label="Visits today" onPress={openRoute} />
        </View>
        <View style={s.progressRow}>
          <View style={s.track}>
            <View
              style={[s.fill, { width: `${order.length ? (done / order.length) * 100 : 0}%` }]}
            />
          </View>
          <Txt style={s.progressText}>
            {done}/{order.length} visits
          </Txt>
        </View>
      </View>

      <View style={s.body}>
        <View style={s.card}>
          {!plan ? null : order.length === 0 ? (
            <>
              <Txt style={s.nextName}>No visits planned</Txt>
              <PrimaryButton label="Plan visits near me" onPress={openPlanning} />
            </>
          ) : !next ? (
            <>
              <Txt style={s.nextName}>All visits done</Txt>
              <Txt style={s.line}>Add a nearby prospect below, or log notes from today.</Txt>
            </>
          ) : (
            <>
              <View style={s.rowBetween}>
                <Txt style={s.eyebrow}>NEXT VISIT · {timeSlot(next.index)}</Txt>
                {gps ? (
                  <Txt style={s.distance}>{formatDistance(haversine(gps, next.stop))} from you</Txt>
                ) : null}
              </View>
              <View style={{ gap: 2 }}>
                <Txt style={s.nextName}>{next.stop.name}</Txt>
                <Txt style={s.line}>
                  {next.stop.commune} · {next.stop.signal}
                </Txt>
              </View>
              {nextView ? (
                <View style={s.whyBox}>
                  {whyNowText(nextView, now) ? (
                    <Txt style={s.line}>
                      <Txt style={s.strong}>Why now: </Txt>
                      {whyNowText(nextView, now)}
                    </Txt>
                  ) : null}
                  <Txt style={s.line}>
                    <Txt style={s.strong}>Ask about: </Txt>
                    {nextView.p.ask_about}
                  </Txt>
                </View>
              ) : null}
              <View style={s.buttons}>
                <OutlineButton
                  label="Directions"
                  onPress={() => void Linking.openURL(directionsUrl(next.stop))}
                  style={{ flex: 1 }}
                />
                <PrimaryButton
                  label="Check in"
                  onPress={() =>
                    update((p) => ({ ...p, checkedIn: [...p.checkedIn, next.stop.id] }))
                  }
                  style={{ flex: 1 }}
                />
              </View>
              <Pressable onPress={openRoute} accessibilityRole="link" style={s.linkRow}>
                <Txt style={s.link}>
                  {next.remaining
                    ? `Then ${next.remaining} more · see route →`
                    : 'Last stop · see route →'}
                </Txt>
              </Pressable>
            </>
          )}
        </View>

        <View style={s.rowBetween}>
          <Txt style={s.h2}>Needs your action</Txt>
          <Txt style={s.caption}>{actions.length} open</Txt>
        </View>
        {actions.length === 0 ? (
          <View style={s.caughtUp}>
            <Txt style={s.caughtUpText}>You&apos;re all caught up.</Txt>
          </View>
        ) : (
          actions.map((item) => (
            <ActionCard
              key={item.key}
              item={item}
              canPlan={canPlan(item.prospectId)}
              onCall={() => callNow(item)}
              onTomorrow={() => snooze(item.key, addDays(today, 1))}
              onAdd={() => {
                addToToday(item.prospectId!);
                snooze(item.key, FOREVER);
              }}
              onNotNow={() => snooze(item.key, addDays(today, 7))}
              onVerify={() => verifyOnVisit(item)}
              onVerified={() => snooze(item.key, FOREVER)}
              onSkip={() => snooze(item.key, FOREVER)}
            />
          ))
        )}
        {upcoming.total ? (
          <Txt style={s.caption}>
            Not overdue yet: {upcoming.dueToday} follow-up{upcoming.dueToday === 1 ? '' : 's'} due
            today, {upcoming.total} in all.
          </Txt>
        ) : null}
        {error ? <Txt style={s.error}>{error}</Txt> : null}

        <View style={s.rowBetween}>
          <Txt style={s.h2}>New in your territory</Txt>
          {ws.metadata.lastScanAt ? (
            <Txt style={s.caption}>since {weekday(ws.metadata.lastScanAt)} scan</Txt>
          ) : null}
        </View>
        {!ws.metadata.lastScanAt ? (
          <Txt style={s.error}>The server is out of date: restart it (pnpm mock:server).</Txt>
        ) : leads.length === 0 ? (
          <Txt style={s.caption}>
            No new leads since {weekday(ws.metadata.lastScanAt)}&apos;s scan.
          </Txt>
        ) : null}
        {leads.slice(0, 3).map((v) => (
          <LeadCard
            key={v.id}
            v={v}
            distance={gps && v.p.location ? haversine(gps, v.p.location as Point) : null}
            added={!!plan?.ids.includes(v.id)}
            canAdd={canPlan(v.id)}
            onAdd={() => addToToday(v.id)}
            onDismiss={() => act(() => api.leadNotRelevant(v.id))}
          />
        ))}
        {leads.length ? (
          <Pressable onPress={() => openRadar(true)} accessibilityRole="link" style={s.linkRow}>
            <Txt style={s.link}>Review all {leads.length} new leads →</Txt>
          </Pressable>
        ) : null}

        {pulse ? (
          <Pressable
            onPress={() =>
              nav.navigate('Evidence', { code: pulse.communeCode, loanType: pulse.loanType })
            }
            accessibilityRole="button"
            accessibilityLabel={`Area pulse. ${LOAN_LABEL[pulse.loanType]} demand in ${pulse.name} rose ${pulse.oldScore} to ${pulse.newScore}: ${pulse.reason ?? 'see the evidence'}.`}
            style={({ pressed }) => [s.pulse, pressed && { opacity: 0.9 }]}
          >
            <View style={{ flex: 1, gap: 4 }}>
              <Txt style={s.pulseEyebrow}>AREA PULSE</Txt>
              <Txt style={s.pulseText}>
                {LOAN_LABEL[pulse.loanType]} demand in {pulse.name} rose{' '}
                <Txt style={s.pulseNum}>
                  {pulse.oldScore} → {pulse.newScore}
                </Txt>
                {pulse.reason ? `: ${pulse.reason}.` : '.'}
              </Txt>
            </View>
            <ChevronRight size={20} color={C.headSoft} />
          </Pressable>
        ) : null}

        {ws.metadata.isSynthetic ? (
          <Txt style={s.caption}>[Sample data] Prospects, scans and area scores are samples.</Txt>
        ) : null}
      </View>
    </ScrollView>
  );
}

function Tile({ n, label, onPress }: { n: number; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${n} ${label.toLowerCase()}`}
      style={({ pressed }) => [s.tile, pressed && { opacity: 0.8 }]}
    >
      <Txt style={s.tileValue}>{n}</Txt>
      <Txt style={s.tileLabel}>{label}</Txt>
    </Pressable>
  );
}

function ActionCard({
  item,
  canPlan,
  onCall,
  onTomorrow,
  onAdd,
  onNotNow,
  onVerify,
  onVerified,
  onSkip,
}: {
  item: ActionItem;
  canPlan: boolean;
  onCall: () => void | Promise<unknown>;
  onTomorrow: () => void;
  onAdd: () => void;
  onNotNow: () => void;
  /** False if there is no planned stop to add the check to: the card stays. */
  onVerify: () => boolean;
  onVerified: () => void;
  onSkip: () => void;
}) {
  const { opacity, leave } = useLeave();
  const tag = TAG[item.kind];
  const [first, second]: [[string, () => void, boolean?], [string, () => void]] =
    item.kind === 'overdue'
      ? [
          ['Call now', () => leave(onCall)],
          ['Tomorrow', () => leave(onTomorrow)],
        ]
      : item.kind === 'signal'
        ? [
            ['Add to today', () => leave(onAdd), !canPlan],
            ['Not now', () => leave(onNotNow)],
          ]
        : [
            ['Verify on visit', () => onVerify() && leave(onVerified)],
            ['Skip', () => leave(onSkip)],
          ];
  return (
    <Animated.View style={[s.card, { opacity }]}>
      <View style={[s.tag, { backgroundColor: tag.bg }]}>
        <Txt style={[s.tagText, { color: tag.fg }]}>{tag.text}</Txt>
      </View>
      <Txt style={s.actionTitle}>{item.title}</Txt>
      <Txt style={s.line}>{item.body}</Txt>
      <View style={s.buttons}>
        <PrimaryButton
          label={first[0]}
          onPress={first[1]}
          disabled={first[2]}
          style={{ flex: 1 }}
        />
        <OutlineButton label={second[0]} onPress={second[1]} style={{ flex: 1 }} />
      </View>
    </Animated.View>
  );
}

function LeadCard({
  v,
  distance,
  added,
  canAdd,
  onAdd,
  onDismiss,
}: {
  v: ProspectView;
  distance: number | null;
  added: boolean;
  canAdd: boolean;
  onAdd: () => void;
  onDismiss: () => Promise<unknown>;
}) {
  const { opacity, leave } = useLeave();
  const where = [
    v.commune,
    distance !== null ? formatDistance(distance) : null,
    `first seen ${weekday(v.p.first_seen_at)}`,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Animated.View style={[s.leadCard, { opacity }]}>
      <View style={s.rowBetween}>
        <Txt style={s.leadName} numberOfLines={1}>
          {v.p.isSynthetic ? '[Sample] ' : ''}
          {v.name}
        </Txt>
        <Txt style={s.priority}>P{v.score}</Txt>
      </View>
      <Txt style={s.leadLine}>
        {v.p.why_now ?? 'No signal'} · {productName(v)}
      </Txt>
      <Txt style={s.caption}>{where}</Txt>
      {added ? (
        <Txt style={s.added}>Added to today&apos;s route</Txt>
      ) : (
        <View style={s.leadButtons}>
          <Pressable
            onPress={onAdd}
            disabled={!canAdd}
            hitSlop={BUTTON_SLOP}
            accessibilityRole="button"
            accessibilityLabel={`Add ${v.name} to today`}
            accessibilityState={{ disabled: !canAdd }}
            style={({ pressed }) => [
              s.leadAdd,
              !canAdd && { opacity: 0.45 },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Txt style={s.leadAddText}>+ Add to today</Txt>
          </Pressable>
          <Pressable
            onPress={() => leave(onDismiss)}
            hitSlop={BUTTON_SLOP}
            accessibilityRole="button"
            accessibilityLabel={`Mark ${v.name} not relevant`}
            style={({ pressed }) => [s.ghost, pressed && { opacity: 0.6 }]}
          >
            <Txt style={s.ghostText}>Not relevant</Txt>
          </Pressable>
        </View>
      )}
    </Animated.View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  header: { backgroundColor: color.navy, paddingVertical: 16, paddingHorizontal: 16, gap: 12 },
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerSub: { fontFamily: font.regular, fontSize: 12, color: C.headSoft },
  hello: { fontFamily: font.bold, fontSize: 20, color: color.surface },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: color.blueTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: font.bold, fontSize: 15, color: color.navy },
  tiles: { flexDirection: 'row', gap: 8 },
  tile: {
    flex: 1,
    minHeight: 64,
    backgroundColor: C.tile,
    borderWidth: 1,
    borderColor: C.tileBorder,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 10,
    gap: 2,
  },
  tileValue: { fontFamily: font.mono, fontSize: 22, color: color.surface },
  tileLabel: { fontFamily: font.regular, fontSize: 12, color: C.headSoft },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  track: { flex: 1, height: 6, borderRadius: 3, backgroundColor: C.tileBorder, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: C.amber },
  progressText: { fontFamily: font.mono, fontSize: 12, color: C.headSoft },
  body: { padding: 16, gap: 12 },
  card: {
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  eyebrow: { fontFamily: font.bold, fontSize: 12, letterSpacing: 0.6, color: C.label },
  distance: { fontFamily: font.semibold, fontSize: 13, color: color.text },
  nextName: { fontFamily: font.bold, fontSize: 18, color: color.text },
  line: { fontFamily: font.regular, fontSize: 13, lineHeight: 19, color: color.text2 },
  strong: { fontFamily: font.bold, fontSize: 13, color: color.text },
  whyBox: { backgroundColor: C.box, borderRadius: 10, padding: 10, gap: 4 },
  buttons: { flexDirection: 'row', gap: 8, paddingTop: 2 },
  linkRow: { minHeight: 44, justifyContent: 'center' },
  link: { fontFamily: font.semibold, fontSize: 13, color: C.link },
  h2: { fontFamily: font.bold, fontSize: 16, color: color.text, paddingTop: 4 },
  caption: { fontFamily: font.regular, fontSize: 12, color: C.label },
  caughtUp: { backgroundColor: C.okBg, borderRadius: 12, padding: 14 },
  caughtUpText: { fontFamily: font.semibold, fontSize: 14, color: C.ok },
  tag: { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  tagText: { fontFamily: font.bold, fontSize: 11, letterSpacing: 0.4 },
  actionTitle: { fontFamily: font.bold, fontSize: 14, color: color.text },
  leadCard: {
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: '#e1e5ec',
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  leadLine: { fontFamily: font.regular, fontSize: 13, lineHeight: 18, color: '#3d4757' },
  priority: { fontFamily: font.mono, fontSize: 14, color: color.navy },
  added: { fontFamily: font.semibold, fontSize: 13, color: C.ok, paddingTop: 6 },
  leadName: { flex: 1, fontFamily: font.bold, fontSize: 14, color: color.text },
  leadButtons: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 6 },
  leadAdd: {
    height: 36,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: color.navy,
    backgroundColor: color.surface,
  },
  leadAddText: { fontFamily: font.semibold, fontSize: 13, color: color.navy },
  ghost: { height: 36, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' },
  ghostText: { fontFamily: font.semibold, fontSize: 13, color: C.label },
  error: { fontFamily: font.semibold, fontSize: 12, color: color.overdue },
  pulse: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: color.navy,
    borderRadius: 14,
    padding: 14,
    minHeight: 64,
  },
  pulseEyebrow: { fontFamily: font.bold, fontSize: 12, letterSpacing: 0.72, color: C.headSoft },
  pulseText: { fontFamily: font.semibold, fontSize: 14, lineHeight: 20, color: color.surface },
  pulseNum: { fontFamily: font.mono, fontSize: 14, color: color.surface },
});
