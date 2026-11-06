import React, { useCallback, useMemo } from 'react';
import { readColumn } from '../components/layout';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { MapPin } from 'lucide-react-native';
import { ProspectMiniRow } from '../components/ProspectCard';
import { Card, Chip, PrimaryButton, SectionLabel, Segmented, Toggle, Txt } from '../components/ui';
import { selectionSummary, tickOf, toggleArea, topCommunes } from '../data/areas';
import { useFilters } from '../data/FilterContext';
import { useAreaTree } from '../data/useAreaTree';
import {
  BAND_LABEL,
  SIGNAL_GROUP_LABEL,
  STAGE_LABEL,
  STAGE_STATUSES,
  STATUS_LABEL,
  productShortName,
  type SignalGroup,
  type Stage,
} from '../data/labels';
import {
  QUICK_VIEWS,
  areaCounts,
  activeFilterCount,
  chipCounts,
  matchesFilters,
  matchesListControls,
  productName,
  sameFilters,
  sortViews,
  type ChipGroup,
  type FilterState,
  type ProspectView,
  type SortKey,
} from '../data/selectors';
import { useLoadedWorkspace } from '../data/WorkspaceProvider';
import type { InterestStatus, PriorityBand } from '../data/types';
import { color, font, type } from '../theme/tokens';

/** Territory shortcuts on the filter; the picker has every area. */
const TERRITORY_CHIPS = 6;

const INTEREST_OPTS: [InterestStatus, string][] = [
  ['unknown', 'Unconfirmed'],
  ['confirmed', 'Confirmed'],
  ['not_interested', 'No need'],
];

