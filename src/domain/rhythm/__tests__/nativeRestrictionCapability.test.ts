import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  NativeRestrictionProvider,
} from '../../../platform/native/NativeRestrictionProvider';
import { NativePermissionProvider } from '../../../platform/native/NativePermissionProvider';

function provider(device: Record<string, unknown>) {
  return new NativeRestrictionProvider(device as never, () => 'android');
}

const permissionEnabled = {
  checkPermissions: async () => ({
    hasUsagePermission: true,
    hasRestrictionPermission: true,
    familyControlsStatus: 'unsupported',
  }),
};

describe('F22 — Android enforcement capability requires a running service', () => {
  test('enabled permission without a running service is foundation-only', async () => {
    const capability = await provider({
      ...permissionEnabled,
      getNativeModuleDiagnostics: async () => ({ available: true, source: 'native' }),
      getEnforcementDiagnostics: async () => ({ serviceRunning: false }),
    }).getCapability();

    assert.equal(capability.status, 'foundation-only');
    assert.match(capability.reason ?? '', /not confirmed running/);
    assert.doesNotMatch(capability.reason ?? '', /service active/);
  });

  test('positively running service with module and permission is enforced', async () => {
    const capability = await provider({
      ...permissionEnabled,
      getNativeModuleDiagnostics: async () => ({ available: true, source: 'native' }),
      getEnforcementDiagnostics: async () => ({ serviceRunning: true }),
    }).getCapability();

    assert.equal(capability.status, 'enforced');
    assert.match(capability.reason ?? '', /service active/);
  });

  test('missing diagnostics method is unconfirmed, never enforced', async () => {
    const capability = await provider({
      ...permissionEnabled,
      getNativeModuleDiagnostics: async () => ({ available: true, source: 'native' }),
    }).getCapability();

    assert.equal(capability.status, 'foundation-only');
    assert.match(capability.reason ?? '', /not confirmed running/);
  });

  test('throwing diagnostics is unconfirmed, never enforced', async () => {
    const capability = await provider({
      ...permissionEnabled,
      getNativeModuleDiagnostics: async () => ({ available: true, source: 'native' }),
      getEnforcementDiagnostics: async () => {
        throw new Error('binder died');
      },
    }).getCapability();

    assert.equal(capability.status, 'foundation-only');
    assert.match(capability.reason ?? '', /not confirmed running/);
  });

  test('unavailable native module stays foundation-only even with permission', async () => {
    const capability = await provider({
      ...permissionEnabled,
      getNativeModuleDiagnostics: async () => ({
        available: false,
        source: 'fallback',
        loadError: 'missing',
      }),
      getEnforcementDiagnostics: async () => ({ serviceRunning: true }),
    }).getCapability();

    assert.equal(capability.status, 'foundation-only');
    assert.match(capability.reason ?? '', /native enforcement module is unavailable/);
  });

  test('throwing module diagnostics is foundation-only with an unconfirmed reason', async () => {
    const capability = await provider({
      ...permissionEnabled,
      getNativeModuleDiagnostics: async () => {
        throw new Error('module load failed');
      },
      getEnforcementDiagnostics: async () => ({ serviceRunning: true }),
    }).getCapability();

    assert.equal(capability.status, 'foundation-only');
    assert.match(capability.reason ?? '', /diagnostics are unavailable/);
  });

  test('permission readiness does not mark enforced from the enabled flag alone', async () => {
    const notRunning = await new NativePermissionProvider(
      {
        ...permissionEnabled,
        getNativeModuleDiagnostics: async () => ({ available: true, source: 'native' }),
        getEnforcementDiagnostics: async () => ({ serviceRunning: false }),
      } as never,
      () => 'android'
    ).getStatus();
    assert.equal(notRunning.restrictionCapability, 'foundation-only');

    const running = await new NativePermissionProvider(
      {
        ...permissionEnabled,
        getNativeModuleDiagnostics: async () => ({ available: true, source: 'native' }),
        getEnforcementDiagnostics: async () => ({ serviceRunning: true }),
      } as never,
      () => 'android'
    ).getStatus();
    assert.equal(running.restrictionCapability, 'enforced');
  });
});
