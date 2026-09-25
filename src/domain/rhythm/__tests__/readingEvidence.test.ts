import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { FallbackModule } from '../../../../modules/rhythm-device';
import { NativeDailyReadingEvidenceClient } from '../readingEvidence';

function nativeResult(overrides: Record<string, unknown> = {}) {
  return {
    providerAvailable: true,
    protocolCompatible: true,
    protocolVersion: 2,
    dateKey: '2026-09-24',
    verifiedActiveSeconds: 0,
    qualifiedPages: 0,
    updatedAtEpochMs: 0,
    ...overrides,
  };
}

describe('Routine Daily Evidence Protocol V2 client', () => {
  test('valid empty Reader date maps to available compatible zero evidence', async () => {
    const client = new NativeDailyReadingEvidenceClient({
      queryDailyReadingEvidence: async () => nativeResult(),
    }, () => 123);
    assert.deepEqual(await client.query('2026-09-24'), {
      dateKey: '2026-09-24',
      providerAvailable: true,
      protocolCompatible: true,
      verifiedActiveSeconds: 0,
      qualifiedPages: 0,
      readerUpdatedAtEpochMs: 0,
      syncedAtEpochMs: 123,
    });
  });

  test('maps numerical fields exactly and retains Reader update timestamp', async () => {
    const client = new NativeDailyReadingEvidenceClient({
      queryDailyReadingEvidence: async () => nativeResult({
        verifiedActiveSeconds: 3600,
        qualifiedPages: 36,
        updatedAtEpochMs: 77,
      }),
    }, () => 123);
    const snapshot = await client.query('2026-09-24');
    assert.equal(snapshot.verifiedActiveSeconds, 3600);
    assert.equal(snapshot.qualifiedPages, 36);
    assert.equal(snapshot.readerUpdatedAtEpochMs, 77);
  });

  test('protocol mismatch remains available but is not trusted as evidence', async () => {
    const client = new NativeDailyReadingEvidenceClient({
      queryDailyReadingEvidence: async () => nativeResult({ protocolVersion: 3 }),
    }, () => 123);
    const snapshot = await client.query('2026-09-24');
    assert.equal(snapshot.providerAvailable, true);
    assert.equal(snapshot.protocolCompatible, false);
    assert.equal(snapshot.verifiedActiveSeconds, 0);
    assert.equal(snapshot.qualifiedPages, 0);
  });

  test('malformed date and failed query report unavailable', async () => {
    let calls = 0;
    const client = new NativeDailyReadingEvidenceClient({
      queryDailyReadingEvidence: async () => {
        calls += 1;
        throw new Error('provider unavailable');
      },
    }, () => 123);
    assert.equal((await client.query('2026-02-30')).providerAvailable, false);
    assert.equal(calls, 0);
    assert.equal((await client.query('2026-09-24')).providerAvailable, false);
    assert.equal(calls, 1);
  });

  test('a mismatched returned date is incompatible and fallback never fabricates evidence', async () => {
    const client = new NativeDailyReadingEvidenceClient({
      queryDailyReadingEvidence: async () => nativeResult({ dateKey: '2026-09-23', verifiedActiveSeconds: 9000, qualifiedPages: 99 }),
    }, () => 123);
    const mismatch = await client.query('2026-09-24');
    assert.equal(mismatch.providerAvailable, true);
    assert.equal(mismatch.protocolCompatible, false);
    assert.equal(mismatch.verifiedActiveSeconds, 0);
    assert.equal(mismatch.qualifiedPages, 0);

    const fallback = await FallbackModule.queryDailyReadingEvidence('2026-09-24');
    assert.equal(fallback.providerAvailable, false);
    assert.equal(fallback.protocolCompatible, false);
    assert.equal(fallback.verifiedActiveSeconds, 0);
    assert.equal(fallback.qualifiedPages, 0);
  });
});
