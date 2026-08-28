import { ConfigPlugin, withAndroidManifest, withEntitlementsPlist } from '@expo/config-plugins';

/**
 * Expo Config Plugin for Rhythmic-Routine native Screen Time (iOS) and UsageStats (Android).
 */
const withRhythmScreenTime: ConfigPlugin = (config) => {
  // 1. Android: Ensure PACKAGE_USAGE_STATS is declared in AndroidManifest
  config = withAndroidManifest(config, (configProps) => {
    const mainApplication = configProps.modResults.manifest;
    if (!mainApplication['uses-permission']) {
      mainApplication['uses-permission'] = [];
    }

    const hasUsageStats = mainApplication['uses-permission'].some(
      (perm: any) => perm.$?.['android:name'] === 'android.permission.PACKAGE_USAGE_STATS'
    );

    if (!hasUsageStats) {
      mainApplication['uses-permission'].push({
        $: {
          'android:name': 'android.permission.PACKAGE_USAGE_STATS',
          'tools:ignore': 'ProtectedPermissions',
        },
      } as any);
    }

    return configProps;
  });

  // 2. iOS: Declare Family Controls entitlement seam
  config = withEntitlementsPlist(config, (configProps) => {
    configProps.modResults['com.apple.developer.family-controls'] = true;
    return configProps;
  });

  return config;
};

export default withRhythmScreenTime;
