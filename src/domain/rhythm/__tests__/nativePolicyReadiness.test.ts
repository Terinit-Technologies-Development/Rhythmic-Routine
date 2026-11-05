import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { deriveNativePolicyReadiness } from '../nativePolicyReadiness';

const nativeReady = {
  moduleAvailable: true,
  serviceRunning: true,
  restrictionAuthorization: 'granted' as const,
  restrictionCapability: 'enforced' as const,
  projectionMismatch: false,
};

describe('F24 — native policy readiness is not inferred from capability alone', () => {
  test('positive module, service and acknowledged sync are Ready', () => {
    const readiness = deriveNativePolicyReadiness({
      ...nativeReady,
      sync: { success: true, updatedAt: 1_700_000_000_000 },
    });

    assert.equal(readiness.status, 'ready');
    assert.equal(readiness.label, 'Ready');
    assert.equal(readiness.policyApplied, true);
    assert.equal(readiness.serviceDisplay, 'Service available');
    assert.equal(readiness.capabilityDisplay, 'Available');
    assert.equal(readiness.authorizationDisplay, 'Authorized');
  });

  test('a default success:true with updatedAt 0 has never been acknowledged and is not Ready', () => {
    const readiness = deriveNativePolicyReadiness({
      ...nativeReady,
      sync: { success: true, updatedAt: 0 },
    });

    assert.equal(readiness.status, 'policy-not-applied');
    assert.equal(readiness.label, 'Policy not applied');
    assert.equal(readiness.policyApplied, false);
    assert.doesNotMatch(readiness.detail, /acknowledged and active|enforced/i);
  });

  test('a failed sync never advertises healthy enforcement even when capability is enforced', () => {
    const readiness = deriveNativePolicyReadiness({
      ...nativeReady,
      sync: {
        success: false,
        updatedAt: 1_700_000_000_000,
        failedStage: 'cooldowns',
        error: 'native save not confirmed',
      },
    });

    assert.equal(readiness.status, 'policy-not-applied');
    assert.deepEqual(readiness.policyApplied, false);
    assert.match(readiness.detail, /failed at cooldowns/);
    assert.doesNotMatch(readiness.detail, /Ready/);
    assert.equal(readiness.serviceDisplay, 'Service available');
    assert.equal(readiness.capabilityDisplay, 'Available');
    assert.equal(readiness.authorizationDisplay, 'Authorized');
  });

  test('a known projection mismatch blocks Ready and reports policy not applied', () => {
    const readiness = deriveNativePolicyReadiness({
      ...nativeReady,
      projectionMismatch: true,
      sync: { success: true, updatedAt: 1_700_000_000_000 },
    });

    assert.equal(readiness.status, 'policy-not-applied');
    assert.equal(readiness.policyApplied, false);
    assert.match(readiness.detail, /out of sync/);
  });

  test('missing module or stopped service is plainly Setup needed', () => {
    const moduleMissing = deriveNativePolicyReadiness({
      ...nativeReady,
      moduleAvailable: false,
      sync: { success: true, updatedAt: 1_700_000_000_000 },
    });
    const serviceStopped = deriveNativePolicyReadiness({
      ...nativeReady,
      serviceRunning: false,
      sync: { success: true, updatedAt: 1_700_000_000_000 },
    });

    assert.equal(moduleMissing.label, 'Setup needed');
    assert.equal(serviceStopped.label, 'Setup needed');
    assert.equal(moduleMissing.policyApplied, false);
    assert.equal(serviceStopped.policyApplied, false);
    assert.equal(moduleMissing.serviceDisplay, 'Unavailable');
    assert.equal(moduleMissing.capabilityDisplay, 'Unavailable');
    assert.equal(moduleMissing.authorizationDisplay, 'Not verified');
    assert.notEqual(moduleMissing.capabilityDisplay, 'Available');
  });
});
