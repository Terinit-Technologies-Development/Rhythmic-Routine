import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';

import {
  APP_PROFILES,
  buildApksignerSignArgs,
  buildGradleInvocation,
  buildZipalignArgs,
  checkManifestProvenance,
  evaluateMemoryPreflight,
  hydrateManifest,
  isPathInside,
  parseArgv,
  profileFor,
  redactSerial,
  resolveDeviceRequest,
  validateKeystorePlacement,
  validatePasswordEnvName,
  validateRepoState,
} from './lib/qa-contract.mjs';

const CERT = 'a'.repeat(64);
const OTHER_CERT = 'b'.repeat(64);
const SHA = 'c'.repeat(40);
const HASH = 'd'.repeat(64);

function baseArtifact(overrides = {}) {
  return {
    id: 'routine-qa',
    role: 'aut',
    app: 'routine',
    variant: 'qaStandalone',
    sourceRepoId: 'routine',
    sourceSha: SHA,
    packageName: 'com.terinit.rhythmicroutine.qa',
    versionName: '1.3.0-qa',
    versionCode: 5,
    protocols: ['reader-recovery-v1'],
    originalApkSha256: HASH,
    finalApkSha256: HASH,
    signerCertSha256: CERT,
    abis: ['arm64-v8a'],
    embeddedBundle: true,
    testTargetAppId: null,
    checks: [],
    ...overrides,
  };
}

function baseManifest(overrides = {}) {
  return hydrateManifest({
    generatedAt: '2026-10-29T00:00:00.000Z',
    repos: [
      {
        id: 'routine',
        sourceSha: SHA,
        dirty: false,
        variant: 'qaStandalone',
        applicationId: 'com.terinit.rhythmicroutine.qa',
        protocols: ['reader-recovery-v1'],
      },
    ],
    artifacts: [baseArtifact()],
    signing: { expectedCertSha256: CERT, keystoreAlias: 'shared-qa' },
    toolchain: { buildToolsVersion: '36.0.0', maxHeapMb: 2048, maxWorkers: 1 },
    ...overrides,
  });
}

