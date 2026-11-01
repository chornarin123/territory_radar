import React from 'react';
import { ActivityIndicator, StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { PrimaryButton, Txt } from './src/components/ui';
import { CoachProvider } from './src/data/CoachContext';
import { FilterProvider } from './src/data/FilterContext';
import { WorkspaceProvider, useWorkspace } from './src/data/WorkspaceProvider';
import { RootNavigator } from './src/navigation/RootNavigator';
import { useAppFonts } from './src/theme/fonts';
import { color, type } from './src/theme/tokens';

export default function App() {
  const [fontsLoaded, fontError] = useAppFonts();
  // Render with system fonts rather than a blank screen if a font fails to load.
  if (!fontsLoaded && !fontError)
    return (
      <Centered>
        <ActivityIndicator color={color.navy} />
      </Centered>
    );

  return (
    <SafeAreaProvider>
      <WorkspaceProvider>
        <Shell />
      </WorkspaceProvider>
    </SafeAreaProvider>
  );
}

function Shell() {
  const { ws, error, loading, reload, copy } = useWorkspace();

  if (!ws) {
    return (
      <Centered>
        {loading ? (
          <ActivityIndicator size="large" color={color.navy} />
        ) : (
          <View style={s.errorBox}>
            <Txt style={type.cardTitle}>{copy('errorTitle')}</Txt>
            <Txt style={[type.bodySm, { textAlign: 'center' }]}>{error ?? ''}</Txt>
            <Txt style={type.caption}>Is the mock server running? pnpm mock:server</Txt>
            <PrimaryButton
              label={copy('retry')}
              onPress={() => void reload()}
              style={{ alignSelf: 'stretch' }}
            />
          </View>
        )}
      </Centered>
    );
  }

  return (
    <SafeAreaView style={s.root} edges={['top', 'left', 'right']}>
      {/* No backgroundColor: SDK 58 Android is edge-to-edge, the bar is transparent. */}
      <StatusBar barStyle="dark-content" />
      <FilterProvider settings={ws.settings}>
        <CoachProvider>
          <RootNavigator />
        </CoachProvider>
      </FilterProvider>
    </SafeAreaView>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <View style={s.center}>{children}</View>;
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.surface },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.bg,
    padding: 24,
  },
  errorBox: {
    gap: 10,
    alignItems: 'center',
    backgroundColor: color.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: color.border,
    padding: 20,
    maxWidth: 360,
    width: '100%',
  },
});
