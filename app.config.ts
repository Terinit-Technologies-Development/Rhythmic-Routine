import { ExpoConfig, ConfigContext } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Rhythmic-Routine',
  slug: 'Rhythmic-Routine',
  scheme: 'rhythmic-routine',
  version: '1.0.1',
  runtimeVersion: {
    policy: 'appVersion',
  },
  orientation: 'portrait',
  icon: './assets/rhythmic_routine_logo.png',
  userInterfaceStyle: 'light',
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.terinit.rhythmicroutine',
    entitlements: {
      'com.apple.developer.family-controls': true,
      'com.apple.security.application-groups': ['group.com.terinit.rhythmicroutine'],
    },
    privacyManifests: {
      NSPrivacyTracking: false,
      NSPrivacyCollectedDataTypes: [],
      NSPrivacyAccessedAPITypes: [
        {
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults',
          NSPrivacyAccessedAPITypeReasons: ['1C8F.1'],
        },
      ],
    },
  },
  android: {
    package: 'com.terinit.rhythmicroutine',
    adaptiveIcon: {
      foregroundImage: './assets/rhythmic_routine_logo.png',
      backgroundColor: '#F8F4E8',
    },
    predictiveBackGestureEnabled: false,
    permissions: ['android.permission.PACKAGE_USAGE_STATS'],
  },
  web: {
    favicon: './assets/favicon.png',
  },
  plugins: [
    'expo-router',
    'expo-status-bar',
    'expo-sqlite',
    './plugins/withRhythmScreenTime',
    './plugins/withRhythmAndroidQaBuild',
  ],
  extra: {
    eas: {
      build: {
        experimental: {
          ios: {
            appExtensions: [
              {
                targetName: 'RhythmDeviceActivityMonitor',
                bundleIdentifier: 'com.terinit.rhythmicroutine.activitymonitor',
                entitlements: {
                  'com.apple.developer.family-controls': true,
                  'com.apple.security.application-groups': ['group.com.terinit.rhythmicroutine'],
                },
              },
            ],
          },
        },
      },
    },
  },
});
