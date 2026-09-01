import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { Info } from 'lucide-react-native';
import { isRhythmNativeModuleAvailable } from '../../modules/rhythm-device';
import { colors, radii } from '../theme/tokens';

/**
 * Subtle notice displayed only when running in development on a native device
 * without the custom RhythmDevice native module (e.g. standard Expo Go).
 *
 * Never rendered on:
 * - web
 * - production
 * - standalone QA builds
 * - custom development clients containing RhythmDevice
 */
export function ExpoGoDevBanner() {
  if (
    !__DEV__ ||
    Platform.OS === 'web' ||
    isRhythmNativeModuleAvailable
  ) {
    return null;
  }

  return (
    <View style={styles.banner}>
      <Info size={16} color={colors.amberDark} style={styles.icon} />
      <Text style={styles.text}>
        Native device controls are unavailable in Expo Go. Use the Rhythm development build for full device testing.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginHorizontal: 20,
    marginBottom: 16,
  },
  icon: {
    marginRight: 10,
    flexShrink: 0,
  },
  text: {
    fontSize: 13,
    color: '#92400E',
    flex: 1,
    lineHeight: 18,
    fontWeight: '500',
  },
});

