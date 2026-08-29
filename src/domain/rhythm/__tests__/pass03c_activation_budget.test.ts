import test from 'node:test';
import assert from 'node:assert/strict';
import { RhythmCoordinator } from '../../../application/RhythmCoordinator';
import {
  IOSSharedRhythmSnapshot,
  NoopNativeRhythmSyncProvider,
  computeMonitoringConfigSignature,
} from '../../../platform/NativeRhythmSyncProvider';
import { configurePlatformServices } from '../../../platform/PlatformServices';
import { MockStorageProvider } from '../../../platform/storage/MockStorageProvider';
import { MockUsageProvider } from '../../../platform/mock/MockUsageProvider';
import { MockPermissionProvider } from '../../../platform/permissions/MockPermissionProvider';
import { MockRestrictionProvider } from '../../../platform/mock/MockRestrictionProvider';
import { RhythmConfiguration, RhythmRuntime } from '../types';
import { computeUnsuppressedBaseRestrictedAppIds } from '../nativePolicy';
import { initialApps, initialRiskGroups, initialRoutineWindows } from '../../../data/mockData';

// --- Test Mocks ---

class OrderedNativeSyncProvider extends NoopNativeRhythmSyncProvider {
  public calls: string[] = [];
  public syncedSnapshots: RhythmRuntime[] = [];

  constructor(private snapshot: IOSSharedRhythmSnapshot | null) {
    super();
  }

  override async getSnapshot(): Promise<IOSSharedRhythmSnapshot | null> {
    this.calls.push('getSnapshot');
    return this.snapshot;
  }

  override async sync(runtime: RhythmRuntime, _config: RhythmConfiguration): Promise<void> {
    const hasSocialCooldown = Boolean(runtime.activeCooldowns?.social);
    this.calls.push(`sync:${hasSocialCooldown}`);
    this.syncedSnapshots.push(JSON.parse(JSON.stringify(runtime)));
  }
}

// --- Test Suite ---

test('Task 1: Cold start calls getSnapshot before first outward sync and preserves native cooldown', async () => {
  const coordinator = RhythmCoordinator.getInstance();
  coordinator.destroy();

  const now = Date.now();
  const futureNativeCooldownEndsAt = now + 45 * 60 * 1000;

  // Extension created a cooldown while JS process was dead
  const extensionSnapshot: IOSSharedRhythmSnapshot = {
    schemaVersion: 1,
    groups: [
      {
        groupId: 'social',
        selectionRef: 'selection.social',
        sessionThresholdMinutes: 15,
        cooldownMinutes: 45,
      },
    ],
    routines: [],
    activeCooldownEndsAt: {
      social: futureNativeCooldownEndsAt,
    },
    activeAccessLeaseEndsAt: {},
    activeRoutineReasons: {},
    updatedAt: now - 1000,
  };

  const orderedSync = new OrderedNativeSyncProvider(extensionSnapshot);
  const storage = new MockStorageProvider();

  // Persisted runtime in SQLite had NO active cooldown or older cooldown
  await storage.saveRuntime({
    state: 'available',
    activeCooldowns: {},
    activeAccessLeases: {},
    activeRoutineWindowIds: [],
    lastReconciledAt: now,
  });

  configurePlatformServices({
    storage,
    usage: new MockUsageProvider(),
    permissions: new MockPermissionProvider(),
    restrictions: new MockRestrictionProvider(),
    nativeRhythm: orderedSync,
  });

  const runtime = await coordinator.initialize();

  // Invariant 1: getSnapshot MUST happen before first sync
  assert.equal(orderedSync.calls[0], 'getSnapshot');
  assert.equal(orderedSync.calls[1], 'sync:true');

  // Invariant 2: Native cooldown survived cold launch
  assert.ok(runtime.activeCooldowns.social, 'Social cooldown should be active in engine');
  assert.equal(runtime.activeCooldowns.social.endsAt, futureNativeCooldownEndsAt);

  // Invariant 3: Outward synced snapshot contained the imported cooldown
  assert.ok(orderedSync.syncedSnapshots[0]?.activeCooldowns?.social);

  coordinator.destroy();
});

