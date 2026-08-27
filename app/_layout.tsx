import React from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors } from '../src/theme/tokens';
import { DemoStateSwitcher } from '../src/components/DemoStateSwitcher';
import { TimeSelectorModal } from '../src/components/TimeSelectorModal';
import { AppEditModal } from '../src/components/AppEditModal';
import { EmergencyAccessModal } from '../src/components/EmergencyAccessModal';

import { usePrototypeStore } from '../src/store/usePrototypeStore';

export default function RootLayout() {
  const initializeApps = usePrototypeStore((s) => s.initializeApps);
  const resolveExpiredTimer = usePrototypeStore((s) => s.resolveExpiredTimer);

  React.useEffect(() => {
    initializeApps();
  }, [initializeApps]);

  React.useEffect(() => {
    const id = setInterval(() => {
      resolveExpiredTimer();
    }, 1000);
    return () => clearInterval(id);
  }, [resolveExpiredTimer]);
  return (
    <SafeAreaProvider>
      <View style={styles.webCenteringContainer}>
        <View style={styles.mobileViewport}>
          <StatusBar style="dark" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.background },
              animation: 'slide_from_right',
            }}
          >
            <Stack.Screen name="index" />
            <Stack.Screen name="onboarding/index" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="risk-groups/[id]" />
            <Stack.Screen name="touch-grass" />
            <Stack.Screen name="settings" />
          </Stack>

          {/* Global Prototype Overlays */}
          <DemoStateSwitcher />
          <TimeSelectorModal />
          <AppEditModal />
          <EmergencyAccessModal />
        </View>
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  webCenteringContainer: {
    flex: 1,
    backgroundColor: '#ECE7DC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mobileViewport: {
    flex: 1,
    width: '100%',
    maxWidth: Platform.OS === 'web' ? 440 : undefined,
    height: '100%',
    backgroundColor: colors.background,
    overflow: 'hidden',
    shadowColor: '#164B38',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: Platform.OS === 'web' ? 0.15 : 0,
    shadowRadius: 30,
    elevation: Platform.OS === 'web' ? 10 : 0,
  },
});
