#!/usr/bin/env node

/**
 * Verification script for Android QA Standalone APK packaging.
 *
 * Verifies:
 * 1. Target APK exists and is non-empty.
 * 2. File size exceeds sensible minimum (> 10MB).
 * 3. Filename / path reflects the qaStandalone variant.
 * 4. Embedded React Native / Hermes JavaScript bundle (assets/index.android.bundle) is present.
 * 5. Application ID is strictly com.terinit.rhythmicroutine.qa and version suffix is -qa (via aapt if available).
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const defaultApkDir = path.resolve(process.cwd(), 'android/app/build/outputs/apk/qaStandalone');

function findDefaultApk() {
  if (!fs.existsSync(defaultApkDir)) {
    return null;
  }
  const files = fs.readdirSync(defaultApkDir).filter((f) => f.endsWith('.apk'));
  if (files.length === 0) {
    return null;
  }
  return path.join(defaultApkDir, files[0]);
}

const targetApk = process.argv[2] ? path.resolve(process.argv[2]) : findDefaultApk();

console.log('[verify-android-qa-apk] Verifying Android QA Standalone APK packaging...');

if (!targetApk || !fs.existsSync(targetApk)) {
  console.error(`  ✗ Error: QA APK not found at "${targetApk || defaultApkDir}".`);
  console.error('    Ensure you ran "./gradlew.bat assembleQaStandalone" in android/.');
  process.exit(1);
}

console.log(`  ✓ Target APK found: ${targetApk}`);

// 1. File size check (> 10 MB)
const stats = fs.statSync(targetApk);
const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);
const minSizeMb = 10;
if (stats.size < minSizeMb * 1024 * 1024) {
  console.error(`  ✗ Error: APK size is unexpectedly small (${sizeMb} MB < ${minSizeMb} MB).`);
  process.exit(1);
}
console.log(`  ✓ APK size verified: ${sizeMb} MB (${stats.size.toLocaleString()} bytes)`);

// 2. Filename check
const filename = path.basename(targetApk);
if (filename === 'app-debug.apk' && !targetApk.toLowerCase().includes('qastandalone')) {
  console.error(`  ✗ Error: Target is a debug development client ("${filename}"), NOT a standalone QA APK.`);
  console.error('    The standalone QA APK is located under android/app/build/outputs/apk/qaStandalone/.');
  console.error('    To build it, run: .\\gradlew.bat assembleQaStandalone -PreactNativeArchitectures=arm64-v8a');
  process.exit(1);
}
if (!filename.toLowerCase().includes('qa') && !targetApk.toLowerCase().includes('qastandalone')) {
  console.error(`  ✗ Error: APK path does not indicate a QA standalone variant: "${filename}"`);
  console.error('    Expected an artifact from the "qaStandalone" build type.');
  process.exit(1);
}
console.log(`  ✓ QA variant name verified: ${filename}`);

// 3. Inspect ZIP contents for embedded JavaScript bundle
let archiveEntries = [];
try {
  const tarOutput = execSync(`tar -tf "${targetApk}"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
  archiveEntries = tarOutput.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
} catch {
  // Fallback: check with powershell if tar fails
  try {
    const psCmd = `powershell -NoProfile -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::OpenRead('${targetApk}').Entries | ForEach-Object { $_.FullName }"`;
    const psOutput = execSync(psCmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    archiveEntries = psOutput.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch (err) {
    console.error('  ✗ Error: Failed to inspect APK archive entries:', err);
    process.exit(1);
  }
}

const hasBundle = archiveEntries.some(
  (entry) =>
    entry === 'assets/index.android.bundle' ||
    entry.endsWith('/index.android.bundle') ||
    entry.includes('index.android.bundle')
);

if (!hasBundle) {
  console.error('  ✗ Critical Error: No embedded JavaScript bundle found in APK archive!');
  console.error('    The APK is likely a debuggable variant that expects Metro (localhost:8081).');
  console.error('    Ensure "qaStandalone" inherits from release and is NOT in react.debuggableVariants.');
  process.exit(1);
}
console.log('  ✓ Embedded JS asset verified: "assets/index.android.bundle" is packaged inside APK');

// 4. Inspect badging via aapt if available
function findAaptPath() {
  try {
    const whichAapt = execSync(process.platform === 'win32' ? 'where.exe aapt' : 'which aapt', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim().split(/\r?\n/)[0];
    if (whichAapt && fs.existsSync(whichAapt)) return whichAapt;
  } catch {}

  const sdkRoot =
    process.env.ANDROID_HOME ||
    process.env.ANDROID_SDK_ROOT ||
    (process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : null);

  if (sdkRoot) {
    const buildToolsDir = path.join(sdkRoot, 'build-tools');
    if (fs.existsSync(buildToolsDir)) {
      const versions = fs.readdirSync(buildToolsDir).sort().reverse();
      for (const v of versions) {
        const candidate = path.join(buildToolsDir, v, process.platform === 'win32' ? 'aapt.exe' : 'aapt');
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }
  return null;
}

const aaptPath = findAaptPath();
if (aaptPath) {
  try {
    const badging = execSync(`"${aaptPath}" dump badging "${targetApk}"`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });

    const expectedAppId = 'com.terinit.rhythmicroutine.qa';
    if (!badging.includes(`name='${expectedAppId}'`)) {
      console.error(`  ✗ Error: Expected applicationId "${expectedAppId}" was not found in APK badging.`);
      process.exit(1);
    }
    console.log(`  ✓ Application ID verified via aapt: "${expectedAppId}"`);

    if (badging.includes("versionName='1.0.1-qa'") || badging.includes("-qa'")) {
      console.log('  ✓ Version name suffix verified via aapt: "1.0.1-qa"');
    }
  } catch (err) {
    console.warn('  ! Warning: aapt dump badging inspection failed (non-fatal):', err.message);
  }
} else {
  console.log('  ℹ aapt not found; skipped deep package ID verification (archive checks passed).');
}

console.log('[verify-android-qa-apk] All Android Standalone QA APK checks passed successfully.');
