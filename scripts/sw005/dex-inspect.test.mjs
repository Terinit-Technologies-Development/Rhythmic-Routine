import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { readZipEntries, summarizeApkEntries, evaluateArtifact } from './lib/apk-inspect.mjs';
import { readDexDefinitions, readDexStrings, summarizeDex } from './lib/dex-inspect.mjs';

const MODULE = 'Lexpo/modules/rhythmdevice/RhythmDeviceModule;';
const SERVICE = 'Lexpo/modules/rhythmdevice/RhythmEnforcementService;';
const REGISTRY = 'Lexpo/modules/ExpoModulesPackageList;';

function uleb(value) {
  const bytes = [];
  let remaining = value;
  do {
    let byte = remaining & 0x7f;
    remaining >>= 7;
    if (remaining) byte |= 0x80;
    bytes.push(byte);
  } while (remaining);
  return Buffer.from(bytes);
}

function finalizeDex(dex) {
  dex.writeUInt32LE(dex.length, 32);
  createHash('sha1').update(dex.subarray(32)).digest().copy(dex, 12);
  let a = 1;
  let b = 0;
  for (const byte of dex.subarray(12)) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  dex.writeUInt32LE(((b << 16) | a) >>> 0, 8);
  return dex;
}

/**
 * Build a structurally valid DEX with actual class_defs. `defined` controls
 * definitions; `extraStrings` are constants/references only. This fixture is
 * explicitly synthetic, not a substitute for SDK/device acceptance.
 */
function makeDex({ defined = [], referenced = [], extraStrings = [], corruptClassIndex = false } = {}) {
  const typeDescriptors = [...defined, ...referenced.filter((value) => !defined.includes(value))];
  const strings = [...new Set([...typeDescriptors, ...extraStrings])];
  const stringIndex = new Map(strings.map((value, index) => [value, index]));
  const header = Buffer.alloc(0x70);
  header.write('dex\n035\0', 0, 'binary');
  header.writeUInt32LE(0x70, 36);
  header.writeUInt32LE(0x12345678, 40);

  const stringIds = Buffer.alloc(strings.length * 4);
  const typeIds = Buffer.alloc(typeDescriptors.length * 4);
  const classDefs = Buffer.alloc(defined.length * 32);
  typeDescriptors.forEach((descriptor, index) => {
    typeIds.writeUInt32LE(stringIndex.get(descriptor), index * 4);
  });
  defined.forEach((_, index) => {
    classDefs.writeUInt32LE(corruptClassIndex && index === 0 ? 9999 : index, index * 32);
  });

  const stringIdsOffset = 0x70;
  const typeIdsOffset = stringIdsOffset + stringIds.length;
  const classDefsOffset = typeIdsOffset + typeIds.length;
  const dataOffset = classDefsOffset + classDefs.length;

  let cursor = dataOffset;
  const stringData = [];
  for (const value of strings) {
    const text = Buffer.from(value, 'utf8');
    const item = Buffer.concat([uleb(text.length), text, Buffer.from([0])]);
    stringIds.writeUInt32LE(cursor, strings.indexOf(value) * 4);
    stringData.push(item);
    cursor += item.length;
  }

  const dex = Buffer.concat([header, stringIds, typeIds, classDefs, ...stringData]);
  header.copy(dex, 0);
  dex.writeUInt32LE(strings.length, 56);
  dex.writeUInt32LE(stringIdsOffset, 60);
  dex.writeUInt32LE(typeDescriptors.length, 64);
  dex.writeUInt32LE(typeIdsOffset, 68);
  dex.writeUInt32LE(defined.length, 96);
  dex.writeUInt32LE(classDefsOffset, 100);
  return finalizeDex(dex);
}

