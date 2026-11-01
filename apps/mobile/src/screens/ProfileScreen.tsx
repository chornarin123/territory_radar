import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Card, OutlineButton, Pill, Txt } from '../components/ui';
import { productShortName } from '../data/labels';
import { shortDate } from '../data/time';
import { useLoadedWorkspace } from '../data/WorkspaceProvider';
import { color, font, type } from '../theme/tokens';

const TAB_KEYS = ['home', 'radar', 'pipeline', 'visits', 'profile'];

export function ProfileScreen() {
  const { ws, views, locale, setLocale, copy } = useLoadedWorkspace();
  const [firstName, roleTitle] = ws.officer.displayName.split(' — ');
  const coverage = ws.metadata.translationCoverage[locale];

  const communes = ws.administrativeAreas.filter((a) => a.level === 'commune');
  const since = ws.territoryAssignments[0]?.effectiveFrom;

  const st = ws.settings;
  const rules: [string, boolean][] = [
    ['Auto-confirm financing interest', st.autoConfirmFinancingInterest],
    ['Call / message from app', st.allowExternalContactActions],
    ['Hide "no need" from recommendations', st.excludeNotInterestedFromRecommendations],
  ];

  return (
    <View style={s.screen}>
      <View style={s.header}>
        <View style={s.avatar}>
          <Txt style={s.avatarText}>{ws.officer.avatarInitials}</Txt>
        </View>
        <View style={{ gap: 2, flex: 1 }}>
          <Txt style={s.name}>{firstName}</Txt>
          <Txt style={s.role}>
            {roleTitle ?? ws.officer.role} · {ws.officer.email}
          </Txt>
        </View>
      </View>

      <ScrollView contentContainerStyle={s.body}>
        <Card>
          <Txt style={type.cardTitle}>Language</Txt>
          <View style={s.twoCol}>
            <OutlineButton
              label="English"
              active={locale === 'en'}
              onPress={() => setLocale('en')}
              style={{ flex: 1 }}
            />
            <OutlineButton
              label="ខ្មែរ"
              active={locale === 'km'}
              onPress={() => setLocale('km')}
              style={{ flex: 1 }}
            />
          </View>
          {coverage === 'labels_only' ? (
            <Txt style={type.caption}>
              Khmer covers labels only in this demo. Signals and notes stay in English.
            </Txt>
          ) : null}
          <View style={s.tabPreview}>
            {TAB_KEYS.map((k) => (
              <View key={k} style={s.tabChip}>
                <Txt style={s.tabChipText} numberOfLines={1}>
                  {copy(k)}
                </Txt>
              </View>
            ))}
          </View>
        </Card>

        <Card>
          <Txt style={type.cardTitle}>Territory</Txt>
          <Txt style={type.bodySm}>
            {ws.branch?.name}
            {since ? ` · since ${shortDate(`${since}T00:00:00+07:00`)} ${since.slice(0, 4)}` : ''}
          </Txt>
          {communes.map((c) => (
            <View key={c.id} style={s.row}>
              <Txt style={[type.body, { color: color.text }]}>Sangkat {c.nameEn}</Txt>
              <Txt style={s.count}>
                {views.filter((v) => v.commune === c.nameEn).length} prospects
              </Txt>
            </View>
          ))}
          <Txt style={type.caption}>Prospects outside your assignment are not visible to you.</Txt>
        </Card>

        <Card>
          <Txt style={type.cardTitle}>Safeguards</Txt>
          {rules.map(([label, on]) => (
            <View key={label} style={s.row}>
              <Txt style={[type.bodySm, { flex: 1, color: color.text }]}>{label}</Txt>
              <Txt style={[s.onOff, { color: on ? color.okText : color.pendText }]}>
                {on ? 'On' : 'Off'}
              </Txt>
            </View>
          ))}
        </Card>

        <Card>
          <Txt style={type.cardTitle}>Discussion categories</Txt>
          <View style={s.chips}>
            {ws.products.map((p) => (
              <Pill
                key={p.id}
                label={productShortName(p.name)}
                bg={color.blueTint}
                fg={color.navy}
                style={s.prod}
              />
            ))}
          </View>
          {/* Spec §4: the product placeholder disclaimer stays visible. */}
          <Txt style={type.caption}>
            Placeholders, not a verified PPCBank catalog. Confirm actual products and eligibility
            before real use.
          </Txt>
        </Card>

        <View style={s.disclaimer}>
          <Txt style={s.disclaimerText}>{ws.metadata.disclaimer}</Txt>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  header: {
    backgroundColor: color.navy,
    paddingVertical: 18,
    paddingHorizontal: 20,
    flexDirection: 'row',
    gap: 14,
    alignItems: 'center',
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: color.navyDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: font.bold, fontSize: 20, color: color.surface },
  name: { fontFamily: font.bold, fontSize: 20, color: color.surface },
  role: { fontFamily: font.regular, fontSize: 13, color: color.navySoft },
  body: { paddingVertical: 14, paddingHorizontal: 16, gap: 12 },
  twoCol: { flexDirection: 'row', gap: 8 },
  tabPreview: { flexDirection: 'row', gap: 4, paddingTop: 4 },
  tabChip: {
    flex: 1,
    backgroundColor: color.bg,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 2,
  },
  tabChipText: { fontFamily: font.semibold, fontSize: 12, color: color.navy, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: color.divider,
    paddingTop: 8,
  },
  count: { fontFamily: font.mono, fontSize: 13, color: color.navy },
  onOff: { fontFamily: font.bold, fontSize: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  prod: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  disclaimer: { backgroundColor: color.warnBg, borderRadius: 16, padding: 14 },
  disclaimerText: { fontFamily: font.regular, fontSize: 12, lineHeight: 18, color: color.warnText },
});
