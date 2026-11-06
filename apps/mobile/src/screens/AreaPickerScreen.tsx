import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { readColumn } from '../components/layout';
import { ChevronLeft, Search, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AreaRow } from '../components/AreaRow';
import { PrimaryButton, Toggle, Txt } from '../components/ui';
import {
  byCount,
  countOf,
  kindOf,
  levelHeading,
  searchByCount,
  searchMeta,
  tickOf,
  toggleArea,
  type AreaNode,
} from '../data/areas';
import { useFilters } from '../data/FilterContext';
import { areaCounts, matchesFilters, matchesListControls } from '../data/selectors';
import { useAreaTree } from '../data/useAreaTree';
import { useLoadedWorkspace } from '../data/WorkspaceProvider';
import type { RootScreenProps } from '../navigation/types';
import { color, font } from '../theme/tokens';

const SEARCH_MAX = 50;

const C = {
  link: '#1d4ed8',
  label: '#5b6576',
  fieldBg: '#f6f8fb',
  fieldBorder: '#d5dbe4',
  chipBg: '#eef3fa',
  chipBorder: '#c7d3e6',
};

type Item =
  | { kind: 'all'; node: AreaNode }
  | { kind: 'area'; node: AreaNode }
  | { kind: 'more'; hidden: number };

/** "14 khans", "7 sangkats", "Sangkat": what an area holds, or what it is. */
function holds(n: AreaNode): string {
  if (n.level === 'province') return countOf(n.children.length, 'district', n.code);
  if (n.level === 'district') return countOf(n.children.length, 'commune', n.code);
  return kindOf(n);
}

/**
 * Area picker for the Prospects filter. It edits a DRAFT of the area selection:
 * "Done" applies it, leaving any other way discards it. Counts are faceted: each
 * is the prospects matching every other active filter inside that area.
 */
