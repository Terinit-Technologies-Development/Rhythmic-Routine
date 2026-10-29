/**
 * SW-2026-005 A4 shared-signer QA harness — policy and provenance contract.
 *
 * Every function here is pure unless documented. The contract is deliberately
 * small: paths, argv arrays, signer env indirection, device authorization,
 * memory preflight, repo pinning and the release manifest.
 */

import * as path from 'node:path';
import { createHash } from 'node:crypto';

export const PROGRAM_ID = 'SW-2026-005';
export const MANIFEST_SCHEMA_VERSION = 1;

export const APP_PROFILES = Object.freeze({
  routine: {
    qa: { applicationId: 'com.terinit.rhythmicroutine.qa', versionNameSuffix: '-qa' },
    production: { applicationId: 'com.terinit.rhythmicroutine', versionNameSuffix: null },
  },
  reader: {
    qa: { applicationId: 'com.terinit.rhythmicreader', versionNameSuffix: null },
    production: { applicationId: 'com.terinit.rhythmicreader', versionNameSuffix: null },
  },
  meditation: {
    qa: { applicationId: 'com.terinit.rhythmicmeditation', versionNameSuffix: null },
    production: { applicationId: 'com.terinit.rhythmicmeditation', versionNameSuffix: null },
  },
});

export const PROTOCOLS = Object.freeze({
  routine: ['reader-daily-evidence-v2', 'reader-recovery-v1', 'meditation-v1'],
  reader: ['reader-daily-evidence-v2', 'reader-recovery-v1'],
  meditation: ['meditation-v1', 'attention-insight-v1'],
});

export function profileFor(app, variant) {
  const profiles = APP_PROFILES[app];
  if (!profiles) throw new Error(`Unknown app profile: ${app}`);
  const selected = profiles[variant];
  if (!selected) throw new Error(`Unknown variant "${variant}" for ${app}`);
  return { app, variant, ...selected };
}

export function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

export function assertAbsolutePath(value, label) {
  assertNonEmptyString(value, label);
  if (!path.isAbsolute(value)) throw new Error(`${label} must be an absolute path: ${value}`);
  return path.normalize(value);
}

function comparable(value) {
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

/** True when `child` is equal to or nested under `parent`. */
export function isPathInside(child, parent) {
  const childPath = comparable(path.resolve(child));
  const parentPath = comparable(path.resolve(parent));
  if (childPath === parentPath) return true;
  return childPath.startsWith(parentPath.endsWith(path.sep) ? parentPath : parentPath + path.sep);
}

/**
 * Shared QA signing keys must live outside every product checkout so a stray
 * `git add -A` can never stage private material.
 */
export function validateKeystorePlacement(keystorePath, repoRoots) {
  const resolved = assertAbsolutePath(keystorePath, 'keystore path');
  if (!Array.isArray(repoRoots) || repoRoots.length === 0) {
    throw new Error('At least one repository root is required to validate keystore placement');
  }
  for (const root of repoRoots) {
    if (isPathInside(resolved, root)) {
      throw new Error(`Keystore must be outside every repository checkout (inside ${root})`);
    }
  }
  const ext = path.extname(resolved).toLowerCase();
  if (!['.jks', '.keystore', '.p12', '.pfx'].includes(ext)) {
    throw new Error(`Unsupported keystore extension: ${ext || '(none)'}`);
  }
  return resolved;
}

export function validatePasswordEnvName(name, label) {
  assertNonEmptyString(name, label);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`${label} must be an environment variable name, not a password value`);
  }
  if (/^(pass|password|keypass|kspass)$/i.test(name)) {
    throw new Error(`${label} looks like a literal password; use an environment variable name`);
  }
  return name;
}

export function validateCertSha256(value, label) {
  assertNonEmptyString(value, label);
  const normalised = value.replace(/:/g, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalised)) {
    throw new Error(`${label} must be a 64-character SHA-256 hex digest`);
  }
  return normalised;
}

export function validatePinnedSha(value, label) {
  assertNonEmptyString(value, label);
  if (!/^[0-9a-f]{40}$/i.test(value)) {
    throw new Error(`${label} must be a full 40-character commit SHA`);
  }
  return value.toLowerCase();
}

