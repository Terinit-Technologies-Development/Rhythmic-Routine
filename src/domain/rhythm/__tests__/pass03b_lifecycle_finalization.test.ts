import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RhythmEngine } from '../RhythmEngine';
import { computeUnsuppressedBaseRestrictedAppIds } from '../nativePolicy';
import { aggregateDailySummary } from '../../insights/aggregateDaily';
import { RhythmCoordinator } from '../../../application/RhythmCoordinator';
import { configurePlatformServices } from '../../../platform/PlatformServices';
import { MockStorageProvider } from '../../../platform/storage/MockStorageProvider';
import { MockUsageProvider } from '../../../platform/mock/MockUsageProvider';
import { MockPermissionProvider } from '../../../platform/permissions/MockPermissionProvider';
import { MockRestrictionProvider } from '../../../platform/mock/MockRestrictionProvider';
import { NoopNativeRhythmSyncProvider } from '../../../platform/NativeRhythmSyncProvider';
import { RhythmConfiguration, RhythmRuntime } from '../types';
import { DeviceApp, RiskGroup, RoutineWindow } from '../../../types/domain';

const mockApps: DeviceApp[] = [
  {
    id: 'com.twitter.android',
    name: 'X (Twitter)',
    classification: 'risk',
    riskGroupId: 'social',
    iconName: 'twitter',
    iconColor: '#1DA1F2',
    iconBg: '#E8F5FD',
    defaultCategory: 'Social',
    usageTodayMinutes: 15,
    sessionMinutes: 0,
  },
  {
    id: 'com.instagram.android',
    name: 'Instagram',
    classification: 'risk',
    riskGroupId: 'social',
    iconName: 'camera',
    iconColor: '#E1306C',
    iconBg: '#FDE8F1',
    defaultCategory: 'Social',
    usageTodayMinutes: 10,
    sessionMinutes: 0,
  },
  {
    id: 'com.google.android.dialer',
    name: 'Phone',
    classification: 'essential',
    riskGroupId: 'social', // deliberately assigned to group to test essential invariant
    iconName: 'phone',
    iconColor: '#34A853',
    iconBg: '#E6F4EA',
    defaultCategory: 'System',
    usageTodayMinutes: 5,
    sessionMinutes: 0,
  },
];

const mockRiskGroups: RiskGroup[] = [
  {
    id: 'social',
    name: 'Social Media',
    description: 'Feeds and social platforms',
    iconName: 'message-circle',
    iconColor: '#3B82F6',
    iconBg: '#EFF6FF',
    appIds: ['com.twitter.android', 'com.instagram.android', 'com.google.android.dialer'],
    sessionThresholdMinutes: 30,
    cooldownMinutes: 60,
    currentSessionMinutes: 0,
  },
];

const mockRoutineWindows: RoutineWindow[] = [
  {
    id: 'morning-buffer',
    name: 'Morning Buffer',
    type: 'morning-buffer',
    tagline: 'Start intentional',
    description: 'Blocks social apps until 09:00',
    startTime: '06:00',
    endTime: '09:00',
    activeDays: [1, 2, 3, 4, 5, 6, 7],
    protectedGroupIds: ['social'],
    enabled: true,
  },
];

const mockConfig: RhythmConfiguration = {
  apps: mockApps,
  riskGroups: mockRiskGroups,
  routineWindows: mockRoutineWindows,
  sessionResetGapMs: 5 * 60 * 1000,
};

test('Task 1: computeUnsuppressedBaseRestrictedAppIds includes routine + cooldown and NEVER subtracts leases', () => {
  const nowMs = new Date('2026-08-29T07:30:00.000Z').getTime(); // inside 06:00-09:00 morning buffer

  const runtimeWithLease: RhythmRuntime = {
    state: 'morning-buffer',
    activeCooldowns: {
      social: {
        groupId: 'social',
        startedAt: nowMs - 10 * 60_000,
        endsAt: nowMs + 50 * 60_000,
      },
    },
    activeAccessLeases: {
      social: {
        id: 'lease-social',
        groupId: 'social',
        startedAt: nowMs - 5 * 60_000,
        endsAt: nowMs + 10 * 60_000, // active lease!
        reason: 'emergency',
      },
    },
    activeRoutineWindowIds: ['morning-buffer'],
    activeRestrictions: [], // effectively suppressed by lease in high-level engine
  };

  const baseRestricted = computeUnsuppressedBaseRestrictedAppIds(runtimeWithLease, mockConfig, nowMs);

  // Both risk apps MUST remain in base set
  assert.ok(baseRestricted.includes('com.twitter.android'), 'Twitter must be in base restrictions');
  assert.ok(baseRestricted.includes('com.instagram.android'), 'Instagram must be in base restrictions');

  // Essential app must NEVER enter base set
  assert.ok(!baseRestricted.includes('com.google.android.dialer'), 'Essential phone app must NEVER be restricted');
  assert.equal(baseRestricted.length, 2);
});

