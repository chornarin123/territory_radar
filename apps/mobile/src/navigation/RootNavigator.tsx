import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { NavigationContainer, useNavigation, type LinkingOptions } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ChevronLeft, Clock, List, MapPin, Radar, User } from 'lucide-react-native';
import { Txt } from '../components/ui';
import { useWorkspace } from '../data/WorkspaceProvider';
import { useFilters } from '../data/FilterContext';
import { EMPTY_FILTERS } from '../data/selectors';
import { color, font } from '../theme/tokens';
import { TodayScreen } from '../screens/TodayScreen';
import { RadarScreen } from '../screens/RadarScreen';
import { ProspectsScreen } from '../screens/ProspectsScreen';
import { VisitsScreen } from '../screens/VisitsScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { FiltersScreen } from '../screens/FiltersScreen';
import { ProspectDetailScreen } from '../screens/ProspectDetailScreen';
import { CoachScreen } from '../screens/CoachScreen';
import { AreaPickerScreen } from '../screens/AreaPickerScreen';
import { EvidenceScreen } from '../screens/EvidenceScreen';
import type { RootStackParamList, TabParamList } from './types';

const Tab = createBottomTabNavigator<TabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

// URLs on web, so a refresh keeps the screen and a demo can open one directly.
const linking: LinkingOptions<RootStackParamList> = {
  prefixes: [],
  config: {
    screens: {
      Tabs: {
        screens: {
          Today: 'today',
          Radar: 'radar',
          Prospects: 'prospects',
          Visits: 'visits',
          Profile: 'profile',
        },
      },
      ProspectDetail: 'prospect/:id',
      Coach: 'prospect/:id/coach',
      Filters: 'filters',
      AreaPicker: 'filters/area',
      Evidence: 'areas/:code/evidence/:loanType',
    },
  },
};

const ICON = { Today: Clock, Radar, Prospects: List, Visits: MapPin, Profile: User } as const;
const COPY_KEY = {
  Today: 'home',
  Radar: 'radar',
  Prospects: 'pipeline',
  Visits: 'visits',
  Profile: 'profile',
};

function Tabs() {
  const { copy, locale } = useWorkspace();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => {
        const Icon = ICON[route.name];
        return {
          headerShown: false,
          tabBarActiveTintColor: color.navy,
          tabBarInactiveTintColor: color.tabInactive,
          tabBarStyle: s.tabBar,
          tabBarLabelStyle: [s.tabLabel, locale === 'km' && { fontFamily: font.khmer }],
          tabBarIcon: ({ color: c }) => <Icon size={22} strokeWidth={2} color={c} />,
          tabBarLabel: copy(COPY_KEY[route.name]),
        };
      }}
    >
      <Tab.Screen name="Today" component={TodayScreen} />
      <Tab.Screen name="Radar" component={RadarScreen} />
      <Tab.Screen name="Prospects" component={ProspectsScreen} />
      <Tab.Screen name="Visits" component={VisitsScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

/**
 * Opening a screen straight from a URL (web refresh, deep link) leaves nothing to
 * go back to, so the header would have no way out. Fall back to the prospect when
 * one is given (the coach), otherwise to the list.
 */
function BackButton({ prospectId }: { prospectId?: string }) {
  const nav = useNavigation();
  return (
    <Pressable
      onPress={() =>
        nav.canGoBack()
          ? nav.goBack()
          : prospectId
            ? nav.navigate('ProspectDetail', { id: prospectId })
            : nav.navigate('Tabs', { screen: 'Prospects' })
      }
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel="Back"
      style={s.back}
    >
      <ChevronLeft size={24} color={color.navy} strokeWidth={2} />
    </Pressable>
  );
}

function ResetButton() {
  const { setFilters } = useFilters();
  return (
    <Pressable
      onPress={() => setFilters(EMPTY_FILTERS)}
      hitSlop={12}
      accessibilityRole="button"
      style={s.reset}
    >
      <Txt style={s.resetText}>Reset</Txt>
    </Pressable>
  );
}

export function RootNavigator() {
  return (
    <NavigationContainer linking={linking} documentTitle={{ formatter: () => 'Territory Radar' }}>
      <Stack.Navigator
        screenOptions={{
          headerTintColor: color.navy,
          headerTitleStyle: { fontFamily: font.bold, fontSize: 17, color: color.text },
          headerShadowVisible: false,
          headerStyle: { backgroundColor: color.surface },
          contentStyle: { backgroundColor: color.bg },
        }}
      >
        <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
        <Stack.Screen
          name="ProspectDetail"
          component={ProspectDetailScreen}
          options={{ title: 'Prospect', headerLeft: () => <BackButton /> }}
        />
        <Stack.Screen
          name="Coach"
          component={CoachScreen}
          options={({ route }) => ({
            title: 'Discussion coach',
            headerLeft: () => <BackButton prospectId={route.params.id} />,
          })}
        />
        <Stack.Screen
          name="Filters"
          component={FiltersScreen}
          options={{
            presentation: 'modal',
            title: 'Filter prospects',
            headerLeft: () => <BackButton />,
            headerRight: () => <ResetButton />,
          }}
        />
        {/* Draws its own header: back steps out of search and up levels first. */}
        <Stack.Screen
          name="AreaPicker"
          component={AreaPickerScreen}
          options={{ headerShown: false }}
        />
        {/* Draws its own navy header. */}
        <Stack.Screen name="Evidence" component={EvidenceScreen} options={{ headerShown: false }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const s = StyleSheet.create({
  tabBar: {
    backgroundColor: color.surface,
    borderTopColor: color.border,
    paddingTop: 6,
    height: 64,
  },
  tabLabel: { fontFamily: font.semibold, fontSize: 11 },
  reset: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  back: { minHeight: 44, minWidth: 44, justifyContent: 'center', marginRight: 4 },
  resetText: { fontFamily: font.semibold, fontSize: 14, color: color.navy },
});
