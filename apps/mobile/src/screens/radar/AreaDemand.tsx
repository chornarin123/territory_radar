import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { MapView, type MapChoropleth } from '../../components/map/MapView';
import { NO_TILES_BG } from '../../components/map/mapHtml';
import { useNavigation } from '@react-navigation/native';
import { PANEL_WIDTH, useWide } from '../../components/layout';
import { OutlineButton, PrimaryButton, Txt } from '../../components/ui';
import {
  BIN_COLORS,
  LOAN_LABEL,
  LOAN_TYPES,
  OUTSIDE_COLOR,
  averageScore,
  communesIn,
  demandScope,
  fillFor,
  lightTextOn,
  mixBarWidth,
  scoreMeaning,
  mixRows,
  rankCommunes,
  shortName,
  type LoanType,
} from '../../data/areaDemand';
import { countOf, kindOf, selectionBbox, type AreaTree } from '../../data/areas';
import { useAreaDemand } from '../../data/useAreaDemand';
import { color, font } from '../../theme/tokens';

// From the Area demand spec.
const C = {
  amber: '#f59e0b',
  amberBg: '#fff7eb',
  bar: '#4b72b3',
  track: '#eef1f5',
  chipBorder: '#d5dbe4',
  link: '#1d4ed8',
  label: '#5b6576',
};

/** In a province, the ranking shows this many; a khan shows all its sangkats. */
const PROVINCE_TOP = 10;

/** Province view: khan labels below this Leaflet zoom, sangkat labels from it. */
const SANGKAT_LABEL_ZOOM = 13;

/**
 * Radar's Area demand view: sangkats shaded by predicted demand for one loan type,
 * and the picked sangkat's loan mix. Scope follows the shared area filter; every
 * number comes from getAreaDemand().
 */
