// Shared components from design/UI_SPEC.md §2. Styles mirror design/prototype/*.dc.html.
import React from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { INTEREST_LABEL, FLAG_LABEL, STATUS_LABEL } from '../../data/labels';
import type {
  DataQualityFlag,
  InterestStatus,
  PriorityBand,
  ProspectStatus,
} from '../../data/types';
import { TOUCH, bandColor, color, font, radius, type } from '../../theme/tokens';
import { Txt } from './Txt';

export { Txt };

// ─── ScoreBadge ───────────────────────────────────────────────────────────────

/** Visit priority, never a probability: just the number on its band colour. */
export function ScoreBadge({
  score,
  band,
  size = 40,
}: {
  score: number;
  band: PriorityBand;
  size?: number;
}) {
  return (
    <View
      style={[s.score, { width: size, height: size, backgroundColor: bandColor[band] }]}
      accessibilityLabel={`Visit priority ${score}`}
    >
      <Txt style={[s.scoreText, size < 40 && { fontSize: 13 }]}>{score}</Txt>
    </View>
  );
}

// ─── Pills ────────────────────────────────────────────────────────────────────

export function Pill({
  label,
  bg,
  fg,
  outline,
  style,
}: {
  label: string;
  bg?: string;
  fg: string;
  outline?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        s.pill,
        { backgroundColor: bg ?? 'transparent' },
        outline ? { borderWidth: 1.5, borderColor: outline, paddingVertical: 1 } : null,
        style,
      ]}
    >
      <Txt style={[s.pillText, { color: fg }]}>{label}</Txt>
    </View>
  );
}

export const StatusPill = ({ status }: { status: ProspectStatus }) => (
  <Pill label={STATUS_LABEL[status]} bg={color.blueTint} fg={color.navy} />
);

const INTEREST_STYLE: Record<InterestStatus, { bg: string; fg: string }> = {
  confirmed: { bg: color.okBg, fg: color.okText },
  not_interested: { bg: color.muted, fg: color.text3 },
  unknown: { bg: color.pendBg, fg: color.pendText },
};

export const InterestPill = ({ interest }: { interest: InterestStatus }) => (
  <Pill label={INTEREST_LABEL[interest]} {...INTEREST_STYLE[interest]} />
);

export const FlagPill = ({ flag }: { flag: DataQualityFlag }) => (
  <Pill label={`⚠ ${FLAG_LABEL[flag]}`} fg={color.warnStrong} outline={color.warnDot} />
);

// ─── Chip ─────────────────────────────────────────────────────────────────────

/**
 * `shape="round"` is the filter-row chip (radius 999), `"square"` the Filters-screen
 * chip (radius 12). A count of 0 renders disabled-looking but stays tappable, so an
 * already-selected option can always be turned off.
 */
export function Chip({
  label,
  selected,
  onPress,
  count,
  shape = 'round',
  onNavy,
  disabled,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  count?: number;
  shape?: 'round' | 'square';
  onNavy?: boolean;
  /** Greyed out and not tappable, e.g. an option nothing matches. */
  disabled?: boolean;
}) {
  const empty = count === 0 && !selected;
  const look = onNavy
    ? selected
      ? { bg: color.surface, fg: color.navy, border: color.surface }
      : { bg: 'transparent', fg: color.surface, border: color.navyLine }
    : selected
      ? { bg: color.navy, fg: color.surface, border: color.navy }
      : empty
        ? { bg: '#F6F7F9', fg: color.textDisabled, border: '#D5DAE1' }
        : { bg: color.surface, fg: color.navy, border: color.borderStrong };
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: !!disabled }}
      accessibilityLabel={count === undefined ? label : `${label}, ${count}`}
      style={({ pressed }) => [
        s.chip,
        shape === 'square' ? s.chipSquare : s.chipRound,
        {
          backgroundColor: look.bg,
          borderColor: look.border,
          borderStyle: empty ? 'dashed' : 'solid',
        },
        pressed && { opacity: 0.75 },
      ]}
    >
      <Txt style={[s.chipText, { color: look.fg }]}>{label}</Txt>
      {count !== undefined ? (
        <View style={[s.chipCount, { backgroundColor: selected ? '#2A4A7A' : color.divider }]}>
          <Txt style={[s.chipCountText, { color: selected ? color.surface : color.text2 }]}>
            {count}
          </Txt>
        </View>
      ) : null}
    </Pressable>
  );
}

// ─── Card / SectionLabel ──────────────────────────────────────────────────────

export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[s.card, style]}>{children}</View>;
}

