/**
 * SW-2026-005 A4 shared-signer QA harness — bounded APK inspection primitives.
 *
 * This module is intentionally dependency-free and side-effect-free. It parses
 * ZIP central directories, `aapt dump badging` text, `apksigner verify
 * --print-certs` text and `am instrument` output. Nothing here spawns a shell
 * and nothing here trusts an APK path to be interpolated into a command line.
 */

import { inflateRawSync } from 'node:zlib';

const EOCD_SIG = 0x06054b50;
const ZIP64_EOCD_SIG = 0x06064b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;
const CENTRAL_DIR_SIG = 0x02014b50;
const LOCAL_HEADER_SIG = 0x04034b50;
const MAX_ENTRIES = 1_000_000;
const MAX_EOCD_SEARCH = 22 + 0xffff;
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;

function assertBuffer(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError('readZipEntries expects a Buffer');
  }
}

function safeNumber(value, label) {
  if (typeof value === 'bigint') {
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(`${label} exceeds the supported ZIP size range`);
    }
    return Number(value);
  }
  return value;
}

function findEndOfCentralDirectory(buffer) {
  const last = buffer.length - 22;
  const first = Math.max(0, buffer.length - MAX_EOCD_SEARCH);
  for (let offset = last; offset >= first; offset -= 1) {
    if (buffer.readUInt32LE(offset) !== EOCD_SIG) continue;
    const commentLength = buffer.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength === buffer.length) return offset;
  }
  throw new Error('APK is not a valid ZIP archive (end-of-central-directory record missing)');
}

function readCentralDirectoryLocation(buffer, eocdOffset) {
  let entryCount = buffer.readUInt16LE(eocdOffset + 10);
  let centralDirSize = buffer.readUInt32LE(eocdOffset + 12);
  let centralDirOffset = buffer.readUInt32LE(eocdOffset + 16);

  const needsZip64 =
    entryCount === 0xffff || centralDirSize === 0xffffffff || centralDirOffset === 0xffffffff;

  if (!needsZip64) {
    return { entryCount, centralDirSize, centralDirOffset };
  }

  const locatorOffset = eocdOffset - 20;
  if (locatorOffset < 0 || buffer.readUInt32LE(locatorOffset) !== ZIP64_LOCATOR_SIG) {
    throw new Error('APK requires ZIP64 but the ZIP64 locator is missing');
  }
  const zip64Offset = safeNumber(buffer.readBigUInt64LE(locatorOffset + 8), 'ZIP64 EOCD offset');
  if (zip64Offset + 56 > buffer.length || buffer.readUInt32LE(zip64Offset) !== ZIP64_EOCD_SIG) {
    throw new Error('APK has an unreadable ZIP64 end-of-central-directory record');
  }
  entryCount = safeNumber(buffer.readBigUInt64LE(zip64Offset + 32), 'ZIP64 entry count');
  centralDirSize = safeNumber(buffer.readBigUInt64LE(zip64Offset + 40), 'ZIP64 central directory size');
  centralDirOffset = safeNumber(buffer.readBigUInt64LE(zip64Offset + 48), 'ZIP64 central directory offset');
  return { entryCount, centralDirSize, centralDirOffset };
}

/**
 * Return the central-directory entries of an APK/ZIP buffer.
 * Bounded by MAX_ENTRIES and strict bounds checks so a corrupt archive fails
 * closed instead of yielding a partial "looks fine" answer.
 *
 * @param {Buffer} buffer
 * @returns {{name: string, compressedSize: number, uncompressedSize: number, flags: number}[]}
 */
export function readZipEntries(buffer) {
  assertBuffer(buffer);
  if (buffer.length < 22) throw new Error('APK is too small to be a ZIP archive');

  const eocdOffset = findEndOfCentralDirectory(buffer);
  const { entryCount, centralDirOffset } = readCentralDirectoryLocation(buffer, eocdOffset);

  if (!Number.isInteger(entryCount) || entryCount < 0 || entryCount > MAX_ENTRIES) {
    throw new Error(`APK central directory entry count is invalid: ${entryCount}`);
  }
  if (centralDirOffset < 0 || centralDirOffset >= buffer.length) {
    throw new Error('APK central directory offset is outside the archive');
  }

  const entries = [];
  let offset = centralDirOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length) {
      throw new Error('APK central directory is truncated');
    }
    if (buffer.readUInt32LE(offset) !== CENTRAL_DIR_SIG) {
      throw new Error(`APK central directory entry ${index} has an invalid signature`);
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    const nextOffset = nameEnd + extraLength + commentLength;
    if (nextOffset > buffer.length) {
      throw new Error(`APK central directory entry ${index} overruns the archive`);
    }
    entries.push({
      name: buffer.toString('utf8', nameStart, nameEnd),
      compressedSize,
      uncompressedSize,
      flags,
      method,
      localHeaderOffset,
    });
    offset = nextOffset;
  }
  return entries;
}

