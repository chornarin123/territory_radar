import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Check, ChevronRight, Minus } from 'lucide-react-native';
import type { AreaNode, Tick } from '../data/areas';
import { color, font } from '../theme/tokens';
import { Txt } from './ui';

const C = {
  label: '#5b6576',
  rowBorder: '#e1e5ec',
  rowOnBg: '#eef3fa',
  rowOnBorder: '#bccbe3',
  allBg: '#f3f6fa',
  boxOff: '#8a94a6',
  zeroBg: '#eef1f5',
};

/**
 * One area in an area picker: the box ticks it; the body drills in when `onOpen`
 * is given, else ticks too. Used by Radar's area sheet and the Prospects filter.
 */
export function AreaRow({
  node,
  title = node.name_en,
  tick,
  meta,
  count,
  onTick,
  onOpen,
  all,
}: {
  node: AreaNode;
  title?: string;
  tick: Tick;
  meta: string;
  /** Prospect count, as a badge: navy when there are any. */
  count?: number;
  onTick: () => void;
  onOpen?: () => void;
  all?: boolean;
}) {
  const on = tick !== 'off';
  return (
    <View style={[s.row, all && s.rowAll, on && !all && s.rowOn]}>
      <Pressable
        onPress={onTick}
        accessibilityRole="checkbox"
        accessibilityState={{
          checked: tick === 'on' ? true : tick === 'partial' ? 'mixed' : false,
        }}
        aria-label={`Select ${title}`}
        style={s.tickArea}
      >
        <View style={[s.box, on ? s.boxOn : s.boxOff]}>
          {tick === 'on' ? <Check size={15} color={color.surface} strokeWidth={3} /> : null}
          {tick === 'partial' ? <Minus size={15} color={color.surface} strokeWidth={3} /> : null}
        </View>
      </Pressable>
      <Pressable
        onPress={onOpen ?? onTick}
        accessibilityRole="button"
        aria-label={`${onOpen ? 'Open' : on ? 'Unselect' : 'Select'} ${title}${
          count !== undefined ? `, ${count} prospect${count === 1 ? '' : 's'}` : ''
        }`}
        style={({ pressed }) => [s.rowBody, pressed && { opacity: 0.7 }]}
      >
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <View style={s.names}>
            <Txt style={[s.name, all && { fontFamily: font.bold }]} numberOfLines={1}>
              {title}
            </Txt>
            {!all && node.name_km ? (
              <Txt style={s.nameKm} numberOfLines={1}>
                {node.name_km}
              </Txt>
            ) : null}
          </View>
          {meta ? <Txt style={s.meta}>{meta}</Txt> : null}
        </View>
        {count !== undefined ? (
          <View style={[s.badge, { backgroundColor: count ? color.navy : C.zeroBg }]}>
            <Txt style={[s.badgeText, { color: count ? color.surface : C.label }]}>{count}</Txt>
          </View>
        ) : null}
        {onOpen ? <ChevronRight size={20} color={C.label} /> : null}
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 64,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.rowBorder,
    backgroundColor: color.surface,
  },
  rowOn: { backgroundColor: C.rowOnBg, borderColor: C.rowOnBorder },
  rowAll: { backgroundColor: C.allBg },
  tickArea: { width: 52, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  box: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { backgroundColor: color.navy, borderColor: color.navy },
  boxOff: { backgroundColor: color.surface, borderColor: C.boxOff },
  rowBody: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    gap: 8,
    paddingVertical: 10,
    paddingRight: 12,
  },
  names: { flexDirection: 'row', alignItems: 'baseline', gap: 8, minWidth: 0 },
  name: { flexShrink: 1, fontFamily: font.semibold, fontSize: 15, color: color.text },
  nameKm: { flexShrink: 2, fontSize: 13, color: C.label },
  meta: { fontFamily: font.regular, fontSize: 13, color: C.label },
  badge: {
    minWidth: 28,
    height: 22,
    paddingHorizontal: 7,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontFamily: font.mono, fontSize: 12 },
});
