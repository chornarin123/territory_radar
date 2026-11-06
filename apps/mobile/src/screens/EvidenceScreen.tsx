import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type ScrollViewInstance,
} from 'react-native';
import {
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  ExternalLink,
  Map as MapIcon,
  MessageCircle,
  SignalHigh,
  SignalLow,
  SignalMedium,
} from 'lucide-react-native';
import { READ_WIDTH, readColumn, useGutter } from '../components/layout';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, api } from '../api/client';
import { OutlineButton, Txt } from '../components/ui';
import { LOAN_LABEL, rankCommunes, communesIn } from '../data/areaDemand';
import {
  communeKind,
  districtKind,
  mappable,
  sourceLink,
  type EvidenceItem,
  type EvidencePack,
  type RadarAction,
} from '../data/evidence';
import { useAreaDemand } from '../data/useAreaDemand';
import { useAreaTree } from '../data/useAreaTree';
import type { RootScreenProps } from '../navigation/types';
import { color, font } from '../theme/tokens';
import { AskRadarSheet } from './evidence/AskRadarSheet';
import { EvidenceMapSheet, type EvidenceMapView } from './evidence/EvidenceMapSheet';

// From the evidence-screen spec.
const C = {
  headText: '#e8edf5',
  headSoft: '#a9b7cc',
  chipBg: '#1c3560',
  chipBorder: '#2f4870',
  baseline: '#c5ccd8',
  blues: ['#1c3a72', '#4b72b3', '#89a7d4', '#bccde6'],
  ok: '#15803d',
  label: '#5b6576',
};

const CONFIDENCE = {
  high: { label: 'High confidence', Icon: SignalHigh, fg: '#bbf7d0', border: '#15803d' },
  medium: { label: 'Medium confidence', Icon: SignalMedium, fg: '#fde68a', border: '#b45309' },
  low: { label: 'Low confidence', Icon: SignalLow, fg: '#d5dbe4', border: '#5b6576' },
} as const;

const segmentColor = (item: EvidenceItem, i: number) =>
  item.n === 0 ? C.baseline : C.blues[Math.min(i - 1, C.blues.length - 1)]!;

