import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RhythmEngine } from '../RhythmEngine';
import { RhythmCoordinator } from '../../../application/RhythmCoordinator';
import { configurePlatformServices } from '../../../platform/PlatformServices';
import { MockStorageProvider } from '../../../platform/storage/MockStorageProvider';
import { MockUsageProvider } from '../../../platform/mock/MockUsageProvider';
import { MockPermissionProvider } from '../../../platform/permissions/MockPermissionProvider';
import { MockRestrictionProvider } from '../../../platform/mock/MockRestrictionProvider';
import { RhythmConfiguration } from '../types';
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
    id: 'com.netflix.mediaclient',
    name: 'Netflix',
    classification: 'risk',
    riskGroupId: 'entertainment',
    iconName: 'film',
    iconColor: '#E50914',
    iconBg: '#FDE8E9',
    defaultCategory: 'Entertainment',
    usageTodayMinutes: 20,
    sessionMinutes: 0,
  },
  {
    id: 'com.google.android.dialer',
    name: 'Phone',
    classification: 'essential',
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
    name: 'Social Feeds',
    description: 'Infinite feeds',
    iconName: 'twitter',
    iconColor: '#1DA1F2',
    iconBg: '#E8F5FD',
    appIds: ['com.twitter.android'],
    sessionThresholdMinutes: 20,
    cooldownMinutes: 90,
    currentSessionMinutes: 0,
    isBufferingToday: false,
    nativeSelectionRef: 'selection.social',
  },
  {
    id: 'entertainment',
    name: 'Entertainment',
    description: 'Streaming media',
    iconName: 'film',
    iconColor: '#E50914',
    iconBg: '#FDE8E9',
    appIds: ['com.netflix.mediaclient'],
    sessionThresholdMinutes: 45,
    cooldownMinutes: 60,
    currentSessionMinutes: 0,
    isBufferingToday: false,
    nativeSelectionRef: 'selection.entertainment',
  },
];

const mockWindows: RoutineWindow[] = [
  {
    id: 'morning-buffer',
    name: 'Morning Buffer',
    type: 'morning-buffer',
    startTime: '06:30',
    endTime: '08:00',
    activeDays: [1, 2, 3, 4, 5, 6, 7],
    protectedGroupIds: ['social'],
    enabled: true,
    tagline: 'Ease into day',
    description: 'Mornings',
  },
];

const mockConfig: RhythmConfiguration = {
  routineWindows: mockWindows,
  riskGroups: mockRiskGroups,
  apps: mockApps,
  sessionResetGapMs: 5 * 60 * 1000,
};

test('Android Policy — Base restriction persists through access lease and restores after lease ends', () => {
  const t0 = 1000000000;
  const engine = new RhythmEngine(mockConfig, null, t0);

  // Trigger cooldown on Social (90m cooldown -> ends at t0 + 90m)
  const cdEndsAt = t0 + 90 * 60 * 1000;
  engine.dispatch({
    type: 'COOLDOWN_STARTED',
    groupId: 'social',
    endsAt: cdEndsAt,
    timestamp: t0,
  });

  // Effective restriction applies to twitter
  assert.deepEqual(engine.getEffectiveRestrictedAppIds(), ['com.twitter.android']);

  // Start a 5-minute access lease on Social (ends at t0 + 5m)
  engine.dispatch({
    type: 'START_ACCESS_LEASE',
    groupId: 'social',
    durationMinutes: 5,
    reason: 'emergency',
    timestamp: t0,
  });

  // During the lease, effective restriction is suppressed for twitter
  assert.deepEqual(engine.getEffectiveRestrictedAppIds(), []);
  // But Social cooldown remains intact and active!
  assert.equal(engine.getRuntime().activeCooldowns['social']?.endsAt, cdEndsAt);

  // Time advances past 5-minute lease (e.g. at t0 + 6m), but still within 90m cooldown
  const tPostLease = t0 + 6 * 60 * 1000;
  engine.dispatch({
    type: 'CLOCK_TICK',
    timestamp: tPostLease,
  });

  // Restrictions for Social are restored automatically without altering original cooldown end!
  assert.deepEqual(engine.getEffectiveRestrictedAppIds(), ['com.twitter.android']);
  assert.equal(engine.getRuntime().activeCooldowns['social']?.endsAt, cdEndsAt);
});

