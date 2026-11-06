import React, { useMemo } from 'react';
import { Pressable, ScrollView, SectionList, StyleSheet, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ArrowUpDown, Map as MapIcon, Search, SlidersHorizontal, X } from 'lucide-react-native';
import { useGutter, useWide } from '../components/layout';
import { OutlineButton, Txt } from '../components/ui';
import { useFilters } from '../data/FilterContext';
import {
  PROSPECT_TABS,
  activeFilterCount,
  matchesFilters,
  matchesListControls,
} from '../data/selectors';
import { localDay } from '../data/time';
import { routeOrder } from '../data/today';
import { useTodayPlan } from '../data/useVisitPlan';
import { timeSlot } from '../data/visitPlan';
import { useLoadedWorkspace } from '../data/WorkspaceProvider';
import type { Task } from '../data/types';
import { ProspectListCard } from '../features/prospects/ProspectListCard';
import {
  SORT_LABEL,
  TAB_LABEL,
  buildRows,
  nextSort,
  nowOf,
  sections,
  summaryText,
  tabCounts,
} from '../features/prospects/selectors';
import { color, font } from '../theme/tokens';
import { toCandidates } from './visits/shared';

// Header colours, the same as Radar's navy header.
const HEAD = {
  text: '#e8edf5',
  soft: '#a9b7cc',
  field: '#1c3560',
  border: '#2f4870',
};

