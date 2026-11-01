import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, ChevronLeft, ChevronRight, Minus, Search, X } from 'lucide-react-native';
import {
  SEARCH_LIMIT,
  inAreas,
  levelHeading,
  prospectCounts,
  rowMeta,
  searchAreas,
  searchMeta,
  tickOf,
  toggleArea,
  type AreaNode,
  type AreaTree,
  type Tick,
} from '../data/areas';
import { color, font } from '../theme/tokens';
import { OutlineButton, PrimaryButton, Txt } from './ui';

// From the area-filter spec; the rest comes from the app's tokens.
const C = {
  scrim: 'rgba(5,12,24,0.45)',
  link: '#1d4ed8',
  label: '#5b6576',
  meta: '#5b6576',
  fieldBg: '#f6f8fb',
  fieldBorder: '#d5dbe4',
  rowBorder: '#e1e5ec',
  rowOnBg: '#eef3fa',
  rowOnBorder: '#bccbe3',
  allBg: '#f3f6fa',
  boxOff: '#8a94a6',
  footerLine: '#e6e9ef',
  chipBorder: '#c7d3e6',
};

/**
 * "Filter by area" bottom sheet: drill Cambodia → province → district → commune,
 * tick at any level, or search all three. The selection is a set of area codes
 * (see data/areas.ts for how ticks merge and split). Nothing applies until "Show".
 */
