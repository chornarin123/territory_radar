import React from 'react';
import { View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';

/**
 * From this window width the app uses its wide layout: side navigation, two
 * panes on map screens, centred reading columns. Phones never reach it, so the
 * phone layout is unchanged; laptops, desktops and landscape tablets do.
 */
export const WIDE_FROM = 900;

/** Comfortable reading width for lists and forms on a wide screen. */
export const READ_WIDTH = 760;

/** Style for a scroll content container or screen root: centred at READ_WIDTH. */
export const readColumn = {
  width: '100%',
  maxWidth: READ_WIDTH,
  alignSelf: 'center',
} as const;

/**
 * A bottom sheet on a wide screen: a centred panel instead of the full window
 * width. Phones never reach WIDE_FROM, so they keep the full-width sheet.
 */
export const SHEET_WIDE = { width: '100%', maxWidth: 600, alignSelf: 'center' } as const;

/** Width of the side panel next to a map on a wide screen. */
export const PANEL_WIDTH = 440;

export function useWide(): boolean {
  return useWindowDimensions().width >= WIDE_FROM;
}

/**
 * Centres its content at `max` wide, full width below that. On a phone the
 * window is narrower than `max`, so this changes nothing there.
 */
export function Column({
  max = READ_WIDTH,
  style,
  children,
}: {
  max?: number;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  return (
    <View style={[{ width: '100%', maxWidth: max, alignSelf: 'center' }, style]}>{children}</View>
  );
}

/** Width of the left navigation sidebar on a wide screen. */
export const SIDEBAR_WIDTH = 220;

/**
 * Side padding that keeps a full-bleed screen's content `max` wide and centred
 * (a navy header can still run edge to edge). 16 on a phone, as before.
 */
export function useGutter(max: number, besideSidebar = true): number {
  const { width } = useWindowDimensions();
  if (width < WIDE_FROM) return 16;
  return Math.max(24, (width - (besideSidebar ? SIDEBAR_WIDTH : 0) - max) / 2);
}