test('Task 4: NATIVE_COOLDOWN_RESTORED and NATIVE_ACCESS_LEASE_RESTORED import into engine conservatively', () => {
  const nowMs = 1000000;
  const engine = new RhythmEngine(mockConfig, undefined, nowMs);

  // Restore native cooldown
  const cooldownEndsAt = nowMs + 45 * 60_000;
  const effects1 = engine.dispatch({
    type: 'NATIVE_COOLDOWN_RESTORED',
    groupId: 'social',
    endsAt: cooldownEndsAt,
    timestamp: nowMs,
  });

  const runtime1 = engine.getRuntime();
  assert.ok(runtime1.activeCooldowns['social'], 'Cooldown should be restored');
  assert.equal(runtime1.activeCooldowns['social'].endsAt, cooldownEndsAt);
  // Must not emit duplicate START_COOLDOWN effect
  assert.ok(!effects1.some((e) => e.type === 'START_COOLDOWN'));

  // Conservative merge: restoring with earlier endsAt keeps later
  engine.dispatch({
    type: 'NATIVE_COOLDOWN_RESTORED',
    groupId: 'social',
    endsAt: nowMs + 10 * 60_000,
    timestamp: nowMs,
  });
  assert.equal(engine.getRuntime().activeCooldowns['social'].endsAt, cooldownEndsAt, 'Conservative merge must keep later endsAt');

  // Restore native access lease
  const leaseEndsAt = nowMs + 12 * 60_000;
  engine.dispatch({
    type: 'NATIVE_ACCESS_LEASE_RESTORED',
    groupId: 'social',
    endsAt: leaseEndsAt,
    timestamp: nowMs,
  });

  const runtime2 = engine.getRuntime();
  assert.ok(runtime2.activeAccessLeases['social'], 'Access lease should be restored');
  assert.equal(runtime2.activeAccessLeases['social'].endsAt, leaseEndsAt);
});

test('Task 9: Automatic cooldown and access lease transitions emit group-protection-ended/started history', () => {
  const t0 = 2000000;
  const engine = new RhythmEngine(mockConfig, undefined, t0);

  // Establish active cooldown
  const cdEndsAt = t0 + 1000;
  engine.dispatch({
    type: 'COOLDOWN_STARTED',
    groupId: 'social',
    endsAt: cdEndsAt,
    timestamp: t0,
  });

  assert.ok(engine.getRuntime().activeCooldowns['social']);

  // Reconcile at t0 + 2000 (after cooldown expiry)
  const effects = engine.reconcile(t0 + 2000);

  // Must emit group-protection-ended
  const hasProtectionEnded = effects.some(
    (e) => e.type === 'RECORD_HISTORY' && e.event.type === 'group-protection-ended' && e.event.groupId === 'social'
  );
  assert.ok(hasProtectionEnded, 'Engine must emit group-protection-ended when cooldown expires automatically');
});

test('Task 9: Canonical daily aggregation prioritizes explicit group-protection events', () => {
  const dayStart = new Date('2026-08-29T00:00:00.000Z').getTime();
  const t1 = dayStart + 2 * 3600_000; // 02:00
  const t2 = dayStart + 3 * 3600_000; // 03:00 (60 minutes)

  const summary = aggregateDailySummary(
    [
      {
        type: 'group-protection-started',
        groupId: 'social',
        timestamp: t1,
      },
      {
        type: 'group-protection-ended',
        groupId: 'social',
        timestamp: t2,
      },
    ],
    '2026-08-29',
    mockRoutineWindows
  );

  assert.equal(summary.observedProtectedMinutes, 60, 'Should aggregate exactly 60 protected minutes from explicit protection events');
});

test('Task 11: handleAppResume refreshes permissions, imports native state, reconciles, and syncs outward', async () => {
  const storage = new MockStorageProvider();
  const permissions = new MockPermissionProvider();
  const restrictions = new MockRestrictionProvider();
  const usage = new MockUsageProvider();

  class MockSyncWithSnapshot extends NoopNativeRhythmSyncProvider {
    public syncedCount = 0;
    async sync(_runtime: RhythmRuntime, _config: RhythmConfiguration): Promise<void> {
      this.syncedCount++;
    }
    async getSnapshot() {
      return {
        schemaVersion: 1 as const,
        groups: [],
        routines: [],
        activeCooldownEndsAt: {
          social: Date.now() + 30 * 60_000,
        },
        activeAccessLeaseEndsAt: {},
        activeRoutineReasons: {},
        updatedAt: Date.now(),
      };
    }
  }

  const nativeRhythm = new MockSyncWithSnapshot();

  configurePlatformServices({
    storage,
    permissions,
    restrictions,
    usage,
    nativeRhythm,
  });

  const coordinator = RhythmCoordinator.getInstance();
  coordinator.destroy();
  await coordinator.initialize();

  // Call handleAppResume
  await coordinator.handleAppResume();

  const runtime = coordinator.getRuntime();
  assert.ok(runtime?.activeCooldowns['social'], 'Native cooldown should be imported on resume');
  assert.ok(nativeRhythm.syncedCount >= 1, 'Final state should be synced to native');

  coordinator.destroy();
});
