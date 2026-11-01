import React, { useMemo } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SlidersHorizontal } from 'lucide-react-native';
import { ProspectCard } from '../components/ProspectCard';
import { Chip, OutlineButton, ToggleChip, Txt } from '../components/ui';
import { useFilters } from '../data/FilterContext';
import { STATUS_LABEL } from '../data/labels';
import {
  activeFilterCount,
  matchesFilters,
  matchesListControls,
  sortViews,
  type ListStatus,
} from '../data/selectors';
import { useLoadedWorkspace } from '../data/WorkspaceProvider';
import { color, font, type } from '../theme/tokens';

const STATUS_CHIPS: { id: ListStatus; label: string }[] = [
  { id: 'active', label: 'All active' },
  { id: 'new', label: STATUS_LABEL.new },
  { id: 'contacted', label: STATUS_LABEL.contacted },
  { id: 'qualified', label: STATUS_LABEL.qualified },
  { id: 'visit_planned', label: STATUS_LABEL.visit_planned },
  { id: 'follow_up', label: STATUS_LABEL.follow_up },
  { id: 'application_referred', label: STATUS_LABEL.application_referred },
  { id: 'unreachable', label: STATUS_LABEL.unreachable },
  { id: 'closedset', label: 'Closed / no need' },
];

const SORT_CAPTION = {
  priority: 'sorted by visit priority',
  fresh: 'newest signal first',
  name: 'sorted by name',
};

export function ProspectsScreen() {
  const { views, copy } = useLoadedWorkspace();
  const { filters, list, setListStatus, toggleMinScore, toggleHideNoNeed, clearAll } = useFilters();
  const nav = useNavigation();

  const shown = useMemo(
    () =>
      sortViews(
        views.filter((v) => matchesFilters(v, filters) && matchesListControls(v, list)),
        filters.sort,
      ),
    [views, filters, list],
  );
  const nFilters = activeFilterCount(filters);

  return (
    <View style={s.screen}>
      <View style={s.header}>
        <View style={s.titleRow}>
          <Txt style={type.screenTitle}>{copy('pipeline')}</Txt>
          <Pressable
            onPress={() => nav.navigate('Filters')}
            accessibilityRole="button"
            accessibilityLabel={`Filters, ${nFilters} active`}
            style={({ pressed }) => [
              s.filterBtn,
              nFilters > 0 && s.filterBtnOn,
              pressed && { opacity: 0.8 },
            ]}
          >
            <SlidersHorizontal
              size={16}
              color={nFilters ? color.surface : color.navy}
              strokeWidth={2}
            />
            <Txt style={[s.filterText, nFilters > 0 && { color: color.surface }]}>
              Filters{nFilters ? ` · ${nFilters}` : ''}
            </Txt>
          </Pressable>
        </View>
        <Txt style={type.caption}>
          {shown.length} shown · {SORT_CAPTION[filters.sort]}
        </Txt>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.chips}
        >
          {STATUS_CHIPS.map((c) => (
            <Chip
              key={c.id}
              label={c.label}
              selected={list.status === c.id}
              onPress={() => setListStatus(c.id)}
            />
          ))}
        </ScrollView>
        <View style={s.toggles}>
          <ToggleChip
            label={`Priority ≥ ${list.minScore}`}
            value={list.minScoreOn}
            onPress={toggleMinScore}
          />
          <ToggleChip label="Hide no-need" value={list.hideNoNeed} onPress={toggleHideNoNeed} />
        </View>
      </View>

      <FlatList
        data={shown}
        keyExtractor={(v) => v.id}
        renderItem={({ item }) => <ProspectCard v={item} />}
        contentContainerStyle={s.list}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        ListEmptyComponent={
          <View style={s.empty}>
            <Txt style={type.itemTitle}>{copy('emptyTitle')}</Txt>
            <OutlineButton
              label={copy('emptyAction')}
              onPress={clearAll}
              style={{ paddingHorizontal: 18 }}
            />
          </View>
        }
      />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  header: {
    backgroundColor: color.surface,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
    paddingTop: 14,
    paddingHorizontal: 16,
    paddingBottom: 10,
    gap: 10,
  },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  filterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: color.borderStrong,
    backgroundColor: color.surface,
  },
  filterBtnOn: { backgroundColor: color.navy, borderColor: color.navy },
  filterText: { fontFamily: font.semibold, fontSize: 14, color: color.navy },
  chips: { gap: 8 },
  toggles: { flexDirection: 'row', gap: 8 },
  list: { padding: 16, paddingTop: 12, flexGrow: 1 },
  empty: { alignItems: 'center', gap: 10, paddingVertical: 40, paddingHorizontal: 12 },
});