export function FiltersScreen() {
  const { ws, views } = useLoadedWorkspace();
  const { filters: f, setFilters, list, toggleMinScore, toggleHideNoNeed } = useFilters();
  const nav = useNavigation();

  // Counts and the result honour the Prospects screen's own toggles too, so
  // "Show X prospects" is exactly what the list then shows.
  const base = useCallback((v: ProspectView) => matchesListControls(v, list), [list]);

  const toggle = <K extends ChipGroup>(k: K, value: FilterState[K][number]) =>
    setFilters((prev) => {
      const cur = prev[k] as string[];
      const next = cur.includes(value as string)
        ? cur.filter((x) => x !== value)
        : [...cur, value as string];
      return { ...prev, [k]: next };
    });

  // Area: faceted counts per province, district and commune, one pass per change.
  const { tree } = useAreaTree();
  const areaSel = new Set(f.area);
  const counts = useMemo(() => areaCounts(views, f, base), [views, f, base]);
  const inArea = f.area.length
    ? views.filter((v) => base(v) && matchesFilters(v, f)).length
    : views.filter((v) => base(v) && matchesFilters(v, f, 'area')).length;
  const summary = selectionSummary(f.area, tree, inArea);
  // Territory chips: the sangkats with the most of the officer's prospects.
  const communeName = useMemo(() => {
    const byCode = new Map<string, string>();
    for (const v of views) if (v.communeCode) byCode.set(v.communeCode, v.commune);
    return byCode;
  }, [views]);
  const territory = useMemo(() => topCommunes(counts, TERRITORY_CHIPS), [counts]);
  const toggleSangkat = (code: string) =>
    setFilters((prev) => {
      const sel = new Set(prev.area);
      if (tree) return { ...prev, area: [...toggleArea(sel, code, tree)] };
      if (sel.has(code)) sel.delete(code);
      else sel.add(code);
      return { ...prev, area: [...sel] };
    });

  const groups = useMemo(() => {
    const count = <T extends string>(
      g: ChipGroup,
      opts: readonly T[],
      test: (v: ProspectView, o: T) => boolean,
    ) => chipCounts(views, f, g, opts, test, base);
    return {
      prod: count(
        'prod',
        ws.products.map((p) => p.id),
        (v, id) => v.product?.id === id,
      ),
      sig: count(
        'sig',
        Object.keys(SIGNAL_GROUP_LABEL) as SignalGroup[],
        (v, g) => v.signalGroup === g,
      ),
      stage: count('stage', Object.keys(STAGE_LABEL) as Stage[], (v, g) =>
        STAGE_STATUSES[g].includes(v.status),
      ),
      band: count('band', ['high', 'medium', 'low'] as PriorityBand[], (v, b) => v.band === b),
      int: count(
        'int',
        INTEREST_OPTS.map(([i]) => i),
        (v, i) => v.interest === i,
      ),
    };
  }, [views, f, base, ws]);

  const result = useMemo(
    () =>
      sortViews(
        views.filter((v) => base(v) && matchesFilters(v, f)),
        f.sort,
      ),
    [views, f, base],
  );
  const active = activeFilterCount(f);
  const listNotes = [
    list.minScoreOn ? `Priority ≥ ${list.minScore}` : null,
    list.hideNoNeed ? 'Hide no-need' : null,
  ].filter(Boolean);

  const chipRow = <K extends Exclude<ChipGroup, 'area'>>(
    k: K,
    opts: [FilterState[K][number], string][],
  ) => (
    <View style={s.chipWrap}>
      {opts.map(([value, label]) => (
        <Chip
          key={String(value)}
          shape="square"
          label={label}
          selected={(f[k] as string[]).includes(value as string)}
          count={(groups[k] as Record<string, number>)[value as string] ?? 0}
          disabled={
            !((groups[k] as Record<string, number>)[value as string] ?? 0) &&
            !(f[k] as string[]).includes(value as string)
          }
          onPress={() => toggle(k, value)}
        />
      ))}
    </View>
  );

  return (
    <View style={[s.screen, readColumn]}>
      <ScrollView contentContainerStyle={s.body}>
        <View style={{ gap: 8 }}>
          <SectionLabel>Quick views</SectionLabel>
          <View style={s.presets}>
            {QUICK_VIEWS.map((q) => {
              const on = sameFilters(f, q.filters);
              return (
                <Pressable
                  key={q.id}
                  onPress={() => setFilters(q.filters)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  style={[s.preset, on ? s.presetOn : s.presetOff]}
                >
                  <Txt style={[s.presetLabel, { color: on ? color.surface : color.navy }]}>
                    {q.label}
                  </Txt>
                  <Txt style={[s.presetSub, { color: on ? color.navySoft : color.text3 }]}>
                    {q.sub}
                  </Txt>
                </Pressable>
              );
            })}
          </View>
        </View>

        <Card>
          <SectionLabel>Area</SectionLabel>
          <Pressable
            onPress={() => nav.navigate('AreaPicker')}
            accessibilityRole="button"
            accessibilityLabel={`Area: ${summary.title}, ${summary.sub}. Change area`}
            style={({ pressed }) => [s.areaRow, pressed && { opacity: 0.8 }]}
          >
            <MapPin size={18} color={color.navy} />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Txt style={s.areaTitle} numberOfLines={1}>
                {summary.title}
              </Txt>
              <Txt style={type.caption} numberOfLines={1}>
                {summary.sub}
              </Txt>
            </View>
            <Txt style={s.areaChange}>Change ›</Txt>
          </Pressable>
          {territory.length ? (
            <>
              <Txt style={type.caption}>Your territory · most prospects</Txt>
              <View style={s.chipWrap}>
                {territory.map((code) => (
                  <Chip
                    key={code}
                    label={tree?.byCode.get(code)?.name_en ?? communeName.get(code) ?? code}
                    selected={tickOf(areaSel, code) === 'on'}
                    count={counts.get(code) ?? 0}
                    onPress={() => toggleSangkat(code)}
                  />
                ))}
              </View>
            </>
          ) : null}
        </Card>
        <Card>
          <SectionLabel>Discussion category</SectionLabel>
          {chipRow(
            'prod',
            ws.products.map((p) => [p.id, productShortName(p.name)]),
          )}
        </Card>
        <Card>
          <SectionLabel>Signal</SectionLabel>
          {chipRow('sig', Object.entries(SIGNAL_GROUP_LABEL) as [SignalGroup, string][])}
        </Card>
        <Card>
          <SectionLabel>Pipeline status</SectionLabel>
          {chipRow('stage', Object.entries(STAGE_LABEL) as [Stage, string][])}
        </Card>
        <Card>
          <SectionLabel right="Not a loan probability">Visit priority</SectionLabel>
          {chipRow('band', Object.entries(BAND_LABEL) as [PriorityBand, string][])}
        </Card>
        <Card>
          <SectionLabel>Financing interest</SectionLabel>
          {chipRow('int', INTEREST_OPTS)}
        </Card>

        <Card style={{ gap: 0 }}>
          <View style={{ paddingBottom: 6 }}>
            <SectionLabel>Prospects list</SectionLabel>
          </View>
          <Toggle
            label={`Priority ≥ ${list.minScore}`}
            sub="Hide prospects below the visit-priority floor"
            value={list.minScoreOn}
            onChange={toggleMinScore}
          />
          <Toggle
            label="Hide no-need"
            sub="Except on the Closed tab"
            value={list.hideNoNeed}
            onChange={toggleHideNoNeed}
          />
        </Card>

        <Card style={{ gap: 0 }}>
          <View style={{ paddingBottom: 6 }}>
            <SectionLabel>Data quality</SectionLabel>
          </View>
          <Toggle
            label="Hide flagged prospects"
            sub="Address conflict, stale evidence, limited history, no pin"
            value={f.hideFlag}
            onChange={(v) => setFilters((p) => ({ ...p, hideFlag: v }))}
          />
          <Toggle
            label="Fresh evidence only"
            sub="Skip signals that need a refresh"
            value={f.fresh}
            onChange={(v) => setFilters((p) => ({ ...p, fresh: v }))}
          />
          <Toggle
            label="Has a map location"
            sub="Needed for Radar and route planning"
            value={f.pinned}
            onChange={(v) => setFilters((p) => ({ ...p, pinned: v }))}
          />
          {f.newLeads ? (
            <Toggle
              label="New leads only"
              sub="First seen since the last scan"
              value
              onChange={() => setFilters((p) => ({ ...p, newLeads: false }))}
            />
          ) : null}
          {f.needsCheck ? (
            <Toggle
              label="Flagged or stale only"
              sub="Set by the Needs checking view"
              value
              onChange={() => setFilters((p) => ({ ...p, needsCheck: false }))}
            />
          ) : null}
        </Card>

        <Card>
          <SectionLabel>Sort by</SectionLabel>
          <Segmented<SortKey>
            value={f.sort}
            onChange={(sort) => setFilters((p) => ({ ...p, sort }))}
            options={[
              { id: 'priority', label: 'Priority' },
              { id: 'nearest', label: 'Nearest' },
              { id: 'fresh', label: 'Newest signal' },
              { id: 'name', label: 'Name A–Z' },
            ]}
          />
        </Card>

        <View style={{ gap: 6 }}>
          <SectionLabel>Preview · top matches</SectionLabel>
          {result.length === 0 ? (
            <View style={s.none}>
              <Txt style={[type.bodySm, { textAlign: 'center', color: color.text3 }]}>
                No prospects match. Remove a filter or tap Reset.
              </Txt>
            </View>
          ) : (
            result
              .slice(0, 3)
              .map((v) => (
                <ProspectMiniRow
                  key={v.id}
                  v={v}
                  sub={`${v.commune} · ${productName(v)} · ${STATUS_LABEL[v.status]}`}
                />
              ))
          )}
        </View>
      </ScrollView>

      <View style={s.footer}>
        <Txt style={type.caption}>
          {active} {active === 1 ? 'filter' : 'filters'} active · {result.length} of {views.length}{' '}
          prospects
        </Txt>
        {listNotes.length ? (
          <Txt style={[type.caption, { color: color.text3 }]}>
            Prospects list also applies: {listNotes.join(' · ')}
          </Txt>
        ) : null}
        <PrimaryButton
          label={
            result.length
              ? `Show ${result.length} prospect${result.length === 1 ? '' : 's'}`
              : 'No matches'
          }
          disabled={!result.length}
          onPress={() => nav.navigate('Tabs', { screen: 'Prospects' })}
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  body: { padding: 16, paddingTop: 12, gap: 12 },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  preset: {
    flexBasis: '47%',
    flexGrow: 1,
    minHeight: 64,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    gap: 2,
  },
  presetOn: { backgroundColor: color.navy, borderColor: color.navy },
  presetOff: { backgroundColor: color.surface, borderColor: color.borderStrong },
  presetLabel: { fontFamily: font.bold, fontSize: 14 },
  presetSub: { fontFamily: font.regular, fontSize: 12 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  areaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 52,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#f6f8fb',
  },
  areaTitle: { fontFamily: font.semibold, fontSize: 15, color: color.text },
  areaChange: { fontFamily: font.semibold, fontSize: 14, color: '#1d4ed8' },
  none: {
    backgroundColor: color.surface,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: color.borderStrong,
    borderRadius: 12,
    padding: 14,
  },
  footer: {
    backgroundColor: color.surface,
    borderTopWidth: 1,
    borderTopColor: color.border,
    paddingTop: 10,
    paddingHorizontal: 16,
    paddingBottom: 14,
    gap: 6,
  },
});
