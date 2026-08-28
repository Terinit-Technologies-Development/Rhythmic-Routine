import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { DeviceApp, RiskGroup, RoutineWindow } from '../../../types/domain';
import { RhythmEngine } from '../RhythmEngine';
import { RhythmConfiguration } from '../types';

describe('Rhythm Engine — Full Engine Lifecycle & Effects', () => {
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
      id: 'x',
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
      id: 'instagram',
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
  ];

  const riskGroups: RiskGroup[] = [
    {
      id: 'social',
      name: 'Social Feeds',
      description: 'Social apps',
      iconName: 'message-square',
      iconColor: '#235D43',
      iconBg: '#E8EFE5',
      appIds: ['x', 'instagram'],
      sessionThresholdMinutes: 30,
      cooldownMinutes: 90,
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

  test('Full lifecycle: continuous usage triggers cooldown and applies restriction effects', () => {
    // Start engine at 14:00 (Open Day time)
    const t0 = new Date('2026-08-31T14:00:00').getTime();
    const engine = new RhythmEngine(config, null, t0);

    assert.equal(engine.getRuntime().state, 'available');
    assert.equal(engine.getEffectiveRestrictedAppIds().length, 0);

    // 1. User foregrounds X
    let effects = engine.dispatch({
      type: 'APP_FOREGROUND',
      appId: 'x',
      timestamp: t0,
    });
    assert.equal(engine.getRuntime().state, 'risk-session');
    assert.equal(engine.getRuntime().activeSession?.groupId, 'social');

    // 2. 18 minutes later, user switches to Instagram
    const t1 = t0 + 18 * 60 * 1000;
    effects = engine.dispatch({
      type: 'APP_FOREGROUND',
      appId: 'instagram',
      timestamp: t1,
    });
    assert.equal(engine.getRuntime().activeSession?.accumulatedSeconds, 18 * 60);

    // 3. 12 minutes later (total 30 minutes), Instagram continues session -> threshold reached!
    const t2 = t1 + 12 * 60 * 1000;
    effects = engine.dispatch({
      type: 'APP_FOREGROUND',
      appId: 'instagram',
      timestamp: t2,
    });

    // Cooldown should be initiated!
    assert.equal(engine.getRuntime().state, 'cooldown');
    assert.ok(engine.getRuntime().activeCooldown);
    assert.equal(engine.getRuntime().activeCooldown?.groupId, 'social');

    // Effects emitted must include START_COOLDOWN and APPLY_RESTRICTIONS for ['x', 'instagram'] (never 'phone')
    assert.equal(effects.some((e) => e.type === 'START_COOLDOWN'), true);
    const applyEffect = effects.find((e) => e.type === 'APPLY_RESTRICTIONS');
    assert.ok(applyEffect);
    if (applyEffect && applyEffect.type === 'APPLY_RESTRICTIONS') {
      assert.deepEqual(applyEffect.appIds.sort(), ['instagram', 'x']);
      assert.equal(applyEffect.appIds.includes('phone'), false);
    }

    // 4. Cooldown timer expires 90 minutes later
    const t3 = t2 + 90 * 60 * 1000 + 1000;
    const expiryEffects = engine.dispatch({
      type: 'CLOCK_TICK',
      timestamp: t3,
    });

    assert.equal(engine.getRuntime().state, 'available');
    assert.equal(engine.getRuntime().activeCooldown, undefined);

    const clearEffect = expiryEffects.find((e) => e.type === 'CLEAR_RESTRICTIONS');
    assert.ok(clearEffect);
    if (clearEffect && clearEffect.type === 'CLEAR_RESTRICTIONS') {
      assert.deepEqual(clearEffect.appIds.sort(), ['instagram', 'x']);
    }
  });

  test('Inactivity gap timeout ends session without triggering cooldown if under threshold', () => {
    const t0 = new Date('2026-08-31T14:00:00').getTime();
    const engine = new RhythmEngine(config, null, t0);

    // User uses X for 5 minutes
    engine.dispatch({
      type: 'APP_FOREGROUND',
      appId: 'x',
      timestamp: t0,
    });
    engine.dispatch({
      type: 'APP_BACKGROUND',
      appId: 'x',
      timestamp: t0 + 5 * 60 * 1000,
    });

    // 10 minutes of inactivity pass (exceeds 5m gap)
    const t1 = t0 + 15 * 60 * 1000;
    engine.dispatch({
      type: 'CLOCK_TICK',
      timestamp: t1,
    });

    // Session is closed and state is back to available
    assert.equal(engine.getRuntime().activeSession, undefined);
    assert.equal(engine.getRuntime().state, 'available');
  });
});