export function AreaDemand({
  tree,
  area,
  setArea,
  fallbackProvince,
  onViewProspects,
}: {
  tree: AreaTree;
  area: string[];
  setArea: (codes: string[]) => void;
  fallbackProvince: string;
  onViewProspects: (communeCode: string) => void;
}) {
  const nav = useNavigation();
  const [type, setType] = useState<LoanType>('car');
  const { scope, focus } = useMemo(
    () => demandScope(area, tree, fallbackProvince),
    [area, tree, fallbackProvince],
  );
  const province = tree.byCode.get(scope.code.slice(0, 2))!;
  const isKhan = scope.level === 'district';
  const { data, error, retry } = useAreaDemand(province.code);

  // A sangkat picked in the area filter becomes the selection.
  const [picked, setPicked] = useState<string | null>(focus);
  useEffect(() => {
    if (focus) setPicked(focus);
  }, [focus]);

  const inScope = useMemo(() => communesIn(scope), [scope]);
  const ranked = useMemo(
    () => (data ? rankCommunes(inScope, data.demand, type) : []),
    [data, inScope, type],
  );
  // Keep the pick across loan types while it is in scope; else the top-ranked.
  const selectedCode =
    picked && ranked.some((r) => r.node.code === picked) ? picked : (ranked[0]?.node.code ?? null);
  const selected = selectedCode ? tree.byCode.get(selectedCode)! : null;
  const rank = ranked.findIndex((r) => r.node.code === selectedCode) + 1;

  const choropleth = useMemo<MapChoropleth | null>(() => {
    if (!data) return null;
    const scores = data.demand.communes;
    const inside = (code: string) => code.startsWith(scope.code);
    const shaped = new Set(data.communes.features.map((f) => f.properties.code));
    const geometryOf = (code: string) =>
      data.communes.features.find((f) => f.properties.code === code)?.geometry;
    const sel = selectedCode ? tree.byCode.get(selectedCode) : null;
    const sangkatLabel = (r: (typeof ranked)[number], minZoom?: number) => ({
      lat: r.node.lat,
      lng: r.node.lng,
      name: shortName(r.node.name_en),
      score: r.score,
      light: lightTextOn(r.score),
      minZoom,
    });
    // The provinces around this one, by their average score, so zooming out
    // shows more of the country rather than empty background. Tap to open one.
    const around = data.provinces.features
      .filter((f) => f.properties.code !== province.code)
      .map((f) => {
        const s = data.demand.provinces?.[f.properties.code]?.[type];
        return {
          code: f.properties.code,
          geometry: f.geometry,
          fill: s !== undefined ? fillFor(s) : OUTSIDE_COLOR,
          faded: true,
        };
      });
    return {
      shapes: [
        ...around,
        ...data.communes.features.map((f) => {
          const s = scores[f.properties.code]?.score[type];
          return {
            code: f.properties.code,
            geometry: f.geometry,
            // Every sangkat in its own blue; those outside the khan are faded.
            fill: s !== undefined ? fillFor(s) : OUTSIDE_COLOR,
            faded: !inside(f.properties.code),
          };
        }),
      ],
      // Sangkats known only as a point still get their shade, as a circle.
      points: inScope
        .filter((n) => !shaped.has(n.code) && scores[n.code])
        .map((n) => ({
          code: n.code,
          lat: n.lat,
          lng: n.lng,
          fill: fillFor(scores[n.code]!.score[type]),
        })),
      outline: isKhan
        ? (data.outlines.features.find((f) => f.properties.code === scope.code)?.geometry ?? null)
        : null,
      selected: sel
        ? shaped.has(sel.code)
          ? { code: sel.code, geometry: geometryOf(sel.code) }
          : { code: sel.code, lat: sel.lat, lng: sel.lng }
        : null,
      // A khan: every sangkat named. A province: khan names and average scores
      // zoomed out, sangkat names once zoomed in far enough to read them.
      labels: isKhan
        ? ranked.map((r) => sangkatLabel(r))
        : [
            ...province.children.flatMap((k) => {
              const avg = averageScore(communesIn(k), data.demand, type);
              return avg === null
                ? []
                : [
                    {
                      lat: k.lat,
                      lng: k.lng,
                      name: shortName(k.name_en),
                      score: avg,
                      light: lightTextOn(avg),
                      maxZoom: SANGKAT_LABEL_ZOOM - 1,
                    },
                  ];
            }),
            ...ranked.map((r) => sangkatLabel(r, SANGKAT_LABEL_ZOOM)),
          ],
      bbox: selectionBbox(
        inScope.map((n) => n.code),
        tree,
      )!,
    };
  }, [data, scope, inScope, isKhan, ranked, selectedCode, tree, type, province]);

  // Frame the scope when it changes, or once its data arrives.
  const fitKey = `${scope.code}|${data ? 1 : 0}`;
  const framed = useRef<string | null>(null);
  const fit = framed.current !== fitKey;
  useEffect(() => {
    framed.current = fitKey;
  }, [fitKey]);

  const onRegion = useCallback(
    (code: string) => {
      if (!tree.byCode.has(code)) return;
      // A neighbouring province: open it.
      if (code.length === 2) return setArea([code]);
      // Outside the khan: switch the scope to its khan, then select it.
      if (isKhan && !code.startsWith(scope.code)) setArea([code.slice(0, 4)]);
      setPicked(code);
    },
    [tree, isKhan, scope.code, setArea],
  );

  const label = LOAN_LABEL[type];
  const scopeTitle = isKhan ? `${kindOf(scope)} ${scope.name_en}` : scope.name_en;
  const unit = inScope[0] ? kindOf(inScope[0]).toLowerCase() : 'sangkat';
  const d = selected && data ? data.demand.communes[selected.code] : undefined;
  const ranking = isKhan ? ranked : ranked.slice(0, PROVINCE_TOP);
  const wide = useWide();

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={s.chipBar}
        contentContainerStyle={s.chips}
      >
        {LOAN_TYPES.map((t) => {
          const on = t === type;
          return (
            <Pressable
              key={t}
              onPress={() => setType(t)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={({ pressed }) => [
                s.chip,
                on ? s.chipOn : s.chipOff,
                pressed && { opacity: 0.75 },
              ]}
            >
              <Txt style={[s.chipText, { color: on ? color.surface : color.navy }]}>
                {LOAN_LABEL[t]}
              </Txt>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={s.scopeRow}>
        <View style={s.crumbs}>
          {isKhan ? (
            <>
              <Pressable
                onPress={() => setArea([province.code])}
                accessibilityRole="link"
                aria-label={`Zoom out to ${province.name_en}`}
                hitSlop={{ top: 12, bottom: 12 }}
              >
                <Txt style={s.crumbLink}>{province.name_en}</Txt>
              </Pressable>
              <Txt style={s.crumbSep}>›</Txt>
            </>
          ) : null}
          <Txt style={s.crumbHere} numberOfLines={1}>
            {scopeTitle} · {countOf(inScope.length, 'commune', scope.code)}
          </Txt>
        </View>
        <View style={s.legend} accessibilityLabel="Score from 0 to 100, darker is higher">
          <Txt style={s.legendText}>0</Txt>
          {BIN_COLORS.map((c) => (
            <View key={c} style={[s.swatch, { backgroundColor: c }]} />
          ))}
          <Txt style={s.legendText}>100</Txt>
        </View>
      </View>

      {/* Wide screens: map on the left, details panel on the right. */}
      <View style={wide ? s.split : s.stack}>
        <View style={wide ? s.mapWide : s.map}>
          <MapView
            style={StyleSheet.absoluteFill}
            center={{ lat: province.lat, lng: province.lng }}
            zoom={11}
            basemap={false}
            pins={NO_PINS}
            choropleth={choropleth}
            fit={fit}
            onPinPress={onRegion}
            accessibilityLabel={`${label} demand by ${unit} in ${scopeTitle}`}
          />
          <View style={s.mapPill}>
            <Txt style={s.mapPillText}>
              {label} demand · tap a {unit}
            </Txt>
          </View>
          {!data ? (
            <View style={s.mapState}>
              {error ? (
                <>
                  <Txt style={s.meta}>Couldn&apos;t load demand data. {error}</Txt>
                  <OutlineButton label="Try again" onPress={retry} style={{ width: 140 }} />
                </>
              ) : (
                <ActivityIndicator color={color.navy} />
              )}
            </View>
          ) : null}
        </View>

        <ScrollView style={wide ? s.panel : s.stack} contentContainerStyle={s.body}>
          {selected && d ? (
            <View style={s.card}>
              <View style={s.cardHead}>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Txt style={s.cardTitle}>
                    {kindOf(selected)} {selected.name_en}
                  </Txt>
                  <Txt style={s.meta}>
                    {kindOf(selected.parent!)} {selected.parent!.name_en} · #{rank} of{' '}
                    {ranked.length} for {label}
                  </Txt>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Txt style={s.bigScore}>{d.score[type]}</Txt>
                  <Txt style={s.meta}>{label} score</Txt>
                  <Txt style={s.meta}>vs other {unit}s</Txt>
                </View>
              </View>
              <Txt style={s.explain}>{scoreMeaning(d.score[type], d.mix[type], label)}</Txt>

              <Txt style={s.section}>Loan mix in this {unit} · share of demand</Txt>
              {mixRows(d).map((row) => {
                const on = row.type === type;
                return (
                  <View key={row.type} style={s.mixRow}>
                    <Txt style={[s.mixLabel, on && { fontFamily: font.bold, color: color.text }]}>
                      {LOAN_LABEL[row.type]}
                    </Txt>
                    <View style={s.track}>
                      <View
                        style={[
                          s.fill,
                          {
                            width: `${mixBarWidth(row.pct)}%`,
                            backgroundColor: on ? C.amber : C.bar,
                          },
                        ]}
                      />
                    </View>
                    <Txt style={s.pct}>{row.pct}%</Txt>
                  </View>
                );
              })}

              <View style={s.whyRow}>
                <PrimaryButton
                  label={`Why ${d.score[type]}?`}
                  onPress={() => nav.navigate('Evidence', { code: selected.code, loanType: type })}
                  style={{ flex: 1 }}
                />
                <OutlineButton
                  label="Ask Radar"
                  onPress={() =>
                    nav.navigate('Evidence', { code: selected.code, loanType: type, chat: true })
                  }
                  style={{ flex: 1 }}
                />
              </View>
              <OutlineButton
                label={`View prospects in ${shortName(selected.name_en)}`}
                onPress={() => onViewProspects(selected.code)}
              />
            </View>
          ) : null}

          {ranking.length ? (
            <View style={s.card}>
              <Txt style={s.cardTitleSm}>
                {label} · top {unit}s in {scopeTitle}
              </Txt>
              {!isKhan && ranked.length > PROVINCE_TOP ? (
                <Txt style={s.meta}>
                  Top {PROVINCE_TOP} of {ranked.length}
                </Txt>
              ) : null}
              {ranking.map((r, i) => {
                const on = r.node.code === selectedCode;
                return (
                  <Pressable
                    key={r.node.code}
                    onPress={() => setPicked(r.node.code)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    aria-label={`${r.node.name_en}, rank ${i + 1}, score ${r.score}`}
                    style={({ pressed }) => [
                      s.rankRow,
                      on && s.rankRowOn,
                      pressed && { opacity: 0.75 },
                    ]}
                  >
                    <Txt style={s.rankNum}>{i + 1}</Txt>
                    <Txt style={s.rankName} numberOfLines={1}>
                      {r.node.name_en}
                    </Txt>
                    <View style={[s.track, { flex: 1 }]}>
                      <View
                        style={[
                          s.fill,
                          { width: `${r.score}%`, backgroundColor: on ? C.amber : C.bar },
                        ]}
                      />
                    </View>
                    <Txt style={s.rankScore}>{r.score}</Txt>
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          {data?.demand.sample ? (
            <Txt style={s.footnote}>
              Sample scores — score 0–100 = predicted demand relative to other {unit}s; loan mix =
              share of predicted demand inside the {unit}.
            </Txt>
          ) : null}
        </ScrollView>
      </View>
    </View>
  );
}

const NO_PINS: never[] = [];

const s = StyleSheet.create({
  chipBar: {
    flexGrow: 0,
    backgroundColor: color.surface,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  chips: { gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipOn: { backgroundColor: color.navy, borderColor: color.navy },
  chipOff: { backgroundColor: color.surface, borderColor: C.chipBorder },
  chipText: { fontFamily: font.semibold, fontSize: 14 },
  scopeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    backgroundColor: color.surface,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  crumbs: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 4 },
  crumbLink: {
    fontFamily: font.medium,
    fontSize: 13,
    color: C.link,
    textDecorationLine: 'underline',
  },
  crumbSep: { fontFamily: font.regular, fontSize: 13, color: C.label },
  crumbHere: { flexShrink: 1, fontFamily: font.bold, fontSize: 13, color: color.text },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  legendText: { fontFamily: font.mono, fontSize: 10, color: C.label },
  swatch: { width: 14, height: 10, borderRadius: 2 },
  map: { height: 290, backgroundColor: NO_TILES_BG },
  stack: { flex: 1 },
  split: { flex: 1, flexDirection: 'row' },
  mapWide: { flex: 1, backgroundColor: NO_TILES_BG },
  panel: {
    width: PANEL_WIDTH,
    flexGrow: 0,
    borderLeftWidth: 1,
    borderLeftColor: color.border,
    backgroundColor: color.bg,
  },
  mapPill: {
    pointerEvents: 'none',
    position: 'absolute',
    left: 10,
    top: 10,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  mapPillText: { fontFamily: font.semibold, fontSize: 12, color: color.text },
  mapState: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 24,
  },
  body: { padding: 16, gap: 12 },
  card: {
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: 16,
    padding: 14,
    gap: 8,
  },
  cardHead: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  cardTitle: { fontFamily: font.bold, fontSize: 17, color: color.text },
  cardTitleSm: { fontFamily: font.bold, fontSize: 15, color: color.text },
  bigScore: { fontFamily: font.mono, fontSize: 32, color: color.navy, lineHeight: 36 },
  meta: { fontFamily: font.regular, fontSize: 13, color: C.label },
  section: {
    fontFamily: font.bold,
    fontSize: 12,
    letterSpacing: 0.72,
    textTransform: 'uppercase',
    color: C.label,
    paddingTop: 6,
  },
  mixRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 24 },
  mixLabel: { width: 104, fontFamily: font.regular, fontSize: 13, color: color.text2 },
  track: { flex: 1, height: 8, borderRadius: 4, backgroundColor: C.track, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },
  pct: { width: 40, textAlign: 'right', fontFamily: font.mono, fontSize: 12, color: color.text },
  rankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 44,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  rankRowOn: { backgroundColor: C.amberBg },
  rankNum: { width: 22, fontFamily: font.mono, fontSize: 12, color: C.label },
  rankName: { width: 120, fontFamily: font.semibold, fontSize: 13, color: color.text },
  rankScore: {
    width: 28,
    textAlign: 'right',
    fontFamily: font.mono,
    fontSize: 13,
    color: color.text,
  },
  whyRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  explain: { fontFamily: font.regular, fontSize: 12, lineHeight: 17, color: C.label },
  footnote: { fontFamily: font.regular, fontSize: 11, color: C.label, lineHeight: 16 },
});