function makeZipWithFiles(files) {
  const allFiles = files['AndroidManifest.xml']
    ? files
    : { 'AndroidManifest.xml': Buffer.from('manifest'), ...files };
  if (!allFiles['lib/arm64-v8a/libreactnativejni.so']) {
    allFiles['lib/arm64-v8a/libreactnativejni.so'] = Buffer.from('unrelated');
  }
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, data] of Object.entries(allFiles)) {
    const nameBuffer = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    const localRecord = Buffer.concat([local, nameBuffer, data]);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, nameBuffer]));
    locals.push(localRecord);
    offset += localRecord.length;
  }
  const centralDirectory = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(allFiles).length, 8);
  eocd.writeUInt16LE(Object.keys(allFiles).length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDirectory, eocd]);
}

function dexFacts(zip) {
  const entries = readZipEntries(zip);
  return {
    exists: true,
    sizeBytes: 20 * 1024 * 1024,
    aaptAvailable: true,
    aaptVersion: '36.0.0',
    apksignerAvailable: true,
    packaging: summarizeApkEntries(entries),
    dex: summarizeDex(zip, entries),
    badging: {
      packageName: 'com.terinit.rhythmicroutine.qa',
      versionName: '1.3.0-qa',
      versionCode: 5,
    },
    signer: {
      certSha256: ['a'.repeat(64)],
      schemes: { v1: true, v2: true, v3: true },
      verified: true,
    },
  };
}

function spec() {
  return {
    id: 'routine-qa',
    role: 'aut',
    expectedPackage: 'com.terinit.rhythmicroutine.qa',
    versionNameSuffix: '-qa',
    expectedVersionCode: 5,
    expectedSignerSha256: 'a'.repeat(64),
    requireExpectedSigner: true,
    minSizeBytes: 10 * 1024 * 1024,
    requireBundle: false,
    requireNativeLibs: true,
    requireDexModule: true,
    requireDexClasses: [
      { label: 'RhythmDeviceModule', descriptor: MODULE },
      { label: 'RhythmEnforcementService', descriptor: SERVICE },
    ],
    requireDexRegistration: REGISTRY,
  };
}