export function AreaPicker({
  visible,
  onClose,
  tree,
  error,
  onRetry,
  communeCodes,
  selected,
  onApply,
}: {
  visible: boolean;
  onClose: () => void;
  tree: AreaTree | null;
  error: string | null;
  onRetry: () => void;
  /** Commune code of each prospect in play (other filters applied), null if unlocated. */
  communeCodes: (string | null)[];
  selected: string[];
  onApply: (codes: string[]) => void;
}) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<Set<string>>(new Set(selected));
  const [currentCode, setCurrentCode] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  // Each opening starts from the applied filter, at the level it lives on. Only on
  // opening: re-running on every prop change would wipe the officer's draft.
  useEffect(() => {
    if (!visible) return;
    setDraft(new Set(selected));
    setQuery('');
    setCurrentCode(commonParent(selected));
  }, [visible]);

  const counts = useMemo(() => prospectCounts(communeCodes), [communeCodes]);
  const current = (currentCode && tree?.byCode.get(currentCode)) || null;
  const searching = query.trim().length > 0;
  const search = useMemo(
    () => (tree && searching ? searchAreas(tree, query) : null),
    [tree, query, searching],
  );

  const codes = [...draft].sort();
  const result = codes.length
    ? communeCodes.filter((c) => inAreas(c, codes)).length
    : communeCodes.length;

  const toggle = (code: string) => tree && setDraft((d) => toggleArea(d, code, tree));
  const open = (n: AreaNode) => {
    setQuery('');
    setCurrentCode(n.code);
  };
  const back = () => (searching ? setQuery('') : setCurrentCode(current?.parent?.code ?? null));

  const crumbs: { code: string | null; name: string }[] = [{ code: null, name: 'Cambodia' }];
  for (const n of ancestry(current)) crumbs.push({ code: n.code, name: n.name_en });

  const rows = current ? current.children : (tree?.roots ?? []);
  const heading = searching ? 'Results' : levelHeading(current);
  const headingCount = search
    ? search.total > SEARCH_LIMIT
      ? `Top ${SEARCH_LIMIT} of ${search.total}`
      : String(search.total)
    : String(rows.length);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.scrim}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          aria-label="Close area filter"
        />
        <View
          role="dialog"
          aria-modal
          aria-label="Filter by area"
          style={[s.sheet, { height: Math.min(620, height * 0.9) }]}
        >
          <View style={s.grabber} />

          <View style={s.head}>
            {current || searching ? (
              <IconButton label="Back" onPress={back}>
                <ChevronLeft size={24} color={color.navy} />
              </IconButton>
            ) : (
              <View style={s.iconBtn} />
            )}
            <Txt style={s.title}>Filter by area</Txt>
            <IconButton label="Close" onPress={onClose}>
              <X size={22} color={color.navy} />
            </IconButton>
          </View>

          <View style={s.crumbs}>
            {crumbs.map((c, i) => {
              const last = i === crumbs.length - 1;
              return (
                <React.Fragment key={c.code ?? 'kh'}>
                  {i > 0 ? <Txt style={s.crumbSep}>›</Txt> : null}
                  {last ? (
                    <Txt style={s.crumbHere} accessibilityState={{ selected: true }}>
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
                returnKeyType="search"
              />
              {query ? (
                <IconButton label="Clear search" onPress={() => setQuery('')} size={36}>
                  <X size={16} color={C.label} />
                </IconButton>
              ) : null}
            </View>
          </View>

          <View style={s.levelRow}>
            <Txt style={s.levelLabel}>{heading}</Txt>
            {tree ? <Txt style={s.levelLabel}>{headingCount}</Txt> : null}
          </View>

          {!tree ? (
            <View style={s.state}>
              {error ? (
                <>
                  <Txt style={s.meta}>Couldn&apos;t load the area list. {error}</Txt>
                  <OutlineButton label="Try again" onPress={onRetry} style={{ width: 140 }} />
                </>
              ) : (
                <ActivityIndicator color={color.navy} />
              )}
            </View>
          ) : (
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={s.list}
              keyboardShouldPersistTaps="handled"
            >
              {search ? (
                search.results.length ? (
                  search.results.map((n) => (
                    <AreaRow
                      key={n.code}
                      node={n}
                      tick={tickOf(draft, n.code)}
                      meta={searchMeta(n, counts.get(n.code) ?? 0)}
                      onTick={() => toggle(n.code)}
                      onOpen={n.level === 'commune' ? undefined : () => open(n)}
                    />
                  ))
                ) : (
                  <Txt style={[s.meta, s.empty]}>No areas match &quot;{query.trim()}&quot;.</Txt>
                )
              ) : (
                <>
                  {current ? (
                    <AreaRow
                      node={current}
                      title={`All of ${current.name_en}`}
                      tick={tickOf(draft, current.code)}
                      meta={rowMeta(current, counts.get(current.code) ?? 0)}
                      onTick={() => toggle(current.code)}
                      all
                    />
                  ) : null}
                  {rows.map((n) => (
                    <AreaRow
                      key={n.code}
                      node={n}
                      tick={tickOf(draft, n.code)}
                      meta={rowMeta(n, counts.get(n.code) ?? 0)}
                      onTick={() => toggle(n.code)}
                      onOpen={n.level === 'commune' ? undefined : () => open(n)}
                    />
                  ))}
                </>
              )}
            </ScrollView>
          )}

          <View style={[s.footer, { paddingBottom: 12 + insets.bottom }]}>
            {codes.length ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={s.chips}
                keyboardShouldPersistTaps="handled"
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
            <View style={s.buttons}>
              <OutlineButton
                label="Clear"
                onPress={() => setDraft(new Set())}
                disabled={!codes.length}
                style={{ width: 120 }}
              />
              <PrimaryButton
                label={`Show ${result} prospect${result === 1 ? '' : 's'}`}
                onPress={() => {
                  onApply(codes);
                  onClose();
                }}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** One area: the box ticks it; the body drills in, or ticks a commune. */
function AreaRow({
  node,
  title = node.name_en,
  tick,
  meta,
  onTick,
  onOpen,
  all,
}: {
  node: AreaNode;
  title?: string;
  tick: Tick;
  meta: string;
  onTick: () => void;
  onOpen?: () => void;
  all?: boolean;
}) {
  const on = tick !== 'off';
  return (
    <View style={[s.row, all && s.rowAll, on && !all && s.rowOn]}>
      <Pressable
        onPress={onTick}
        accessibilityRole="checkbox"
        accessibilityState={{
          checked: tick === 'on' ? true : tick === 'partial' ? 'mixed' : false,
        }}
        aria-label={`Select ${title}`}
        style={s.tickArea}
      >
        <View style={[s.box, on ? s.boxOn : s.boxOff]}>
          {tick === 'on' ? <Check size={15} color={color.surface} strokeWidth={3} /> : null}
          {tick === 'partial' ? <Minus size={15} color={color.surface} strokeWidth={3} /> : null}
        </View>
      </Pressable>
      <Pressable
        onPress={onOpen ?? onTick}
        accessibilityRole="button"
        aria-label={onOpen ? `Open ${title}` : `${on ? 'Unselect' : 'Select'} ${title}`}
        style={({ pressed }) => [s.rowBody, pressed && { opacity: 0.7 }]}
      >
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <View style={s.names}>
            <Txt style={[s.name, all && { fontFamily: font.bold }]} numberOfLines={1}>
              {title}
            </Txt>
            {!all && node.name_km ? (
              <Txt style={s.nameKm} numberOfLines={1}>
                {node.name_km}
              </Txt>
            ) : null}
          </View>
          {meta ? <Txt style={s.meta}>{meta}</Txt> : null}
        </View>
        {onOpen ? <ChevronRight size={20} color={C.label} /> : null}
      </Pressable>
    </View>
  );
}

function IconButton({
  label,
  onPress,
  children,
  size = 44,
}: {
  label: string;
  onPress: () => void;
  children: React.ReactNode;
  size?: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      aria-label={label}
      style={({ pressed }) => [
        s.iconBtn,
        { width: size, height: size },
        pressed && { opacity: 0.6 },
      ]}
    >
      {children}
    </Pressable>
  );
}

/** Root first, down to and including `n`. */
function ancestry(n: AreaNode | null): AreaNode[] {
  const out: AreaNode[] = [];
  for (let p = n; p; p = p.parent) out.unshift(p);
  return out;
}

/** Open on the level that holds the whole selection, if it shares one. */
function commonParent(codes: string[]): string | null {
  if (!codes.length) return null;
  const parents = new Set(codes.map((c) => (c.length > 2 ? c.slice(0, c.length - 2) : null)));
  return parents.size === 1 ? [...parents][0]! : null;
}

const s = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: C.scrim },
  sheet: {
    backgroundColor: color.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -4 },
    elevation: 16,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: color.borderStrong,
    marginTop: 8,
  },
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingTop: 2 },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontFamily: font.bold, fontSize: 16, color: color.text },
  crumbs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  crumbSep: { fontFamily: font.regular, fontSize: 13, color: C.label },
  crumbLink: {
    fontFamily: font.medium,
    fontSize: 13,
    color: C.link,
    textDecorationLine: 'underline',
  },
  crumbHere: { fontFamily: font.bold, fontSize: 13, color: color.text },
  searchWrap: { paddingHorizontal: 16, paddingBottom: 10 },
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
    paddingBottom: 8,
  },
  levelLabel: {
    fontFamily: font.bold,
    fontSize: 12,
    letterSpacing: 0.72, // .06em
    textTransform: 'uppercase',
    color: C.label,
  },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  list: { paddingHorizontal: 16, paddingBottom: 12, gap: 8 },
  empty: { textAlign: 'center', paddingVertical: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 64,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.rowBorder,
    backgroundColor: color.surface,
  },
  rowOn: { backgroundColor: C.rowOnBg, borderColor: C.rowOnBorder },
  rowAll: { backgroundColor: C.allBg },
  tickArea: { width: 52, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  box: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { backgroundColor: color.navy, borderColor: color.navy },
  boxOff: { backgroundColor: color.surface, borderColor: C.boxOff },
  rowBody: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    gap: 8,
    paddingVertical: 10,
    paddingRight: 12,
  },
  names: { flexDirection: 'row', alignItems: 'baseline', gap: 8, minWidth: 0 },
  name: { flexShrink: 1, fontFamily: font.semibold, fontSize: 15, color: color.text },
  nameKm: { flexShrink: 2, fontSize: 13, color: C.meta },
  meta: { fontFamily: font.regular, fontSize: 13, color: C.meta },
  footer: {
    borderTopWidth: 1,
    borderTopColor: C.footerLine,
    paddingTop: 10,
    gap: 10,
  },
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
    backgroundColor: C.rowOnBg,
  },
  chipText: { flexShrink: 1, fontFamily: font.semibold, fontSize: 13, color: color.navy },
  buttons: { flexDirection: 'row', gap: 10, paddingHorizontal: 16 },
});
