import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { sectorLabel } from '../data/labels';
import { isStale, productName, type ProspectView } from '../data/selectors';
import { color, font, type } from '../theme/tokens';
import { FlagPill, InterestPill, Pill, ScoreBadge, StatusPill, Txt } from './ui';

/** "● Second location announced · weak signal", or ⏱ when the evidence is stale. */
export function signalLine(v: ProspectView): string {
  if (!v.signal) return 'No signal on record';
  return `${isStale(v) ? '⏱' : '●'} ${v.signal.title}${v.signal.strength === 'weak' ? ' · weak signal' : ''}`;
}

/** Prospects list card (spec §3.3). */
export function ProspectCard({ v }: { v: ProspectView }) {
  const nav = useNavigation();
  return (
    <Pressable
      onPress={() => nav.navigate('ProspectDetail', { id: v.id })}
      accessibilityRole="button"
      accessibilityLabel={`${v.name}, visit priority ${v.score}`}
      style={({ pressed }) => [s.card, pressed && { opacity: 0.85 }]}
    >
      <View style={s.top}>
        <ScoreBadge score={v.score} band={v.band} />
        <View style={s.titleCol}>
          <Txt style={type.itemTitle} numberOfLines={2}>
            {v.name}
          </Txt>
          <Txt style={type.caption}>
            {sectorLabel(v.p.sector)} · {v.commune}
          </Txt>
        </View>
        <StatusPill status={v.status} />
      </View>
      <Txt style={type.bodySm}>{signalLine(v)}</Txt>
      <View style={s.pills}>
        <InterestPill interest={v.interest} />
        <Pill label={`Discuss: ${productName(v)}`} bg={color.bg} fg={color.text2} />
        {v.p.dataQuality.flags.map((f) => (
          <FlagPill key={f} flag={f} />
        ))}
      </View>
    </Pressable>
  );
}

/** Compact row used by the Filters preview. */
export function ProspectMiniRow({ v, sub }: { v: ProspectView; sub: string }) {
  return (
    <View style={s.mini}>
      <ScoreBadge score={v.score} band={v.band} size={34} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt style={s.miniName} numberOfLines={1}>
          {v.name}
        </Txt>
        <Txt style={type.caption} numberOfLines={1}>
          {sub}
        </Txt>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 8,
  },
  top: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  titleCol: { flex: 1, minWidth: 0, gap: 2 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  mini: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  miniName: { fontFamily: font.semibold, fontSize: 14, color: color.text },
});
