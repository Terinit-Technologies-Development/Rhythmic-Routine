import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RhythmEngine } from '../RhythmEngine';
import { RhythmConfiguration } from '../types';
import { DeviceApp, RiskGroup, RoutineWindow } from '../../../types/domain';

const mockApps: DeviceApp[] = [
  {
    id: 'com.twitter.android',
    name: 'X',
    classification: 'risk',
    riskGroupId: 'social',
    iconName: 'twitter',
    iconColor: '#000000',
    iconBg: '#FFFFFF',
    defaultCategory: 'Social',
    usageTodayMinutes: 0,
    sessionMinutes: 0,
  },
  {
    id: 'com.instagram.android',
    name: 'Instagram',
    classification: 'risk',
    riskGroupId: 'social',
    iconName: 'instagram',
    iconColor: '#E4405F',
    iconBg: '#FCE4EC',
    defaultCategory: 'Social',
    usageTodayMinutes: 0,
    sessionMinutes: 0,
  },
  {
    id: 'com.netflix.mediaclient',
    name: 'Netflix',
    classification: 'risk',
    riskGroupId: 'entertainment',
    iconName: 'tv',
    iconColor: '#E50914',
    iconBg: '#FFEBEE',
    defaultCategory: 'Entertainment',
    usageTodayMinutes: 0,
    sessionMinutes: 0,
  },
  {
    id: 'com.google.android.dialer',
    name: 'Phone',
    classification: 'essential',
    iconName: 'phone',
    iconColor: '#164B38',
    iconBg: '#E8EFE5',
    defaultCategory: 'Utilities',
    usageTodayMinutes: 0,
    sessionMinutes: 0,
  },
];

const mockRiskGroups: RiskGroup[] = [
  {
    id: 'social',
    name: 'Social Feeds',
    description: 'X, Instagram',
    iconName: 'share-2',
    iconColor: '#164B38',
    iconBg: '#E8EFE5',
    appIds: ['com.twitter.android', 'com.instagram.android'],
    sessionThresholdMinutes: 30,
    cooldownMinutes: 60,
    currentSessionMinutes: 0,
  },
  {
    id: 'entertainment',
    name: 'Entertainment',
    description: 'Netflix',
    iconName: 'tv',
    iconColor: '#8C3B1A',
    iconBg: '#FCEBE6',
    appIds: ['com.netflix.mediaclient'],
    sessionThresholdMinutes: 45,
    cooldownMinutes: 90,
    currentSessionMinutes: 0,
  },
];

const mockRoutineWindows: RoutineWindow[] = [
  {
    id: 'morning-buffer',
    name: 'Morning Buffer',
    type: 'morning-buffer',
    startTime: '06:30',
    endTime: '08:00',
    activeDays: [1, 2, 3, 4, 5, 6, 7],
    protectedGroupIds: ['social', 'entertainment'],
    enabled: true,
    tagline: 'Ease into your day',
    description: 'Protected wake-up buffer',
  },
];

test('Access Lease — Cooldown Active → Start Lease Suppresses Restrictions for Target Group Only', () => {
  const config: RhythmConfiguration = {
    apps: mockApps,
    riskGroups: mockRiskGroups,
    routineWindows: mockRoutineWindows,
  };

  // Outside morning buffer (14:00)
  const t0 = new Date('2026-08-31T14:00:00').getTime();
  const engine = new RhythmEngine(config, null, t0);

  // Trigger cooldown on Social (60m -> ends at 15:00) and Entertainment (90m -> ends at 15:30)
  engine.dispatch({
    type: 'COOLDOWN_STARTED',
    groupId: 'social',
    endsAt: t0 + 60 * 60 * 1000,
    timestamp: t0,
  });
  engine.dispatch({
    type: 'COOLDOWN_STARTED',
    groupId: 'entertainment',
    endsAt: t0 + 90 * 60 * 1000,
    timestamp: t0,
  });

  let restricted = engine.getEffectiveRestrictedAppIds();
  assert.ok(restricted.includes('com.twitter.android'), 'X is restricted by cooldown');
  assert.ok(restricted.includes('com.instagram.android'), 'Instagram is restricted by cooldown');
  assert.ok(restricted.includes('com.netflix.mediaclient'), 'Netflix is restricted by cooldown');
  assert.ok(!restricted.includes('com.google.android.dialer'), 'Phone is never restricted');

  // Start 5-minute Emergency Access Lease on 'social'
  const effects = engine.dispatch({
    type: 'START_ACCESS_LEASE',
    groupId: 'social',
    durationMinutes: 5,
    reason: 'emergency',
    timestamp: t0,
  });

  // Verify CLEAR_RESTRICTIONS effect was emitted for social apps
  const clearEffect = effects.find((e) => e.type === 'CLEAR_RESTRICTIONS');
  assert.ok(clearEffect, 'CLEAR_RESTRICTIONS effect emitted');
  assert.ok(clearEffect?.appIds.includes('com.twitter.android'));
  assert.ok(clearEffect?.appIds.includes('com.instagram.android'));

  // Verify history recorded
  const historyEffect = effects.find(
    (e) => e.type === 'RECORD_HISTORY' && e.event.type === 'access-lease-started'
  );
  assert.ok(historyEffect, 'Recorded access-lease-started history event');

  // Verify effective restrictions: Social is suppressed, but Entertainment remains restricted!
  restricted = engine.getEffectiveRestrictedAppIds();
  assert.ok(!restricted.includes('com.twitter.android'), 'X is unrestricted during lease');
  assert.ok(!restricted.includes('com.instagram.android'), 'Instagram is unrestricted during lease');
  assert.ok(restricted.includes('com.netflix.mediaclient'), 'Netflix remains restricted');
  assert.ok(!restricted.includes('com.google.android.dialer'), 'Phone remains unrestricted');

  // Active cooldown is NOT destroyed
  const runtime = engine.getRuntime();
  assert.ok(runtime.activeCooldowns['social'], 'Social cooldown is still active');
  assert.ok(runtime.activeAccessLeases['social'], 'Social access lease is active');
});

