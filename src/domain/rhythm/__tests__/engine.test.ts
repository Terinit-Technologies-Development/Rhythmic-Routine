import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { DeviceApp, RiskGroup, RoutineWindow } from '../../../types/domain';
import { RhythmEngine } from '../RhythmEngine';
import { RhythmConfiguration } from '../types';

describe('Rhythm Engine — Full Engine Lifecycle, Effects & Reconciliation Clock', () => {
  const apps: DeviceApp[] = [
    {
      id: 'phone',
      name: 'Phone',
      classification: 'essential',
      iconName: 'phone',
      iconColor: '#2E7D32',
      iconBg: '#E8F5E9',
      defaultCategory: 'Communication',
      usageTodayMinutes: 10,
      sessionMinutes: 2,
    },
    {
      id: 'com.twitter.android',
      name: 'X',
      classification: 'risk',
      riskGroupId: 'social',
      iconName: 'x',
      iconColor: '#000',
      iconBg: '#eee',
      defaultCategory: 'Social',
      usageTodayMinutes: 25,
      sessionMinutes: 12,
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
      usageTodayMinutes: 30,
      sessionMinutes: 18,
    },
    {
      id: 'com.google.android.youtube',
      name: 'YouTube',
      classification: 'risk',
      riskGroupId: 'entertainment',
      iconName: 'film',
      iconColor: '#FF0000',
      iconBg: '#FFEEEE',
      defaultCategory: 'Entertainment',
      usageTodayMinutes: 40,
      sessionMinutes: 0,
    },
  ];

  const riskGroups: RiskGroup[] = [
    {
      id: 'social',
      name: 'Social Feeds',
      description: 'Social apps',
      iconName: 'message-square',
      iconColor: '#235D43',
      iconBg: '#E8EFE5',
      appIds: ['com.twitter.android', 'com.instagram.android'],
      sessionThresholdMinutes: 30,
      cooldownMinutes: 90,
      currentSessionMinutes: 0,
    },
    {
      id: 'entertainment',
      name: 'Entertainment',
      description: 'Streaming apps',
      iconName: 'film',
      iconColor: '#FF0000',
      iconBg: '#FFEEEE',
      appIds: ['com.google.android.youtube'],
      sessionThresholdMinutes: 60,
      cooldownMinutes: 60,
      currentSessionMinutes: 0,
    },
  ];

  const routineWindows: RoutineWindow[] = [
    {
      id: 'morning-buffer',
      name: 'Morning Buffer',
      type: 'morning-buffer',
      startTime: '06:30',
      endTime: '08:30',
      activeDays: [1, 2, 3, 4, 5, 6, 7],
      protectedGroupIds: ['social'],
      enabled: true,
      tagline: 'Morning Buffer',
      description: 'Buffer',
    },
  ];

  const config: RhythmConfiguration = {
    apps,
    riskGroups,
    routineWindows,
  };

  test('Continuous foreground usage: CLOCK_TICK alone triggers threshold without second foreground event', () => {
    const t0 = new Date('2026-08-31T14:00:00').getTime();
    const engine = new RhythmEngine(config, null, t0);

    assert.equal(engine.getRuntime().state, 'available');

    // 1. Single APP_FOREGROUND for X
    engine.dispatch({
      type: 'APP_FOREGROUND',
      appId: 'com.twitter.android',
      timestamp: t0,
    });
    assert.equal(engine.getRuntime().state, 'risk-session');

    // 2. 30 minutes of continuous foreground usage with only CLOCK_TICK events
    const t1 = t0 + 30 * 60 * 1000;
    const effects = engine.dispatch({
      type: 'CLOCK_TICK',
      timestamp: t1,
    });

    // Cooldown triggered!
    assert.equal(engine.getRuntime().state, 'cooldown');
    assert.ok(engine.getRuntime().activeCooldowns.social);
    assert.equal(engine.getRuntime().activeSession, undefined);

    const applyEffect = effects.find((e) => e.type === 'APPLY_RESTRICTIONS');
    assert.ok(applyEffect);
    if (applyEffect && applyEffect.type === 'APPLY_RESTRICTIONS') {
      assert.deepEqual(applyEffect.appIds.sort(), ['com.instagram.android', 'com.twitter.android']);
      assert.equal(applyEffect.appIds.includes('phone'), false);
    }
  });

  test('Multi-group cooldowns: Social and Entertainment cooldowns coexist and expire independently', () => {
    const t0 = new Date('2026-08-31T14:00:00').getTime();
    const engine = new RhythmEngine(config, null, t0);

    // 1. Start Social Cooldown (90m, ends at t0 + 90m)
    engine.dispatch({
      type: 'COOLDOWN_STARTED',
      groupId: 'social',
      endsAt: t0 + 90 * 60 * 1000,
      timestamp: t0,
    });

    // 2. 10m later, start Entertainment Cooldown (60m, ends at t0 + 70m)
    const t1 = t0 + 10 * 60 * 1000;
    engine.dispatch({
      type: 'COOLDOWN_STARTED',
      groupId: 'entertainment',
      endsAt: t1 + 60 * 60 * 1000,
      timestamp: t1,
    });

    assert.equal(Object.keys(engine.getRuntime().activeCooldowns).length, 2);
    assert.deepEqual(
      engine.getEffectiveRestrictedAppIds().sort(),
      ['com.google.android.youtube', 'com.instagram.android', 'com.twitter.android']
    );

    // 3. At t = t0 + 75m (Entertainment expired, Social still active)
    const t2 = t0 + 75 * 60 * 1000;
    const effects = engine.dispatch({
      type: 'CLOCK_TICK',
      timestamp: t2,
    });

    // Entertainment is purged, Social remains
    assert.equal(engine.getRuntime().activeCooldowns.entertainment, undefined);
    assert.ok(engine.getRuntime().activeCooldowns.social);
    assert.equal(engine.getRuntime().state, 'cooldown');

    // Only YouTube was cleared!
    const clearEffect = effects.find((e) => e.type === 'CLEAR_RESTRICTIONS');
    assert.ok(clearEffect);
    if (clearEffect && clearEffect.type === 'CLEAR_RESTRICTIONS') {
      assert.deepEqual(clearEffect.appIds, ['com.google.android.youtube']);
    }
    assert.deepEqual(
      engine.getEffectiveRestrictedAppIds().sort(),
      ['com.instagram.android', 'com.twitter.android']
    );
  });

  test('updateConfiguration immediately returns restriction execution effects', () => {
    const t0 = new Date('2026-08-31T07:00:00').getTime(); // Inside Morning Buffer
    const engine = new RhythmEngine(config, null, t0);

    // Morning buffer restricts social apps
    assert.deepEqual(
      engine.getEffectiveRestrictedAppIds().sort(),
      ['com.instagram.android', 'com.twitter.android']
    );

    // User removes Instagram from Social Feeds group
    const updatedGroups = config.riskGroups.map((g) =>
      g.id === 'social' ? { ...g, appIds: ['com.twitter.android'] } : g
    );

    const effects = engine.updateConfiguration(
      {
        ...config,
        riskGroups: updatedGroups,
      },
      t0
    );

    // Emits CLEAR_RESTRICTIONS for Instagram immediately
    const clearEffect = effects.find((e) => e.type === 'CLEAR_RESTRICTIONS');
    assert.ok(clearEffect);
    if (clearEffect && clearEffect.type === 'CLEAR_RESTRICTIONS') {
      assert.deepEqual(clearEffect.appIds, ['com.instagram.android']);
    }
  });

  test('Reclassifying active Risk app to Essential during active session stops counting and clears restriction', () => {
    const t0 = new Date('2026-08-31T14:00:00').getTime();
    const engine = new RhythmEngine(config, null, t0);

    // Start session in X
    engine.dispatch({
      type: 'APP_FOREGROUND',
      appId: 'com.twitter.android',
      timestamp: t0,
    });
    assert.equal(engine.getRuntime().activeSession?.activeAppId, 'com.twitter.android');

    // Reclassify X to Essential
    const updatedApps = config.apps.map((a) =>
      a.id === 'com.twitter.android' ? { ...a, classification: 'essential' as const, riskGroupId: undefined } : a
    );
    const updatedGroups = config.riskGroups.map((g) =>
      g.id === 'social' ? { ...g, appIds: ['com.instagram.android'] } : g
    );

    engine.updateConfiguration({
      ...config,
      apps: updatedApps,
      riskGroups: updatedGroups,
    });

    // Active session no longer points to X
    assert.equal(engine.getRuntime().activeSession?.activeAppId, undefined);
    assert.equal(engine.getEffectiveRestrictedAppIds().includes('com.twitter.android'), false);
  });
});
