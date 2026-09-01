import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import getExpoConfig from '../../../../app.config';
import { RHYTHM_QA_STANDALONE_BLOCK } from '../../../../plugins/withRhythmAndroidQaBuild';

describe('Pass 04C — App Icon Integration & QA Standalone Packaging Invariants', () => {
  const rootDir = path.resolve(__dirname, '../../../../');

  it('app.config canonical icon uses rhythmic_routine_logo', () => {
    const config = getExpoConfig({} as any);

    assert.ok(config.icon, 'Canonical icon must be defined');
    assert.match(
      config.icon,
      /assets\/rhythmic_routine_logo\./,
      `Canonical icon must point to rhythmic_routine_logo.*, got: ${config.icon}`
    );

    const resolvedPath = path.resolve(rootDir, config.icon);
    assert.ok(fs.existsSync(resolvedPath), `Asset file must exist at ${resolvedPath}`);
  });

  it('Android adaptive icon uses the new logo and brand background color', () => {
    const config = getExpoConfig({} as any);

    assert.ok(config.android?.adaptiveIcon, 'android.adaptiveIcon must be configured');
    assert.match(
      config.android.adaptiveIcon.foregroundImage!,
      /assets\/rhythmic_routine_logo\./,
      `Adaptive icon foreground must point to rhythmic_routine_logo.*, got: ${config.android.adaptiveIcon.foregroundImage}`
    );
    assert.equal(
      config.android.adaptiveIcon.backgroundColor,
      '#F8F4E8',
      'Adaptive icon background must match brand off-white #F8F4E8'
    );
  });

  it('legacy Android icon assets are not present in active app.config', () => {
    const config = getExpoConfig({} as any);
    const configStr = JSON.stringify(config);

    assert.ok(!configStr.includes('android-icon-foreground.png'), 'Must not reference android-icon-foreground.png');
    assert.ok(!configStr.includes('android-icon-background.png'), 'Must not reference android-icon-background.png');
    assert.ok(!configStr.includes('android-icon-monochrome.png'), 'Must not reference android-icon-monochrome.png');
    assert.ok(!configStr.includes('assets/icon.png'), 'Must not reference assets/icon.png');
  });

  it('qaStandalone remains initWith release, uses debug signing, and has .qa package suffix', () => {
    assert.ok(RHYTHM_QA_STANDALONE_BLOCK.includes('qaStandalone {'), 'Must declare qaStandalone');
    assert.ok(RHYTHM_QA_STANDALONE_BLOCK.includes('initWith release'), 'Must inherit from release');
    assert.ok(RHYTHM_QA_STANDALONE_BLOCK.includes('signingConfig signingConfigs.debug'), 'Must use debug signing');
    assert.ok(RHYTHM_QA_STANDALONE_BLOCK.includes('applicationIdSuffix ".qa"'), 'Must append .qa suffix');
    assert.ok(RHYTHM_QA_STANDALONE_BLOCK.includes('versionNameSuffix "-qa"'), 'Must append -qa version suffix');
    assert.ok(RHYTHM_QA_STANDALONE_BLOCK.includes("matchingFallbacks = ['release']"), 'Must fallback to release');
    assert.ok(!RHYTHM_QA_STANDALONE_BLOCK.includes('initWith debug'), 'qaStandalone MUST NOT be based on debug');
  });

  it('qaStandalone is not configured as a debuggable RN variant in android/app/build.gradle', () => {
    const buildGradlePath = path.resolve(rootDir, 'android/app/build.gradle');
    if (fs.existsSync(buildGradlePath)) {
      const content = fs.readFileSync(buildGradlePath, 'utf8');
      assert.ok(
        !content.includes('debuggableVariants = ["qaStandalone"]') &&
        !content.includes("debuggableVariants = ['qaStandalone']"),
        'qaStandalone must not be configured as a debuggable RN variant'
      );
    }
  });

  it('verifier script targets QA standalone APK and rejects app-debug.apk', () => {
    const verifierPath = path.resolve(rootDir, 'scripts/verify-android-qa-apk.mjs');
    assert.ok(fs.existsSync(verifierPath), 'Verifier script must exist');

    const verifierSrc = fs.readFileSync(verifierPath, 'utf8');
    assert.ok(verifierSrc.includes('assets/index.android.bundle'), 'Must verify embedded JS bundle');
    assert.ok(verifierSrc.includes('com.terinit.rhythmicroutine.qa'), 'Must verify .qa application ID');
    assert.ok(verifierSrc.includes('app-debug.apk'), 'Must explicitly detect and explain app-debug.apk');
  });

  it('runtime documentation does not instruct assembleDebug for standalone installation', () => {
    const runtimeDocPath = path.resolve(rootDir, 'docs/qa/android-runtime-build-modes.md');
    assert.ok(fs.existsSync(runtimeDocPath), 'Runtime modes doc must exist');

    const docContent = fs.readFileSync(runtimeDocPath, 'utf8');
    // In the Mode 3 Standalone QA section, it must instruct assembleQaStandalone, not assembleDebug
    const standaloneSection = docContent.split('## 4. Mode 3: Standalone QA APK')[1] || '';
    assert.ok(
      standaloneSection.includes('assembleQaStandalone'),
      'Standalone instructions must specify assembleQaStandalone'
    );
    assert.ok(
      !standaloneSection.includes('assembleDebug'),
      'Standalone instructions must NOT instruct assembleDebug'
    );
    assert.ok(
      !standaloneSection.includes('expo export:embed'),
      'Standalone instructions must NOT instruct manual expo export:embed'
    );
  });
});
