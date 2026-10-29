#!/usr/bin/env node
/**
 * SW-2026-005 A4 — Routine QA standalone APK verifier (fail-closed).
 *
 * Unlike the previous helper this script does not interpolate APK paths into a
 * shell, does not skip package/signature checks when the SDK is missing, and
 * does not claim runtime enforcement from static packaging.
 *
 * Usage:
 *   node scripts/verify-android-qa-apk.mjs [apk] [--variant qa|production]
 *     [--sdk PATH] [--build-tools-version V] [--expected-cert-sha256 HEX]
 *     [--expected-version-code N] [--json]
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  buildApksignerVerifyArgs,
  parseArgv,
  profileFor,
  validateCertSha256,
} from './sw005/lib/qa-contract.mjs';
import {
  evaluateArtifact,
  parseAaptBadging,
  parseApksignerOutput,
  readZipEntries,
  summarizeApkEntries,
} from './sw005/lib/apk-inspect.mjs';
import { summarizeDex } from './sw005/lib/dex-inspect.mjs';

const execFileAsync = promisify(execFile);

const QA_APPLICATION_ID = 'com.terinit.rhythmicroutine.qa';
const REQUIRED_BUNDLE_ENTRY = 'assets/index.android.bundle';
const DEFAULT_APK_DIR = path.resolve(process.cwd(), 'android/app/build/outputs/apk/qaStandalone');

const ALLOWED = [
  'variant',
  'sdk',
  'build-tools-version',
  'expected-cert-sha256',
  'expected-version-code',
  'java',
  'json',
  'help',
];

async function run(command, args) {
  const result = await execFileAsync(command, args, {
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
    timeout: 2 * 60 * 1000,
  });
  return result.stdout ?? '';
}

function findDefaultApk() {
  if (!fs.existsSync(DEFAULT_APK_DIR)) return null;
  const files = fs
    .readdirSync(DEFAULT_APK_DIR)
    .filter((file) => file.toLowerCase().endsWith('.apk'))
    .sort();
  if (files.length === 0) return null;
  const preferred = files.find((file) => file.toLowerCase().includes('qastandalone'));
  return path.join(DEFAULT_APK_DIR, preferred ?? files[0]);
}

function resolveSdk(explicit) {
  return (
    explicit ||
    process.env.ANDROID_SDK_ROOT ||
    process.env.ANDROID_HOME ||
    (process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : null)
  );
}

function resolveBuildTools(sdk, requestedVersion) {
  const root = path.join(sdk, 'build-tools');
  if (!fs.existsSync(root)) return null;
  const versions = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+(\.\d+)+/.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const version = requestedVersion ?? versions.at(-1);
  if (!version || !versions.includes(version)) return null;
  return {
    version,
    aapt: path.join(root, version, process.platform === 'win32' ? 'aapt.exe' : 'aapt'),
    apksignerJar: path.join(root, version, 'lib', 'apksigner.jar'),
  };
}

async function main() {
  const args = parseArgv(process.argv.slice(2), ALLOWED);
  if (args.help) {
    process.stdout.write(
      'Usage: node scripts/verify-android-qa-apk.mjs [apk] [--variant qa|production] ' +
        '[--sdk PATH] [--build-tools-version V] [--expected-cert-sha256 HEX] ' +
        '[--expected-version-code N] [--json]\n'
    );
    return;
  }

  const variant = args.variant ?? 'qa';
  const profile = profileFor('routine', variant);
  if (profile.applicationId !== QA_APPLICATION_ID && variant === 'qa') {
    throw new Error('QA profile no longer maps to the canonical QA application ID');
  }
  const targetApk = args._[0] ? path.resolve(args._[0]) : findDefaultApk();

  const sdk = resolveSdk(args.sdk);
  const buildTools = sdk && fs.existsSync(sdk) ? resolveBuildTools(sdk, args['build-tools-version']) : null;
  const java =
    args.java ||
    (process.env.JAVA_HOME
      ? path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
      : 'java');

  if (!targetApk || !fs.existsSync(targetApk)) {
    process.stderr.write(`[verify-android-qa-apk] FAIL: QA APK not found at "${targetApk || DEFAULT_APK_DIR}".\n`);
    process.exitCode = 1;
    return;
  }

  const filename = path.basename(targetApk);
  if (filename === 'app-debug.apk' && !targetApk.toLowerCase().includes('qastandalone')) {
    process.stderr.write(
      '[verify-android-qa-apk] FAIL: app-debug.apk is the Metro development client, not a standalone QA APK.\n'
    );
    process.exitCode = 1;
    return;
  }
  if (variant === 'qa' && !filename.toLowerCase().includes('qa') && !targetApk.toLowerCase().includes('qastandalone')) {
    process.stderr.write(`[verify-android-qa-apk] FAIL: path does not indicate the qaStandalone variant: ${filename}\n`);
    process.exitCode = 1;
    return;
  }

  let expectedSignerSha256;
  if (args['expected-cert-sha256']) {
    expectedSignerSha256 = validateCertSha256(args['expected-cert-sha256'], 'expected certificate SHA-256');
  } else if (process.env.SW005_EXPECTED_CERT_SHA256) {
    expectedSignerSha256 = validateCertSha256(
      process.env.SW005_EXPECTED_CERT_SHA256,
      'expected certificate SHA-256'
    );
  }

  const facts = {
    exists: true,
    sizeBytes: fs.statSync(targetApk).size,
    aaptAvailable: Boolean(buildTools && fs.existsSync(buildTools.aapt)),
    aaptVersion: buildTools?.version ?? null,
    apksignerAvailable: Boolean(buildTools && fs.existsSync(buildTools.apksignerJar)),
    javaExe: java,
  };

  try {
    const buffer = fs.readFileSync(targetApk);
    const entries = readZipEntries(buffer);
    facts.packaging = summarizeApkEntries(entries);
    facts.dex = summarizeDex(buffer, entries);
  } catch (error) {
    facts.entriesError = error.message;
  }

  if (facts.aaptAvailable) {
    try {
      facts.badging = parseAaptBadging(await run(buildTools.aapt, ['dump', 'badging', targetApk]));
    } catch (error) {
      facts.badgingError = error.message;
    }
  } else {
    facts.badgingError = 'aapt unavailable; refusing to skip package/version validation';
  }

  if (facts.apksignerAvailable) {
    try {
      const output = await run(java, [
        '-jar',
        buildTools.apksignerJar,
        ...buildApksignerVerifyArgs({ apksignerJar: buildTools.apksignerJar, apk: targetApk }),
      ]);
      facts.signer = parseApksignerOutput(output);
    } catch (error) {
      facts.signerError = error.message;
    }
  }

  const spec = {
    id: 'routine-qa-standalone',
    role: 'aut',
    expectedPackage: profile.applicationId,
    versionNameSuffix: profile.versionNameSuffix,
    expectedVersionCode: args['expected-version-code'] ? Number(args['expected-version-code']) : undefined,
    expectedSignerSha256,
    requireExpectedSigner: true,
    minSizeBytes: 10 * 1024 * 1024,
    requireBundle: true,
    requireNativeLibs: true,
    requireDexModule: true,
    requireDexClasses: [
      { label: 'RhythmDeviceModule', descriptor: 'Lexpo/modules/rhythmdevice/RhythmDeviceModule;' },
      { label: 'RhythmEnforcementService', descriptor: 'Lexpo/modules/rhythmdevice/RhythmEnforcementService;' },
    ],
    requireDexRegistration: 'Lexpo/modules/ExpoModulesPackageList;',
  };

  const evaluation = evaluateArtifact(spec, facts);
  const report = {
    targetApk,
    variant,
    expected: {
      package: profile.applicationId,
      versionNameSuffix: profile.versionNameSuffix,
      versionCode: spec.expectedVersionCode ?? null,
      signerCertSha256: expectedSignerSha256 ?? null,
      bundleEntry: REQUIRED_BUNDLE_ENTRY,
    },
    sdk: {
      root: sdk ?? null,
      buildToolsVersion: buildTools?.version ?? null,
      aapt: buildTools?.aapt ?? null,
      apksignerJar: buildTools?.apksignerJar ?? null,
    },
    ok: evaluation.ok,
    rows: evaluation.rows,
  };

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`[verify-android-qa-apk] ${targetApk}\n`);
    if (!sdk) process.stderr.write('  SDK not found; package/version/signature checks fail closed.\n');
    for (const row of evaluation.rows) {
      const mark = row.status === 'PASS' ? 'PASS' : row.status === 'FAIL' ? 'FAIL' : 'NOT RUN';
      process.stdout.write(`  [${mark}] ${row.id}: ${row.detail}\n`);
    }
    process.stdout.write(
      evaluation.ok
        ? '[verify-android-qa-apk] Static packaging and signature checks passed. Runtime checks remain NOT RUN.\n'
        : '[verify-android-qa-apk] FAILED. No runtime enforcement is claimed.\n'
    );
  }

  if (!evaluation.ok) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`[verify-android-qa-apk] fatal: ${error.message}\n`);
  process.exitCode = 1;
});
