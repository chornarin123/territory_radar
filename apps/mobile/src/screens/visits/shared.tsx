import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Txt } from '../../components/ui';
import { SIGNAL_GROUP_LABEL, type SignalGroup } from '../../data/labels';
import { isOnRadar, type ProspectView } from '../../data/selectors';
import type { Origin } from '../../data/useOrigin';
import type { Point } from '../../data/visitPlan';
import { color, font } from '../../theme/tokens';

// From the Plan visits spec.
export const P = {
  navy: '#12284a',
  amber: '#f59e0b',
  amberBg: '#fff7eb',
  amberBorder: '#f5c77a',
  green: '#15803d',
  blue: '#2563eb',
  link: '#1d4ed8',
};

/** A prospect that can go on a visit plan: live, with a location. */
export interface Candidate extends Point {
  id: string;
  name: string;
  commune: string;
  group: SignalGroup | null;
  /** "Equipment", "Expansion", …: the signal group, as on Radar. */
  signal: string;
  score: number;
  contactConfirmed: boolean;
  locationVerified: boolean;
}

export function toCandidates(views: ProspectView[]): Candidate[] {
  return views
    .filter((v) => isOnRadar(v) && v.p.location)
    .map((v) => ({
      id: v.id,
      name: v.name,
      commune: v.commune,
      group: v.signalGroup,
      signal: v.signalGroup ? SIGNAL_GROUP_LABEL[v.signalGroup] : 'No signal',
      score: v.score,
      lat: v.p.location!.lat,
      lng: v.p.location!.lng,
      contactConfirmed: v.p.contact.canCall,
      locationVerified: !v.p.address.isApproximate && v.p.dataQuality.lastVerifiedAt !== null,
    }));
}

const PURPOSE: Partial<Record<SignalGroup, string>> = {
  equip: 'Discuss equipment purchase and verify financing interest.',
  exp: 'Discuss expansion plans and verify financing interest.',
  stock: 'Discuss stock financing needs and verify interest.',
};

export const purposeFor = (g: SignalGroup | null) =>
  (g && PURPOSE[g]) ?? 'Discuss financing needs and verify interest.';

/** "● Your location · GPS ±15 m", or the branch fallback in amber. */
export function LocationLine({ origin }: { origin: Origin | null }) {
  const gps = origin?.kind === 'gps';
  const text = !origin
    ? 'Finding your location…'
    : gps
      ? `Your location${origin.accuracy !== null ? ` · GPS ±${Math.round(origin.accuracy)} m` : ''}`
      : 'From your branch · location is off';
  return (
    <View style={s.line}>
      <View style={[s.dot, { backgroundColor: origin && !gps ? P.amber : P.blue }]} />
      <Txt style={s.text}>{text}</Txt>
    </View>
  );
}

const s = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  text: { fontFamily: font.regular, fontSize: 13, color: color.text3 },
});