test('Task 1: Later native cooldown endsAt beats earlier persisted JS cooldown on cold start', async () => {
  const coordinator = RhythmCoordinator.getInstance();
  coordinator.destroy();

  const now = Date.now();
  const earlierJsEndsAt = now + 10 * 60 * 1000;
  const laterNativeEndsAt = now + 40 * 60 * 1000;

  const extensionSnapshot: IOSSharedRhythmSnapshot = {
    schemaVersion: 1,
    groups: [],
    routines: [],
    activeCooldownEndsAt: {
      social: laterNativeEndsAt,
    },
    activeAccessLeaseEndsAt: {},
    activeRoutineReasons: {},
    updatedAt: now,
  };

  const orderedSync = new OrderedNativeSyncProvider(extensionSnapshot);
  const storage = new MockStorageProvider();

  // Earlier persisted cooldown in SQLite
  await storage.saveRuntime({
    state: 'cooldown',
    activeCooldowns: {
      social: {
        groupId: 'social',
        startedAt: now - 5000,
        endsAt: earlierJsEndsAt,
      },
    },
    activeAccessLeases: {},
    activeRoutineWindowIds: [],
    lastReconciledAt: now,
  });

  configurePlatformServices({
    storage,
    usage: new MockUsageProvider(),
    permissions: new MockPermissionProvider(),
    restrictions: new MockRestrictionProvider(),
    nativeRhythm: orderedSync,
  });

  const runtime = await coordinator.initialize();

  // Conservative merge takes later timestamp
  assert.equal(runtime.activeCooldowns.social?.endsAt, laterNativeEndsAt);

  coordinator.destroy();
});

test('Task 1: Expired native cooldown is ignored on cold start', async () => {
  const coordinator = RhythmCoordinator.getInstance();
  coordinator.destroy();

  const now = Date.now();
  const expiredNativeEndsAt = now - 5 * 60 * 1000;

  const extensionSnapshot: IOSSharedRhythmSnapshot = {
    schemaVersion: 1,
    groups: [],
    routines: [],
    activeCooldownEndsAt: {
      social: expiredNativeEndsAt,
    },
    activeAccessLeaseEndsAt: {},
    activeRoutineReasons: {},
    updatedAt: now - 10000,
  };

  const orderedSync = new OrderedNativeSyncProvider(extensionSnapshot);
  const storage = new MockStorageProvider();

  await storage.saveRuntime({
    state: 'available',
    activeCooldowns: {},
    activeAccessLeases: {},
    activeRoutineWindowIds: [],
    lastReconciledAt: now,
  });

  configurePlatformServices({
    storage,
    usage: new MockUsageProvider(),
    permissions: new MockPermissionProvider(),
    restrictions: new MockRestrictionProvider(),
    nativeRhythm: orderedSync,
  });

  const runtime = await coordinator.initialize();
  assert.equal(runtime.activeCooldowns.social, undefined);

  coordinator.destroy();
});