/** "Why this score": the public evidence behind a sangkat's demand score. */
export function EvidenceScreen({ route, navigation }: RootScreenProps<'Evidence'>) {
  const { code, loanType, chat } = route.params;
  const insets = useSafeAreaInsets();
  const [pack, setPack] = useState<EvidencePack | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [chatOpen, setChatOpen] = useState(!!chat);
  const [mapView, setMapView] = useState<EvidenceMapView | null>(null);
  const [verdict, setVerdict] = useState<'agree' | 'disagree' | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    api.evidence(code, loanType).then(
      (p) => {
        if (!live) return;
        setPack(p);
        // The first real signal starts open; the baseline is context.
        setExpanded((e) => e ?? p.breakdown.find((i) => i.n > 0)?.n ?? null);
      },
      (e: unknown) =>
        live &&
        setError(
          e instanceof ApiError && e.status === 404 && /Route not found/.test(e.message)
            ? 'The server is out of date: restart it (pnpm mock:server).'
            : e instanceof Error
              ? e.message
              : String(e),
        ),
    );
    return () => {
      live = false;
    };
  }, [code, loanType, attempt]);

  // "Compare with {top neighbour}": the best-scoring other sangkat in the khan.
  const { tree } = useAreaTree();
  const { data: demand } = useAreaDemand(code.slice(0, 2));
  const neighbour = useMemo(() => {
    const node = tree?.byCode.get(code);
    if (!node?.parent || !demand) return null;
    const others = communesIn(node.parent).filter((n) => n.code !== code);
    return rankCommunes(others, demand.demand, loanType)[0]?.node.name_en ?? null;
  }, [tree, demand, code, loanType]);

  // Scrolling to a cited card: remember where each card sits.
  const scroller = useRef<ScrollViewInstance>(null);
  const gutter = useGutter(READ_WIDTH);
  const cardsTop = useRef(0);
  const cardY = useRef(new Map<number, number>());
  const scrollToCard = useCallback((n: number) => {
    setExpanded(n);
    // After the accordion re-lays out.
    setTimeout(() => {
      const y = cardY.current.get(n);
      if (y !== undefined)
        scroller.current?.scrollTo({ y: cardsTop.current + y - 12, animated: true });
    }, 80);
  }, []);

  const back = () =>
    navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Tabs', { screen: 'Radar' });

  const runAction = (a: RadarAction) => {
    if (!pack) return;
    if (a.type === 'plan_visits' && a.prospectIds?.length) {
      setChatOpen(false);
      navigation.navigate('Tabs', { screen: 'Visits', params: { preselect: a.prospectIds } });
    } else if (a.type === 'compare_area') {
      // The other area: the action may list this one too.
      const other = a.communeCodes?.find((c) => c !== code);
      if (!other) return;
      setChatOpen(false);
      navigation.push('Evidence', { code: other, loanType });
    } else if (a.type === 'show_on_map') {
      const wanted = new Set(a.prospectIds ?? []);
      const records = pack.breakdown.flatMap((i) => i.records);
      setChatOpen(false);
      setMapView({
        title: a.label,
        records: wanted.size
          ? records.filter((r) => r.prospectId && wanted.has(r.prospectId))
          : records,
        codes: a.communeCodes?.length ? a.communeCodes : [code],
      });
    }
  };

  const sendFeedback = async (v: 'agree' | 'disagree') => {
    if (!pack) return;
    setFeedbackError(null);
    try {
      await api.areaFeedback(code, { loanType, scanDate: pack.scanDate, verdict: v });
      setVerdict(v);
    } catch {
      setFeedbackError("Couldn't save that. Try again.");
    }
  };

  if (!pack) {
    return (
      <View style={[s.screen, s.center]}>
        {error ? (
          <>
            <Txt style={s.body}>{error}</Txt>
            <OutlineButton
              label="Try again"
              onPress={() => setAttempt((a) => a + 1)}
              style={{ width: 140 }}
            />
            <OutlineButton label="Back" onPress={back} style={{ width: 140 }} />
          </>
        ) : (
          <ActivityIndicator color={color.navy} />
        )}
      </View>
    );
  }

  const label = LOAN_LABEL[pack.loanType];
  const conf = CONFIDENCE[pack.confidence];
  const total = pack.breakdown.reduce((a, i) => a + i.points, 0) || 1;

  return (
    <View style={s.screen}>
      <View style={[s.head, { paddingHorizontal: gutter }]}>
        <Pressable
          onPress={back}
          accessibilityRole="button"
          aria-label="Back to Area demand"
          style={({ pressed }) => [s.back, pressed && { opacity: 0.7 }]}
        >
          <ChevronLeft size={20} color={C.headText} />
          <Txt style={s.backText}>Area demand</Txt>
        </Pressable>
        <View style={s.titleRow}>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Txt style={s.name}>{pack.name}</Txt>
            <Txt style={s.sub}>
              {communeKind(code)} · {districtKind(code)} {pack.districtName} · {label}
            </Txt>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Txt style={s.score}>{pack.score}</Txt>
            <Txt style={s.sub}>{label} score</Txt>
          </View>
        </View>
        <View style={s.chips}>
          <View style={[s.chip, { borderColor: conf.border }]}>
            <conf.Icon size={14} color={conf.fg} strokeWidth={2.5} />
            <Txt style={[s.chipText, { color: conf.fg }]}>{conf.label}</Txt>
          </View>
          <View style={s.chip}>
            <Txt style={s.chipText}>
              Scan {pack.scanDate} · {pack.signalsAvailable} of {pack.signalsTotal} signals
            </Txt>
          </View>
          {pack.sample ? (
            <View style={[s.chip, s.chipSample]}>
              <Txt style={s.chipText}>Sample evidence</Txt>
            </View>
          ) : null}
        </View>
      </View>

      <ScrollView
        ref={scroller}
        style={{ flex: 1 }}
        contentContainerStyle={[s.content, readColumn]}
      >
        <Txt style={s.h2}>What drives this score</Txt>
        <View
          style={s.bar}
          accessible
          accessibilityRole="image"
          accessibilityLabel={`Score ${pack.score}: ${pack.breakdown
            .map((i) => `${i.title} ${i.points} points`)
            .join(', ')}`}
        >
          {pack.breakdown
            .filter((i) => i.points > 0)
            .map((i) => (
              <View
                key={i.id}
                style={{
                  width: `${(i.points / total) * 100}%`,
                  backgroundColor: segmentColor(i, pack.breakdown.indexOf(i)),
                }}
              />
            ))}
        </View>

        <View style={{ gap: 8 }} onLayout={(e) => (cardsTop.current = e.nativeEvent.layout.y)}>
          {pack.breakdown.map((item, i) => {
            const open = expanded === item.n;
            const link = sourceLink(item);
            return (
              <View
                key={item.id}
                style={[s.card, open && s.cardOpen]}
                onLayout={(e) => cardY.current.set(item.n, e.nativeEvent.layout.y)}
              >
                <Pressable
                  onPress={() => setExpanded(open ? null : item.n)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open }}
                  aria-label={`Evidence ${item.n}: ${item.title}, plus ${item.points} points`}
                  style={s.cardHead}
                >
                  <View style={[s.badge, { backgroundColor: segmentColor(item, i) }]}>
                    <Txt style={[s.badgeText, item.n === 0 && { color: color.text }]}>{item.n}</Txt>
                  </View>
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Txt style={s.cardTitle}>{item.title}</Txt>
                    <Txt style={s.cardLine}>{item.line}</Txt>
                    <Txt style={s.cardSource}>
                      {item.source} · {item.date}
                    </Txt>
                  </View>
                  <Txt style={s.points}>+{item.points}</Txt>
                  {item.n > 0 ? (
                    open ? (
                      <ChevronUp size={18} color={C.label} />
                    ) : (
                      <ChevronDown size={18} color={C.label} />
                    )
                  ) : null}
                </Pressable>

                {open && item.n > 0 ? (
                  <View style={s.cardBody}>
                    {item.records.length ? (
                      item.records.map((r, k) => (
                        <View key={`${r.name}-${k}`} style={s.record}>
                          <Txt style={s.recordName} numberOfLines={1}>
                            {r.name}
                          </Txt>
                          <Txt style={s.recordTag} numberOfLines={1}>
                            {r.tag}
                          </Txt>
                          <Txt style={s.recordWhen}>{r.when}</Txt>
                        </View>
                      ))
                    ) : (
                      <Txt style={s.cardLine}>No individual records: this is an area figure.</Txt>
                    )}
                    {item.totalRecords > item.records.length ? (
                      <Txt style={s.cardSource}>
                        +{item.totalRecords - item.records.length} more
                      </Txt>
                    ) : null}
                    <View style={s.cardButtons}>
                      <Pressable
                        onPress={() =>
                          setMapView({
                            title: item.title,
                            records: mappable(item.records),
                            codes: [code],
                          })
                        }
                        accessibilityRole="button"
                        style={({ pressed }) => [s.smallBtn, pressed && { opacity: 0.7 }]}
                      >
                        <MapIcon size={16} color={color.navy} />
                        <Txt style={s.smallBtnText}>Show on map</Txt>
                      </Pressable>
                      <Pressable
                        onPress={() => link && void Linking.openURL(link)}
                        disabled={!link}
                        accessibilityRole="link"
                        accessibilityState={{ disabled: !link }}
                        style={({ pressed }) => [
                          s.smallBtn,
                          !link && { opacity: 0.45 },
                          pressed && { opacity: 0.7 },
                        ]}
                      >
                        <ExternalLink size={16} color={color.navy} />
                        <Txt style={s.smallBtnText}>Open source</Txt>
                      </Pressable>
                    </View>
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>

        <Txt style={s.h2}>What Radar can&apos;t see</Txt>
        <View style={s.panel}>
          {pack.limitations.map((l) => (
            <Txt key={l} style={s.bullet}>
              • {l}
            </Txt>
          ))}
        </View>

        <Txt style={s.h2}>Does this match what you see in {pack.name}?</Txt>
        {verdict ? (
          <Txt style={s.thanks}>
            {verdict === 'agree'
              ? 'Thanks — noted that this matches what you see.'
              : 'Thanks — noted that this doesn’t match. It helps calibrate Radar.'}
          </Txt>
        ) : (
          <View style={s.cardButtons}>
            <OutlineButton
              label="Yes, matches"
              onPress={() => void sendFeedback('agree')}
              style={{ flex: 1 }}
            />
            <OutlineButton
              label="Not really"
              onPress={() => void sendFeedback('disagree')}
              style={{ flex: 1 }}
            />
          </View>
        )}
        {feedbackError ? <Txt style={s.error}>{feedbackError}</Txt> : null}
      </ScrollView>

      <View style={[s.footer, { paddingHorizontal: gutter, paddingBottom: 10 + insets.bottom }]}>
        <Pressable
          onPress={() => setChatOpen(true)}
          accessibilityRole="button"
          style={({ pressed }) => [s.ask, pressed && { opacity: 0.85 }]}
        >
          <MessageCircle size={20} color={color.surface} />
          <Txt style={s.askText}>Ask Radar about {pack.name}</Txt>
        </Pressable>
      </View>

      <AskRadarSheet
        visible={chatOpen}
        onClose={() => setChatOpen(false)}
        pack={pack}
        neighbour={neighbour}
        onCite={(n) => {
          setChatOpen(false);
          scrollToCard(n);
        }}
        onOpenArea={(c) => {
          setChatOpen(false);
          navigation.push('Evidence', { code: c, loanType });
        }}
        onAction={runAction}
      />
      <EvidenceMapSheet
        view={mapView}
        onClose={() => setMapView(null)}
        onProspect={(id) => {
          setMapView(null);
          navigation.navigate('ProspectDetail', { id });
        }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  body: { fontFamily: font.regular, fontSize: 14, color: color.text2, textAlign: 'center' },
  head: { backgroundColor: color.navy, paddingHorizontal: 16, paddingBottom: 14, gap: 8 },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    minHeight: 44,
    alignSelf: 'flex-start',
  },
  backText: { fontFamily: font.semibold, fontSize: 14, color: C.headText },
  titleRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-end' },
  name: { fontFamily: font.bold, fontSize: 24, color: C.headText },
  sub: { fontFamily: font.regular, fontSize: 13, color: C.headSoft },
  score: { fontFamily: font.mono, fontSize: 40, lineHeight: 44, color: C.headText },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 28,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.chipBorder,
    backgroundColor: C.chipBg,
  },
  chipSample: { borderStyle: 'dashed', borderColor: C.headSoft, backgroundColor: 'transparent' },
  chipText: { fontFamily: font.semibold, fontSize: 12, color: C.headText },
  content: { padding: 16, gap: 12, paddingBottom: 24 },
  h2: { fontFamily: font.bold, fontSize: 16, color: color.text, paddingTop: 4 },
  bar: { flexDirection: 'row', height: 14, gap: 2, borderRadius: 7, overflow: 'hidden' },
  card: {
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: 14,
  },
  cardOpen: { borderColor: '#bccbe3' },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, minHeight: 64 },
  badge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontFamily: font.mono, fontSize: 12, color: color.surface },
  cardTitle: { fontFamily: font.semibold, fontSize: 15, color: color.text },
  cardLine: { fontFamily: font.regular, fontSize: 13, color: color.text2 },
  cardSource: { fontFamily: font.regular, fontSize: 12, color: C.label },
  points: { fontFamily: font.mono, fontSize: 15, color: color.navy },
  cardBody: {
    borderTopWidth: 1,
    borderTopColor: color.divider,
    padding: 12,
    gap: 8,
  },
  record: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 28 },
  recordName: { flex: 1, fontFamily: font.medium, fontSize: 13, color: color.text },
  recordTag: { maxWidth: 120, fontFamily: font.mono, fontSize: 11, color: C.label },
  recordWhen: { fontFamily: font.regular, fontSize: 12, color: C.label },
  cardButtons: { flexDirection: 'row', gap: 8 },
  smallBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: color.borderStrong,
    backgroundColor: color.surface,
  },
  smallBtnText: { fontFamily: font.semibold, fontSize: 13, color: color.navy },
  panel: {
    backgroundColor: color.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: color.border,
    padding: 12,
    gap: 6,
  },
  bullet: { fontFamily: font.regular, fontSize: 13, lineHeight: 19, color: color.text2 },
  thanks: { fontFamily: font.semibold, fontSize: 14, color: C.ok },
  error: { fontFamily: font.semibold, fontSize: 13, color: color.overdue },
  footer: {
    backgroundColor: color.surface,
    borderTopWidth: 1,
    borderTopColor: color.border,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  ask: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 52,
    borderRadius: 14,
    backgroundColor: color.navy,
  },
  askText: { fontFamily: font.bold, fontSize: 15, color: color.surface },
});
