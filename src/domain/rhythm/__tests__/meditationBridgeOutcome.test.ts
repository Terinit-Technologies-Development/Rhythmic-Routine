import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  nativeMeditationBridge,
  setNativeMeditationModuleForTests,
} from '../../../platform/NativeMeditationBridge';
import { hasMeditationIdentityMetadata } from '../meditationEvidence';

const baseSeven = {
  sessionId: 'morning-ad-20260928-0830',
  protocolVersion: 1,
  status: 'COMPLETED',
  requiredQualifiedSeconds: 1800,
  completedQualifiedSeconds: 1800,
  completedAtEpochMs: 1790243200000,
  lastUpdatedAtEpochMs: 1790243260000,
};
const fullIdentity = {
  ...baseSeven,
  sessionKind: 'MORNING_REQUIRED',
  sourceCooldownId: null,
  sourceRhythmicDayId: 'ad-20260928-0830',
};

function moduleWithDetailed(detail: Record<string, unknown> | null) {
  return {
    isMeditationAvailable: async () => 'available',
    startMeditationRecoverySession: async () => true,
    queryMeditationStatus: async () => null,
    queryMeditationStatusDetailed: async () => detail,
  };
}

describe('F9 — detailed meditation query outcome', () => {
  afterEach(() => setNativeMeditationModuleForTests(undefined));

  test('detailed available morning preserves explicit-null identity', async () => {
    setNativeMeditationModuleForTests(moduleWithDetailed({
      queryStatus: 'available',
      availability: 'available',
      identityMetadataAvailable: true,
      evidence: fullIdentity,
    }));
    const result = await nativeMeditationBridge.queryMeditationStatusResult!(
      'morning-ad-20260928-0830'
    );
    assert.equal(result.queryStatus, 'available');
    assert.equal(result.identityMetadataAvailable, true);
    assert.equal(hasMeditationIdentityMetadata(result.evidence), true);
    assert.equal(result.evidence?.sourceCooldownId, null);
  });

  test('detailed failures stay distinct from unknown session', async () => {
    for (const [status, availability] of [
      ['session-missing', 'unavailable'],
      ['permission-denied', 'permission-denied'],
      ['protocol-incompatible', 'protocol-incompatible'],
      ['corrupt', 'unavailable'],
      ['query-failed', 'unavailable'],
    ] as const) {
      setNativeMeditationModuleForTests(moduleWithDetailed({
        queryStatus: status,
        availability,
        identityMetadataAvailable: false,
        evidence: null,
      }));
      const result = await nativeMeditationBridge.queryMeditationStatusResult!('session');
      assert.equal(result.queryStatus, status);
      assert.equal(result.availability, availability);
      assert.equal(result.evidence, undefined);
      assert.equal(result.sessionMissing === true, status === 'session-missing');
    }
  });

  test('presence boolean overrides populated fields for legacy metadata', async () => {
    setNativeMeditationModuleForTests(moduleWithDetailed({
      queryStatus: 'available',
      availability: 'available',
      identityMetadataAvailable: false,
      evidence: fullIdentity,
    }));
    const result = await nativeMeditationBridge.queryMeditationStatusResult!('session');
    assert.equal(result.identityMetadataAvailable, false);
  });

  test('legacy ambiguous null is not confident session-missing', async () => {
    setNativeMeditationModuleForTests({
      isMeditationAvailable: async () => 'available',
      startMeditationRecoverySession: async () => true,
      queryMeditationStatus: async () => null,
    });
    const result = await nativeMeditationBridge.queryMeditationStatusResult!('session');
    assert.equal(result.queryStatus, 'legacy-ambiguous-null');
    assert.equal(result.sessionMissing, false);
    assert.equal(result.evidence, undefined);
  });

  test('legacy valid seven-column row is capability-limited but usable evidence', async () => {
    setNativeMeditationModuleForTests({
      isMeditationAvailable: async () => 'available',
      startMeditationRecoverySession: async () => true,
      queryMeditationStatus: async () => baseSeven,
    });
    const result = await nativeMeditationBridge.queryMeditationStatusResult!('session');
    assert.equal(result.queryStatus, 'available');
    assert.equal(result.identityMetadataAvailable, false);
    assert.equal(hasMeditationIdentityMetadata(result.evidence), false);
  });

  test('thrown query is query-failed and preflight failure is not rewritten', async () => {
    setNativeMeditationModuleForTests({
      isMeditationAvailable: async () => 'available',
      startMeditationRecoverySession: async () => true,
      queryMeditationStatus: async () => { throw new Error('binder'); },
    });
    const thrown = await nativeMeditationBridge.queryMeditationStatusResult!('session');
    assert.equal(thrown.queryStatus, 'query-failed');

    setNativeMeditationModuleForTests({
      isMeditationAvailable: async () => 'not-installed',
      startMeditationRecoverySession: async () => true,
      queryMeditationStatus: async () => null,
    });
    const unavailable = await nativeMeditationBridge.queryMeditationStatusResult!('session');
    assert.equal(unavailable.availability, 'not-installed');
    assert.equal(unavailable.queryStatus, 'not-installed');
  });
  test('detailed query error cannot carry completion evidence', async () => {
    setNativeMeditationModuleForTests(moduleWithDetailed({
      queryStatus: 'permission-denied',
      availability: 'permission-denied',
      identityMetadataAvailable: true,
      evidence: fullIdentity,
    }));
    const result = await nativeMeditationBridge.queryMeditationStatusResult!('morning-ad-20260928-0830');
    assert.equal(result.availability, 'permission-denied');
    assert.equal(result.evidence, undefined);
    assert.equal(result.identityMetadataAvailable, false);
  });
  test('malformed detailed success cannot expose evidence', async () => {
    for (const detail of [
      { queryStatus: 'available', availability: 'available', evidence: {} },
      { queryStatus: 'available', availability: 'available', evidence: fullIdentity },
      { queryStatus: 'unknown', availability: 'available', evidence: fullIdentity },
    ]) {
      setNativeMeditationModuleForTests(moduleWithDetailed(detail));
      const result = await nativeMeditationBridge.queryMeditationStatusResult!('different-request');
      assert.equal(result.availability, 'unavailable');
      assert.equal(result.queryStatus, 'corrupt');
      assert.equal(result.evidence, undefined);
      assert.equal(result.identityMetadataAvailable, false);
    }
  });
});