/**
 * Read and, if necessary, inflate one ZIP entry. Bounded to 64 MiB so a hostile
 * APK cannot exhaust memory; classes.dex is normally well below this.
 */
export function readZipEntryBuffer(buffer, entries, name) {
  assertBuffer(buffer);
  const entry = entries.find((candidate) => candidate.name === name);
  if (!entry) throw new Error(`ZIP entry not found: ${name}`);
  if (entry.localHeaderOffset + 30 > buffer.length) throw new Error(`ZIP entry ${name} header is out of bounds`);
  if (buffer.readUInt32LE(entry.localHeaderOffset) !== LOCAL_HEADER_SIG) {
    throw new Error(`ZIP entry ${name} has an invalid local header`);
  }
  const nameLength = buffer.readUInt16LE(entry.localHeaderOffset + 26);
  const extraLength = buffer.readUInt16LE(entry.localHeaderOffset + 28);
  const dataStart = entry.localHeaderOffset + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > buffer.length) throw new Error(`ZIP entry ${name} data is out of bounds`);
  const compressed = buffer.subarray(dataStart, dataEnd);
  if (entry.method === 0) return Buffer.from(compressed);
  if (entry.method === 8) {
    return inflateRawSync(compressed, { maxOutputLength: MAX_ENTRY_BYTES });
  }
  throw new Error(`ZIP entry ${name} uses unsupported compression method ${entry.method}`);
}

/**
 * Summarise the packaging facts this programme actually cares about.
 *
 * @param {{name: string}[]} entries
 */
export function summarizeApkEntries(entries) {
  if (!Array.isArray(entries)) throw new TypeError('summarizeApkEntries expects an array');

  const bundleEntry = entries.find((entry) => entry.name === 'assets/index.android.bundle');
  const bundlePaths = bundleEntry ? [bundleEntry.name] : [];
  const bundleBytes = bundleEntry ? bundleEntry.uncompressedSize : 0;

  const nativeLibs = entries
    .filter(
      (entry) =>
        /^lib\/[^/]+\/[^/]+\.so$/.test(entry.name) &&
        ((entry.uncompressedSize ?? 0) > 0 || (entry.compressedSize ?? 0) > 0)
    )
    .map((entry) => entry.name);

  const abis = [...new Set(nativeLibs.map((name) => name.split('/')[1]))].sort();

  return {
    hasAndroidManifest: entries.some((entry) => entry.name === 'AndroidManifest.xml'),
    hasResources: entries.some((entry) => entry.name === 'resources.arsc'),
    hasBundle: bundlePaths.length > 0,
    bundlePaths,
    bundleBytes,
    nativeLibs,
    abis,
    entryCount: entries.length,
  };
}

/**
 * Parse `aapt dump badging` output. Missing fields are returned as null so the
 * caller can fail closed with an explicit reason.
 *
 * @param {string} text
 */
export function parseAaptBadging(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error('aapt badging output is empty');
  }

  const packageMatch = /^package:\s+name='([^']+)'(?:\s+versionCode='([^']*)')?(?:\s+versionName='([^']*)')?/m.exec(
    text
  );
  if (!packageMatch) throw new Error('aapt badging output does not contain a package line');

  const instrumentationMatch = /^instrumentation:\s+name='([^']+)'\s+targetPackage='([^']+)'/m.exec(text);
  const sdkMatch = /^sdkVersion:'([^']*)'/m.exec(text);
  const targetSdkMatch = /^targetSdkVersion:'([^']*)'/m.exec(text);
  const nativeCodeMatch = /^native-code:\s*(.+)$/m.exec(text);
  const nativeCodes = nativeCodeMatch
    ? [...nativeCodeMatch[1].matchAll(/'([^']+)'/g)].map((match) => match[1])
    : [];

  return {
    packageName: packageMatch[1],
    versionCode: packageMatch[2] ? Number(packageMatch[2]) : null,
    versionName: packageMatch[3] ?? null,
    sdkVersion: sdkMatch ? Number(sdkMatch[1]) : null,
    targetSdkVersion: targetSdkMatch ? Number(targetSdkMatch[1]) : null,
    nativeCodes,
    instrumentation: instrumentationMatch
      ? { name: instrumentationMatch[1], targetPackage: instrumentationMatch[2] }
      : null,
  };
}

