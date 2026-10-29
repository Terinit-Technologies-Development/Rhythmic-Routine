/**
 * SW-2026-005 A4 — explicit per-application native project layout facts.
 *
 * Routine is an Expo CNG project whose generated Android project lives at
 * `android/`. Reader and Meditation keep their Gradle project at repository
 * root (`settings.gradle.kts`, `app/`). Never infer one layout from another.
 */

import * as path from 'node:path';

export const APP_LAYOUTS = Object.freeze({
  routine: {
    projectSubdir: 'android',
    apkRoot: 'android/app/build/outputs/apk',
    variant: 'qaStandalone',
    testVariant: 'qaStandaloneAndroidTest',
    buildTask: 'assembleQaStandalone',
    testTask: 'assembleQaStandaloneAndroidTest',
    applicationId: 'com.terinit.rhythmicroutine.qa',
    testApplicationId: 'com.terinit.rhythmicroutine.qa.test',
    versionNameSuffix: '-qa',
  },
  reader: {
    projectSubdir: '.',
    apkRoot: 'app/build/outputs/apk',
    variant: 'debug',
    testVariant: 'debugAndroidTest',
    buildTask: 'assembleDebug',
    testTask: 'assembleDebugAndroidTest',
    applicationId: 'com.terinit.rhythmicreader',
    testApplicationId: 'com.terinit.rhythmicreader.test',
    versionNameSuffix: null,
  },
  meditation: {
    projectSubdir: '.',
    apkRoot: 'app/build/outputs/apk',
    variant: 'debug',
    testVariant: 'debugAndroidTest',
    buildTask: 'assembleDebug',
    testTask: 'assembleDebugAndroidTest',
    applicationId: 'com.terinit.rhythmicmeditation',
    testApplicationId: 'com.terinit.rhythmicmeditation.test',
    versionNameSuffix: null,
  },
});

function withLayout(app, overrides = {}) {
  const base = APP_LAYOUTS[app];
  if (!base) throw new Error(`Unknown app layout: ${app}`);
  const merged = { ...base, ...overrides };
  if (!merged.projectSubdir || path.isAbsolute(merged.projectSubdir)) {
    throw new Error(`${app} projectSubdir must be a relative path from the repository root`);
  }
  if (!merged.apkRoot || path.isAbsolute(merged.apkRoot)) {
    throw new Error(`${app} apkRoot must be a relative path from the repository root`);
  }
  return merged;
}

/**
 * Resolve the complete build plan for one app. The returned artifact paths are
 * absolute and are the exact paths the build/sign/verify pipeline will use.
 */
export function planAppBuild(app, { root, layoutOverrides = {}, routineVersionCode, architectures = ['arm64-v8a'] }) {
  const rootPath = path.resolve(root);
  const layout = withLayout(app, layoutOverrides);
  const projectDir = path.resolve(rootPath, layout.projectSubdir);
  const artifactRoot = path.resolve(rootPath, layout.apkRoot);
  const isRoutine = app === 'routine';

  const autApk = isRoutine
    ? path.join(artifactRoot, 'qaStandalone', 'app-qaStandalone.apk')
    : path.join(artifactRoot, 'debug', 'app-debug.apk');
  const testApk = isRoutine
    ? path.join(artifactRoot, 'androidTest', 'qaStandalone', 'app-qaStandalone-androidTest.apk')
    : path.join(artifactRoot, 'androidTest', 'debug', 'app-debug-androidTest.apk');

  const aut = {
    id: `${app}-qa`,
    role: 'aut',
    app,
    sourceRepoId: app,
    variant: layout.variant,
    task: layout.buildTask,
    expectedPackage: layout.applicationId,
    versionNameSuffix: layout.versionNameSuffix,
    expectedVersionCode: isRoutine ? routineVersionCode : undefined,
    minSizeMb: 10,
    requireBundle: isRoutine,
    requireNativeLibs: isRoutine,
    requiredAbi: isRoutine ? architectures[0] : undefined,
    requireDexModule: isRoutine,
    requireDexClasses: isRoutine
      ? (layout.requireDexClasses ?? [
          { label: 'RhythmDeviceModule', descriptor: 'Lexpo/modules/rhythmdevice/RhythmDeviceModule;' },
          { label: 'RhythmEnforcementService', descriptor: 'Lexpo/modules/rhythmdevice/RhythmEnforcementService;' },
        ])
      : [],
    requireDexRegistration: isRoutine
      ? (layout.requireDexRegistration ?? 'Lexpo/modules/ExpoModulesPackageList;')
      : null,
    apkPath: autApk,
  };

  const test = {
    id: `${app}-qa-test`,
    role: 'test',
    app,
    sourceRepoId: app,
    variant: layout.testVariant,
    task: layout.testTask,
    expectedPackage: layout.testApplicationId,
    versionNameSuffix: null,
    expectedVersionCode: undefined,
    minSizeMb: 1,
    requireBundle: false,
    requireNativeLibs: false,
    requiredAbi: undefined,
    requireDexModule: false,
    requireDexClasses: [],
    requireDexStrings: [],
    testTargetAppId: layout.applicationId,
    apkPath: testApk,
  };

  return {
    app,
    root: rootPath,
    layout,
    projectDir,
    tasks: [layout.buildTask, layout.testTask],
    artifacts: [aut, test],
    taskEvidence: 'build mode probes each task with gradle help --task before building',
  };
}

export function applyArtifactOverrides(plan, overrides = []) {
  if (!Array.isArray(overrides) || overrides.length === 0) return plan;
  const byId = new Map(overrides.map((override) => [override.id, override]));
  return {
    ...plan,
    artifacts: plan.artifacts.map((artifact) => {
      const override = byId.get(artifact.id);
      if (!override) return artifact;
      const apkRelative = override.apkRelative;
      return {
        ...artifact,
        ...override,
        apkPath: apkRelative ? path.resolve(plan.root, apkRelative) : (override.apkPath ?? artifact.apkPath),
      };
    }),
  };
}