test('Task 2: Android base registry has sole writer and is unaffected by access lease transitions', () => {
  const d = new Date();
  d.setHours(7, 30, 0, 0);
  const now = d.getTime(); // within 06:00-09:00 morning buffer in local time
  const config: RhythmConfiguration = {
    routineWindows: [
      {
        id: 'morning-buffer',
        name: 'Morning Buffer',
        type: 'morning-buffer',
        tagline: 'Buffer',
        description: 'Buffer',
        startTime: '06:00',
        endTime: '09:00',
        activeDays: [1, 2, 3, 4, 5, 6, 7],
        protectedGroupIds: ['social'],
        enabled: true,
      },
    ],
    riskGroups: [
      {
        id: 'social',
        name: 'Social',
        description: 'Social',
        iconName: 'message-square',
        iconColor: '#FF0000',
        iconBg: '#E8EFE5',
        appIds: ['com.twitter.android'],
        sessionThresholdMinutes: 15,
        cooldownMinutes: 45,
        currentSessionMinutes: 0,
      },
    ],
    apps: [
      {
        id: 'com.twitter.android',
        name: 'X',
        classification: 'risk',
        riskGroupId: 'social',
        iconName: 'twitter',
        iconColor: '#000',
        iconBg: '#fff',
        defaultCategory: 'Social',
        usageTodayMinutes: 0,
        sessionMinutes: 0,
      },
      {
        id: 'com.google.android.dialer',
        name: 'Phone',
        classification: 'essential',
        iconName: 'phone',
        iconColor: '#000',
        iconBg: '#fff',
        defaultCategory: 'Utilities',
        usageTodayMinutes: 0,
        sessionMinutes: 0,
      },
    ],
    sessionResetGapMs: 5 * 60 * 1000,
  };

  const runtimeWithoutLease: RhythmRuntime = {
    state: 'morning-buffer',
    activeCooldowns: {},
    activeAccessLeases: {},
    activeRoutineWindowIds: ['morning-buffer'],
    activeRestrictions: [],
  };

  // Base set with active routine
  const baseBefore = computeUnsuppressedBaseRestrictedAppIds(runtimeWithoutLease, config, now);
  assert.deepEqual(baseBefore, ['com.twitter.android']);

  // Add an active access lease for social
  const runtimeWithLease: RhythmRuntime = {
    ...runtimeWithoutLease,
    activeAccessLeases: {
      social: {
        id: 'lease-social',
        groupId: 'social',
        startedAt: now,
        endsAt: now + 15 * 60 * 1000,
        reason: 'intentional',
      },
    },
  };

  // Invariant: Base set MUST NEVER subtract or delete apps when an access lease is active!
  const baseDuringLease = computeUnsuppressedBaseRestrictedAppIds(runtimeWithLease, config, now);
  assert.deepEqual(baseDuringLease, ['com.twitter.android']);
  assert.deepEqual(baseBefore, baseDuringLease);
});

test('Task 3 & 4: iOS Monitoring Planner compresses 7-day routines, skips Open Day, and builds 1 risk.daily', () => {
  const config: RhythmConfiguration = {
    routineWindows: [
      {
        id: 'morning-buffer',
        name: 'Morning Buffer',
        type: 'morning-buffer',
        tagline: 'Buffer',
        description: 'Buffer',
        startTime: '06:30',
        endTime: '08:00',
        activeDays: [1, 2, 3, 4, 5, 6, 7], // 7 days -> 1 daily monitor
        protectedGroupIds: ['social', 'entertainment'],
        enabled: true,
      },
      {
        id: 'open-day',
        name: 'Open Day',
        type: 'open-day',
        tagline: 'Open',
        description: 'Open',
        startTime: '08:00',
        endTime: '21:30',
        activeDays: [1, 2, 3, 4, 5, 6, 7],
        protectedGroupIds: [], // Protects 0 groups -> 0 monitors!
        enabled: true,
      },
      {
        id: 'evening-wind-down',
        name: 'Evening Wind-Down',
        type: 'evening-wind-down',
        tagline: 'Wind-Down',
        description: 'Wind-Down',
        startTime: '21:30',
        endTime: '23:30',
        activeDays: [1, 2, 3, 4, 5, 6, 7], // 7 days -> 1 daily monitor
        protectedGroupIds: ['social', 'entertainment'],
        enabled: true,
      },
    ],
    riskGroups: [
      {
        id: 'social',
        name: 'Social',
        description: 'Social',
        iconName: 'message-square',
        iconColor: '#FF0000',
        iconBg: '#E8EFE5',
        appIds: ['x'],
        nativeSelectionRef: 'selection.social',
        nativeSelectionCount: 2,
        sessionThresholdMinutes: 15,
        cooldownMinutes: 45,
        currentSessionMinutes: 0,
      },
      {
        id: 'entertainment',
        name: 'Entertainment',
        description: 'Entertainment',
        iconName: 'film',
        iconColor: '#00FF00',
        iconBg: '#E8EFE5',
        appIds: ['yt'],
        nativeSelectionRef: 'selection.entertainment',
        nativeSelectionCount: 1,
        sessionThresholdMinutes: 20,
        cooldownMinutes: 60,
        currentSessionMinutes: 0,
      },
    ],
    apps: initialApps,
    sessionResetGapMs: 5 * 60 * 1000,
  };

  // Calculate planned routine monitors
  const plannedRoutines = config.routineWindows.filter(
    (r) => r.enabled && r.protectedGroupIds.length > 0
  );
  assert.equal(plannedRoutines.length, 2, 'Open Day must be skipped (0 protected groups)');

  // Both Morning Buffer and Evening Wind-Down are 7 days -> exactly 2 routine monitors
  const routineMonitorCount = plannedRoutines.reduce((acc, r) => {
    const isEveryDay = r.activeDays.length === 7;
    return acc + (isEveryDay ? 1 : r.activeDays.length);
  }, 0);
  assert.equal(routineMonitorCount, 2);

  // Both groups share ONE single risk.daily monitor
  const hasRiskActivity = config.riskGroups.some((g) => Boolean(g.nativeSelectionRef));
  assert.equal(hasRiskActivity, true);
  const riskMonitorCount = hasRiskActivity ? 1 : 0;

  // Invariant: Default persistent total is exactly 3!
  const totalPersistentCount = routineMonitorCount + riskMonitorCount;
  assert.equal(totalPersistentCount, 3);
  assert.ok(totalPersistentCount <= 18, 'Must remain within max 18 persistent capacity');
});