export function redactSerial(serial) {
  assertNonEmptyString(serial, 'device serial');
  const hash = createHash('sha256').update(serial).digest('hex');
  return { alias: `device-${hash.slice(0, 10)}`, serialSha256: hash };
}

export function validateProviderUri(uri) {
  assertNonEmptyString(uri, 'provider URI');
  let parsed;
  try {
    parsed = new URL(uri);
  } catch {
    throw new Error(`Invalid provider URI: ${uri}`);
  }
  if (parsed.protocol !== 'content:') throw new Error('Provider URI must use content://');
  if (!parsed.hostname) throw new Error('Provider URI must include an authority');
  if (parsed.search) throw new Error('Provider URI must not carry a query string');
  if (parsed.pathname.includes('..')) throw new Error('Provider URI path must not contain ..');
  return {
    uri,
    authority: parsed.hostname,
    path: parsed.pathname,
    sha256: createHash('sha256').update(uri).digest('hex'),
  };
}

export function redactProviderUri(uri) {
  const parsed = validateProviderUri(uri);
  const segments = parsed.path.split('/').filter(Boolean).map((segment) =>
    /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d{4}-\d{2}-\d{2}|\d+)$/i.test(segment)
      ? '<redacted>'
      : segment
  );
  return `content://${parsed.authority}/${segments.join('/')}`;
}

export function buildInstallPlan({ variant, adb = 'adb', serial = '<serial>', artifactsDir = '<signed-artifacts-dir>' }) {
  const routine =
    variant === 'production'
      ? { id: 'routine-production', pkg: 'com.terinit.rhythmicroutine' }
      : { id: 'routine-qa', pkg: 'com.terinit.rhythmicroutine.qa' };
  const apps = [
    routine,
    { id: 'reader-qa', pkg: 'com.terinit.rhythmicreader' },
    { id: 'meditation-qa', pkg: 'com.terinit.rhythmicmeditation' },
  ];
  const apk = (id) => path.join(artifactsDir, `${id}.signed.apk`);
  return {
    variant,
    apps,
    update: apps.map((app) => ({ command: adb, args: ['-s', serial, 'install', '-r', apk(app.id)] })),
    cleanInstall: [
      ...apps.map((app) => ({
        command: adb,
        args: ['-s', serial, 'uninstall', app.pkg],
        note: 'OPERATOR GATE: removes local data for this package only',
      })),
      ...apps.map((app) => ({ command: adb, args: ['-s', serial, 'install', apk(app.id)] })),
    ],
    rollback: apps.map((app) => ({
      command: adb,
      args: ['-s', serial, 'install', '-r', '-d', apk(app.id)],
      note: 'OPERATOR GATE: data-preserving where platform accepts lower versionCode',
    })),
    authorityCheck: {
      command: adb,
      args: ['-s', serial, 'shell', 'pm', 'list', 'packages', 'com.terinit.rhythmicroutine'],
    },
  };
}

export function buildInstrumentationArgv({
  adb = 'adb',
  serial,
  testPackage,
  runner,
  testClass,
  providerUri,
  providerPackage,
  requiredColumns = [],
}) {
  assertNonEmptyString(serial, 'device serial');
  assertNonEmptyString(testPackage, 'instrumentation test package');
  assertNonEmptyString(runner, 'instrumentation runner');
  assertNonEmptyString(testClass, 'test class');
  validateProviderUri(providerUri);
  assertNonEmptyString(providerPackage, 'provider package');
  const escapedPackage = testPackage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!new RegExp(`^${escapedPackage}/`).test(runner)) {
    throw new Error(`Runner component must belong to test package ${testPackage}`);
  }
  if (!/^[A-Za-z_][A-Za-z0-9_$]*(\.[A-Za-z_][A-Za-z0-9_$]*)+$/.test(testClass)) {
    throw new Error('Test class must be a fully qualified Java/Kotlin class name');
  }
  const args = ['-s', serial, 'shell', 'am', 'instrument', '-w', '-r', '-e', 'class', testClass];
  args.push('-e', 'providerUri', providerUri, '-e', 'providerPackage', providerPackage);
  if (requiredColumns.length > 0) args.push('-e', 'requiredColumns', requiredColumns.join(','));
  args.push(runner);
  return { command: adb, args };
}

