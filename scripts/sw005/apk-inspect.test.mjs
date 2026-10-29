import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateArtifact,
  parseAaptBadging,
  parseApksignerOutput,
  parseInstrumentationOutput,
  readZipEntries,
  summarizeApkEntries,
} from './lib/apk-inspect.mjs';

const CERT = 'a'.repeat(64);

/** Build a minimal ZIP containing only a central directory and EOCD. */
function makeZipBuffer(names) {
  const records = [];
  for (const name of names) {
    const nameBuffer = Buffer.from(name, 'utf8');
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt32LE(10, 20);
    record.writeUInt32LE(20, 24);
    record.writeUInt16LE(nameBuffer.length, 28);
    records.push(record, nameBuffer);
  }
  const centralDirectory = Buffer.concat(records);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(names.length, 8);
  eocd.writeUInt16LE(names.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(0, 16);
  return Buffer.concat([centralDirectory, eocd]);
}

const happyFacts = () => ({
  exists: true,
  sizeBytes: 20 * 1024 * 1024,
  aaptAvailable: true,
  aaptVersion: '36.0.0',
  apksignerAvailable: true,
  packaging: {
    hasAndroidManifest: true,
    hasResources: true,
    hasBundle: true,
    bundlePaths: ['assets/index.android.bundle'],
    bundleBytes: 4096,
    nativeLibs: ['lib/arm64-v8a/libappmodules.so'],
    abis: ['arm64-v8a'],
    entryCount: 4,
  },
  badging: {
    packageName: 'com.terinit.rhythmicroutine.qa',
    versionName: '1.3.0-qa',
    versionCode: 5,
    instrumentation: null,
  },
  signer: {
    certSha256: [CERT],
    schemes: { v1: true, v2: true, v3: true, v4: false },
    verified: true,
  },
});

const baseSpec = {
  id: 'routine-qa',
  role: 'aut',
  expectedPackage: 'com.terinit.rhythmicroutine.qa',
  versionNameSuffix: '-qa',
  expectedVersionCode: 5,
  expectedSignerSha256: CERT,
  minSizeBytes: 10 * 1024 * 1024,
  requireBundle: true,
  requireNativeLibs: true,
  requiredAbi: 'arm64-v8a',
};

describe('SW-2026-005 APK inspection', () => {
  it('reads a central directory and reports bundle/native packaging facts', () => {
    const buffer = makeZipBuffer([
      'AndroidManifest.xml',
      'resources.arsc',
      'assets/index.android.bundle',
      'lib/arm64-v8a/libappmodules.so',
    ]);
    const summary = summarizeApkEntries(readZipEntries(buffer));
    assert.equal(summary.hasAndroidManifest, true);
    assert.equal(summary.hasResources, true);
    assert.equal(summary.hasBundle, true);
    assert.ok(summary.bundleBytes > 0);
    assert.deepEqual(summary.abis, ['arm64-v8a']);
    assert.equal(summary.nativeLibs.length, 1);
  });

  it('fails closed on a corrupt or non-ZIP archive', () => {
    assert.throws(() => readZipEntries(Buffer.from('not a zip at all')), /valid ZIP|too small/i);
    const buffer = makeZipBuffer(['AndroidManifest.xml']);
    buffer.writeUInt32LE(0xdeadbeef, 0);
    assert.throws(() => readZipEntries(buffer), /invalid signature/i);
  });

  it('parses aapt badging for package, version, ABI and instrumentation target', () => {
    const text = [
      "package: name='com.terinit.rhythmicroutine.qa' versionCode='5' versionName='1.3.0-qa'",
      "sdkVersion:'24'",
      "targetSdkVersion:'36'",
      "native-code: 'arm64-v8a' 'armeabi-v7a'",
      "instrumentation: name='com.terinit.rhythmicroutine.qa.test.Runner' targetPackage='com.terinit.rhythmicroutine.qa'",
    ].join('\n');
    const badging = parseAaptBadging(text);
    assert.equal(badging.packageName, 'com.terinit.rhythmicroutine.qa');
    assert.equal(badging.versionCode, 5);
    assert.equal(badging.versionName, '1.3.0-qa');
    assert.deepEqual(badging.nativeCodes, ['arm64-v8a', 'armeabi-v7a']);
    assert.equal(badging.instrumentation.targetPackage, 'com.terinit.rhythmicroutine.qa');
  });

  it('parses apksigner certificates and schemes, and detects verification failure', () => {
    const output = [
      'Verifies',
      'Verified using v1 scheme (JAR signing): true',
      'Verified using v2 scheme (APK Signature Scheme v2): true',
      'Verified using v3 scheme (APK Signature Scheme v3): true',
      `Signer #1 certificate SHA-256 digest: ${CERT}`,
    ].join('\n');
    const parsed = parseApksignerOutput(output);
    assert.deepEqual(parsed.certSha256, [CERT]);
    assert.equal(parsed.schemes.v2, true);
    assert.equal(parsed.verified, true);

    const failed = parseApksignerOutput(`DOES NOT VERIFY\nSigner #1 certificate SHA-256 digest: ${CERT}`);
    assert.equal(failed.verified, false);
  });

  it('refuses zero executed instrumentation tests and accepted failures', () => {
    assert.equal(parseInstrumentationOutput('OK (7 tests)').ok, true);
    assert.equal(parseInstrumentationOutput('OK (7 tests)').testsRun, 7);

    const zero = parseInstrumentationOutput('OK (0 tests)');
    assert.equal(zero.ok, false);
    assert.match(zero.reason, /zero/i);

    const failed = parseInstrumentationOutput(
      'FAILURES!!!\nTests run: 3,  Failures: 1,  Errors: 0\nINSTRUMENTATION_CODE: -1'
    );
    assert.equal(failed.ok, false);
    assert.equal(failed.testsRun, 3);
    assert.equal(failed.failures, 1);

    const crashed = parseInstrumentationOutput(
      'INSTRUMENTATION_RESULT: shortMsg=Process crashed.\nINSTRUMENTATION_CODE: 0'
    );
    assert.equal(crashed.ok, false);

    assert.equal(parseInstrumentationOutput('').ok, false);
  });

  it('passes a complete APK but never claims runtime proof', () => {
    const result = evaluateArtifact(baseSpec, happyFacts());
    assert.equal(result.ok, true);
    const runtime = result.rows.filter((row) => row.status === 'NOT RUN');
    assert.ok(runtime.length >= 2);
    assert.ok(runtime.every((row) => row.runtime === true && row.mandatory === false));
  });

  it('fails when the embedded bundle, SDK tool, package, version or signer is wrong', () => {
    const missingBundle = happyFacts();
    missingBundle.packaging.hasBundle = false;
    missingBundle.packaging.bundlePaths = [];
    assert.equal(evaluateArtifact(baseSpec, missingBundle).ok, false);

    const noAapt = happyFacts();
    noAapt.aaptAvailable = false;
    assert.equal(evaluateArtifact(baseSpec, noAapt).ok, false);

    const noApksigner = happyFacts();
    noApksigner.apksignerAvailable = false;
    assert.equal(evaluateArtifact(baseSpec, noApksigner).ok, false);

    const wrongPackage = happyFacts();
    wrongPackage.badging.packageName = 'com.terinit.rhythmicroutine';
    assert.equal(evaluateArtifact(baseSpec, wrongPackage).ok, false);

    const wrongVersion = happyFacts();
    wrongVersion.badging.versionName = '1.3.0';
    assert.equal(evaluateArtifact(baseSpec, wrongVersion).ok, false);

    const wrongVersionCode = happyFacts();
    wrongVersionCode.badging.versionCode = 6;
    assert.equal(evaluateArtifact(baseSpec, wrongVersionCode).ok, false);

    const wrongSigner = happyFacts();
    wrongSigner.signer.certSha256 = ['b'.repeat(64)];
    assert.equal(evaluateArtifact(baseSpec, wrongSigner).ok, false);

    const missingExpectation = evaluateArtifact(
      { ...baseSpec, expectedSignerSha256: undefined, requireExpectedSigner: true },
      happyFacts()
    );
    assert.equal(missingExpectation.ok, false);
    assert.ok(missingExpectation.rows.some((row) => row.id === 'signer-fingerprint' && row.status === 'FAIL'));
  });

  it('requires the instrumentation APK to target its app-under-test', () => {
    const facts = happyFacts();
    facts.badging.packageName = 'com.terinit.rhythmicroutine.qa.test';
    facts.badging.instrumentation = {
      name: 'com.terinit.rhythmicroutine.qa.test.Runner',
      targetPackage: 'com.terinit.rhythmicmeditation',
    };
    const result = evaluateArtifact(
      {
        ...baseSpec,
        id: 'routine-test',
        role: 'test',
        expectedPackage: 'com.terinit.rhythmicroutine.qa.test',
        versionNameSuffix: null,
        expectedVersionCode: undefined,
        requireBundle: false,
        requireNativeLibs: false,
        requiredAbi: undefined,
        testTargetAppId: 'com.terinit.rhythmicroutine.qa',
      },
      facts
    );
    assert.equal(result.ok, false);
    assert.ok(result.rows.some((row) => row.id === 'test-target' && row.status === 'FAIL'));
  });
});