/** "What should I do next?" — the officer's prospects, grouped by what's due. */
export function ProspectsScreen() {
  const { ws, views } = useLoadedWorkspace();
  const { filters, setFilters, list, setTab, setSearch, clearAll } = useFilters();
  const { plan } = useTodayPlan();
  const nav = useNavigation();

  const today = localDay(nowOf(ws));
  const branch = ws.branch?.location ?? null;

  // Today's visit times, in the same order and slots as the Visits route.
  const visitTimes = useMemo(() => {
    if (!plan) return new Map<string, string>();
    const order = routeOrder(plan, toCandidates(views), plan.start?.point ?? branch);
    return new Map(order.map((c, i) => [c.id, timeSlot(i)]));
  }, [plan, views, branch]);

  const tasks = useMemo(() => {
    const byProspect = new Map<string, Task[]>();
    for (const t of ws.tasks) {
      if (t.status !== 'open') continue;
      byProspect.set(t.prospectId, [...(byProspect.get(t.prospectId) ?? []), t]);
    }
    return byProspect;
  }, [ws.tasks]);

  // Everything that passes the filters, with no-need kept for the Closed tab.
  const rows = useMemo(
    () =>
      buildRows(
        views.filter(
          (v) =>
            v.p.assignmentOfficerId === ws.officer.id &&
            matchesFilters(v, filters) &&
            matchesListControls(v, { ...list, tab: 'closed' }),
        ),
        { today, visitTimes, tasks },
        branch,
      ),
    [views, ws.officer.id, filters, list, today, visitTimes, tasks, branch],
  );
  const live = useMemo(
    () => (list.hideNoNeed ? rows.filter((r) => r.v.status !== 'not_interested') : rows),
    [rows, list.hideNoNeed],
  );
  const counts = useMemo(
    () => ({ ...tabCounts(live), closed: tabCounts(rows).closed }),
    [live, rows],
  );
  const groups = useMemo(
    () => sections(list.tab === 'closed' ? rows : live, list.tab, filters.sort),
    [rows, live, list.tab, filters.sort],
  );
  // Wide screens: two cards per row, content centred at LIST_MAX. Phones: one per row.
  const wide = useWide();
  const gutter = useGutter(LIST_MAX);
  const perRow = wide ? 2 : 1;
  const gridGroups = useMemo(
    () =>
      groups.map((g) => {
        const data: (typeof g.data)[] = [];
        for (let i = 0; i < g.data.length; i += perRow) data.push(g.data.slice(i, i + perRow));
        return { ...g, data };
      }),
    [groups, perRow],
  );
  const shown = groups.reduce((n, g) => n + g.data.length, 0);
  const todayCount = live.filter((r) => r.today).length;
  const nFilters = activeFilterCount(filters);

  return (
    <View style={s.screen}>
      {ws.settings.showSyntheticDataBanner ? (
        <View style={s.banner}>
          <Txt style={s.bannerText}>Demo data · fictional businesses</Txt>
        </View>
      ) : null}

      <View style={[s.header, { paddingHorizontal: gutter }]}>
        <View style={s.titleRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt style={s.title}>Prospects</Txt>
            <Txt style={s.subtitle}>
              {shown} shown · {todayCount} need action today
            </Txt>
          </View>
          <Pressable
            onPress={() => nav.navigate('Tabs', { screen: 'Radar', params: { view: 'prospects' } })}
            accessibilityRole="button"
            accessibilityLabel="Show on the map"
            style={({ pressed }) => [s.iconBtn, pressed && { opacity: 0.7 }]}
          >
            <MapIcon size={20} color={HEAD.text} />
          </Pressable>
        </View>

        <View style={s.searchRow}>
          <View style={s.search}>
            <Search size={18} color={HEAD.soft} />
            <TextInput
              value={list.search}
              onChangeText={setSearch}
              placeholder="Search name, sector, sangkat"
              placeholderTextColor={HEAD.soft}
              style={s.searchInput}
              accessibilityLabel="Search prospects"
              autoCorrect={false}
              returnKeyType="search"
            />
            {list.search ? (
              <Pressable
                onPress={() => setSearch('')}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
                style={s.clearBtn}
              >
                <X size={16} color={HEAD.soft} />
              </Pressable>
            ) : null}
          </View>
          <Pressable
            onPress={() => nav.navigate('Filters')}
            accessibilityRole="button"
            accessibilityLabel={`Filter, ${nFilters} active`}
            style={({ pressed }) => [s.filterBtn, pressed && { opacity: 0.7 }]}
          >
            <SlidersHorizontal size={16} color={HEAD.text} />
            <Txt style={s.filterText}>Filter</Txt>
            {nFilters ? (
              <View style={s.badge}>
                <Txt style={s.badgeText}>{nFilters}</Txt>
              </View>
            ) : null}
          </Pressable>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.tabs}
          accessibilityRole="tablist"
        >
          {PROSPECT_TABS.map((t) => {
            const on = list.tab === t;
            const alert = t === 'today' && counts.today > 0;
            return (
              <Pressable
                key={t}
                onPress={() => setTab(t)}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${TAB_LABEL[t]}, ${counts[t]}`}
                style={({ pressed }) => [s.tab, on && s.tabOn, pressed && { opacity: 0.8 }]}
              >
                <Txt style={[s.tabText, on && s.tabTextOn]}>{TAB_LABEL[t]}</Txt>
                <View
                  style={[s.count, on && s.countOn, alert && { backgroundColor: color.pendBg }]}
                >
                  <Txt
                    style={[s.countText, on && s.countTextOn, alert && { color: color.pendText }]}
                  >
                    {counts[t]}
                  </Txt>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <View style={[s.summary, { paddingHorizontal: gutter }]}>
        <Txt style={s.summaryText} numberOfLines={1}>
          {summaryText(list.minScoreOn, list.minScore, list.hideNoNeed)}
        </Txt>
        <Pressable
          onPress={() => setFilters((f) => ({ ...f, sort: nextSort(f.sort) }))}
          accessibilityRole="button"
          accessibilityLabel={`Sort: ${SORT_LABEL[filters.sort]}. Change sort`}
          style={({ pressed }) => [s.sortBtn, pressed && { opacity: 0.7 }]}
        >
          <ArrowUpDown size={14} color={color.navy} />
          <Txt style={s.sortText}>Sort: {SORT_LABEL[filters.sort]}</Txt>
        </Pressable>
      </View>

      <SectionList
        sections={gridGroups}
        keyExtractor={(pair) => pair[0]!.v.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={[s.list, { paddingHorizontal: gutter }]}
        keyboardShouldPersistTaps="handled"
        renderSectionHeader={({ section }) => (
          <View style={s.sectionHead}>
            <Txt style={s.sectionTitle}>
              {section.title.toUpperCase()} · {section.data.length}
            </Txt>
            {section.hint ? <Txt style={s.sectionHint}>{section.hint}</Txt> : null}
          </View>
        )}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        renderItem={({ item }) => (
          <View style={s.cardRow}>
            {item.map((r) => (
              <View key={r.v.id} style={s.cardCell}>
                <ProspectListCard
                  row={r}
                  onPress={() => nav.navigate('ProspectDetail', { id: r.v.id })}
                />
              </View>
            ))}
            {item.length < perRow ? <View style={s.cardCell} /> : null}
          </View>
        )}
        ListEmptyComponent={
          <View style={s.empty}>
            <Txt style={s.emptyTitle}>No prospects match</Txt>
            <Txt style={s.emptyText}>Try another search or clear the filters.</Txt>
            <OutlineButton
              label="Clear search and filters"
              onPress={clearAll}
              style={{ paddingHorizontal: 18 }}
            />
          </View>
        }
      />
    </View>
  );
}

/** Widest the Prospects content grows on a big screen. */
const LIST_MAX = 1100;

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  banner: { backgroundColor: '#FBEBD3', paddingVertical: 6, paddingHorizontal: 16 },
  bannerText: { fontFamily: font.semibold, fontSize: 12, color: color.warnText },
  header: {
    backgroundColor: color.navy,
    paddingTop: 14,
    paddingHorizontal: 16,
    gap: 10,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { fontFamily: font.bold, fontSize: 22, color: HEAD.text },
  subtitle: { fontFamily: font.regular, fontSize: 12, color: HEAD.soft },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: HEAD.border,
    backgroundColor: HEAD.field,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchRow: { flexDirection: 'row', gap: 8 },
  search: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: HEAD.border,
    backgroundColor: HEAD.field,
    paddingLeft: 12,
    paddingRight: 4,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    height: '100%',
    fontFamily: font.regular,
    fontSize: 14,
    color: HEAD.text,
  },
  clearBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  filterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 44,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: HEAD.border,
    backgroundColor: HEAD.field,
  },
  filterText: { fontFamily: font.semibold, fontSize: 14, color: HEAD.text },
  badge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 10,
    backgroundColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontFamily: font.mono, fontSize: 11, color: color.navy },
  // Rounded pills, like Radar's signal chips.
  tabs: { gap: 8, paddingBottom: 12 },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: HEAD.border,
  },
  tabOn: { backgroundColor: color.surface, borderColor: color.surface },
  tabText: { fontFamily: font.semibold, fontSize: 14, color: HEAD.text },
  tabTextOn: { fontFamily: font.bold, color: color.navy },
  count: {
    minWidth: 22,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 10,
    backgroundColor: HEAD.field,
    alignItems: 'center',
  },
  countOn: { backgroundColor: color.blueTint },
  countText: { fontFamily: font.mono, fontSize: 11, color: HEAD.text },
  countTextOn: { color: color.navy },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    backgroundColor: color.bg,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  summaryText: { flex: 1, fontFamily: font.regular, fontSize: 12, color: color.text3 },
  sortBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 4,
  },
  sortText: { fontFamily: font.semibold, fontSize: 13, color: color.navy },
  list: { paddingHorizontal: 16, paddingBottom: 24, flexGrow: 1 },
  cardRow: { flexDirection: 'row', gap: 12 },
  cardCell: { flex: 1, minWidth: 0 },
  sectionHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingTop: 14,
    paddingBottom: 8,
  },
  sectionTitle: { fontFamily: font.bold, fontSize: 12, letterSpacing: 0.6, color: color.text2 },
  sectionHint: { fontFamily: font.regular, fontSize: 12, color: color.text3 },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 48, paddingHorizontal: 12 },
  emptyTitle: { fontFamily: font.semibold, fontSize: 16, color: color.text },
  emptyText: { fontFamily: font.regular, fontSize: 13, color: color.text3, textAlign: 'center' },
});