export function parseProviderAuthorities(dumpsysText) {
  const authorities = new Set();
  for (const line of String(dumpsysText).split(/\r?\n/)) {
    const match = /^\s*(?:Authorities|authorities)\s*[:=]\s*(.+)$/i.exec(line);
    if (match) {
      for (const authority of match[1].split(/[;,]\s*/)) {
        if (authority.trim()) authorities.add(authority.trim());
      }
    }
  }
  return [...authorities];
}

export function validateProbeBaseline(evidence, expected) {
  if (!evidence || typeof evidence !== 'object') throw new Error('positive baseline evidence is missing');
  const fields = ['providerPackage', 'autPackage', 'testPackage', 'providerUriSha256', 'expectedSignerSha256'];
  for (const field of fields) {
    if (!expected[field]) throw new Error(`baseline comparison field ${field} is missing`);
    if (evidence[field] !== expected[field]) {
      throw new Error(`positive baseline ${field} does not match the current probe`);
    }
  }
  if (evidence.status !== 'PASS' || evidence.expectation !== 'positive' || !Number.isInteger(evidence.testsRun) || evidence.testsRun < 1) {
    throw new Error('positive baseline did not record a passing, non-zero positive test run');
  }
  if (evidence.failures !== 0) throw new Error('positive baseline recorded failures');
  return true;
}

/**
 * Default-deny device gate. No device work happens unless the caller supplied
 * an exact serial, an explicit authorization flag and a device classification.
 */
export function resolveDeviceRequest(input = {}) {
  const mode = input.mode ?? 'plan';
  if (mode === 'plan') {
    return { allowed: false, execute: false, code: 'PLAN_ONLY', reason: 'plan mode never touches a device' };
  }
  if (mode !== 'execute') {
    return { allowed: false, execute: false, code: 'UNKNOWN_MODE', reason: `unknown device mode: ${mode}` };
  }
  if (!input.serial || typeof input.serial !== 'string' || input.serial.trim() === '') {
    return { allowed: false, execute: false, code: 'SERIAL_REQUIRED', reason: 'an exact device serial is required' };
  }
  if (input.authorizeDevice !== true) {
    return {
      allowed: false,
      execute: false,
      code: 'AUTHORIZATION_REQUIRED',
      reason: 'pass --authorize-device after explicit operator authorization',
    };
  }
  if (!['disposable', 'owner-consented'].includes(input.deviceKind)) {
    return {
      allowed: false,
      execute: false,
      code: 'DEVICE_KIND_REQUIRED',
      reason: 'declare --device-kind disposable or owner-consented',
    };
  }
  if (input.deviceKind === 'owner-consented' && !input.ownerConsentToken) {
    return {
      allowed: false,
      execute: false,
      code: 'OWNER_CONSENT_REQUIRED',
      reason: 'owner hardware requires a recorded C2 handoff/consent token',
    };
  }
  const redacted = redactSerial(input.serial.trim());
  return {
    allowed: true,
    execute: true,
    serial: input.serial.trim(),
    deviceKind: input.deviceKind,
    deviceAlias: redacted.alias,
    serialSha256: redacted.serialSha256,
  };
}

export function evaluateMemoryPreflight({
  totalBytes,
  freeBytes,
  minFreeBytes = 3 * 1024 ** 3,
  emulatorRunning = false,
  allowLowMemory = false,
} = {}) {
  const rows = [];
  if (!Number.isFinite(totalBytes) || !Number.isFinite(freeBytes)) {
    rows.push({ id: 'memory-visibility', status: 'FAIL', detail: 'free/total physical memory is not visible' });
    return { ok: false, rows };
  }
  const totalGiB = totalBytes / 1024 ** 3;
  const freeGiB = freeBytes / 1024 ** 3;
  const minGiB = minFreeBytes / 1024 ** 3;

  rows.push({
    id: 'memory-headroom',
    status: freeBytes >= minFreeBytes ? 'PASS' : allowLowMemory ? 'WARN' : 'FAIL',
    detail: `${freeGiB.toFixed(2)} GiB free of ${totalGiB.toFixed(2)} GiB; target >= ${minGiB.toFixed(2)} GiB before a serial native build`,
  });
  rows.push({
    id: 'memory-no-emulator',
    status: emulatorRunning ? 'FAIL' : 'PASS',
    detail: emulatorRunning
      ? 'an emulator appears to be running; do not build alongside an emulator'
      : 'no emulator is expected alongside this build',
  });
  rows.push({
    id: 'memory-limitation',
    status: 'PASS',
    detail:
      'This is a run-time headroom check only. It is not a permanent RAM fix and does not change page-file or OS configuration.',
  });
  return { ok: rows.every((row) => row.status !== 'FAIL'), rows };
}

