import fs from 'fs';
import path from 'path';

function verifyIosPrivacyManifests() {
  console.log('[verify-ios-privacy] Verifying Apple Privacy Manifests...');

  // 1. Check main app configuration
  const appConfigPath = path.resolve('app.config.ts');
  if (!fs.existsSync(appConfigPath)) {
    throw new Error('app.config.ts not found');
  }
  const appConfigContent = fs.readFileSync(appConfigPath, 'utf8');

  if (!appConfigContent.includes('privacyManifests')) {
    throw new Error('app.config.ts does not declare ios.privacyManifests');
  }
  if (!appConfigContent.includes('NSPrivacyAccessedAPICategoryUserDefaults')) {
    throw new Error('app.config.ts missing NSPrivacyAccessedAPICategoryUserDefaults');
  }
  if (!appConfigContent.includes('1C8F.1')) {
    throw new Error('app.config.ts missing required reason 1C8F.1 for App Group UserDefaults');
  }
  if (appConfigContent.includes('CA92.1')) {
    throw new Error('app.config.ts incorrectly contains CA92.1 instead of 1C8F.1');
  }
  console.log('  ✓ Verified: Main app declares ios.privacyManifests with reason 1C8F.1 for UserDefaults');

  // 2. Check extension PrivacyInfo.xcprivacy source file
  const extPrivacyPath = path.resolve('ios-targets', 'RhythmDeviceActivityMonitor', 'PrivacyInfo.xcprivacy');
  if (!fs.existsSync(extPrivacyPath)) {
    throw new Error(`Extension privacy manifest missing at ${extPrivacyPath}`);
  }
  const extPrivacyContent = fs.readFileSync(extPrivacyPath, 'utf8');

  if (!extPrivacyContent.includes('NSPrivacyAccessedAPICategoryUserDefaults')) {
    throw new Error('Extension PrivacyInfo.xcprivacy missing NSPrivacyAccessedAPICategoryUserDefaults');
  }
  if (!extPrivacyContent.includes('1C8F.1')) {
    throw new Error('Extension PrivacyInfo.xcprivacy missing required reason 1C8F.1');
  }
  if (extPrivacyContent.includes('CA92.1')) {
    throw new Error('Extension PrivacyInfo.xcprivacy incorrectly contains CA92.1');
  }
  console.log('  ✓ Verified: Extension PrivacyInfo.xcprivacy exists with reason 1C8F.1');

  // 3. Check withRhythmScreenTime.ts config plugin copies and wires it
  const pluginPath = path.resolve('plugins', 'withRhythmScreenTime.ts');
  const pluginContent = fs.readFileSync(pluginPath, 'utf8');
  if (!pluginContent.includes('PrivacyInfo.xcprivacy')) {
    throw new Error('plugins/withRhythmScreenTime.ts does not reference PrivacyInfo.xcprivacy');
  }
  if (!pluginContent.includes('PBXResourcesBuildPhase')) {
    throw new Error('plugins/withRhythmScreenTime.ts does not add PrivacyInfo.xcprivacy to PBXResourcesBuildPhase');
  }
  console.log('  ✓ Verified: withRhythmScreenTime plugin wires PrivacyInfo.xcprivacy to PBXResourcesBuildPhase');

  console.log('[verify-ios-privacy] All Apple Privacy Manifest verification checks passed successfully.');
}

verifyIosPrivacyManifests();
