/**
 * SW-2026-005 A4 — bounded DEX verification for static native-module presence.
 *
 * RhythmDeviceModule is Kotlin/DEX, not a bespoke `.so`. The verifier must use
 * class_defs (actual definitions), not string_ids constants or type_ids
 * references: a DEX can contain strings naming classes it never defines.
 *
 * Header/format reference: https://source.android.com/docs/core/runtime/dex-format
 * Static definition presence is NOT runtime reachability and MUST NOT be
 * reported as ENFORCED.
 */

import { createHash } from 'node:crypto';
import { readZipEntryBuffer } from './apk-inspect.mjs';

const MAX_DEX_STRING_IDS = 500_000;
const MAX_DEX_TYPE_IDS = 500_000;
const MAX_DEX_CLASS_DEFS = 500_000;
const CLASS_DEF_ITEM_SIZE = 32;

function adler32(buffer) {
  let a = 1;
  let b = 0;
  for (const byte of buffer) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function readUleb128(buffer, offset, limit) {
  let result = 0;
  let shift = 0;
  let cursor = offset;
  while (cursor < limit) {
    const byte = buffer[cursor];
    cursor += 1;
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value: result, offset: cursor };
    shift += 7;
    if (shift > 35) throw new Error('DEX ULEB128 value is too large');
  }
  throw new Error('DEX ULEB128 is truncated');
}

function validateDexHeader(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 0x70) throw new Error('DEX file is too small');
  if (buffer.toString('ascii', 0, 4) !== 'dex\n') throw new Error('DEX magic is missing');
  if (buffer.readUInt32LE(36) !== 0x70) throw new Error('DEX header size is not 0x70');
  if (buffer.readUInt32LE(32) !== buffer.length) throw new Error('DEX file size does not match its header');

  const expectedSignature = createHash('sha1').update(buffer.subarray(32)).digest();
  if (!expectedSignature.equals(buffer.subarray(12, 32))) {
    throw new Error('DEX SHA-1 signature does not match its contents');
  }
  if (adler32(buffer.subarray(12)) !== buffer.readUInt32LE(8)) {
    throw new Error('DEX Adler-32 checksum does not match its contents');
  }
}

function readTableSizeAndOffset(buffer, sizeOffset, offsetOffset, label, maxEntries, entrySize) {
  const size = buffer.readUInt32LE(sizeOffset);
  const offset = buffer.readUInt32LE(offsetOffset);
  if (size > maxEntries) throw new Error(`DEX ${label} table is unreasonably large`);
  if (size > 0 && offset + size * entrySize > buffer.length) {
    throw new Error(`DEX ${label} table is out of bounds`);
  }
  return { size, offset };
}

/** Read one indexed DEX string lazily. Long metadata strings are legal. */
function readIndexedString(buffer, stringIdsOffset, stringIdsSize, index) {
  if (!Number.isInteger(index) || index < 0 || index >= stringIdsSize) {
    throw new Error(`DEX string index ${index} is out of bounds`);
  }
  const dataOffset = buffer.readUInt32LE(stringIdsOffset + index * 4);
  if (dataOffset + 1 >= buffer.length) throw new Error('DEX string data offset is out of bounds');
  const { offset: textOffset } = readUleb128(buffer, dataOffset, buffer.length);
  let end = textOffset;
  while (end < buffer.length && buffer[end] !== 0) end += 1;
  if (end >= buffer.length) throw new Error('DEX string is not NUL-terminated');
  // Decode only the indexed value actually needed. No arbitrary 32K cap:
  // real APK metadata strings can legitimately exceed that size.
  return buffer.toString('utf8', textOffset, end);
}

function isClassDescriptor(value) {
  return /^L[^.;]+(?:[/$][^.;]+)*;$/.test(value);
}

/**
 * Full string table utility (explicitly called only by tests/diagnostics).
 * Production module proof uses readDexDefinitions() and decodes only indexed
 * class/type strings.
 */
export function readDexStrings(buffer) {
  validateDexHeader(buffer);
  const { size: stringIdsSize, offset: stringIdsOffset } = readTableSizeAndOffset(
    buffer,
    56,
    60,
    'string id',
    MAX_DEX_STRING_IDS,
    4
  );
  const strings = [];
  for (let index = 0; index < stringIdsSize; index += 1) {
    strings.push(readIndexedString(buffer, stringIdsOffset, stringIdsSize, index));
  }
  return strings;
}

/**
 * Return actual class definitions and referenced type descriptors. Only
 * class_defs are proof of definition; type_ids include referenced-only types.
 */
export function readDexDefinitions(buffer) {
  validateDexHeader(buffer);
  const strings = readTableSizeAndOffset(buffer, 56, 60, 'string id', MAX_DEX_STRING_IDS, 4);
  const types = readTableSizeAndOffset(buffer, 64, 68, 'type id', MAX_DEX_TYPE_IDS, 4);
  const classDefs = readTableSizeAndOffset(buffer, 96, 100, 'class_def', MAX_DEX_CLASS_DEFS, CLASS_DEF_ITEM_SIZE);

  const descriptorForType = (typeIndex) => {
    if (typeIndex < 0 || typeIndex >= types.size) throw new Error('DEX type index is out of bounds');
    const descriptorIndex = buffer.readUInt32LE(types.offset + typeIndex * 4);
    return readIndexedString(buffer, strings.offset, strings.size, descriptorIndex);
  };

  const referencedClasses = [];
  for (let typeIndex = 0; typeIndex < types.size; typeIndex += 1) {
    const descriptor = descriptorForType(typeIndex);
    if (isClassDescriptor(descriptor)) referencedClasses.push(descriptor);
  }

  const definedClasses = [];
  for (let classIndex = 0; classIndex < classDefs.size; classIndex += 1) {
    const itemOffset = classDefs.offset + classIndex * CLASS_DEF_ITEM_SIZE;
    const typeIndex = buffer.readUInt32LE(itemOffset);
    const descriptor = descriptorForType(typeIndex);
    if (!isClassDescriptor(descriptor)) {
      throw new Error(`DEX class_def ${classIndex} does not point to a class descriptor`);
    }
    definedClasses.push(descriptor);
  }

  return {
    definedClasses: [...new Set(definedClasses)].sort(),
    referencedClasses: [...new Set(referencedClasses)].sort(),
    counts: { strings: strings.size, types: types.size, classes: classDefs.size },
  };
}

/**
 * @param {Buffer} apkBuffer
 * @param {{name: string}[]} entries
 */
export function summarizeDex(apkBuffer, entries) {
  const dexEntries = entries.filter((entry) => /^classes\d*\.dex$/.test(entry.name));
  if (dexEntries.length === 0) {
    return {
      dexCount: 0,
      definedClasses: [],
      referencedClasses: [],
      error: 'no classes*.dex entries packaged',
    };
  }

  const defined = new Set();
  const referenced = new Set();
  try {
    for (const entry of dexEntries) {
      const result = readDexDefinitions(readZipEntryBuffer(apkBuffer, entries, entry.name));
      result.definedClasses.forEach((value) => defined.add(value));
      result.referencedClasses.forEach((value) => referenced.add(value));
    }
  } catch (error) {
    return {
      dexCount: dexEntries.length,
      definedClasses: [...defined],
      referencedClasses: [...referenced],
      error: error.message,
    };
  }

  return {
    dexCount: dexEntries.length,
    definedClasses: [...defined].sort(),
    referencedClasses: [...referenced].sort(),
    error: null,
  };
}