export function validateRepoState({ id, pinnedSha, head, statusPorcelain }) {
  const rows = [];
  const cleanPinned = validatePinnedSha(pinnedSha, `${id} pinned SHA`);
  rows.push({
    id: `${id}-pinned-sha`,
    status: 'PASS',
    detail: `pinned ${cleanPinned}`,
  });
  const headSha = String(head ?? '').trim().toLowerCase();
  rows.push({
    id: `${id}-head-matches`,
    status: headSha === cleanPinned ? 'PASS' : 'FAIL',
    detail: `HEAD=${headSha || '(missing)'}; expected=${cleanPinned}`,
  });
  const dirty = String(statusPorcelain ?? '').trim();
  rows.push({
    id: `${id}-clean-checkout`,
    status: dirty === '' ? 'PASS' : 'FAIL',
    detail: dirty === '' ? 'worktree clean' : 'worktree is dirty; the harness will not clean, reset or overwrite it',
  });
  return { ok: rows.every((row) => row.status === 'PASS'), rows };
}

export function buildZipalignArgs({ inputApk, outputApk, pageAlignment = 16 }) {
  assertAbsolutePath(inputApk, 'zipalign input APK');
  assertAbsolutePath(outputApk, 'zipalign output APK');
  if (inputApk === outputApk) throw new Error('zipalign must not overwrite its input in place');
  return ['-P', String(pageAlignment), '-f', '4', inputApk, outputApk];
}

/**
 * Passwords travel only as `env:NAME` references. The caller adds the actual
 * values to the child process environment; they never enter argv, JSON or logs.
 */
export function buildApksignerSignArgs({
  apksignerJar,
  keystore,
  keyAlias,
  keystorePassEnv,
  keyPassEnv,
  inputApk,
  outputApk,
}) {
  assertAbsolutePath(apksignerJar, 'apksigner jar');
  assertAbsolutePath(keystore, 'keystore');
  assertAbsolutePath(inputApk, 'apksigner input APK');
  assertAbsolutePath(outputApk, 'apksigner output APK');
  assertNonEmptyString(keyAlias, 'key alias');
  validatePasswordEnvName(keystorePassEnv, 'keystore password env');
  validatePasswordEnvName(keyPassEnv, 'key password env');
  if (inputApk === outputApk) throw new Error('apksigner must not overwrite its input in place');
  return [
    'sign',
    '--ks',
    keystore,
    '--ks-key-alias',
    keyAlias,
    '--ks-pass',
    `env:${keystorePassEnv}`,
    '--key-pass',
    `env:${keyPassEnv}`,
    '--out',
    outputApk,
    inputApk,
  ];
}

export function buildApksignerVerifyArgs({ apksignerJar, apk }) {
  assertAbsolutePath(apksignerJar, 'apksigner jar');
  assertAbsolutePath(apk, 'APK');
  return ['verify', '--print-certs', '-v', '-Werr', apk];
}

/**
 * Gradle 9.3 launcher invocation. Executed through `java -jar` with an argv
 * array, never through a `.bat` file or a composed shell string.
 */
