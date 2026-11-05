import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { ProspectView } from '../data/selectors';
import { color, font, type } from '../theme/tokens';
import { ScoreBadge, Txt } from './ui';

// The Prospects list card is features/prospects/ProspectListCard.tsx.

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