/**
 * Parse `aapt dump xmltree <apk> AndroidManifest.xml` output for the actual
 * instrumentation element. Current SDK badging does not emit an
 * `instrumentation:` line, so the binary manifest is authoritative.
 *
 * @param {string} text
 * @returns {{name: string, targetPackage: string} | null}
 */
export function parseAaptXmltreeInstrumentation(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error('aapt xmltree output is empty');
  }

  let inInstrumentation = false;
  let baseIndent = -1;
  let name = null;
  let targetPackage = null;
  for (const line of text.split(/\r?\n/)) {
    const indent = /^\s*/.exec(line)[0].length;
    if (!inInstrumentation) {
      if (/^\s*E:\s+instrumentation\b/.test(line)) {
        inInstrumentation = true;
        baseIndent = indent;
      }
      continue;
    }
    if (/^\s*E:\s+/.test(line) && indent <= baseIndent) break;
    const attribute = /^\s*A:\s+android:(name|targetPackage)(?:\([^)]*\))?="([^"]*)"/.exec(line);
    if (attribute) {
      if (attribute[1] === 'name') name = attribute[2];
      if (attribute[1] === 'targetPackage') targetPackage = attribute[2];
    }
  }

  return name && targetPackage ? { name, targetPackage } : null;
}

/**
 * Parse certificate digests and scheme verification lines from
 * `apksigner verify --print-certs -v`.
 *
 * @param {string} text
 */
export function parseApksignerOutput(text) {
  if (typeof text !== 'string') throw new TypeError('parseApksignerOutput expects text');

  const certSha256 = [...text.matchAll(/certificate SHA-256 digest:\s*([0-9a-f]{64})/gi)].map((match) =>
    match[1].toLowerCase()
  );
  const schemes = {
    v1: /Verified using v1 scheme \(JAR signing\):\s*true/i.test(text),
    v2: /Verified using v2 scheme \(APK Signature Scheme v2\):\s*true/i.test(text),
    v3: /Verified using v3 scheme \(APK Signature Scheme v3\):\s*true/i.test(text),
    v4: /Verified using v4 scheme \(APK Signature Scheme v4\):\s*true/i.test(text),
  };

  return {
    certSha256,
    schemes,
    verified: /DOES NOT VERIFY/i.test(text) ? false : certSha256.length > 0,
  };
}

/**
 * Parse `am instrument -w -r` output. Zero executed tests is always a failure.
 *
 * @param {string} text
 */
export function parseInstrumentationOutput(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    return {
      ok: false,
      testsRun: 0,
      failures: 0,
      errors: 0,
      reason: 'instrumentation produced no output',
    };
  }

  const normalised = text.replace(/\r\n/g, '\n');
  const summary =
    /Tests run:\s*(\d+),\s*Failures:\s*(\d+)(?:,\s*Errors:\s*(\d+))?/i.exec(normalised) ?? null;
  const okMatch = /^OK \((\d+) tests?\)/m.exec(normalised);
  const shortMsg = /INSTRUMENTATION_RESULT:\s*shortMsg=([^\n]+)/.exec(normalised);
  const codeMatch = /INSTRUMENTATION_CODE:\s*(-?\d+)/.exec(normalised);
  const hasFailureMarker = /FAILURES!!!/.test(normalised);
  const hasCrashMarker = /Process crashed|INSTRUMENTATION_FAILED|Unable to find instrumentation/i.test(normalised);

  const testsRun = summary ? Number(summary[1]) : okMatch ? Number(okMatch[1]) : 0;
  const failures = summary ? Number(summary[2]) : 0;
  const errors = summary && summary[3] ? Number(summary[3]) : 0;
  const code = codeMatch ? Number(codeMatch[1]) : null;

  const reasons = [];
  if (testsRun === 0) reasons.push('zero instrumentation tests executed');
  if (failures > 0) reasons.push(`${failures} instrumentation failure(s)`);
  if (errors > 0) reasons.push(`${errors} instrumentation error(s)`);
  if (hasFailureMarker) reasons.push('instrumentation reported FAILURES');
  if (shortMsg) reasons.push(`instrumentation shortMsg: ${shortMsg[1].trim()}`);
  if (hasCrashMarker) reasons.push('instrumentation crashed or target was not found');

  return {
    ok: reasons.length === 0,
    testsRun,
    failures,
    errors,
    code,
    reason: reasons.length === 0 ? 'instrumentation passed with at least one executed test' : reasons.join('; '),
  };
}

