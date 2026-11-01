import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { ChevronDown, MapPin } from 'lucide-react-native';
import { AreaPicker } from '../components/AreaPicker';
import { MapView, type MapAreas } from '../components/map/MapView';
import { Chip, InterestPill, OutlineButton, StatusPill, Txt } from '../components/ui';
import { useFilters } from '../data/FilterContext';
import { SIGNAL_GROUP_LABEL, type SignalGroup } from '../data/labels';
import { areaLabel, selectionBbox } from '../data/areas';
import { isOnRadar, matchesFilters, sortViews } from '../data/selectors';
import { loadShapes, useAreaTree } from '../data/useAreaTree';
import { useLoadedWorkspace } from '../data/WorkspaceProvider';
import type { TabParamList } from '../navigation/types';
import { bandColor, color, font, type } from '../theme/tokens';
import { AreaDemand } from './radar/AreaDemand';

const GROUPS = Object.keys(SIGNAL_GROUP_LABEL) as SignalGroup[];

// Header text and area button, from the area-filter spec.
const HEAD = { text: '#e8edf5', pill: '#1c3560', pillBorder: '#2f4870', track: '#0b1c36' };

export function RadarScreen() {
  const { ws, views } = useLoadedWorkspace();
  const { filters, setFilters } = useFilters();
  const nav = useNavigation();

  // Live prospects only (spec §3.2), narrowed by the shared filters.
  const visible = useMemo(
    () =>
      sortViews(
        views.filter((v) => isOnRadar(v) && matchesFilters(v, filters)),
        'priority',
      ),
    [views, filters],
  );
  const pinned = useMemo(() => visible.filter((v) => v.p.location), [visible]);
  const unpinned = visible.length - pinned.length;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = visible.find((v) => v.id === selectedId) ?? pinned[0] ?? visible[0] ?? null;

  // Re-frame the map when the filters change which pins or areas are shown, not
  // when a pin is tapped.
  const pinKey = pinned.map((v) => v.id).join(',') + '|' + filters.area.join(',');
  const framedKey = useRef(pinKey);
  const fit = framedKey.current !== pinKey;
  useEffect(() => {
    framedKey.current = pinKey;
  }, [pinKey]);

  const pins = useMemo(
    () =>
      pinned.map((v) => ({
        id: v.id,
        lat: v.p.location!.lat,
        lng: v.p.location!.lng,
        label: String(v.score),
        color: bandColor[v.band],
        selected: v.id === selected?.id,
        flagged: v.p.dataQuality.flags.length > 0,
      })),
    [pinned, selected?.id],
  );
  const onPinPress = useCallback((id: string) => setSelectedId(id), []);

  // Radar chips are a single-select view of the shared Signal filter.
  const pickGroup = (g: SignalGroup | null) => setFilters((f) => ({ ...f, sig: g ? [g] : [] }));

  // Area filter: the sheet counts radar prospects given every OTHER filter.
  const [areaOpen, setAreaOpen] = useState(false);
  const areaTree = useAreaTree();
  const areaPool = useMemo(
    () =>
      views
        .filter((v) => isOnRadar(v) && matchesFilters(v, filters, 'area'))
        .map((v) => v.communeCode),
    [views, filters],
  );
  const label = areaLabel(filters.area, areaTree.tree);

  // Prospects (pins) or Area demand (shaded sangkats); both use the area above.
  const [view, setView] = useState<'prospects' | 'demand'>('prospects');
  // Today's tiles open the Prospects view, whichever view was left open.
  const route = useRoute<RouteProp<TabParamList, 'Radar'>>();
  const askedView = route.params?.view;
  useEffect(() => {
    if (!askedView) return;
    setView(askedView);
    nav.setParams({ view: undefined } as never);
  }, [askedView, nav]);
  // With no area picked, Area demand shows the province most prospects are in.
  const homeProvince = useMemo(() => {
    const n = new Map<string, number>();
    for (const v of views) {
      const p = v.communeCode?.slice(0, 2);
      if (p) n.set(p, (n.get(p) ?? 0) + 1);
    }
    return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '12';
  }, [views]);

  // Frame the picked areas at once; their outlines follow when the polygons load.
  const [shapes, setShapes] = useState<{ key: string; features: unknown[] } | null>(null);
  const areaKey = filters.area.join(',');
  useEffect(() => {
    if (!areaKey) return;
    let live = true;
    loadShapes(areaKey.split(',')).then(
      (features) => live && setShapes({ key: areaKey, features }),
      () => undefined, // outlines are a nicety; the bbox still frames the map
    );
    return () => {
      live = false;
    };
  }, [areaKey]);
  const mapAreas = useMemo<MapAreas | null>(() => {
    const bbox = areaTree.tree && selectionBbox(filters.area, areaTree.tree);
    if (!bbox) return null;
    return { bbox, shapes: shapes?.key === areaKey ? shapes.features : [] };
  }, [areaTree.tree, filters.area, areaKey, shapes]);

  return (
    <View style={s.screen}>
      <View style={s.header}>
        <View style={s.titleRow}>
          <Txt style={s.title}>Radar</Txt>
          <Pressable
            onPress={() => setAreaOpen(true)}
            accessibilityRole="button"
            aria-label={`Area: ${label}. Change area`}
            style={({ pressed }) => [s.areaBtn, pressed && { opacity: 0.8 }]}
          >
            <MapPin size={16} strokeWidth={2.2} color={HEAD.text} />
            <Txt style={s.areaText} numberOfLines={1}>
              {label}
            </Txt>
            <ChevronDown size={16} strokeWidth={2.2} color={HEAD.text} />
          </Pressable>
        </View>
        <View style={s.switch}>
          {(
            [
              ['prospects', 'Prospects'],
              ['demand', 'Area demand'],
            ] as const
          ).map(([id, text]) => {
            const on = view === id;
            return (
              <Pressable
                key={id}
                onPress={() => setView(id)}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                style={[s.switchItem, on && s.switchItemOn]}
              >
                <Txt style={[s.switchText, on && s.switchTextOn]}>{text}</Txt>
              </Pressable>
            );
          })}
        </View>
        {view === 'prospects' ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.chips}
          >
            {filters.newLeads ? (
              <Chip
                label="New leads ✕"
                selected
                onPress={() => setFilters((f) => ({ ...f, newLeads: false }))}
                onNavy
              />
            ) : null}
            <Chip
              label="All"
              selected={filters.sig.length === 0}
              onPress={() => pickGroup(null)}
              onNavy
            />
            {GROUPS.map((g) => (
              <Chip
                key={g}
                label={SIGNAL_GROUP_LABEL[g]}
                selected={filters.sig.includes(g)}
                onPress={() => pickGroup(g)}
                onNavy
              />
            ))}
          </ScrollView>
        ) : null}
      </View>

      {view === 'demand' ? (
        areaTree.tree ? (
          <AreaDemand
            tree={areaTree.tree}
            area={filters.area}
            setArea={(area) => setFilters((f) => ({ ...f, area }))}
            fallbackProvince={homeProvince}
            onViewProspects={(code) => {
              setFilters((f) => ({ ...f, area: [code] }));
              setView('prospects');
            }}
          />
        ) : (
          <View style={s.waiting}>
            {areaTree.error ? (
              <>
                <Txt style={type.bodySm}>Couldn&apos;t load the area list. {areaTree.error}</Txt>
                <OutlineButton label="Try again" onPress={areaTree.retry} style={{ width: 140 }} />
              </>
            ) : (
              <ActivityIndicator color={color.navy} />
            )}
          </View>
        )
      ) : null}

      <View style={[s.mapArea, view !== 'prospects' && s.hidden]}>
        <MapView
          style={StyleSheet.absoluteFill}
          center={ws.settings.mapDefaultCenter}
          zoom={ws.settings.mapDefaultZoom}
          pins={pins}
          areas={mapAreas}
          fit={fit}
          onPinPress={onPinPress}
        />

        <View style={s.legend}>
          {(['high', 'medium', 'low'] as const).map((b) => (
            <View key={b} style={s.legendItem}>
              <View style={[s.legendDot, { backgroundColor: bandColor[b] }]} />
              <Txt style={s.legendText}>{b[0]!.toUpperCase() + b.slice(1)}</Txt>
            </View>
          ))}
        </View>

        <View style={s.bottom}>
          {selected ? (
            <Pressable
              onPress={() => nav.navigate('ProspectDetail', { id: selected.id })}
              accessibilityRole="button"
              style={({ pressed }) => [s.card, pressed && { opacity: 0.9 }]}
            >
              <View style={s.cardTop}>
                <Txt style={[type.itemTitle, { flex: 1 }]} numberOfLines={1}>
                  {selected.name}
                </Txt>
                <Txt style={s.priority}>Priority {selected.score}</Txt>
              </View>
              <Txt style={type.bodySm} numberOfLines={1}>
                {selected.signal?.title ?? 'No signal'} · {selected.commune}
              </Txt>
              <View style={s.pills}>
                <InterestPill interest={selected.interest} />
                <StatusPill status={selected.status} />
              </View>
              <Txt style={s.footnote}>
                {visible.length} on radar
                {unpinned ? ` · ${unpinned} without location, see Prospects list` : ''} · pins are
                approximate
              </Txt>
            </Pressable>
          ) : (
            <View style={s.card}>
              <Txt style={type.body}>No prospects match these filters.</Txt>
            </View>
          )}
        </View>
      </View>

      <AreaPicker
        visible={areaOpen}
        onClose={() => setAreaOpen(false)}
        tree={areaTree.tree}
        error={areaTree.error}
        onRetry={areaTree.retry}
        communeCodes={areaPool}
        selected={filters.area}
        onApply={(area) => setFilters((f) => ({ ...f, area }))}
      />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  header: { backgroundColor: color.navy, paddingVertical: 14, paddingHorizontal: 16, gap: 10 },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  title: { fontFamily: font.bold, fontSize: 22, color: HEAD.text },
  areaBtn: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: HEAD.pillBorder,
    backgroundColor: HEAD.pill,
  },
  areaText: { flexShrink: 1, fontFamily: font.semibold, fontSize: 14, color: HEAD.text },
  chips: { gap: 8 },
  switch: { flexDirection: 'row', backgroundColor: HEAD.track, borderRadius: 12, padding: 4 },
  switchItem: {
    flex: 1,
    minHeight: 40,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  switchItemOn: { backgroundColor: color.surface },
  switchText: { fontFamily: font.semibold, fontSize: 14, color: HEAD.text },
  switchTextOn: { fontFamily: font.bold, color: color.navy },
  waiting: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  hidden: { display: 'none' },
  mapArea: { flex: 1, position: 'relative', backgroundColor: '#E9ECE6' },
  legend: {
    pointerEvents: 'none',
    position: 'absolute',
    right: 12,
    top: 12,
    flexDirection: 'row',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontFamily: font.regular, fontSize: 11, color: color.text2 },
  bottom: { position: 'absolute', left: 12, right: 12, bottom: 12 },
  card: {
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 6,
  },
  cardTop: { flexDirection: 'row', gap: 10, alignItems: 'baseline' },
  priority: { fontFamily: font.mono, fontSize: 13, color: color.navy },
  pills: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  footnote: { fontFamily: font.regular, fontSize: 11, color: color.text3 },
});