export function buildGradleInvocation({
  javaExe,
  launcherJar,
  projectDir,
  task,
  gradleUserHome,
  maxHeapMb = 1024,
  maxWorkers = 1,
  architectures = ['arm64-v8a'],
  extraArgs = [],
}) {
  assertNonEmptyString(javaExe, 'java executable');
  if (!path.isAbsolute(javaExe) && !/^java(\.exe)?$/i.test(javaExe)) {
    throw new Error('java executable must be an absolute path or the PATH name java');
  }
  assertAbsolutePath(launcherJar, 'Gradle launcher jar');
  assertAbsolutePath(projectDir, 'Gradle project dir');
  assertNonEmptyString(task, 'Gradle task');
  if (!Number.isInteger(maxHeapMb) || maxHeapMb < 1024 || maxHeapMb > 8192) {
    throw new Error('maxHeapMb must be an integer between 1024 and 8192');
  }
  if (maxWorkers !== 1) throw new Error('native QA builds must use exactly one Gradle worker');
  if (!Array.isArray(architectures) || architectures.length === 0) {
    throw new Error('at least one native architecture is required');
  }

  const args = [
    `-Xmx${maxHeapMb}m`,
    '-Dorg.gradle.jvmargs=' +
      `-Xmx${Math.max(1024, Math.floor(maxHeapMb * 0.75))}m ` +
      '-XX:MaxMetaspaceSize=512m -Dfile.encoding=UTF-8',
    '-Dorg.gradle.daemon=false',
    '-Dorg.gradle.parallel=false',
    '-Dorg.gradle.workers.max=1',
    '-jar',
    launcherJar,
    '--no-daemon',
    '--no-parallel',
    '--max-workers=1',
    '--console=plain',
    '--project-dir',
    projectDir,
    `-PreactNativeArchitectures=${architectures.join(',')}`,
    ...extraArgs,
    task,
  ];
  if (gradleUserHome) {
    assertAbsolutePath(gradleUserHome, 'isolated Gradle user home');
    args.splice(args.indexOf('--no-daemon'), 0, '--gradle-user-home', gradleUserHome);
  }
  return { command: javaExe, args };
}

export function parseArgv(argv, allowedKeys) {
  if (!Array.isArray(argv)) throw new TypeError('argv must be an array');
  const allowed = new Set(allowedKeys);
  const result = { _: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--') {
      result._.push(...argv.slice(index + 1));
      break;
    }
    if (!token.startsWith('--')) {
      result._.push(token);
      continue;
    }

    const equals = token.indexOf('=');
    let key;
    let value;
    if (equals > 2) {
      key = token.slice(2, equals);
      value = token.slice(equals + 1);
    } else {
      key = token.slice(2);
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith('--')) {
        value = next;
        index += 1;
      } else {
        value = true;
      }
    }

    if (!allowed.has(key)) throw new Error(`Unknown option --${key}`);
    if (Object.prototype.hasOwnProperty.call(result, key)) {
      throw new Error(`Duplicate option --${key}`);
    }
    result[key] = value;
  }
  return result;
}

const SECRET_KEY_PATTERN = /pass(word|phrase|wd)?$|private.?key|keystore.?blob|secret/i;
const KEY_MATERIAL_PATTERN = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;

export function findSecretMaterial(value, pathParts = []) {
  const findings = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => findings.push(...findSecretMaterial(item, [...pathParts, String(index)])));
    return findings;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      const childPath = [...pathParts, key];
      if (SECRET_KEY_PATTERN.test(key)) {
        findings.push(`${childPath.join('.')} uses a secret-shaped key`);
      }
      findings.push(...findSecretMaterial(child, childPath));
    }
    return findings;
  }
  if (typeof value === 'string' && KEY_MATERIAL_PATTERN.test(value)) {
    findings.push(`${pathParts.join('.')} contains private key material`);
  }
  return findings;
}