describe('SW-2026-005 DEX class_def proof', () => {
  it('accepts exact class_def definitions and the generated registry definition', () => {
    const dex = makeDex({ defined: [MODULE, SERVICE, REGISTRY] });
    assert.equal(dex.readUInt32LE(36), 0x70);
    const definitions = readDexDefinitions(dex);
    assert.deepEqual(definitions.definedClasses, [REGISTRY, MODULE, SERVICE].sort());
    const result = evaluateArtifact(spec(), dexFacts(makeZipWithFiles({ 'classes.dex': dex })));
    assert.equal(result.ok, true, JSON.stringify(result.rows));
  });

  it('rejects reference-only strings and lookalike nested/fragment classes', () => {
    const referenceOnly = makeDex({
      defined: ['LNativeReferenceOnlyFixture;'],
      extraStrings: [MODULE, SERVICE, REGISTRY, 'ExpoModulesPackageList'],
    });
    const referenceDefinitions = readDexDefinitions(referenceOnly);
    assert.deepEqual(referenceDefinitions.definedClasses, ['LNativeReferenceOnlyFixture;']);
    assert.ok(!referenceDefinitions.referencedClasses.includes(MODULE));
    const referenceSummary = summarizeDex(
      makeZipWithFiles({ 'classes.dex': referenceOnly }),
      readZipEntries(makeZipWithFiles({ 'classes.dex': referenceOnly }))
    );
    assert.equal(referenceSummary.error, null);
    const referenceResult = evaluateArtifact(spec(), dexFacts(makeZipWithFiles({ 'classes.dex': referenceOnly })));
    assert.equal(referenceResult.ok, false);
    const moduleRow = referenceResult.rows.find((row) => row.id === 'native-dex-RhythmDeviceModule');
    assert.equal(moduleRow.status, 'FAIL');
    assert.match(moduleRow.detail, /missing class_def/i);
    assert.ok(referenceResult.rows.some((row) => row.id === 'native-dex-RhythmEnforcementService' && row.status === 'FAIL'));
    assert.ok(referenceResult.rows.some((row) => row.id === 'native-autolink-registration' && row.status === 'FAIL'));

    const referencedTypeOnly = makeDex({
      defined: ['LNativeReferenceOnlyFixture;'],
      referenced: [MODULE, SERVICE, REGISTRY],
    });
    const referencedDefinitions = readDexDefinitions(referencedTypeOnly);
    assert.equal(referencedDefinitions.definedClasses.includes(MODULE), false);
    assert.equal(referencedDefinitions.referencedClasses.includes(MODULE), true);
    const referencedSummary = summarizeDex(
      makeZipWithFiles({ 'classes.dex': referencedTypeOnly }),
      readZipEntries(makeZipWithFiles({ 'classes.dex': referencedTypeOnly }))
    );
    assert.equal(referencedSummary.error, null);
    const referencedResult = evaluateArtifact(
      spec(),
      dexFacts(makeZipWithFiles({ 'classes.dex': referencedTypeOnly }))
    );
    assert.equal(referencedResult.ok, false);
    const referencedRow = referencedResult.rows.find((row) => row.id === 'native-dex-RhythmDeviceModule');
    assert.equal(referencedRow.status, 'FAIL');
    assert.match(referencedRow.detail, /referenced\/string-only, not defined/i);

    const lookalike = makeDex({
      defined: [
        'Lcom/example/RhythmDeviceModule;',
        'Lexpo/modules/rhythmdevice/RhythmDeviceModuleNested;',
        'Lexpo/modules/ExpoModulesPackageListExtra;',
      ],
    });
    assert.equal(readDexDefinitions(lookalike).definedClasses.length, 3);
    const lookalikeResult = evaluateArtifact(spec(), dexFacts(makeZipWithFiles({ 'classes.dex': lookalike })));
    assert.equal(lookalikeResult.ok, false);
  });

  it('does not reject a legitimate long unrelated metadata string', () => {
    const longMetadata = `Lmetadata/${'x'.repeat(40_000)};`;
    const dex = makeDex({ defined: [MODULE, SERVICE, REGISTRY], extraStrings: [longMetadata] });
    assert.equal(readDexDefinitions(dex).definedClasses.length, 3);
    assert.ok(readDexStrings(dex).includes(longMetadata));
    const result = evaluateArtifact(spec(), dexFacts(makeZipWithFiles({ 'classes.dex': dex })));
    assert.equal(result.ok, true, JSON.stringify(result.rows));
  });

  it('finds definitions in multidex and preserves unrelated-native false-positive refusal', () => {
    const first = makeDex({ defined: ['Lcom/example/Unrelated;'], extraStrings: [MODULE, SERVICE, REGISTRY] });
    const second = makeDex({ defined: [MODULE, SERVICE, REGISTRY] });
    const zip = makeZipWithFiles({
      'classes.dex': first,
      'classes2.dex': second,
      'lib/arm64-v8a/libreactnativejni.so': Buffer.from('unrelated'),
    });
    const result = evaluateArtifact(spec(), dexFacts(zip));
    assert.equal(result.ok, true, JSON.stringify(result.rows));

    const unrelatedSo = makeZipWithFiles({
      'classes.dex': first,
      'lib/arm64-v8a/libreactnativejni.so': Buffer.from('unrelated'),
    });
    const falsePositive = evaluateArtifact(spec(), dexFacts(unrelatedSo));
    assert.equal(falsePositive.ok, false);
  });

  it('fails closed on corrupt checksum and out-of-bounds class_def type index', () => {
    const checksumCorrupt = makeDex({ defined: [MODULE, SERVICE, REGISTRY] });
    checksumCorrupt[checksumCorrupt.length - 2] ^= 0xff;
    assert.throws(() => readDexDefinitions(checksumCorrupt), /signature|checksum/i);

    const badIndex = makeDex({ defined: [MODULE, SERVICE, REGISTRY], corruptClassIndex: true });
    assert.throws(() => readDexDefinitions(badIndex), /type index|out of bounds/i);
    const badZip = makeZipWithFiles({ 'classes.dex': badIndex });
    assert.match(summarizeDex(badZip, readZipEntries(badZip)).error, /type index|out of bounds/i);
  });
});
