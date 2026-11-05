import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AlertTriangle, ChevronRight } from 'lucide-react-native';
import { ScoreRing } from '../../components/ScoreRing';
import { Txt } from '../../components/ui';
import { FLAG_LABEL, INTEREST_LABEL, STATUS_LABEL } from '../../data/labels';
import type { ProspectStatus } from '../../data/types';
import { color, font } from '../../theme/tokens';
import { discussLabel, metaLine, signalCategory, type ProspectRow, type Tone } from './selectors';

const PILL = { grey: { bg: color.bg, fg: color.text3 } };

function statusLook(s: ProspectStatus) {
  if (s === 'new') return { bg: color.surface, fg: color.navy, border: color.navy };
  if (s === 'application_referred') return { bg: color.okBg, fg: color.okText, border: color.okBg };
  if (s === 'unreachable' || s === 'not_interested' || s === 'closed') {
    return { bg: PILL.grey.bg, fg: color.text3, border: PILL.grey.bg };
  }
  return { bg: color.blueTint, fg: color.navy, border: color.blueTint };
}

const STRIP: Record<Tone, { bg: string; fg: string; dot: string }> = {
  overdue: { bg: color.overdueBg, fg: color.overdueText, dot: color.overdueText },
  today: { bg: color.pendBg, fg: color.pendText, dot: color.pendText },
  visit: { bg: color.blueTint, fg: color.navy, dot: color.navy },
  neutral: { bg: '#F6F7F9', fg: color.text2, dot: color.text3 },
  muted: { bg: '#F6F7F9', fg: color.text3, dot: color.grey },
};

/** One prospect in the list: what it is, why now, and what to do next. */
export function ProspectListCard({ row, onPress }: { row: ProspectRow; onPress: () => void }) {
  const { v, km, action } = row;
  const status = statusLook(v.status);
  const strip = STRIP[action.tone];
  const signal = v.signal;
  const interest =
    v.interest === 'confirmed'
      ? { bg: color.okBg, fg: color.okText }
      : v.interest === 'not_interested'
        ? PILL.grey
        : { bg: color.pendBg, fg: color.pendText };
  const discuss = discussLabel(v);
  const flags = v.p.dataQuality.flags;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${v.name}, visit priority ${v.score} of 100, ${STATUS_LABEL[v.status]}. Next: ${action.text}`}
      style={({ pressed }) => [s.card, pressed && { opacity: 0.92 }]}
    >
      <View style={s.top}>
        <View style={s.row}>
          <ScoreRing score={v.score} band={v.band} />
          <View style={s.titles}>
            <Txt style={s.name} numberOfLines={2}>
              {v.name}
            </Txt>
            <Txt style={s.meta} numberOfLines={1} ellipsizeMode="tail">
              {metaLine(v, km)}
            </Txt>
          </View>
          <View style={[s.status, { backgroundColor: status.bg, borderColor: status.border }]}>
            <Txt style={[s.pillText, { color: status.fg }]}>{STATUS_LABEL[v.status]}</Txt>
          </View>
        </View>

        {signal ? (
          <View style={s.signalRow}>
            <Txt style={s.category}>{signalCategory(signal.type)}</Txt>
            <Txt style={s.signal} numberOfLines={1}>
              {signal.title}
              {signal.strength === 'weak' ? ' · weak signal' : ''}
            </Txt>
            <Txt
              style={[
                s.fresh,
                { color: signal.freshness === 'stale' ? color.overdueText : color.okText },
              ]}
            >
              {signal.freshness === 'stale' ? 'Needs refresh' : 'Fresh'}
            </Txt>
          </View>
        ) : null}

        <View style={s.pills}>
          <View style={[s.pill, { backgroundColor: interest.bg }]}>
            <Txt style={[s.pillText, { color: interest.fg }]}>{INTEREST_LABEL[v.interest]}</Txt>
          </View>
          {discuss ? (
            <View style={[s.pill, { backgroundColor: PILL.grey.bg }]}>
              <Txt style={[s.pillText, { color: PILL.grey.fg }]} numberOfLines={1}>
                {discuss}
              </Txt>
            </View>
          ) : null}
        </View>

        {flags.length ? (
          <View style={s.warn}>
            <AlertTriangle size={14} color={color.pendText} />
            <Txt style={s.warnText}>
              {flags.map((f) => FLAG_LABEL[f]).join(' · ')} — verify before visiting
            </Txt>
          </View>
        ) : null}
      </View>

      <View
        style={[
          s.strip,
          { backgroundColor: strip.bg },
          (action.tone === 'neutral' || action.tone === 'muted') && s.stripDivided,
        ]}
      >
        <View style={[s.dot, { backgroundColor: strip.dot }]} />
        <Txt style={[s.stripText, { color: strip.fg }]} numberOfLines={1}>
          {action.text}
        </Txt>
        <ChevronRight size={16} color={strip.fg} />
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: 16,
    overflow: 'hidden',
  },
  top: { paddingVertical: 12, paddingHorizontal: 14, gap: 9 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  titles: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontFamily: font.semibold, fontSize: 16, lineHeight: 21, color: color.text },
  meta: { fontFamily: font.regular, fontSize: 12, color: color.text3 },
  status: {
    flexShrink: 0,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  signalRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  category: { fontFamily: font.bold, fontSize: 10, letterSpacing: 0.6, color: color.text3 },
  signal: { flex: 1, minWidth: 0, fontFamily: font.regular, fontSize: 13, color: color.text2 },
  fresh: { flexShrink: 0, fontFamily: font.semibold, fontSize: 12 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pill: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, maxWidth: '100%' },
  pillText: { fontFamily: font.semibold, fontSize: 11 },
  warn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  warnText: { flex: 1, fontFamily: font.semibold, fontSize: 12, color: color.pendText },
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  stripDivided: { borderTopWidth: 1, borderTopColor: color.divider },
  dot: { width: 7, height: 7, borderRadius: 4 },
  stripText: { flex: 1, fontFamily: font.semibold, fontSize: 13 },
});
