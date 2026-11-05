// Design tokens from design/UI_SPEC.md §1. Every colour in the app comes from here.

export const color = {
  navy: '#12305A',
  navyDeep: '#1D3F70',
  navyLine: '#3A5684',
  navySoft: '#C9D5E8', // secondary text on navy (prototype)
  navyBar: '#2A4A7A', // bar track / count badge on navy
  navyBarFill: '#A9C1E2',
  blue: '#3E6AAE',
  blueTint: '#E6EDF7',
  grey: '#9AA0AA',
  bg: '#F3F4F6',
  surface: '#FFFFFF',
  border: '#E2E4E9',
  borderStrong: '#C5CCD8',
  divider: '#EEF1F5',
  muted: '#EEF0F3',
  text: '#15171C',
  text2: '#3B3F47',
  text3: '#555A64',
  textDisabled: '#8A9099',
  tabInactive: '#6A707C',
  warnBg: '#FBEBD3',
  warnText: '#6B3005',
  warnDot: '#C2620F',
  warnStrong: '#9A4A0B', // flag pill text
  overdue: '#B4400B',
  overdueBg: '#FCE4DA',
  overdueText: '#9C2F06',
  selectedRing: '#E8913F',
  okBg: '#E5F2E8',
  okText: '#1F5E33',
  pendBg: '#FDF0E3',
  pendText: '#8A3F06',
} as const;

export const bandColor = {
  high: color.navy,
  medium: color.blue,
  low: color.grey,
} as const;

export const font = {
  regular: 'IBMPlexSans_400Regular',
  medium: 'IBMPlexSans_500Medium',
  semibold: 'IBMPlexSans_600SemiBold',
  bold: 'IBMPlexSans_700Bold',
  mono: 'IBMPlexMono_600SemiBold',
  khmer: 'NotoSansKhmer_400Regular',
  khmerBold: 'NotoSansKhmer_700Bold',
} as const;

export const radius = { card: 16, button: 12, chip: 999, chipSquare: 12, pill: 6 } as const;
export const space = { screen: 16, card: 14, gap: 10 } as const;

/** Minimum touch target, spec §1. */
export const TOUCH = 44;

// Type scale from spec §1: screen title 22/700, card title 15/700, item title 16/600,
// body 13–14, caption 12, pill 11/600.
export const type = {
  screenTitle: { fontFamily: font.bold, fontSize: 22, color: color.text },
  cardTitle: { fontFamily: font.bold, fontSize: 15, color: color.text },
  itemTitle: { fontFamily: font.semibold, fontSize: 16, color: color.text },
  body: { fontFamily: font.regular, fontSize: 14, color: color.text2, lineHeight: 20 },
  bodySm: { fontFamily: font.regular, fontSize: 13, color: color.text2, lineHeight: 19 },
  caption: { fontFamily: font.regular, fontSize: 12, color: color.text3 },
  pill: { fontFamily: font.semibold, fontSize: 11 },
  sectionLabel: {
    fontFamily: font.bold,
    fontSize: 12,
    color: color.text3,
    letterSpacing: 0.6, // 0.05em at 12px
    textTransform: 'uppercase' as const,
  },
  mono: { fontFamily: font.mono },
} as const;