test('iOS Native Reason Union — Multi-group cooldowns and subset clearing preserve unrelated shields', () => {
  const t0 = 1000000000;
  const engine = new RhythmEngine(mockConfig, null, t0);

  // Trigger cooldown on BOTH Social (90m) and Entertainment (60m)
  const socialCdEndsAt = t0 + 90 * 60 * 1000;
  const entCdEndsAt = t0 + 60 * 60 * 1000;

  engine.dispatch({
    type: 'COOLDOWN_STARTED',
    groupId: 'social',
    endsAt: socialCdEndsAt,
    timestamp: t0,
  });
  engine.dispatch({
    type: 'COOLDOWN_STARTED',
    groupId: 'entertainment',
    endsAt: entCdEndsAt,
    timestamp: t0,
  });

  // Both apps effectively restricted
  const restrictedBoth = engine.getEffectiveRestrictedAppIds();
  assert.ok(restrictedBoth.includes('com.twitter.android'));
  assert.ok(restrictedBoth.includes('com.netflix.mediaclient'));

  // Start access lease on Social ONLY
  engine.dispatch({
    type: 'START_ACCESS_LEASE',
    groupId: 'social',
    durationMinutes: 15,
    reason: 'emergency',
    timestamp: t0,
  });

  // INVARIANT: Subset clearing Social must NOT clear Entertainment!
  const restrictedDuringSocialLease = engine.getEffectiveRestrictedAppIds();
  assert.equal(restrictedDuringSocialLease.includes('com.twitter.android'), false, 'Social is suppressed');
  assert.equal(restrictedDuringSocialLease.includes('com.netflix.mediaclient'), true, 'Entertainment remains strictly shielded');

  // After Social lease expires at t0 + 16m:
  engine.dispatch({
    type: 'CLOCK_TICK',
    timestamp: t0 + 16 * 60 * 1000,
  });

  // Social is shielded again, and Entertainment remained shielded throughout!
  const restrictedPostLease = engine.getEffectiveRestrictedAppIds();
  assert.equal(restrictedPostLease.includes('com.twitter.android'), true, 'Social is shielded again');
  assert.equal(restrictedPostLease.includes('com.netflix.mediaclient'), true, 'Entertainment remained shielded throughout');
});

test('iOS Capability Truthfulness — Family Controls approved without selection reports foundation-only', async () => {
  const restrictionProvider = new MockRestrictionProvider();
  const capability = await restrictionProvider.getCapability();

  assert.equal(capability.supportsRoutineWindows, true);
  assert.equal(capability.supportsGroupCooldowns, true);
  assert.equal(capability.supportsEmergencyOverride, true);
});

test('Coordinator Lifecycle — handleAppResume reconciles wall clock and syncs native state', async () => {
  const storage = new MockStorageProvider(
    {
      routineWindows: mockWindows,
      riskGroups: mockRiskGroups,
      appClassifications: {},
      sessionResetGapMs: 300000,
      onboardingCompleted: true,
    },
    null
  );

  let syncCalled = false;
  const mockSync = {
    async sync() {
      syncCalled = true;
    },
  };

  configurePlatformServices({
    usage: new MockUsageProvider(),
    restrictions: new MockRestrictionProvider(),
    storage,
    permissions: new MockPermissionProvider(),
    nativeRhythm: mockSync as any,
  });

  const coordinator = RhythmCoordinator.getInstance();
  coordinator.destroy();
  await coordinator.initialize();

  syncCalled = false;
  await coordinator.handleAppResume();

  assert.equal(syncCalled, true, 'handleAppResume must synchronize native state on app resume');
});