describe('SW-2026-005 QA contract', () => {
  it('parses argv with spaces and equals syntax without shell composition', () => {
    const parsed = parseArgv(
      ['--keystore', 'C:\\Keys With Spaces\\qa shared.p12', '--expected-cert-sha256=' + CERT, '--strict'],
      ['keystore', 'expected-cert-sha256', 'strict']
    );
    assert.equal(parsed.keystore, 'C:\\Keys With Spaces\\qa shared.p12');
    assert.equal(parsed['expected-cert-sha256'], CERT);
    assert.equal(parsed.strict, true);

    const quoted = parseArgv(['--keystore', 'C:\\Keys "QA"\\qa shared.p12'], ['keystore']);
    assert.equal(quoted.keystore, 'C:\\Keys "QA"\\qa shared.p12');
    assert.throws(() => parseArgv(['--unknown', 'x'], ['known']), /Unknown option/);
    assert.throws(() => parseArgv(['--strict', '--strict'], ['strict']), /Duplicate option/);
  });

  it('keeps the shared keystore outside every repository and rejects literal passwords', () => {
    const routineRoot = path.resolve('worktrees', 'routine');
    const readerRoot = path.resolve('worktrees', 'reader');
    const outside = path.resolve('shared signing', 'sw005-qa.p12');
    assert.equal(validateKeystorePlacement(outside, [routineRoot, readerRoot]), outside);
    assert.throws(
      () => validateKeystorePlacement(path.join(routineRoot, 'keys', 'qa.p12'), [routineRoot]),
      /outside every repository/i
    );
    assert.throws(() => validateKeystorePlacement('relative/qa.p12', [routineRoot]), /absolute/i);
    assert.equal(validatePasswordEnvName('SW005_KS_PASS', 'env'), 'SW005_KS_PASS');
    assert.throws(() => validatePasswordEnvName('pass:hunter2', 'env'), /environment variable name/i);
  });

  it('builds apksigner argv with env:NAME indirection and distinct output', () => {
    const input = path.resolve('build outputs', 'app qa.apk');
    const output = path.resolve('signed outputs', 'app qa signed.apk');
    const args = buildApksignerSignArgs({
      apksignerJar: path.resolve('sdk', 'build-tools', '36.0.0', 'lib', 'apksigner.jar'),
      keystore: path.resolve('shared keys', 'qa.p12'),
      keyAlias: 'shared-qa',
      keystorePassEnv: 'SW005_KS_PASS',
      keyPassEnv: 'SW005_KEY_PASS',
      inputApk: input,
      outputApk: output,
    });
    assert.deepEqual(args.slice(0, 1), ['sign']);
    assert.ok(args.includes('env:SW005_KS_PASS'));
    assert.ok(args.includes('env:SW005_KEY_PASS'));
    assert.ok(args.includes(input));
    assert.ok(args.includes(output));
    assert.ok(!args.some((arg) => arg === 'hunter2'));
    assert.throws(
      () =>
        buildApksignerSignArgs({
          apksignerJar: path.resolve('sdk', 'apksigner.jar'),
          keystore: path.resolve('keys', 'qa.p12'),
          keyAlias: 'a',
          keystorePassEnv: 'KS_PASS',
          keyPassEnv: 'KEY_PASS',
          inputApk: input,
          outputApk: input,
        }),
      /overwrite/i
    );
  });

  it('aligns before signing and keeps the output path separate', () => {
    const input = path.resolve('in put', 'app.apk');
    const output = path.resolve('out put', 'app aligned.apk');
    assert.deepEqual(buildZipalignArgs({ inputApk: input, outputApk: output }), [
      '-P',
      '16',
      '-f',
      '4',
      input,
      output,
    ]);
  });

  it('invokes Gradle 9.3 serially through java -jar without a batch shell', () => {
    const invocation = buildGradleInvocation({
      javaExe: path.resolve('jdk21', 'bin', 'java.exe'),
      launcherJar: path.resolve('gradle-9.3', 'lib', 'gradle-gradle-cli-main-9.3.1.jar'),
      projectDir: path.resolve('routine worktree', 'android'),
      task: 'assembleQaStandalone',
      gradleUserHome: path.resolve('isolated gradle cache'),
      maxHeapMb: 2048,
      maxWorkers: 1,
      architectures: ['arm64-v8a'],
      extraArgs: ['assembleQaStandaloneAndroidTest'],
    });
    assert.equal(invocation.command, path.resolve('jdk21', 'bin', 'java.exe'));
    for (const expected of [
      '-jar',
      path.resolve('gradle-9.3', 'lib', 'gradle-gradle-cli-main-9.3.1.jar'),
      '--no-daemon',
      '--no-parallel',
      '--max-workers=1',
      '--gradle-user-home',
      path.resolve('isolated gradle cache'),
      '--project-dir',
      path.resolve('routine worktree', 'android'),
      '-PreactNativeArchitectures=arm64-v8a',
      'assembleQaStandalone',
      'assembleQaStandaloneAndroidTest',
    ]) {
      assert.ok(invocation.args.includes(expected), `missing ${expected}`);
    }
    assert.ok(!invocation.args.includes('--stop'));
    assert.ok(!invocation.args.includes('clean'));
    assert.throws(
      () =>
        buildGradleInvocation({
          javaExe: path.resolve('jdk', 'bin', 'java'),
          launcherJar: path.resolve('gradle', 'lib', 'launcher.jar'),
          projectDir: path.resolve('android'),
          task: 'assembleDebug',
          maxWorkers: 2,
        }),
      /one Gradle worker/i
    );
  });

  it('defaults device work to deny and redacts the serial identity', () => {
    assert.equal(resolveDeviceRequest({}).allowed, false);
    assert.equal(resolveDeviceRequest({ mode: 'plan' }).code, 'PLAN_ONLY');
    assert.equal(
      resolveDeviceRequest({ mode: 'execute', serial: 'R58M12345', authorizeDevice: false, deviceKind: 'disposable' })
        .code,
      'AUTHORIZATION_REQUIRED'
    );
    assert.equal(
      resolveDeviceRequest({ mode: 'execute', serial: 'R58M12345', authorizeDevice: true }).code,
      'DEVICE_KIND_REQUIRED'
    );
    assert.equal(
      resolveDeviceRequest({
        mode: 'execute',
        serial: 'R58M12345',
        authorizeDevice: true,
        deviceKind: 'owner-consented',
      }).code,
      'OWNER_CONSENT_REQUIRED'
    );
    const allowed = resolveDeviceRequest({
      mode: 'execute',
      serial: 'R58M12345',
      authorizeDevice: true,
      deviceKind: 'disposable',
    });
    assert.equal(allowed.allowed, true);
    assert.equal(allowed.serial, 'R58M12345');
    assert.match(allowed.deviceAlias, /^device-[0-9a-f]{10}$/);
    assert.notEqual(allowed.deviceAlias, allowed.serial);
    assert.equal(redactSerial('R58M12345').alias, allowed.deviceAlias);
  });

  it('fails memory preflight when headroom is low or an emulator is running', () => {
    const low = evaluateMemoryPreflight({ totalBytes: 16 * 1024 ** 3, freeBytes: 1.5 * 1024 ** 3 });
    assert.equal(low.ok, false);
    const overridden = evaluateMemoryPreflight({
      totalBytes: 16 * 1024 ** 3,
      freeBytes: 1.5 * 1024 ** 3,
      allowLowMemory: true,
    });
    assert.equal(overridden.ok, true);
    const emulator = evaluateMemoryPreflight({
      totalBytes: 16 * 1024 ** 3,
      freeBytes: 6 * 1024 ** 3,
      emulatorRunning: true,
    });
    assert.equal(emulator.ok, false);
  });

  it('requires a clean checkout at the exact pinned SHA', () => {
    assert.equal(validateRepoState({ id: 'routine', pinnedSha: SHA, head: SHA, statusPorcelain: '' }).ok, true);
    assert.equal(
      validateRepoState({ id: 'routine', pinnedSha: SHA, head: 'e'.repeat(40), statusPorcelain: '' }).ok,
      false
    );
    assert.equal(
      validateRepoState({ id: 'routine', pinnedSha: SHA, head: SHA, statusPorcelain: ' M src/file.ts' }).ok,
      false
    );
    assert.throws(() => validateRepoState({ id: 'routine', pinnedSha: 'abc', head: SHA }), /40-character/);
  });

  it('records source/hash/signer provenance and one shared signer', () => {
    const manifest = baseManifest();
    const provenance = checkManifestProvenance(manifest);
    assert.equal(provenance.ok, true);
    assert.equal(manifest.artifacts[0].signerCertSha256, CERT);
    assert.equal(manifest.artifacts[0].originalApkSha256, HASH);
    assert.equal(manifest.repos[0].dirty, false);
    assert.ok(manifest.runtimeChecks.every((check) => check.status === 'NOT RUN'));
  });

  it('rejects dirty sources, mismatched signers and orphan instrumentation targets', () => {
    assert.throws(
      () =>
        hydrateManifest({
          repos: [{ id: 'routine', sourceSha: SHA, dirty: true }],
          artifacts: [baseArtifact()],
          signing: { expectedCertSha256: CERT },
        }),
      /clean/
    );

    assert.throws(
      () =>
        hydrateManifest({
          repos: [{ id: 'routine', sourceSha: SHA, dirty: false }],
          artifacts: [baseArtifact({ signerCertSha256: OTHER_CERT })],
          signing: { expectedCertSha256: CERT },
        }),
      /does not match expected/
    );

    assert.throws(
      () =>
        hydrateManifest({
          repos: [{ id: 'routine', sourceSha: SHA, dirty: false }],
          artifacts: [
            baseArtifact(),
            baseArtifact({
              id: 'reader-test',
              role: 'test',
              app: 'reader',
              sourceRepoId: 'reader',
              packageName: 'com.terinit.rhythmicreader.test',
              versionName: '1.3.0',
              versionCode: 3,
              testTargetAppId: 'com.terinit.rhythmicreader',
            }),
          ],
          signing: { expectedCertSha256: CERT },
        }),
      /unknown source repo|not built as an AUT/
    );
  });

  it('fails provenance when runtime proof is claimed without a device run', () => {
    const manifest = baseManifest();
    manifest.runtimeChecks[0].status = 'PASS';
    const provenance = checkManifestProvenance(manifest);
    assert.equal(provenance.ok, false);
    assert.ok(provenance.rows.some((row) => row.id === 'manifest-runtime-not-claimed' && row.status === 'FAIL'));
  });

  it('rejects secret-shaped manifest fields', () => {
    const manifest = baseManifest();
    manifest.keyPassword = 'hunter2';
    const provenance = checkManifestProvenance(manifest);
    assert.equal(provenance.ok, false);
    assert.ok(provenance.rows.some((row) => row.id === 'manifest-no-secrets' && row.status === 'FAIL'));
  });

  it('exposes explicit QA versus production Routine package expectations', () => {
    assert.equal(profileFor('routine', 'qa').applicationId, 'com.terinit.rhythmicroutine.qa');
    assert.equal(profileFor('routine', 'qa').versionNameSuffix, '-qa');
    assert.equal(profileFor('routine', 'production').applicationId, 'com.terinit.rhythmicroutine');
    assert.equal(profileFor('reader', 'qa').applicationId, 'com.terinit.rhythmicreader');
    assert.equal(profileFor('meditation', 'qa').applicationId, 'com.terinit.rhythmicmeditation');
    assert.equal(isPathInside(path.join('a', 'b'), 'a'), true);
    assert.equal(isPathInside(path.join('a', 'b'), path.join('a', 'c')), false);
    assert.equal(APP_PROFILES.routine.qa.applicationId, 'com.terinit.rhythmicroutine.qa');
  });
});
