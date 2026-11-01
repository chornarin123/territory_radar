import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { MessageCircle } from 'lucide-react-native';
import { api } from '../api/client';
import {
  Card,
  InterestPill,
  OutlineButton,
  Pill,
  PrimaryButton,
  SectionLabel,
  Segmented,
  StatusPill,
  Txt,
} from '../components/ui';
import { PRIORITY_FACTOR_LABEL, STATUS_LABEL, sectorLabel } from '../data/labels';
import { shortDate } from '../data/time';
import { useCoach } from '../data/CoachContext';
import { useLoadedWorkspace } from '../data/WorkspaceProvider';
import type { InterestStatus, ProspectStatus } from '../data/types';
import type { RootScreenProps } from '../navigation/types';
import { color, font, type } from '../theme/tokens';

type Tab = 'open' | 'ask' | 'verify';

const VERIFICATION_LABEL: Record<string, string> = {
  unverified_demo: 'unverified demo evidence',
  conflicting: 'conflicting evidence',
};

export function ProspectDetailScreen({ route, navigation }: RootScreenProps<'ProspectDetail'>) {
  const { ws, views, run, busy } = useLoadedWorkspace();
  const [tab, setTab] = useState<Tab>('open');
  const [error, setError] = useState<string | null>(null);
  const coach = useCoach();
  // Officer questions asked so far in this prospect's coach chat.
  const coachTurns = coach.chat(route.params.id).messages.filter((m) => m.role === 'user').length;

  const v = views.find((x) => x.id === route.params.id);

  const detail = useMemo(() => {
    if (!v) return null;
    const signals = ws.signals.filter((sg) => sg.prospectId === v.id);
    const evidence = new Map(ws.evidence.map((e) => [e.id, e]));
    const match = ws.productMatches.find((m) => m.prospectId === v.id && m.rank === 1) ?? null;
    const product = match ? (ws.products.find((p) => p.id === match.productId) ?? null) : null;
    const activities = ws.activities
      .filter((a) => a.prospectId === v.id)
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    const limitations = [...new Set(signals.flatMap((sg) => sg.limitations))].filter(
      (l) => !/^Synthetic evidence/i.test(l),
    );
    return { signals, evidence, match, product, activities, limitations };
  }, [v, ws]);

  // Not in this officer's workspace — the server never sent it (spec §4).
  if (!v || !detail) {
    return (
      <View style={[s.screen, { padding: 16 }]}>
        <Card>
          <Txt style={type.cardTitle}>Prospect not available</Txt>
          <Txt style={type.bodySm}>It is not in your territory, or it no longer exists.</Txt>
        </Card>
      </View>
    );
  }

  const p = v.p;
  const act = async (action: () => Promise<unknown>) => setError(await run(action));
  const setInterest = (i: InterestStatus) => {
    if (v.interest !== i) void act(() => api.recordInterest(p.id, i));
  };
  const moveTo = (to: ProspectStatus) => void act(() => api.transition(p.id, to));

  const factors = Object.keys(PRIORITY_FACTOR_LABEL) as (keyof typeof PRIORITY_FACTOR_LABEL)[];
  const moves = ws.stateTransitions[p.pipelineStatus] ?? [];
  const canCall = p.contact.canCall && ws.settings.allowExternalContactActions;
  const callLabel = !p.contact.canCall
    ? 'Call disabled · no contact consent'
    : 'Call disabled · bank setting';

  const rows =
    tab === 'open'
      ? detail.match
        ? [detail.match.suggestedOpening]
        : []
      : tab === 'ask'
        ? (detail.match?.discoveryQuestions ?? [])
        : (detail.match?.unverifiedRequirements ?? []);

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.body}>
      {/* Identity */}
      <View style={{ gap: 6 }}>
        <Txt style={s.h1}>{p.displayName}</Txt>
        <Txt style={type.bodySm}>
          {sectorLabel(p.sector)} · {v.commune}
          {p.businessProfile.operatingMonths
            ? ` · operating ~${p.businessProfile.operatingMonths} months`
            : ''}
        </Txt>
        <View style={s.pills}>
          <StatusPill status={p.pipelineStatus} />
          <InterestPill interest={v.interest} />
          {p.dataQuality.requiresOfficerVerification ? (
            <Pill
              label="Needs officer verification"
              fg={color.text2}
              outline={color.borderStrong}
            />
          ) : null}
        </View>
      </View>

      {/* Visit priority — never a probability (spec §4). */}
      <View style={s.priority}>
        <View style={s.priorityTop}>
          <View style={{ gap: 2 }}>
            <Txt style={s.priorityLabel}>VISIT PRIORITY</Txt>
            <Txt style={s.prioritySub}>Not a loan probability</Txt>
          </View>
          <Txt style={s.priorityScore}>
            {p.priority.score}
            <Txt style={s.priorityOf}>/100</Txt>
          </Txt>
        </View>
        {factors.map((k) => {
          const val = p.priority.factors[k];
          const max = p.priority.maxPoints[k];
          return (
            <View key={k} style={s.factor}>
              <Txt style={s.factorLabel}>{PRIORITY_FACTOR_LABEL[k]}</Txt>
              <View style={s.bar}>
                <View style={[s.barFill, { width: `${Math.round((val / max) * 100)}%` }]} />
              </View>
              <Txt style={s.factorValue}>
                {val}/{max}
              </Txt>
            </View>
          );
        })}
      </View>

      {/* Signals & evidence */}
      <Card>
        <Txt style={type.cardTitle}>Signals &amp; evidence</Txt>
        {detail.signals.map((sg) => {
          const ev = sg.evidenceIds.map((id) => detail.evidence.get(id)).find(Boolean);
          return (
            <View key={sg.id} style={s.divided}>
              <View style={s.rowBetween}>
                <Txt style={[s.signalTitle, { flex: 1 }]}>{sg.title}</Txt>
                <Pill
                  label={sg.strength}
                  bg={sg.strength === 'weak' ? color.bg : color.blueTint}
                  fg={sg.strength === 'weak' ? color.text3 : color.navy}
                />
              </View>
              <Txt style={type.bodySm}>{sg.interpretation}</Txt>
              {ev ? (
                <Txt style={type.caption}>
                  {ev.sourceName} · {shortDate(ev.publishedAt)} ·{' '}
                  {VERIFICATION_LABEL[ev.verificationStatus] ?? ev.verificationStatus}
                  {sg.freshness === 'stale' ? ' · ⏱ stale' : ''}
                </Txt>
              ) : null}
            </View>
          );
        })}
        {detail.limitations.length ? (
          <View style={s.note}>
            {detail.limitations.map((l) => (
              <Txt key={l} style={s.noteText}>
                {l}
              </Txt>
            ))}
          </View>
        ) : null}
      </Card>

      {/* Suggested discussion — not an eligibility decision. */}
      {detail.match && detail.product ? (
        <Card>
          <View style={s.rowBetween}>
            <Txt style={type.cardTitle}>Suggested discussion</Txt>
            <Txt style={[type.caption, { fontSize: 11 }]}>Not an eligibility decision</Txt>
          </View>
          <Txt style={s.product}>{detail.product.name}</Txt>
          <Segmented<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { id: 'open', label: 'Opening line' },
              { id: 'ask', label: 'Ask' },
              { id: 'verify', label: 'Still to verify' },
            ]}
          />
          {tab === 'ask' ? (
            <>
              <Txt style={type.caption}>Tap a question for coaching on how to ask it.</Txt>
              {rows.map((text, i) => (
                <Pressable
                  key={i}
                  onPress={() => navigation.navigate('Coach', { id: p.id, question: text })}
                  accessibilityRole="button"
                  accessibilityHint="Opens the discussion coach with this question"
                  style={({ pressed }) => [
                    s.askRow,
                    pressed && { backgroundColor: color.blueTint },
                  ]}
                >
                  <Txt style={s.tabNum}>{String(i + 1)}</Txt>
                  <Txt style={[type.body, { flex: 1, color: color.text }]}>{text}</Txt>
                  <MessageCircle size={18} color={color.navy} strokeWidth={2} />
                </Pressable>
              ))}
            </>
          ) : (
            rows.map((text, i) => (
              <View key={i} style={s.tabRow}>
                <Txt style={s.tabNum}>{tab === 'open' ? '“' : String(i + 1)}</Txt>
                <Txt style={[type.body, { flex: 1, color: color.text }]}>{text}</Txt>
              </View>
            ))
          )}
          <OutlineButton
            label={coachTurns ? `Continue coach chat (${coachTurns})` : 'Open discussion coach'}
            onPress={() => navigation.navigate('Coach', { id: p.id })}
            style={{ minHeight: 44 }}
          />
        </Card>
      ) : null}

      {/* Record outcome — officer actions only. */}
      <Card>
        <Txt style={type.cardTitle}>Record outcome</Txt>
        <Txt style={type.caption}>
          Financing interest is only recorded from a real conversation.
        </Txt>
        <View style={s.twoCol}>
          <OutlineButton
            label="Interest confirmed"
            active={v.interest === 'confirmed'}
            activeColor={color.okText}
            disabled={busy}
            onPress={() => setInterest('confirmed')}
            style={{ flex: 1 }}
          />
          <OutlineButton
            label="No financing need"
            active={v.interest === 'not_interested'}
            activeColor={color.text3}
            disabled={busy}
            onPress={() => setInterest('not_interested')}
            style={{ flex: 1 }}
          />
        </View>
        {moves.length ? (
          <>
            <View style={{ paddingTop: 4 }}>
              <SectionLabel>Move to</SectionLabel>
            </View>
            <View style={s.moves}>
              {moves.map((to) => (
                <OutlineButton
                  key={to}
                  label={STATUS_LABEL[to]}
                  disabled={busy}
                  onPress={() => moveTo(to)}
                  style={s.move}
                />
              ))}
            </View>
          </>
        ) : (
          <Txt style={type.caption}>
            {STATUS_LABEL[p.pipelineStatus]} is final — no further moves.
          </Txt>
        )}
        {error ? <Txt style={s.error}>{error}</Txt> : null}
        {detail.activities.slice(0, 5).map((a) => (
          <View key={a.id} style={[s.divided, s.logRow]}>
            <Txt style={s.logDate}>{shortDate(a.occurredAt)}</Txt>
            <Txt style={[type.caption, { color: color.text2, flex: 1 }]}>{a.note}</Txt>
          </View>
        ))}
      </Card>

      <View style={s.twoCol}>
        <PrimaryButton
          label="Plan a visit"
          onPress={() => navigation.navigate('Tabs', { screen: 'Visits' })}
          style={{ flex: 1 }}
        />
        <PrimaryButton
          label={canCall ? 'Call' : callLabel}
          disabled={!canCall}
          onPress={() => {}}
          style={{ flex: 1 }}
        />
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  body: { padding: 16, paddingTop: 14, gap: 12 },
  h1: { fontFamily: font.bold, fontSize: 24, lineHeight: 29, color: color.text },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingTop: 2 },
  priority: { backgroundColor: color.navy, borderRadius: 16, padding: 14, gap: 10 },
  priorityTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  priorityLabel: { fontFamily: font.bold, fontSize: 12, color: color.navySoft, letterSpacing: 0.5 },
  prioritySub: { fontFamily: font.regular, fontSize: 12, color: color.navySoft },
  priorityScore: { fontFamily: font.mono, fontSize: 34, color: color.surface },
  priorityOf: { fontFamily: font.mono, fontSize: 16, color: color.navySoft },
  factor: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  factorLabel: { width: 120, fontFamily: font.regular, fontSize: 12, color: '#E4EAF3' },
  bar: { flex: 1, height: 6, borderRadius: 3, backgroundColor: color.navyBar, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3, backgroundColor: color.navyBarFill },
  factorValue: {
    width: 44,
    textAlign: 'right',
    fontFamily: font.mono,
    fontSize: 12,
    color: color.surface,
  },
  divided: { borderTopWidth: 1, borderTopColor: color.divider, paddingTop: 10, gap: 4 },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 8,
  },
  signalTitle: { fontFamily: font.semibold, fontSize: 14, color: color.text },
  note: {
    backgroundColor: color.pendBg,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 2,
  },
  noteText: { fontFamily: font.regular, fontSize: 12, color: color.pendText },
  product: { fontFamily: font.bold, fontSize: 17, color: color.navy },
  tabRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  askRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    minHeight: 48,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: color.border,
  },
  tabNum: { fontFamily: font.mono, fontSize: 12, color: color.navy, minWidth: 16, paddingTop: 3 },
  twoCol: { flexDirection: 'row', gap: 8 },
  moves: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  move: { minHeight: 44, paddingHorizontal: 12 },
  error: { fontFamily: font.semibold, fontSize: 12, color: color.overdue },
  logRow: { flexDirection: 'row', gap: 10 },
  logDate: { fontFamily: font.mono, fontSize: 12, color: color.text3 },
});