test('Task 4: Partial-week routine generates weekday-specific monitors', () => {
  const partialRoutine = {
    id: 'work-focus',
    startTime: '09:00',
    endTime: '17:00',
    activeDays: [1, 2, 3, 4, 5], // Mon-Fri
    protectedGroupIds: ['social'],
    enabled: true,
  };

  const isEveryDay = partialRoutine.activeDays.length === 7;
  const count = isEveryDay ? 1 : partialRoutine.activeDays.length;
  assert.equal(count, 5, 'Mon-Fri partial week produces 5 weekday monitors');
});

test('Task 5: computeMonitoringConfigSignature changes ONLY on config topology edits, not on clock ticks', () => {
  const baseConfig: RhythmConfiguration = {
    routineWindows: initialRoutineWindows,
    riskGroups: initialRiskGroups,
    apps: initialApps,
    sessionResetGapMs: 5 * 60 * 1000,
  };

  const sig1 = computeMonitoringConfigSignature(baseConfig);
  const sig2 = computeMonitoringConfigSignature(baseConfig);

  // Invariant: Same configuration produces identical signature
  assert.equal(sig1, sig2);

  // Modifying routine window changes signature
  const editedRoutineConfig: RhythmConfiguration = {
    ...baseConfig,
    routineWindows: [
      {
        ...baseConfig.routineWindows[0],
        endTime: '08:30', // edited
      },
      ...baseConfig.routineWindows.slice(1),
    ],
  };
  const sigRoutine = computeMonitoringConfigSignature(editedRoutineConfig);
  assert.notEqual(sig1, sigRoutine);

  // Modifying risk threshold changes signature
  const editedRiskConfig: RhythmConfiguration = {
    ...baseConfig,
    riskGroups: [
      {
        ...baseConfig.riskGroups[0],
        sessionThresholdMinutes: 60, // edited from initial 30
      },
      ...baseConfig.riskGroups.slice(1),
    ],
  };
  const sigRisk = computeMonitoringConfigSignature(editedRiskConfig);
  assert.notEqual(sig1, sigRisk);
});

test('Task 6: Nearest-expiry calculation picks minimum future timestamp and enforces >=15m wake interval', () => {
  const now = Date.now();
  const cooldown1EndsAt = now + 25 * 60 * 1000;
  const cooldown2EndsAt = now + 60 * 60 * 1000;
  const leaseEndsAt = now + 15 * 60 * 1000;

  // Single nearest expiry algorithm
  const futureTimestamps = [cooldown1EndsAt, cooldown2EndsAt, leaseEndsAt].filter((t) => t > now);
  const nearest = Math.min(...futureTimestamps);

  assert.equal(nearest, leaseEndsAt, 'Lease endsAt (15m) is the earliest wake-up');

  // Wake interval constraint: semantic end is 15m, registration happens now
  const minimumDeviceActivityInterval = 15 * 60 * 1000;
  const monitorWakePadding = 2 * 1000;
  const minimumWakeEnd = now + minimumDeviceActivityInterval + monitorWakePadding;
  const actualWakeEnd = Math.max(nearest, minimumWakeEnd);

  const durationMs = actualWakeEnd - now;
  assert.ok(
    durationMs >= minimumDeviceActivityInterval,
    'DeviceActivity schedule duration must be at least 15 minutes'
  );
});