export function hydrateManifest(input) {
  const {
    generatedAt = new Date().toISOString(),
    repos,
    artifacts,
    signing,
    runtimeChecks = defaultRuntimeChecks(),
    device = null,
    commands = [],
    notes = [],
    toolchain = {},
  } = input ?? {};

  if (!Array.isArray(repos) || repos.length === 0) throw new Error('manifest requires repositories');
  if (!Array.isArray(artifacts) || artifacts.length === 0) throw new Error('manifest requires artifacts');
  if (!signing?.expectedCertSha256) throw new Error('manifest requires the expected signer fingerprint');

  const expectedCert = validateCertSha256(signing.expectedCertSha256, 'expected signer fingerprint');
  const seenSourceShas = new Map();

  const normalisedRepos = repos.map((repo) => {
    const sourceSha = validatePinnedSha(repo.sourceSha, `${repo.id} source SHA`);
    if (repo.dirty !== false) throw new Error(`${repo.id} must be recorded as clean (dirty=false)`);
    if (seenSourceShas.has(repo.id)) throw new Error(`Duplicate repository id: ${repo.id}`);
    seenSourceShas.set(repo.id, sourceSha);
    return {
      id: repo.id,
      sourceSha,
      dirty: false,
      branch: repo.branch ?? null,
      variant: repo.variant ?? null,
      applicationId: repo.applicationId ?? null,
      protocols: Array.isArray(repo.protocols) ? [...repo.protocols] : [],
    };
  });

  const normalisedArtifacts = artifacts.map((artifact) => {
    const role = artifact.role;
    if (!['aut', 'test'].includes(role)) throw new Error(`artifact ${artifact.id} has invalid role`);
    const finalSha256 = validateCertSha256OrHash(artifact.finalApkSha256, `${artifact.id} final APK SHA-256`);
    const originalSha256 = validateCertSha256OrHash(
      artifact.originalApkSha256,
      `${artifact.id} original APK SHA-256`
    );
    const signerCertSha256 = validateCertSha256(
      artifact.signerCertSha256,
      `${artifact.id} signer certificate SHA-256`
    );
    if (signerCertSha256 !== expectedCert) {
      throw new Error(`${artifact.id} signer ${signerCertSha256} does not match expected ${expectedCert}`);
    }
    const sourceSha = validatePinnedSha(artifact.sourceSha, `${artifact.id} source SHA`);
    if (!seenSourceShas.has(artifact.sourceRepoId)) {
      throw new Error(`${artifact.id} references unknown source repo ${artifact.sourceRepoId}`);
    }
    if (seenSourceShas.get(artifact.sourceRepoId) !== sourceSha) {
      throw new Error(`${artifact.id} source SHA does not match its repository record`);
    }
    if (!Number.isInteger(artifact.versionCode) || artifact.versionCode <= 0) {
      throw new Error(`${artifact.id} must record a positive integer versionCode`);
    }
    assertNonEmptyString(artifact.versionName, `${artifact.id} versionName`);
    assertNonEmptyString(artifact.packageName, `${artifact.id} packageName`);

    return {
      id: artifact.id,
      role,
      app: artifact.app,
      variant: artifact.variant,
      sourceRepoId: artifact.sourceRepoId,
      sourceSha,
      packageName: artifact.packageName,
      versionName: artifact.versionName,
      versionCode: artifact.versionCode,
      protocols: Array.isArray(artifact.protocols) ? [...artifact.protocols] : [],
      originalApkSha256: originalSha256,
      finalApkSha256: finalSha256,
      signerCertSha256,
      abis: Array.isArray(artifact.abis) ? [...artifact.abis] : [],
      nativeDexClasses: Array.isArray(artifact.nativeDexClasses) ? [...artifact.nativeDexClasses] : [],
      nativeAutolink: Array.isArray(artifact.nativeAutolink) ? [...artifact.nativeAutolink] : [],
      embeddedBundle: artifact.embeddedBundle === true,
      testTargetAppId: artifact.testTargetAppId ?? null,
      checks: Array.isArray(artifact.checks) ? artifact.checks : [],
    };
  });

  const autPackages = new Set(
    normalisedArtifacts.filter((artifact) => artifact.role === 'aut').map((artifact) => artifact.packageName)
  );
  for (const testArtifact of normalisedArtifacts.filter((artifact) => artifact.role === 'test')) {
    if (!testArtifact.testTargetAppId) {
      throw new Error(`${testArtifact.id} must record testTargetAppId`);
    }
    if (!autPackages.has(testArtifact.testTargetAppId)) {
      throw new Error(`${testArtifact.id} targets ${testArtifact.testTargetAppId}, which is not built as an AUT`);
    }
  }

  const signers = new Set(normalisedArtifacts.map((artifact) => artifact.signerCertSha256));
  if (signers.size !== 1) throw new Error('all AUT and instrumentation APKs must share exactly one signer');

  const manifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    program: PROGRAM_ID,
    generatedAt,
    signing: {
      expectedCertSha256: expectedCert,
      keystoreAlias: signing.keystoreAlias ?? null,
      passwordSource: 'environment-variable',
    },
    repos: normalisedRepos,
    artifacts: normalisedArtifacts,
    toolchain: {
      buildToolsVersion: toolchain.buildToolsVersion ?? null,
      maxHeapMb: toolchain.maxHeapMb ?? null,
      maxWorkers: toolchain.maxWorkers ?? null,
    },
    device: device
      ? { kind: device.kind, alias: device.deviceAlias, serialSha256: device.serialSha256 }
      : null,
    commands,
    runtimeChecks,
    notes,
    limitations: [
      'Static APK checks cannot prove ENFORCED runtime behaviour.',
      'Instrumentation results must come from a real authorized device run.',
      'No provider completion, gate, ordinal or counter may be seeded by this harness.',
    ],
  };

  const findings = findSecretMaterial(manifest);
  if (findings.length > 0) throw new Error(`manifest contains secret-shaped data: ${findings.join('; ')}`);
  return manifest;
}