export const SectionLabel = ({ children, right }: { children: string; right?: string }) => (
  <View style={s.sectionRow}>
    <Txt style={type.sectionLabel}>{children}</Txt>
    {right ? <Txt style={type.caption}>{right}</Txt> : null}
  </View>
);

// ─── Buttons ──────────────────────────────────────────────────────────────────

export function PrimaryButton({
  label,
  onPress,
  disabled,
  style,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        s.button,
        { backgroundColor: disabled ? color.border : color.navy },
        pressed && !disabled && { opacity: 0.85 },
        style,
      ]}
    >
      <Txt style={[s.buttonText, { color: disabled ? color.tabInactive : color.surface }]}>
        {label}
      </Txt>
    </Pressable>
  );
}

export function OutlineButton({
  label,
  onPress,
  disabled,
  active,
  activeColor = color.navy,
  style,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** Filled state, e.g. the recorded outcome. */
  active?: boolean;
  activeColor?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected: active }}
      style={({ pressed }) => [
        s.button,
        active
          ? { backgroundColor: activeColor, borderColor: activeColor }
          : { backgroundColor: color.surface, borderColor: color.borderStrong },
        { borderWidth: 1 },
        disabled && { opacity: 0.5 },
        pressed && { opacity: 0.8 },
        style,
      ]}
    >
      <Txt style={[s.buttonText, { color: active ? color.surface : color.navy }]}>{label}</Txt>
    </Pressable>
  );
}

// ─── Toggle ───────────────────────────────────────────────────────────────────

export function Toggle({
  label,
  sub,
  value,
  onChange,
}: {
  label: string;
  sub?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Pressable
      onPress={() => onChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      style={s.toggleRow}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Txt style={s.toggleLabel}>{label}</Txt>
        {sub ? <Txt style={type.caption}>{sub}</Txt> : null}
      </View>
      <View style={[s.track, { backgroundColor: value ? color.navy : color.borderStrong }]}>
        <View style={[s.knob, { left: value ? 21 : 3 }]} />
      </View>
    </Pressable>
  );
}

/** The dashed / tinted "✓ Priority ≥ 60" toggle chip from the Prospects header. */
export function ToggleChip({
  label,
  value,
  onPress,
}: {
  label: string;
  value: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      style={[
        s.toggleChip,
        value
          ? { backgroundColor: color.blueTint, borderColor: '#A9C1E2', borderStyle: 'solid' }
          : {
              backgroundColor: color.surface,
              borderColor: color.borderStrong,
              borderStyle: 'dashed',
            },
      ]}
    >
      <Txt style={[s.toggleChipText, { color: value ? color.navy : color.text3 }]}>
        {value ? `✓ ${label}` : label}
      </Txt>
    </Pressable>
  );
}

// ─── Segmented ────────────────────────────────────────────────────────────────

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <View style={s.segment}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <Pressable
            key={o.id}
            onPress={() => onChange(o.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={[s.segmentItem, on && s.segmentItemOn]}
          >
            <Txt style={[s.segmentText, { color: on ? color.navy : color.text3 }]}>{o.label}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  score: { borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  scoreText: { fontFamily: font.mono, fontSize: 15, color: color.surface },

  pill: {
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  pillText: { ...type.pill },

  chip: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    flexShrink: 0,
  },
  chipRound: { borderRadius: radius.chip },
  chipSquare: { borderRadius: radius.chipSquare, minHeight: TOUCH, paddingHorizontal: 12 },
  chipText: { fontFamily: font.semibold, fontSize: 13 },
  chipCount: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  chipCountText: { fontFamily: font.mono, fontSize: 11 },

  card: {
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.card,
    padding: 14,
    gap: 10,
  },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },

  button: {
    minHeight: 48,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  buttonText: { fontFamily: font.semibold, fontSize: 14, textAlign: 'center' },

  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 48,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: color.divider,
  },
  toggleLabel: { fontFamily: font.semibold, fontSize: 14, color: color.text },
  track: { width: 46, height: 28, borderRadius: 14, flexShrink: 0 },
  knob: {
    position: 'absolute',
    top: 3,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: color.surface,
  },

  toggleChip: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
  },
  toggleChipText: { fontFamily: font.semibold, fontSize: 12 },

  segment: {
    flexDirection: 'row',
    gap: 4,
    backgroundColor: color.divider,
    borderRadius: 10,
    padding: 4,
  },
  segmentItem: {
    flex: 1,
    minHeight: 38,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentItemOn: {
    backgroundColor: color.surface,
    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.12)',
  },
  segmentText: { fontFamily: font.semibold, fontSize: 13 },
});
