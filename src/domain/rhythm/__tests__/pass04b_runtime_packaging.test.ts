import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  injectQaBuildType,
  RHYTHM_QA_BUILD_MARKER,
} from '../../../../plugins/withRhythmAndroidQaBuild';
import {
  FallbackModule,
  isRhythmNativeModuleAvailable,
} from '../../../../modules/rhythm-device';

describe('Pass 04B — Android Runtime Packaging, Development Client & Standalone QA APK', () => {
  describe('Task 2: withRhythmAndroidQaBuild Config Plugin', () => {
    const mockGradleContent = `
android {
    namespace 'com.terinit.rhythmicroutine'
    defaultConfig {
        applicationId 'com.terinit.rhythmicroutine'
    }
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig signingConfigs.debug
            minifyEnabled true
        }
    }
}
`;

    it('injects qaStandalone block into buildTypes { ... }', () => {
      const output = injectQaBuildType(mockGradleContent);

      assert.ok(output.includes(RHYTHM_QA_BUILD_MARKER), 'Should include the QA build marker');
      assert.ok(output.includes('qaStandalone {'), 'Should include qaStandalone block');
      assert.ok(output.includes('initWith release'), 'Should inherit from release');
      assert.ok(output.includes('signingConfig signingConfigs.debug'), 'Should use debug signing config');
      assert.ok(output.includes('applicationIdSuffix ".qa"'), 'Should add .qa package suffix');
      assert.ok(output.includes('versionNameSuffix "-qa"'), 'Should add -qa version suffix');
      assert.ok(output.includes('minifyEnabled false'), 'Should disable Proguard minification');
      assert.ok(output.includes("matchingFallbacks = ['release']"), 'Should fallback to release for libraries');
    });

    it('is strictly idempotent on repeated prebuild runs', () => {
      const firstPass = injectQaBuildType(mockGradleContent);
      const secondPass = injectQaBuildType(firstPass);
      const thirdPass = injectQaBuildType(secondPass);

      assert.equal(firstPass, secondPass, 'Second pass should match first pass exactly');
      assert.equal(secondPass, thirdPass, 'Third pass should match second pass exactly');

      const markerCount = (secondPass.match(new RegExp(RHYTHM_QA_BUILD_MARKER.replace(/\//g, '\\/'), 'g')) || []).length;
      assert.equal(markerCount, 1, 'Marker should appear exactly once in gradle content');
    });

    it('throws when buildTypes { block is missing', () => {
      const invalidGradle = `android { namespace 'test' }`;
      assert.throws(() => injectQaBuildType(invalidGradle), /Unable to locate "buildTypes \{" block/);
    });
  });

  describe('Task 3: Expo Go Compatibility & Native Fallback Classification', () => {
    it('exposes isRhythmNativeModuleAvailable as a boolean', () => {
      assert.equal(typeof isRhythmNativeModuleAvailable, 'boolean');
    });

    it('FallbackModule does not report granted native permissions on native fallback (non-web)', async () => {
      // In Node test runner, Platform.OS is not 'web' (defaults to android/ios or undefined)
      const permissions = await FallbackModule.checkPermissions();

      assert.equal(
        permissions.hasUsagePermission,
        false,
        'hasUsagePermission must be false when native RhythmDevice module is unavailable'
      );
      assert.equal(
        permissions.hasRestrictionPermission,
        false,
        'hasRestrictionPermission must be false when native RhythmDevice module is unavailable'
      );
      assert.equal(
        permissions.monitoringOperational,
        false,
        'monitoringOperational must be false when native module is unavailable'
      );
      assert.equal(
        permissions.persistentMonitoringOperational,
        false,
        'persistentMonitoringOperational must be false when native module is unavailable'
      );
    });

    it('evaluates fallback state to foundation-only restrictionCapability and never enforced', async () => {
      const permissions = await FallbackModule.checkPermissions();
      const restrictionCapability = permissions.hasRestrictionPermission ? 'enforced' : 'foundation-only';

      assert.equal(
        restrictionCapability,
        'foundation-only',
        'Capability must strictly evaluate to foundation-only when native permissions are ungranted'
      );
      assert.notEqual(
        restrictionCapability,
        'enforced',
        'Fallback state must NEVER report enforced'
      );
    });

    it('FallbackModule showFamilyActivityPicker returns 0 tokens when native module is unavailable', async () => {
      const pickerResult = await FallbackModule.showFamilyActivityPicker('social');
      assert.equal(pickerResult.tokenCount, 0, 'Should not report tokens when native picker is unavailable');
    });
  });
});
