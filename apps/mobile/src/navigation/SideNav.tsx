import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Clock, List, MapPin, Radar, User, type LucideIcon } from 'lucide-react-native';
import { SIDEBAR_WIDTH } from '../components/layout';
import { Txt } from '../components/ui';
import { useWorkspace } from '../data/WorkspaceProvider';
import { color, font } from '../theme/tokens';
import type { TabParamList } from './types';

export type TabName = keyof TabParamList;

export const TABS: { name: TabName; icon: LucideIcon; copyKey: string }[] = [
  { name: 'Today', icon: Clock, copyKey: 'home' },
  { name: 'Radar', icon: Radar, copyKey: 'radar' },
  { name: 'Prospects', icon: List, copyKey: 'pipeline' },
  { name: 'Visits', icon: MapPin, copyKey: 'visits' },
  { name: 'Profile', icon: User, copyKey: 'profile' },
];

/**
 * The navigation on a wide screen: a fixed left sidebar like a web app. It sits
 * beside every screen, prospect detail and the other pushed screens included, so
 * it never disappears. Phones never use it; they keep the bottom tab bar.
 */
export function SideNav({
  current,
  onSelect,
}: {
  /** The section to highlight: the tab showing, or the one a pushed screen came from. */
  current: TabName;
  onSelect: (tab: TabName) => void;
}) {
  const { copy, locale } = useWorkspace();
  return (
    <View style={s.bar}>
      <View style={s.brand}>
        <View style={s.logo}>
          <Radar size={18} color={color.surface} strokeWidth={2.2} />
        </View>
        <Txt style={s.brandText}>Territory Radar</Txt>
      </View>

      {TABS.map(({ name, icon: Icon, copyKey }) => {
        const focused = name === current;
        const tint = focused ? color.navy : color.tabInactive;
        const label = copy(copyKey);
        return (
          <Pressable
            key={name}
            onPress={() => onSelect(name)}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            aria-label={label}
            style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [
              s.item,
              focused ? s.itemOn : hovered && s.itemHover,
              pressed && { opacity: 0.8 },
            ]}
          >
            <Icon size={22} strokeWidth={2} color={tint} />
            <Txt
              style={[s.label, locale === 'km' && { fontFamily: font.khmer }, { color: tint }]}
              numberOfLines={1}
            >
              {label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  bar: {
    width: SIDEBAR_WIDTH,
    flexShrink: 0,
    backgroundColor: color.surface,
    borderRightWidth: 1,
    borderRightColor: color.border,
    paddingTop: 18,
    paddingHorizontal: 12,
    gap: 4,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 8,
    paddingBottom: 18,
  },
  logo: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: color.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandText: { fontFamily: font.bold, fontSize: 16, color: color.navy },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    height: 46,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  itemOn: { backgroundColor: '#EAF0F8' },
  itemHover: { backgroundColor: '#F4F6FA' },
  label: { fontFamily: font.semibold, fontSize: 15 },
});