export function AreaPickerScreen({ navigation }: RootScreenProps<'AreaPicker'>) {
  const { views } = useLoadedWorkspace();
  const { filters, setFilters, list } = useFilters();
  const { tree, error, retry } = useAreaTree();
  const insets = useSafeAreaInsets();

  const [draft, setDraft] = useState<Set<string>>(() => new Set(filters.area));
  const [currentCode, setCurrentCode] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [onlyWithProspects, setOnlyWithProspects] = useState(true);

  const base = useCallback((v: (typeof views)[number]) => matchesListControls(v, list), [list]);
  // Once per filter change: per commune, rolled up to district and province.
  const counts = useMemo(() => areaCounts(views, filters, base), [views, filters, base]);
  const codes = [...draft].sort();
  const result = useMemo(
    () => views.filter((v) => base(v) && matchesFilters(v, { ...filters, area: codes })).length,
    // `codes` is derived from `draft`.
    [views, base, filters, draft],
  );

  const current = (currentCode && tree?.byCode.get(currentCode)) || null;
  const searching = query.trim().length > 0;
  const count = (n: AreaNode) => counts.get(n.code) ?? 0;

  const { items, withProspects } = useMemo((): { items: Item[]; withProspects: number } => {
    if (!tree) return { items: [], withProspects: 0 };
    if (searching) {
      const found = searchByCount(tree, query, counts, { onlyWithProspects, limit: SEARCH_MAX });
      return {
        items: [
          ...found.results.map((node): Item => ({ kind: 'area', node })),
          ...(found.hidden ? [{ kind: 'more' as const, hidden: found.hidden }] : []),
        ],
        withProspects: found.results.filter((n) => counts.get(n.code)).length,
      };
    }
    const rows = current ? current.children : tree.roots;
    const shown = onlyWithProspects ? rows.filter((n) => counts.get(n.code)) : rows;
    const hidden = rows.length - shown.length;
    return {
      items: [
        ...(current ? [{ kind: 'all' as const, node: current }] : []),
        ...byCount(shown, counts).map((node): Item => ({ kind: 'area', node })),
        ...(hidden ? [{ kind: 'more' as const, hidden }] : []),
      ],
      withProspects: rows.filter((n) => counts.get(n.code)).length,
    };
  }, [tree, searching, query, counts, onlyWithProspects, current]);

  const toggle = (code: string) => tree && setDraft((d) => toggleArea(d, code, tree));

  // Back clears the search first, then goes up a level, then closes (discarding
  // the draft). The hardware back button and swipe-back do the same.
  const closing = useRef(false);
  const stepBack = useCallback((): boolean => {
    if (searching) {
      setQuery('');
      return true;
    }
    if (current) {
      setCurrentCode(current.parent?.code ?? null);
      return true;
    }
    return false;
  }, [searching, current]);
  useEffect(
    () =>
      navigation.addListener('beforeRemove', (e) => {
        if (closing.current || !stepBack()) return;
        e.preventDefault();
      }),
    [navigation, stepBack],
  );
  const back = () => {
    if (!stepBack()) navigation.goBack();
  };
  const done = () => {
    closing.current = true;
    setFilters((f) => ({ ...f, area: codes }));
    navigation.goBack();
  };

  const crumbs: { code: string | null; name: string }[] = [{ code: null, name: 'Cambodia' }];
  for (let n = current; n; n = n.parent) crumbs.splice(1, 0, { code: n.code, name: n.name_en });

  const renderItem = ({ item }: { item: Item }) => {
    if (item.kind === 'more') {
      return (
        <Pressable
          onPress={() => setOnlyWithProspects(false)}
          accessibilityRole="button"
          style={({ pressed }) => [s.more, pressed && { opacity: 0.7 }]}
        >
          <Txt style={s.moreText}>
            Show {item.hidden} area{item.hidden === 1 ? '' : 's'} with no prospects
          </Txt>
        </Pressable>
      );
    }
    const n = item.node;
    if (item.kind === 'all') {
      return (
        <AreaRow
          node={n}
          title={`All of ${n.name_en}`}
          tick={tickOf(draft, n.code)}
          meta=""
          count={count(n)}
          onTick={() => toggle(n.code)}
          all
        />
      );
    }
    return (
      <AreaRow
        node={n}
        tick={tickOf(draft, n.code)}
        meta={searching ? searchMeta(n, 0) : holds(n)}
        count={count(n)}
        onTick={() => toggle(n.code)}
        onOpen={
          n.level === 'commune'
            ? undefined
            : () => {
                setQuery('');
                setCurrentCode(n.code);
              }
        }
      />
    );
  };

  return (
    <View style={[s.screen, readColumn, { paddingTop: insets.top }]}>
      <View style={s.head}>
        <Pressable
          onPress={back}
          accessibilityRole="button"
          aria-label={searching ? 'Clear search' : current ? 'Up one level' : 'Back to filters'}
          style={({ pressed }) => [s.iconBtn, pressed && { opacity: 0.6 }]}
        >
          <ChevronLeft size={24} color={color.navy} />
        </Pressable>
        <Txt style={s.title}>Area</Txt>
        <Pressable
          onPress={() => setDraft(new Set())}
          disabled={!draft.size}
          accessibilityRole="button"
          accessibilityState={{ disabled: !draft.size }}
          style={s.clear}
        >
          <Txt style={[s.clearText, !draft.size && { color: color.textDisabled }]}>Clear</Txt>
        </Pressable>
      </View>

      <View style={s.crumbs}>
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1 && !searching;
          return (
            <React.Fragment key={c.code ?? 'kh'}>
              {i > 0 ? <Txt style={s.crumbSep}>›</Txt> : null}
              {last ? (
                <Txt style={s.crumbHere} aria-current="page">
                  {c.name}
                </Txt>
              ) : (
                <Pressable
                  onPress={() => {
                    setQuery('');
                    setCurrentCode(c.code);
                  }}
                  accessibilityRole="link"
                  hitSlop={{ top: 12, bottom: 12, left: 4, right: 4 }}
                >
                  <Txt style={s.crumbLink}>{c.name}</Txt>
                </Pressable>
              )}
            </React.Fragment>
          );
        })}
      </View>

      <View style={s.searchWrap}>
        <View style={s.search}>
          <Search size={18} color={C.label} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search province, district, commune"
            placeholderTextColor={C.label}
            style={s.searchInput}
            aria-label="Search areas"
            autoCorrect={false}
          />
          {query ? (
            <Pressable
              onPress={() => setQuery('')}
              accessibilityRole="button"
              aria-label="Clear search"
              style={s.iconBtnSm}
            >
              <X size={16} color={C.label} />
            </Pressable>
          ) : null}
        </View>
        <Toggle
          label="Only areas with prospects"
          value={onlyWithProspects}
          onChange={setOnlyWithProspects}
        />
      </View>

      <View style={s.levelRow}>
        <Txt style={s.levelLabel}>{searching ? 'Results' : levelHeading(current)}</Txt>
        {tree ? <Txt style={s.levelLabel}>{withProspects} with prospects</Txt> : null}
      </View>

      {!tree ? (
        <View style={s.state}>
          {error ? (
            <>
              <Txt style={s.stateText}>Couldn&apos;t load the area list. {error}</Txt>
              <PrimaryButton label="Try again" onPress={retry} />
            </>
          ) : (
            <ActivityIndicator color={color.navy} />
          )}
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => (it.kind === 'more' ? 'more' : `${it.kind}:${it.node.code}`)}
          renderItem={renderItem}
          contentContainerStyle={s.list}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <Txt style={s.stateText}>
              {searching ? `No areas match "${query.trim()}".` : 'No areas here.'}
            </Txt>
          }
        />
      )}

      <View style={[s.footer, { paddingBottom: 12 + insets.bottom }]}>
        {codes.length ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.chips}
          >
            {codes.map((code) => {
              const name = tree?.byCode.get(code)?.name_en ?? code;
              return (
                <Pressable
                  key={code}
                  onPress={() => toggle(code)}
                  accessibilityRole="button"
                  aria-label={`Remove ${name}`}
                  style={({ pressed }) => [s.chip, pressed && { opacity: 0.7 }]}
                >
                  <Txt style={s.chipText} numberOfLines={1}>
                    {name}
                  </Txt>
                  <X size={14} color={color.navy} />
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}
        <PrimaryButton
          label={`Done · ${result} prospect${result === 1 ? '' : 's'}`}
          onPress={done}
          style={{ marginHorizontal: 16 }}
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.surface },
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, paddingTop: 4 },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  iconBtnSm: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontFamily: font.bold, fontSize: 17, color: color.text },
  clear: { minWidth: 64, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  clearText: { fontFamily: font.semibold, fontSize: 15, color: color.navy },
  crumbs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  crumbSep: { fontFamily: font.regular, fontSize: 13, color: C.label },
  crumbLink: {
    fontFamily: font.medium,
    fontSize: 13,
    color: C.link,
    textDecorationLine: 'underline',
  },
  crumbHere: { fontFamily: font.bold, fontSize: 13, color: color.text },
  searchWrap: { paddingHorizontal: 16, gap: 4 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.fieldBorder,
    backgroundColor: C.fieldBg,
    paddingLeft: 12,
    paddingRight: 4,
  },
  searchInput: {
    flex: 1,
    height: '100%',
    fontFamily: font.regular,
    fontSize: 14,
    color: color.text,
  },
  levelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  levelLabel: {
    fontFamily: font.bold,
    fontSize: 12,
    letterSpacing: 0.72,
    textTransform: 'uppercase',
    color: C.label,
  },
  list: { paddingHorizontal: 16, paddingBottom: 12, gap: 8 },
  more: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: C.fieldBorder,
  },
  moreText: { fontFamily: font.semibold, fontSize: 13, color: C.link },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  stateText: {
    fontFamily: font.regular,
    fontSize: 13,
    color: C.label,
    textAlign: 'center',
    paddingVertical: 16,
  },
  footer: { borderTopWidth: 1, borderTopColor: color.border, paddingTop: 10, gap: 10 },
  chips: { gap: 8, paddingHorizontal: 16 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    maxWidth: 220,
    paddingHorizontal: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.chipBorder,
    backgroundColor: C.chipBg,
  },
  chipText: { flexShrink: 1, fontFamily: font.semibold, fontSize: 13, color: color.navy },
});
