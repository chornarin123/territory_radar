import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ArrowUpDown, Check } from 'lucide-react-native';
import { MapView } from '../../components/map/MapView';
import { PrimaryButton, Segmented, Txt } from '../../components/ui';
import {
  MINUTES_PER_VISIT,
  RADII,
  byPriority,
  formatDistance,
  formatRadius,
  nextRadius,
  routeLength,
  withDistances,
  type Radius,
} from '../../data/visitPlan';
import type { Origin } from '../../data/useOrigin';
import type { VisitPlan } from '../../data/useVisitPlan';
import { color, font } from '../../theme/tokens';
import { LocationLine, P, type Candidate } from './shared';

type Sort = 'nearest' | 'priority';

/**
 * Plan visits: prospects around the officer, within a radius they choose, ticked
 * into today's plan. Straight-line distances only.
 */
export function PlanVisits({
  origin,
  candidates,
  plan,
  update,
  center,
  zoom,
}: {
  origin: Origin;
  candidates: Candidate[];
  plan: VisitPlan;
  update: (change: (p: VisitPlan) => VisitPlan) => void;
  center: { lat: number; lng: number };
  zoom: number;
}) {
  const [radius, setRadius] = useState<Radius>(2000);
  const [sort, setSort] = useState<Sort>('nearest');

  // Distances change only when the origin does (moves under 50 m are ignored upstream).
  const all = useMemo(() => withDistances(candidates, origin.point), [candidates, origin.point]);
  const inside = useMemo(() => {
    const list = all.filter((c) => c.distance <= radius);
    return sort === 'priority' ? [...list].sort(byPriority) : list;
  }, [all, radius, sort]);
  const next = nextRadius(radius);
  const more = next ? all.filter((c) => c.distance > radius && c.distance <= next).length : 0;

  const picked = new Set(plan.ids);
  const byId = useMemo(() => new Map(all.map((c) => [c.id, c])), [all]);
  const selected = plan.ids.map((id) => byId.get(id)).filter((c) => c !== undefined);
  const outsideSelected = selected.filter((c) => c.distance > radius).length;
  const km = routeLength(origin.point, selected) / 1000;

  const toggle = useCallback(
    (id: string) =>
      update((p) => ({
        ...p,
        ids: p.ids.includes(id) ? p.ids.filter((x) => x !== id) : [...p.ids, id],
      })),
    [update],
  );

  // Frame the circle when the radius or the origin changes, not on every tick.
  const fitKey = `${radius}|${origin.point.lat},${origin.point.lng}`;
  const framed = useRef(fitKey);
  const fit = framed.current !== fitKey;
  useEffect(() => {
    framed.current = fitKey;
  }, [fitKey]);

  // Numbered pins match the list rank; the rest are grey dots.
  const { pins, dots } = useMemo(() => {
    const rank = new Map(inside.map((c, i) => [c.id, i + 1]));
    const on = new Set(plan.ids);
    const shown = all.filter((c) => rank.has(c.id) || on.has(c.id));
    return {
      pins: shown.map((c) => ({
        id: c.id,
        lat: c.lat,
        lng: c.lng,
        // Selected but outside the radius: still on the plan, so still a pin.
        label: rank.has(c.id) ? String(rank.get(c.id)) : '✓',
        color: on.has(c.id) ? P.amber : P.navy,
      })),
      dots: all
        .filter((c) => !rank.has(c.id) && !on.has(c.id))
        .map(({ lat, lng }) => ({ lat, lng })),
    };
  }, [all, inside, plan.ids]);
  const mapOrigin = useMemo(
    () => ({ ...origin.point, label: origin.kind === 'gps' ? 'You' : 'Branch' }),
    [origin],
  );
  const circle = useMemo(() => ({ ...origin.point, radius }), [origin.point, radius]);

  const n = plan.ids.length;
  const radiusText = formatRadius(radius);

  return (
    <View style={s.screen}>
      <View style={s.header}>
        <Txt style={s.title}>Plan visits</Txt>
        <LocationLine origin={origin} />
      </View>

      <View style={s.map}>
        <MapView
          style={StyleSheet.absoluteFill}
          center={center}
          zoom={zoom}
          pins={pins}
          dots={dots}
          origin={mapOrigin}
          circle={circle}
          fit={fit}
          onPinPress={toggle}
        />
        <View style={s.radiusPill}>
          <Txt style={s.radiusPillText}>Radius {radiusText} · straight-line</Txt>
        </View>
      </View>

      <View style={s.controls}>
        <View style={{ flex: 1 }}>
          <Segmented
            value={String(radius)}
            onChange={(r) => setRadius(Number(r) as Radius)}
            options={RADII.map((r) => ({ id: String(r), label: formatRadius(r) }))}
          />
        </View>
        <Pressable
          onPress={() => setSort((x) => (x === 'nearest' ? 'priority' : 'nearest'))}
          accessibilityRole="button"
          aria-label={`Sorted by ${sort}. Sort by ${sort === 'nearest' ? 'priority' : 'distance'}`}
          style={({ pressed }) => [s.sortBtn, pressed && { opacity: 0.7 }]}
        >
          <ArrowUpDown size={16} color={color.navy} />
          <Txt style={s.sortText}>{sort === 'nearest' ? 'Nearest' : 'Priority'}</Txt>
        </Pressable>
      </View>

      <View style={s.countRow}>
        <Txt style={s.count}>
          {inside.length} prospect{inside.length === 1 ? '' : 's'} within {radiusText}
        </Txt>
        {next && more ? (
          <Pressable onPress={() => setRadius(next)} accessibilityRole="link" hitSlop={10}>
            <Txt style={s.link}>
              {more} more · widen to {formatRadius(next)}
            </Txt>
          </Pressable>
        ) : null}
      </View>
      {outsideSelected ? (
        <Txt style={s.outside}>
          {outsideSelected} selected outside {radiusText}
        </Txt>
      ) : null}

      <ScrollView style={{ flex: 1 }} contentContainerStyle={s.list}>
        {inside.length === 0 ? (
          <Txt style={s.empty}>No prospects within {radiusText}. Try a wider radius.</Txt>
        ) : (
          inside.map((c, i) => {
            const on = picked.has(c.id);
            return (
              <Pressable
                key={c.id}
                onPress={() => toggle(c.id)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                aria-label={`Add ${c.name} to visit plan`}
                style={({ pressed }) => [s.row, on && s.rowOn, pressed && { opacity: 0.85 }]}
              >
                <View style={s.tick}>
                  <View style={[s.box, on ? s.boxOn : s.boxOff]}>
                    {on ? <Check size={15} color={color.surface} strokeWidth={3} /> : null}
                  </View>
                </View>
                <View style={[s.rank, { backgroundColor: on ? P.amber : P.navy }]}>
                  <Txt style={s.rankText}>{i + 1}</Txt>
                </View>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Txt style={s.name} numberOfLines={1}>
                    {c.name}
                  </Txt>
                  <Txt style={s.sub} numberOfLines={1}>
                    {c.commune} · {c.signal}
                  </Txt>
                </View>
                <View style={s.right}>
                  <Txt style={s.distance}>{formatDistance(c.distance)}</Txt>
                  <Txt style={s.score}>P{c.score}</Txt>
                </View>
              </Pressable>
            );
          })
        )}
      </ScrollView>

      <View style={s.bar}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt style={s.barTitle}>
            {n} visit{n === 1 ? '' : 's'} selected
          </Txt>
          <Txt style={s.barSub} numberOfLines={1}>
            ~{km.toFixed(1)} km straight-line · {n * MINUTES_PER_VISIT} min on site
          </Txt>
        </View>
        <PrimaryButton
          label="Plan route →"
          disabled={!n}
          onPress={() =>
            update((p) => ({
              ...p,
              stage: 'route',
              start: origin,
              checkedIn: p.checkedIn.filter((id) => p.ids.includes(id)),
            }))
          }
          style={{ paddingHorizontal: 18 }}
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  header: {
    backgroundColor: color.surface,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
    paddingTop: 14,
    paddingHorizontal: 16,
    paddingBottom: 10,
    gap: 4,
  },
  title: { fontFamily: font.bold, fontSize: 22, color: color.text },
  map: { height: 240, backgroundColor: '#E9ECE6' },
  radiusPill: {
    pointerEvents: 'none',
    position: 'absolute',
    left: 10,
    bottom: 10,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  radiusPillText: { fontFamily: font.semibold, fontSize: 12, color: color.text },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  sortBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 46,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: color.borderStrong,
    backgroundColor: color.surface,
  },
  sortText: { fontFamily: font.semibold, fontSize: 13, color: color.navy },
  countRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  count: { fontFamily: font.semibold, fontSize: 14, color: color.text },
  link: {
    fontFamily: font.semibold,
    fontSize: 13,
    color: P.link,
    textDecorationLine: 'underline',
  },
  outside: {
    fontFamily: font.regular,
    fontSize: 12,
    color: color.pendText,
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  list: { padding: 16, paddingTop: 10, gap: 8 },
  empty: {
    fontFamily: font.regular,
    fontSize: 14,
    color: color.text3,
    textAlign: 'center',
    paddingVertical: 24,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 72,
    paddingRight: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  rowOn: { backgroundColor: P.amberBg, borderColor: P.amberBorder },
  tick: { width: 44, alignSelf: 'stretch', alignItems: 'flex-end', justifyContent: 'center' },
  box: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { backgroundColor: color.navy, borderColor: color.navy },
  boxOff: { backgroundColor: color.surface, borderColor: '#8a94a6' },
  rank: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rankText: { fontFamily: font.mono, fontSize: 12, color: color.surface },
  name: { fontFamily: font.semibold, fontSize: 15, color: color.text },
  sub: { fontFamily: font.regular, fontSize: 13, color: color.text3 },
  right: { alignItems: 'flex-end', gap: 2 },
  distance: { fontFamily: font.semibold, fontSize: 14, color: color.text },
  score: { fontFamily: font.mono, fontSize: 11, color: color.text3 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: color.surface,
    borderTopWidth: 1,
    borderTopColor: color.border,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  barTitle: { fontFamily: font.bold, fontSize: 15, color: color.text },
  barSub: { fontFamily: font.regular, fontSize: 12, color: color.text3 },
});
