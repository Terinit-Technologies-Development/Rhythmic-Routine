import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { configurePlatformServices } from '../../../platform/PlatformServices';
import { MockUsageProvider } from '../../../platform/mock/MockUsageProvider';
import { MockRestrictionProvider } from '../../../platform/mock/MockRestrictionProvider';
import { MockStorageProvider } from '../../../platform/storage/MockStorageProvider';
import { MockPermissionProvider } from '../../../platform/permissions/MockPermissionProvider';
import { RhythmCoordinator } from '../../../application/RhythmCoordinator';
import { initialRiskGroups, initialRoutineWindows } from '../../../data/mockData';

describe('RhythmCoordinator — Platform Composition & Lifecycle', () => {
  test('Coordinator initializes platform services, dispatches events, and enforces restrictions safely', async () => {
    const mockUsage = new MockUsageProvider();
    const mockRestrictions = new MockRestrictionProvider();
    const mockStorage = new MockStorageProvider({
      routineWindows: initialRoutineWindows,
      riskGroups: initialRiskGroups,
      appClassifications: {
        x: { classification: 'risk', riskGroupId: 'social' },
        instagram: { classification: 'risk', riskGroupId: 'social' },
        phone: { classification: 'essential' },
      },
      sessionResetGapMs: 5 * 60 * 1000,
      onboardingCompleted: true,
    });
    const mockPermissions = new MockPermissionProvider();

    configurePlatformServices({
      usage: mockUsage,
      restrictions: mockRestrictions,
      storage: mockStorage,
      permissions: mockPermissions,
    });

    const coordinator = RhythmCoordinator.getInstance();
    coordinator.destroy(); // Clear any previous singleton state

    // Initialize and reconcile at 14:00 (Open Day)
    const t0 = new Date('2026-08-31T14:00:00').getTime();
    await coordinator.initialize();
    await coordinator.reconcile(t0);

    assert.equal(coordinator.getRuntime()?.state, 'available');

    // 1. User opens X (foreground)
    await coordinator.dispatch({
      type: 'APP_FOREGROUND',
      appId: 'x',
      timestamp: t0,
    });
    assert.equal(coordinator.getRuntime()?.state, 'risk-session');

    // 2. 30 minutes continuous usage -> threshold reached!
    await coordinator.dispatch({
      type: 'APP_FOREGROUND',
      appId: 'x',
      timestamp: t0 + 30 * 60 * 1000,
    });

    assert.equal(coordinator.getRuntime()?.state, 'cooldown');
    const restrictedApps = await mockRestrictions.getActiveRestrictedApps();
    assert.equal(restrictedApps.includes('x'), true);
    assert.equal(restrictedApps.includes('instagram'), true);
    assert.equal(restrictedApps.includes('tiktok'), true);
    assert.equal(restrictedApps.includes('phone'), false);

    // 3. Cooldown expires -> restriction cleared
    await coordinator.dispatch({
      type: 'CLOCK_TICK',
      timestamp: t0 + 125 * 60 * 1000,
    });

    assert.equal(coordinator.getRuntime()?.state, 'available');
    const clearedApps = await mockRestrictions.getActiveRestrictedApps();
    assert.equal(clearedApps.length, 0);

    // 4. Verify permission status handling
    mockPermissions.setMockStatus({ usageAccess: 'denied' });
    const permStatus = await mockPermissions.getStatus();
    assert.equal(permStatus.usageAccess, 'denied');
  });
});