export function statusRow(id, status, detail, extra = {}) {
  if (!['PASS', 'FAIL', 'NOT RUN'].includes(status)) {
    throw new Error(`Invalid QA status: ${status}`);
  }
  return { id, status, detail, ...extra };
}

/**
 * Pure, fail-closed evaluation of one APK against an explicit expectation.
 *
 * `facts` is produced by the CLI from real files and tools, which keeps this
 * function directly testable without shell access.
 */
export function evaluateArtifact(spec, facts) {
  const rows = [];
  const add = (id, status, detail, extra) => rows.push(statusRow(id, status, detail, extra));

  add('artifact-exists', facts.exists ? 'PASS' : 'FAIL', facts.exists ? 'artifact present' : 'artifact missing');
  if (!facts.exists) {
    return { ok: false, rows };
  }

  add(
    'artifact-size',
    facts.sizeBytes >= spec.minSizeBytes ? 'PASS' : 'FAIL',
    `${facts.sizeBytes} bytes (minimum ${spec.minSizeBytes})`
  );

  if (facts.entriesError) {
    add('archive-integrity', 'FAIL', `ZIP central directory unreadable: ${facts.entriesError}`);
    return { ok: false, rows };
  }

  add('archive-integrity', 'PASS', 'ZIP central directory readable');
  add(
    'android-manifest',
    facts.packaging?.hasAndroidManifest ? 'PASS' : 'FAIL',
    facts.packaging?.hasAndroidManifest ? 'AndroidManifest.xml packaged' : 'AndroidManifest.xml missing'
  );

  if (!facts.aaptAvailable) {
    add('sdk-aapt', 'FAIL', 'aapt is unavailable; package/version validation cannot be skipped');
  } else {
    add('sdk-aapt', 'PASS', `aapt ${facts.aaptVersion ?? 'present'}`);
  }

  if (facts.badgingError || !facts.badging) {
    add('package-id', 'FAIL', `aapt badging failed: ${facts.badgingError ?? 'no badging result'}`);
    add('version-name', 'FAIL', 'version name unavailable because badging failed');
    if (spec.expectedVersionCode != null) add('version-code', 'FAIL', 'version code unavailable');
  } else {
    const badging = facts.badging;
    add(
      'package-id',
      badging.packageName === spec.expectedPackage ? 'PASS' : 'FAIL',
      `package=${badging.packageName}; expected=${spec.expectedPackage}`
    );

    const versionOk =
      spec.role === 'test' ||
      (typeof badging.versionName === 'string' &&
        badging.versionName.length > 0 &&
        (spec.versionNameSuffix ? badging.versionName.endsWith(spec.versionNameSuffix) : true));
    add(
      'version-name',
      versionOk ? 'PASS' : 'FAIL',
      `versionName=${badging.versionName}; suffix=${spec.versionNameSuffix ?? '(none)'}`
    );

    if (spec.expectedVersionCode != null) {
      add(
        'version-code',
        badging.versionCode === spec.expectedVersionCode ? 'PASS' : 'FAIL',
        `versionCode=${badging.versionCode}; expected=${spec.expectedVersionCode}`
      );
    }

    if (spec.role === 'test') {
      const instrumentation = facts.manifestInstrumentationChecked
        ? facts.manifestInstrumentation
        : badging.instrumentation;
      const targetOk = instrumentation?.targetPackage === spec.testTargetAppId;
      add(
        'test-target',
        targetOk ? 'PASS' : 'FAIL',
        `instrumentation target=${instrumentation?.targetPackage ?? '(none)'}; expected=${spec.testTargetAppId}`
      );
      if (spec.expectedTestRunner) {
        add(
          'test-runner',
          instrumentation?.name === spec.expectedTestRunner ? 'PASS' : 'FAIL',
          `instrumentation runner=${instrumentation?.name ?? '(none)'}; expected=${spec.expectedTestRunner}`
        );
      }
    }
  }

  if (spec.requireBundle) {
    const bundleOk = Boolean(facts.packaging?.hasBundle) && (facts.packaging?.bundleBytes ?? 0) > 0;
    add(
      'embedded-js-bundle',
      bundleOk ? 'PASS' : 'FAIL',
      bundleOk
        ? `bundled: ${facts.packaging.bundlePaths.join(', ')} (${facts.packaging.bundleBytes} bytes)`
        : 'no non-empty embedded index.android.bundle (Metro-dependent build is not QA standalone)'
    );
  }

  if (spec.requireNativeLibs) {
    const hasLibs = (facts.packaging?.nativeLibs?.length ?? 0) > 0;
    add(
      'native-module-packaging',
      hasLibs ? 'PASS' : 'FAIL',
      hasLibs
        ? `native libs packaged for ${facts.packaging.abis.join(', ')} (static presence only; unrelated .so files are not module proof)`
        : 'no native libraries packaged (static module presence missing)'
    );
    if (spec.requiredAbi) {
      const abiOk = facts.packaging?.abis?.includes(spec.requiredAbi) ?? false;
      add(
        'required-abi',
        abiOk ? 'PASS' : 'FAIL',
        `ABIs=${facts.packaging?.abis?.join(', ') ?? '(none)'}; required=${spec.requiredAbi}`
      );
    }
  }

  if (spec.requireDexModule) {
    const dexError = facts.dex?.error ?? (facts.dex ? null : 'DEX inspection not performed');
    const defined = new Set(facts.dex?.definedClasses ?? []);
    const referenced = new Set(facts.dex?.referencedClasses ?? []);

    for (const requirement of spec.requireDexClasses ?? []) {
      const definedExact = defined.has(requirement.descriptor);
      const referencedOnly = referenced.has(requirement.descriptor) && !definedExact;
      add(
        `native-dex-${requirement.label}`,
        definedExact ? 'PASS' : 'FAIL',
        definedExact
          ? `class_def defines ${requirement.descriptor} (static presence)`
          : referencedOnly
            ? `${requirement.descriptor} is referenced/string-only, not defined by class_def`
            : `missing class_def for ${requirement.descriptor}: ${dexError ?? 'not found'}`
      );
    }

    if (spec.requireDexRegistration) {
      const registration = spec.requireDexRegistration;
      const definedExact = defined.has(registration);
      add(
        'native-autolink-registration',
        definedExact ? 'PASS' : 'FAIL',
        definedExact
          ? `class_def defines generated registry ${registration} (static presence only)`
          : `missing generated registry class_def ${registration}; a bare string or referenced type is not registration proof`
      );
    }

    add(
      'native-module-runtime',
      'NOT RUN',
      'DEX class_defs and generated registry presence are static only; native module reachability requires a real device run',
      { mandatory: false, runtime: true }
    );
  }

  if (!facts.apksignerAvailable) {
    add('archive-signature', 'FAIL', 'apksigner is unavailable; signatures cannot be skipped');
    add('signer-fingerprint', 'FAIL', 'signer fingerprint unavailable');
  } else if (facts.signerError) {
    add('archive-signature', 'FAIL', `apksigner verify failed: ${facts.signerError}`);
    add('signer-fingerprint', 'FAIL', 'signer fingerprint unavailable');
  } else {
    const certs = facts.signer?.certSha256 ?? [];
    const hasSingleSigner = certs.length === 1;
    add(
      'archive-signature',
      hasSingleSigner ? 'PASS' : 'FAIL',
      hasSingleSigner ? `v1=${facts.signer.schemes.v1} v2=${facts.signer.schemes.v2} v3=${facts.signer.schemes.v3}` : `expected exactly one signer, found ${certs.length}`
    );
    const expected = spec.expectedSignerSha256;
    const expectationMissing = spec.requireExpectedSigner && !expected;
    const fingerprintOk = hasSingleSigner && !expectationMissing && (!expected || certs[0] === expected);
    add(
      'signer-fingerprint',
      fingerprintOk ? 'PASS' : 'FAIL',
      expectationMissing
        ? 'expected signer fingerprint is required'
        : expected
          ? `actual=${certs[0] ?? '(none)'}; expected=${expected}`
          : `actual=${certs[0] ?? '(none)'}; expectation not supplied`
    );
  }

  add('instrumentation-execution', 'NOT RUN', 'requires an explicitly authorized device and a real run', {
    mandatory: false,
    runtime: true,
  });
  add('signature-ipc-runtime', 'NOT RUN', 'same-signer/mismatched-signer IPC proof requires a device', {
    mandatory: false,
    runtime: true,
  });
  add('native-enforcement-runtime', 'NOT RUN', 'static APK presence is not ENFORCED runtime proof', {
    mandatory: false,
    runtime: true,
  });

  return { ok: rows.every((row) => row.status !== 'FAIL'), rows };
}

export function assertTestTargetMatch(testBadging, autPackage) {
  if (!testBadging?.instrumentation) {
    throw new Error('Instrumentation APK does not declare an instrumentation target');
  }
  if (testBadging.instrumentation.targetPackage !== autPackage) {
    throw new Error(
      `Instrumentation target ${testBadging.instrumentation.targetPackage} does not match app-under-test ${autPackage}`
    );
  }
}