function validateCertSha256OrHash(value, label) {
  assertNonEmptyString(value, label);
  const normalised = value.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalised)) throw new Error(`${label} must be a SHA-256 hex digest`);
  return normalised;
}

export function defaultRuntimeChecks() {
  return [
    { id: 'T19-same-signer-ipc', status: 'NOT RUN', detail: 'requires disposable/consented device' },
    { id: 'T18-mismatched-signer-denial', status: 'NOT RUN', detail: 'requires disposable/consented device' },
    { id: 'T07-T10-morning-enforcement', status: 'NOT RUN', detail: 'requires installed runtime proof' },
    { id: 'T12-T17-restorative-gates', status: 'NOT RUN', detail: 'requires installed runtime proof' },
    { id: 'T20-native-enforcement-truth', status: 'NOT RUN', detail: 'requires installed runtime proof' },
    { id: 'T22-android16-upgrade', status: 'NOT RUN', detail: 'requires owner-authorized hardware' },
  ];
}

export function checkManifestProvenance(manifest) {
  const rows = [];
  const add = (id, ok, detail) =>
    rows.push({ id, status: ok ? 'PASS' : 'FAIL', detail });

  if (!manifest || typeof manifest !== 'object') {
    return { ok: false, rows: [{ id: 'manifest-shape', status: 'FAIL', detail: 'manifest missing' }] };
  }
  add('manifest-schema', manifest.schemaVersion === MANIFEST_SCHEMA_VERSION, `schemaVersion=${manifest.schemaVersion}`);
  add('manifest-program', manifest.program === PROGRAM_ID, `program=${manifest.program}`);

  const repos = Array.isArray(manifest.repos) ? manifest.repos : [];
  add('manifest-repos', repos.length > 0, `${repos.length} repository record(s)`);
  add(
    'manifest-pinned-sources',
    repos.every((repo) => /^[0-9a-f]{40}$/.test(repo.sourceSha) && repo.dirty === false),
    'every source SHA is full and every checkout is recorded clean'
  );
  add(
    'manifest-toolchain',
    Boolean(manifest.toolchain?.buildToolsVersion),
    `build-tools=${manifest.toolchain?.buildToolsVersion ?? '(missing)'}`
  );

  const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
  add('manifest-artifacts', artifacts.length > 0, `${artifacts.length} artifact record(s)`);
  add(
    'manifest-provenance',
    artifacts.every(
      (artifact) =>
        /^[0-9a-f]{64}$/.test(artifact.originalApkSha256 ?? '') &&
        /^[0-9a-f]{64}$/.test(artifact.finalApkSha256 ?? '') &&
        /^[0-9a-f]{64}$/.test(artifact.signerCertSha256 ?? '') &&
        /^[0-9a-f]{40}$/.test(artifact.sourceSha ?? '')
    ),
    'original/final APK, signer and source hashes are complete'
  );
  add(
    'manifest-single-signer',
    new Set(artifacts.map((artifact) => artifact.signerCertSha256)).size === 1,
    'all artifacts share one signer'
  );
  add(
    'manifest-test-targets',
    artifacts
      .filter((artifact) => artifact.role === 'test')
      .every((artifact) =>
        artifacts.some(
          (candidate) => candidate.role === 'aut' && candidate.packageName === artifact.testTargetAppId
        )
      ),
    'every instrumentation APK targets a built AUT'
  );
  add(
    'manifest-runtime-not-claimed',
    Array.isArray(manifest.runtimeChecks) &&
      manifest.runtimeChecks.every((check) => check.status === 'NOT RUN'),
    'runtime checks remain NOT RUN until a real device run'
  );
  const findings = findSecretMaterial(manifest);
  add('manifest-no-secrets', findings.length === 0, findings.join('; ') || 'no secret-shaped material');

  return { ok: rows.every((row) => row.status === 'PASS'), rows };
}
