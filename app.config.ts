import { ExpoConfig, ConfigContext } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Rhythmic-Routine',
  slug: 'Rhythmic-Routine',
  scheme: 'rhythmic-routine',
  version: '1.0.0',
  runtimeVersion: {
    policy: 'appVersion',
  },
  orientation: 'portrait',
  icon: './assets/icon.png',
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
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
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