test('Access Lease — Lease Expiry Restores Original Cooldown Restrictions Without Altering Cooldown End', () => {
  const config: RhythmConfiguration = {
    apps: mockApps,
    riskGroups: mockRiskGroups,
    routineWindows: mockRoutineWindows,
  };

  const t0 = new Date('2026-08-31T14:00:00').getTime();
  const cooldownEndsAt = t0 + 60 * 60 * 1000; // 15:00
  const engine = new RhythmEngine(config, null, t0);

  engine.dispatch({
    type: 'COOLDOWN_STARTED',
    groupId: 'social',
    endsAt: cooldownEndsAt,
    timestamp: t0,
  });

  // Start 5-minute lease at 14:00 -> ends at 14:05
  engine.dispatch({
    type: 'START_ACCESS_LEASE',
    groupId: 'social',
    durationMinutes: 5,
    timestamp: t0,
  });

  assert.equal(engine.getEffectiveRestrictedAppIds().length, 0);

  // Advance clock by 3 minutes (14:03): lease still active
  engine.dispatch({
    type: 'CLOCK_TICK',
    timestamp: t0 + 3 * 60 * 1000,
  });
  assert.equal(engine.getEffectiveRestrictedAppIds().length, 0);

  // Advance clock past 5 minutes (14:06): lease has expired!
  const expiryEffects = engine.dispatch({
    type: 'CLOCK_TICK',
    timestamp: t0 + 6 * 60 * 1000,
  });

  // Verify APPLY_RESTRICTIONS effect re-emitted for social apps
  const applyEffect = expiryEffects.find((e) => e.type === 'APPLY_RESTRICTIONS');
  assert.ok(applyEffect, 'APPLY_RESTRICTIONS effect re-emitted after lease expiry');
  assert.ok(applyEffect?.appIds.includes('com.twitter.android'));
  assert.ok(applyEffect?.appIds.includes('com.instagram.android'));

  // Verify history recorded
  const historyEffect = expiryEffects.find(
    (e) => e.type === 'RECORD_HISTORY' && e.event.type === 'access-lease-ended'
  );
  assert.ok(historyEffect, 'Recorded access-lease-ended history event');

  // Verify restrictions returned
  const restricted = engine.getEffectiveRestrictedAppIds();
  assert.ok(restricted.includes('com.twitter.android'));
  assert.ok(restricted.includes('com.instagram.android'));

  // Cooldown still ends at original 15:00
  const runtime = engine.getRuntime();
  assert.equal(runtime.activeCooldowns['social']?.endsAt, cooldownEndsAt);
  assert.equal(Object.keys(runtime.activeAccessLeases).length, 0);
});

test('Access Lease — Routine Window Active: Suppressing Social Leaves Entertainment Window Protected', () => {
  const config: RhythmConfiguration = {
    apps: mockApps,
    riskGroups: mockRiskGroups,
    routineWindows: mockRoutineWindows,
  };

  // Inside Morning Buffer (07:00 AM on Monday)
  const tMorning = new Date('2026-08-31T07:00:00').getTime();
  const engine = new RhythmEngine(config, null, tMorning);

  let restricted = engine.getEffectiveRestrictedAppIds();
  assert.ok(restricted.includes('com.twitter.android'), 'Social protected by morning buffer');
  assert.ok(restricted.includes('com.netflix.mediaclient'), 'Entertainment protected by morning buffer');

  // Start 5-minute lease on 'social'
  engine.dispatch({
    type: 'START_ACCESS_LEASE',
    groupId: 'social',
    durationMinutes: 5,
    timestamp: tMorning,
  });

  restricted = engine.getEffectiveRestrictedAppIds();
  assert.ok(!restricted.includes('com.twitter.android'), 'Social unlocked during emergency lease');
  assert.ok(!restricted.includes('com.instagram.android'), 'Social unlocked during emergency lease');
  assert.ok(restricted.includes('com.netflix.mediaclient'), 'Entertainment remains locked under morning buffer');
});
