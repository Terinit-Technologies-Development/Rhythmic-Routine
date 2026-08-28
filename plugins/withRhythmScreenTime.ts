import {
  ConfigPlugin,
  withAndroidManifest,
  withEntitlementsPlist,
  withXcodeProject,
} from '@expo/config-plugins';
import * as fs from 'fs';
import * as path from 'path';

const APP_GROUP_IDENTIFIER = 'group.com.terinit.rhythmicroutine';
const EXTENSION_TARGET_NAME = 'RhythmDeviceActivityMonitor';
const EXTENSION_BUNDLE_IDENTIFIER = 'com.terinit.rhythmicroutine.activitymonitor';

/**
 * Expo Config Plugin for Rhythmic-Routine Screen Time & Device Activity Monitor Extension:
 * 1. Declares Android PACKAGE_USAGE_STATS permission in AndroidManifest.xml.
 * 2. Injects iOS Family Controls & App Group entitlements into main application.
 * 3. Synthesizes and configures the out-of-process RhythmDeviceActivityMonitor Xcode extension target.
 */
const withRhythmScreenTime: ConfigPlugin = (config) => {
  // 1. Android: Ensure PACKAGE_USAGE_STATS is declared
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

  // 2. iOS: Declare Family Controls & App Group entitlements in main app
  config = withEntitlementsPlist(config, (configProps) => {
    configProps.modResults['com.apple.developer.family-controls'] = true;

    const existingGroups = (configProps.modResults['com.apple.security.application-groups'] as string[]) || [];
    if (!existingGroups.includes(APP_GROUP_IDENTIFIER)) {
      configProps.modResults['com.apple.security.application-groups'] = [
        ...existingGroups,
        APP_GROUP_IDENTIFIER,
      ];
    }

    return configProps;
  });

  // 3. iOS: Deterministic Xcode project target synthesis
  config = withXcodeProject(config, (configProps) => {
    const xcodeProject = configProps.modResults;
    const projectRoot = configProps.modRequest.projectRoot;
    const platformProjectRoot = configProps.modRequest.platformProjectRoot;

    const extensionSourceDir = path.join(projectRoot, 'ios-targets', EXTENSION_TARGET_NAME);
    const extensionDestDir = path.join(platformProjectRoot, EXTENSION_TARGET_NAME);

    // Copy extension source files into ios project folder if not already copied
    if (fs.existsSync(extensionSourceDir)) {
      if (!fs.existsSync(extensionDestDir)) {
        fs.mkdirSync(extensionDestDir, { recursive: true });
      }

      const files = fs.readdirSync(extensionSourceDir);
      for (const file of files) {
        fs.copyFileSync(path.join(extensionSourceDir, file), path.join(extensionDestDir, file));
      }

      // Generate extension entitlements file with Family Controls + App Group
      const extEntitlementsContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.developer.family-controls</key>
    <true/>
    <key>com.apple.security.application-groups</key>
    <array>
        <string>${APP_GROUP_IDENTIFIER}</string>
    </array>
</dict>
</plist>`;
      fs.writeFileSync(path.join(extensionDestDir, `${EXTENSION_TARGET_NAME}.entitlements`), extEntitlementsContent);
    }

    // Check if target already exists (idempotent)
    const existingTarget = xcodeProject.pbxTargetByName(EXTENSION_TARGET_NAME);
    if (!existingTarget) {
      try {
        // Add extension target to PBXProject
        const target = xcodeProject.addTarget(
          EXTENSION_TARGET_NAME,
          'app_extension',
          EXTENSION_TARGET_NAME,
          EXTENSION_BUNDLE_IDENTIFIER
        );

        if (target) {
          // Add PBXGroup for extension files
          xcodeProject.addPbxGroup(
            ['DeviceActivityMonitorExtension.swift', 'Info.plist', `${EXTENSION_TARGET_NAME}.entitlements`],
            EXTENSION_TARGET_NAME,
            EXTENSION_TARGET_NAME
          );

          // Add build phase for sources
          xcodeProject.addBuildPhase(
            ['DeviceActivityMonitorExtension.swift'],
            'PBXSourcesBuildPhase',
            'Sources',
            target.uuid
          );

          // Add Frameworks build phase
          xcodeProject.addBuildPhase(
            [],
            'PBXFrameworksBuildPhase',
            'Frameworks',
            target.uuid
          );

          // Configure build settings
          const configurations = xcodeProject.pbxXCConfigurationList()[target.pbxXCConfigurationList];
          if (configurations) {
            for (const configUuid of configurations.buildConfigurations) {
              const buildConfig = xcodeProject.pbxXCBuildConfigurationSection()[configUuid.value];
              if (buildConfig && buildConfig.buildSettings) {
                buildConfig.buildSettings.PRODUCT_BUNDLE_IDENTIFIER = `"${EXTENSION_BUNDLE_IDENTIFIER}"`;
                buildConfig.buildSettings.SWIFT_VERSION = '5.0';
                buildConfig.buildSettings.TARGETED_DEVICE_FAMILY = '"1,2"';
                buildConfig.buildSettings.IPHONEOS_DEPLOYMENT_TARGET = '16.0';
                buildConfig.buildSettings.INFOPLIST_FILE = `"${EXTENSION_TARGET_NAME}/Info.plist"`;
                buildConfig.buildSettings.CODE_SIGN_ENTITLEMENTS = `"${EXTENSION_TARGET_NAME}/${EXTENSION_TARGET_NAME}.entitlements"`;
                buildConfig.buildSettings.DEVELOPMENT_TEAM = '""';
              }
            }
          }
        }
      } catch {
        // Safe fallback if target already indexed
      }
    }

    return configProps;
  });

  return config;
};

export default withRhythmScreenTime;
