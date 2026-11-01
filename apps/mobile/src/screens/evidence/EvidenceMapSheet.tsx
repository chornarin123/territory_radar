import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MapView, type MapAreas } from '../../components/map/MapView';
import { Txt } from '../../components/ui';
import { selectionBbox } from '../../data/areas';
import { mappable, type EvidenceRecord } from '../../data/evidence';
import { loadShapes, useAreaTree } from '../../data/useAreaTree';
import { color, font } from '../../theme/tokens';

export interface EvidenceMapView {
  title: string;
  records: EvidenceRecord[];
  /** Areas to outline and frame. */
  codes: string[];
}

/** "Show on map": an evidence card's records as pins, inside the sangkat outline. */
export function EvidenceMapSheet({
  view,
  onClose,
  onProspect,
}: {
  view: EvidenceMapView | null;
  onClose: () => void;
  /** A pin that is one of the officer's leads opens its prospect. */
  onProspect: (id: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const { tree } = useAreaTree();
  const [shapes, setShapes] = useState<unknown[]>([]);
  const codesKey = view?.codes.join(',') ?? '';

  useEffect(() => {
    setShapes([]);
    if (!codesKey) return;
    let live = true;
    loadShapes(codesKey.split(',')).then(
      (f) => live && setShapes(f),
      () => undefined, // the outline is a nicety
    );
    return () => {
      live = false;
    };
  }, [codesKey]);

  const records = useMemo(() => mappable(view?.records ?? []), [view]);
  const pins = useMemo(
    () =>
      records.map((r, i) => ({
        id: r.prospectId ?? `record-${i}`,
        lat: r.lat,
        lng: r.lng,
        label: String(i + 1),
        color: r.prospectId ? color.navy : '#4b72b3',
      })),
    [records],
  );
  const areas = useMemo<MapAreas | null>(() => {
    const bbox = tree && view ? selectionBbox(view.codes, tree) : null;
    return bbox ? { bbox, shapes } : null;
  }, [tree, view, shapes]);

  if (!view) return null;
  const center = records[0] ?? tree?.byCode.get(view.codes[0]!) ?? { lat: 11.56, lng: 104.92 };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[s.screen, { paddingTop: insets.top }]}>
        <View style={s.head}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt style={s.title} numberOfLines={1}>
              {view.title}
            </Txt>
            <Txt style={s.sub}>
              {records.length
                ? `${records.length} place${records.length === 1 ? '' : 's'} with a location`
                : 'No individual places to pin: showing the area'}
            </Txt>
          </View>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            aria-label="Close map"
            style={({ pressed }) => [s.close, pressed && { opacity: 0.6 }]}
          >
            <X size={22} color={color.navy} />
          </Pressable>
        </View>
        <MapView
          style={{ flex: 1 }}
          center={{ lat: center.lat, lng: center.lng }}
          zoom={15}
          pins={pins}
          areas={areas}
          fit
          onPinPress={(id) => {
            if (!id.startsWith('record-')) onProspect(id);
          }}
        />
        <View style={[s.legend, { paddingBottom: 10 + insets.bottom }]}>
          {records.map((r, i) => (
            <Txt key={`${r.name}-${i}`} style={s.legendRow} numberOfLines={1}>
              {i + 1}. {r.name} · {r.tag}
            </Txt>
          ))}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.surface },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 16,
    paddingRight: 4,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  title: { fontFamily: font.bold, fontSize: 16, color: color.text },
  sub: { fontFamily: font.regular, fontSize: 12, color: color.text3 },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  legend: { paddingHorizontal: 16, paddingTop: 10, gap: 4, maxHeight: 180 },
  legendRow: { fontFamily: font.regular, fontSize: 13, color: color.text2 },
});
