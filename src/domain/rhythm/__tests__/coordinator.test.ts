import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { configurePlatformServices } from '../../../platform/PlatformServices';
import { MockUsageProvider } from '../../../platform/mock/MockUsageProvider';
import { MockRestrictionProvider } from '../../../platform/mock/MockRestrictionProvider';
import { MockStorageProvider } from '../../../platform/storage/MockStorageProvider';
import { MockPermissionProvider } from '../../../platform/permissions/MockPermissionProvider';
import { RhythmCoordinator } from '../../../application/RhythmCoordinator';
import { initialRoutineWindows } from '../../../data/mockData';
import { usePrototypeStore } from '../../../store/usePrototypeStore';
import { DeviceApp } from '../../../types/domain';

describe('RhythmCoordinator — Platform Composition, Lifecycle & Native Identity', () => {
  const nativeInstalledApps: DeviceApp[] = [
    {
      id: 'com.twitter.android',
      name: 'X',
      classification: 'normal',
      iconName: 'smartphone',
      iconColor: '#000',
      iconBg: '#eee',
      defaultCategory: 'Social',
      usageTodayMinutes: 0,
      sessionMinutes: 0,
    },
    {
      id: 'com.instagram.android',
      name: 'Instagram',
      classification: 'risk',
      riskGroupId: 'social',
      iconName: 'camera',
      iconColor: '#E1306C',
      iconBg: '#FCE8EF',
      defaultCategory: 'Social',
      usageTodayMinutes: 0,
      sessionMinutes: 0,
    },
    {
      id: 'com.google.android.dialer',
      name: 'Phone',
      classification: 'essential',
      iconName: 'phone',
      iconColor: '#2E7D32',
      iconBg: '#E8F5E9',
      defaultCategory: 'Communication',
      usageTodayMinutes: 0,
      sessionMinutes: 0,
    },
  ];

  test('Native app identity: bootstrapped package IDs reach Zustand and OS events match configured Risk app', async () => {
    const mockUsage = new MockUsageProvider(nativeInstalledApps);
    const mockRestrictions = new MockRestrictionProvider();
    const mockStorage = new MockStorageProvider();
    const mockPermissions = new MockPermissionProvider();

    configurePlatformServices({
      usage: mockUsage,
      restrictions: mockRestrictions,
      storage: mockStorage,
      permissions: mockPermissions,
    });

    const coordinator = RhythmCoordinator.getInstance();
    coordinator.destroy();

    // Initialize through store
    await usePrototypeStore.getState().initializeApps();

    const storeApps = usePrototypeStore.getState().apps;
    const xApp = storeApps.find((a) => a.id === 'com.twitter.android');
    assert.ok(xApp, 'Store must contain native package ID com.twitter.android');
    assert.equal(xApp?.name, 'X');

    // Classify com.twitter.android as Risk in Social Feeds
    await usePrototypeStore.getState().updateAppClassification('com.twitter.android', 'risk', 'social');

    const updatedX = usePrototypeStore.getState().apps.find((a) => a.id === 'com.twitter.android');
    assert.equal(updatedX?.classification, 'risk');
    assert.equal(updatedX?.riskGroupId, 'social');

    // Dispatch OS foreground event with native package ID
    const t0 = new Date('2026-08-31T14:00:00').getTime();
    await coordinator.dispatch({
      type: 'APP_FOREGROUND',
      appId: 'com.twitter.android',
      timestamp: t0,
    });

    assert.equal(coordinator.getRuntime()?.state, 'risk-session');
    assert.equal(coordinator.getRuntime()?.activeSession?.groupId, 'social');
    assert.equal(coordinator.getRuntime()?.activeSession?.activeAppId, 'com.twitter.android');
  });

  test('Cold start: unexpired cooldown on startup restores and reapplies restrictions to provider', async () => {
    const mockUsage = new MockUsageProvider(nativeInstalledApps);
    const mockRestrictions = new MockRestrictionProvider();
    const tNow = Date.now();
    const mockStorage = new MockStorageProvider(
      {
        routineWindows: initialRoutineWindows,
        riskGroups: [
          {
            id: 'social',
            name: 'Social Feeds',
            description: 'Social',
            iconName: 'message-square',
            iconColor: '#235D43',
            iconBg: '#E8EFE5',
            appIds: ['com.twitter.android', 'com.instagram.android'],
            sessionThresholdMinutes: 30,
            cooldownMinutes: 90,
            currentSessionMinutes: 0,
          },
        ],
        appClassifications: {
          'com.twitter.android': { classification: 'risk', riskGroupId: 'social' },
          'com.instagram.android': { classification: 'risk', riskGroupId: 'social' },
          'com.google.android.dialer': { classification: 'essential' },
        },
        sessionResetGapMs: 5 * 60 * 1000,
        onboardingCompleted: true,
      },
      {
        state: 'cooldown',
        activeCooldowns: {
          social: {
            groupId: 'social',
            startedAt: tNow - 30 * 60 * 1000,
            endsAt: tNow + 60 * 60 * 1000, // Still 60m remaining
          },
        },
        activeRoutineWindowIds: [],
        lastReconciledAt: tNow,
      }
    );
    const mockPermissions = new MockPermissionProvider();

    configurePlatformServices({
      usage: mockUsage,
      restrictions: mockRestrictions,
      storage: mockStorage,
      permissions: mockPermissions,
    });

    const coordinator = RhythmCoordinator.getInstance();
    coordinator.destroy();

    await coordinator.initialize();

    assert.equal(coordinator.getRuntime()?.state, 'cooldown');
    assert.ok(coordinator.getRuntime()?.activeCooldowns.social);

    // Assert restrictions were reapplied on cold start!
    const activeRestricted = await mockRestrictions.getActiveRestrictedApps();
    assert.deepEqual(activeRestricted.sort(), ['com.instagram.android', 'com.twitter.android']);
    assert.equal(activeRestricted.includes('com.google.android.dialer'), false);
  });

  test('Cold start: expired cooldown on startup is discarded without reapplication', async () => {
    const mockUsage = new MockUsageProvider(nativeInstalledApps);
    const mockRestrictions = new MockRestrictionProvider();
    const tNow = Date.now();
    const mockStorage = new MockStorageProvider(
      null,
      {
        state: 'cooldown',
        activeCooldowns: {
          social: {
            groupId: 'social',
            startedAt: tNow - 120 * 60 * 1000,
            endsAt: tNow - 30 * 60 * 1000, // Expired 30 minutes ago
          },
        },
        activeRoutineWindowIds: [],
        lastReconciledAt: tNow,
      }
    );
    const mockPermissions = new MockPermissionProvider();

    configurePlatformServices({
      usage: mockUsage,
      restrictions: mockRestrictions,
      storage: mockStorage,
      permissions: mockPermissions,
    });

    const coordinator = RhythmCoordinator.getInstance();
    coordinator.destroy();

    await coordinator.initialize();

    assert.equal(coordinator.getRuntime()?.activeCooldowns.social, undefined);
  });
});
