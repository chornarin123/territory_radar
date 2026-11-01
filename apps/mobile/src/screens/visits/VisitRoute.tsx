import React, { useEffect, useMemo, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ArrowLeft, Check } from 'lucide-react-native';
import { MapView } from '../../components/map/MapView';
import { OutlineButton, Pill, PrimaryButton, Txt } from '../../components/ui';
import type { Origin } from '../../data/useOrigin';
import type { VisitPlan } from '../../data/useVisitPlan';
import {
  MINUTES_PER_VISIT,
  nearestNeighbourOrder,
  routeLength,
  timeSlot,
} from '../../data/visitPlan';
import { color, font, type } from '../../theme/tokens';
import { P, purposeFor, type Candidate } from './shared';

/** Today's route: the planned prospects in order, from where the plan was made. */
export function VisitRoute({
  start,
  candidates,
  plan,
  update,
  zoom,
}: {
  start: Origin;
  candidates: Candidate[];
  plan: VisitPlan;
  update: (change: (p: VisitPlan) => VisitPlan) => void;
  zoom: number;
}) {
  const byId = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates]);
  const order = useMemo(() => {
    const planned = plan.ids.map((id) => byId.get(id)).filter((c) => c !== undefined);
    // Simulated: greedy nearest-neighbour on straight-line distance, not road routing.
    return plan.optimized ? nearestNeighbourOrder(start.point, planned) : planned;
  }, [plan.ids, plan.optimized, byId, start.point]);

  const checked = new Set(plan.checkedIn);
  const done = order.filter((c) => checked.has(c.id)).length;
  const km = routeLength(start.point, order) / 1000;
  const n = order.length;

  const pins = useMemo(
    () =>
      order.map((c, i) => ({
        id: c.id,
        lat: c.lat,
        lng: c.lng,
        label: String(i + 1),
        color: plan.checkedIn.includes(c.id) ? P.green : P.navy,
      })),
    [order, plan.checkedIn],
  );
  const mapOrigin = useMemo(
    () => ({ ...start.point, label: start.kind === 'gps' ? 'You' : 'Branch' }),
    [start],
  );
  const route = useMemo(
    () => ({ start: start.point, startLabel: '', path: pins, dashed: !plan.optimized }),
    [start.point, pins, plan.optimized],
  );

  // Frame the route when the order changes; checking in leaves the view alone.
  const fitKey = order.map((c) => c.id).join(',');
  const framed = useRef<string | null>(null);
  const fit = framed.current !== fitKey;
  useEffect(() => {
    framed.current = fitKey;
  }, [fitKey]);

  const toggleCheckIn = (id: string) =>
    update((p) => ({
      ...p,
      checkedIn: p.checkedIn.includes(id)
        ? p.checkedIn.filter((x) => x !== id)
        : [...p.checkedIn, id],
    }));

  return (
    <View style={s.screen}>
      <View style={s.header}>
        <Pressable
          onPress={() => update((p) => ({ ...p, stage: 'select' }))}
          accessibilityRole="button"
          aria-label="Back to Plan visits"
          style={({ pressed }) => [s.back, pressed && { opacity: 0.6 }]}
        >
          <ArrowLeft size={22} color={color.navy} />
        </Pressable>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt style={type.screenTitle}>Visits</Txt>
          <Txt style={type.bodySm}>
            Today · {n} visit{n === 1 ? '' : 's'} ·{' '}
            {plan.optimized ? 'optimized (simulated)' : 'draft, not optimized'}
          </Txt>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
        <MapView
          style={s.map}
          center={start.point}
          zoom={zoom}
          pins={pins}
          origin={mapOrigin}
          route={route}
          fit={fit}
        />

        <View style={s.statBar}>
          <View style={s.stat}>
            <Txt style={s.statValue}>{n}</Txt>
            <Txt style={s.statLabel}>visits · {n * MINUTES_PER_VISIT} min</Txt>
          </View>
          <View style={s.stat}>
            <Txt style={s.statValue}>{km.toFixed(1)}</Txt>
            <Txt style={s.statLabel}>km straight-line</Txt>
          </View>
          <View style={s.stat}>
            <Txt style={s.statValue}>
              {done}/{n}
            </Txt>
            <Txt style={s.statLabel}>completed</Txt>
          </View>
        </View>

        <View style={{ paddingHorizontal: 16, paddingTop: 12, gap: 6 }}>
          {plan.optimized ? (
            <OutlineButton
              label="Optimized · nearest stop first"
              onPress={() => update((p) => ({ ...p, optimized: false }))}
            />
          ) : (
            <PrimaryButton
              label="Optimize route order"
              onPress={() => update((p) => ({ ...p, optimized: true }))}
            />
          )}
          <Txt style={[type.caption, { fontSize: 11 }]}>
            Simulated straight-line distances, not real road navigation.
          </Txt>
        </View>

        <View style={s.cards}>
          {n === 0 ? (
            <Txt style={[type.body, { textAlign: 'center', paddingVertical: 16 }]}>
              None of the planned prospects are available any more. Go back to plan again.
            </Txt>
          ) : null}
          {order.map((c, i) => {
            const isIn = checked.has(c.id);
            return (
              <View key={c.id} style={s.card}>
                <View style={s.cardTop}>
                  <View style={[s.num, { backgroundColor: isIn ? P.green : color.navy }]}>
                    <Txt style={s.numText}>{i + 1}</Txt>
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <View style={s.rowBetween}>
                      <Txt style={s.name} numberOfLines={1}>
                        {c.name}
                      </Txt>
                      <Txt style={s.time}>{timeSlot(i)}</Txt>
                    </View>
                    <Txt style={type.caption}>
                      {c.commune} · priority {c.score}
                    </Txt>
                  </View>
                </View>
                <Txt style={type.bodySm}>{purposeFor(c.group)}</Txt>
                {plan.checks[c.id]?.map((check) => (
                  <Txt key={check} style={s.check}>
                    ☐ {check}
                  </Txt>
                ))}
                <View style={s.pills}>
                  {c.contactConfirmed ? null : (
                    <Pill label="Contact not confirmed" bg={color.bg} fg={color.text3} />
                  )}
                  {c.locationVerified ? null : (
                    <Pill label="Location not verified" bg={color.bg} fg={color.text3} />
                  )}
                </View>
                <Pressable
                  onPress={() => toggleCheckIn(c.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isIn }}
                  aria-label={isIn ? `Checked in at ${c.name}. Undo` : `Check in at ${c.name}`}
                  style={({ pressed }) => [
                    s.checkBtn,
                    isIn ? s.checkBtnOn : s.checkBtnOff,
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  {isIn ? <Check size={16} color={color.surface} strokeWidth={3} /> : null}
                  <Txt style={[s.checkText, { color: isIn ? color.surface : color.navy }]}>
                    {isIn ? 'Checked in' : 'Check in'}
                  </Txt>
                </Pressable>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: color.surface,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
    paddingTop: 10,
    paddingLeft: 4,
    paddingRight: 16,
    paddingBottom: 10,
  },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  map: { height: 220, backgroundColor: '#E9ECE6' },
  statBar: {
    marginTop: -16,
    marginHorizontal: 16,
    backgroundColor: color.navy,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    gap: 8,
    zIndex: 2,
  },
  stat: { flex: 1 },
  statValue: { fontFamily: font.mono, fontSize: 20, color: color.surface },
  statLabel: { fontFamily: font.regular, fontSize: 12, color: color.navySoft },
  cards: { paddingHorizontal: 16, paddingTop: 10, gap: 10 },
  card: {
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 8,
  },
  cardTop: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  num: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  numText: { fontFamily: font.mono, fontSize: 13, color: color.surface },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  name: { fontFamily: font.semibold, fontSize: 15, color: color.text, flex: 1 },
  time: { fontFamily: font.mono, fontSize: 13, color: color.navy },
  check: { fontFamily: font.semibold, fontSize: 13, color: color.pendText },
  pills: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  checkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
  },
  checkBtnOff: { backgroundColor: color.surface, borderColor: color.navy },
  checkBtnOn: { backgroundColor: P.green, borderColor: P.green },
  checkText: { fontFamily: font.semibold, fontSize: 14 },
});
