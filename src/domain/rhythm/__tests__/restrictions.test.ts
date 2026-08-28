import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { DeviceApp, RiskGroup, RoutineWindow } from '../../../types/domain';
import { computeEffectiveRestrictions, diffRestrictions } from '../restrictions';
import { ActiveCooldown } from '../types';

describe('Rhythm Engine — Restriction Union & Invariants', () => {
  const apps: DeviceApp[] = [
    {
      id: 'phone',
      name: 'Phone',
      classification: 'essential', // Must NEVER be restricted
      iconName: 'phone',
      iconColor: '#2E7D32',
      iconBg: '#E8F5E9',
      defaultCategory: 'Communication',
      usageTodayMinutes: 10,
      sessionMinutes: 2,
    },
    {
      id: 'maps',
      name: 'Maps',
      classification: 'essential', // Must NEVER be restricted
      iconName: 'map',
      iconColor: '#1976D2',
      iconBg: '#E3F2FD',
      defaultCategory: 'Navigation',
      usageTodayMinutes: 5,
      sessionMinutes: 0,
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
    {
      id: 'youtube',
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
      description: 'Social scroll apps',
      iconName: 'message-square',
      iconColor: '#235D43',
      iconBg: '#E8EFE5',
      appIds: ['x', 'instagram', 'phone'], // Phone mistakenly in group
      sessionThresholdMinutes: 30,
      cooldownMinutes: 90,
      currentSessionMinutes: 0,
    },
    {
      id: 'entertainment',
      name: 'Entertainment',
      description: 'Streaming apps',
      iconName: 'film',
      iconColor: '#B27D2B',
      iconBg: '#FBF3E2',
      appIds: ['youtube', 'maps'], // Maps mistakenly in group
      sessionThresholdMinutes: 60,
      cooldownMinutes: 60,
      currentSessionMinutes: 0,
    },
  ];

  const activeWindow: RoutineWindow = {
    id: 'morning-buffer',
    name: 'Morning Buffer',
    type: 'morning-buffer',
    startTime: '06:30',
    endTime: '08:30',
    activeDays: [1, 2, 3, 4, 5, 6, 7],
    protectedGroupIds: ['social'],
    enabled: true,
    tagline: 'Unlock at 08:30',
    description: 'Buffer',
  };

  test('Essential apps (phone, maps) are strictly excluded from restrictions even if in group appIds', () => {
    const { effectiveAppIds, appRestrictions } = computeEffectiveRestrictions(
      [activeWindow],
      undefined,
      riskGroups,
      apps
    );

    assert.deepEqual(effectiveAppIds.sort(), ['instagram', 'x']);
    assert.equal(effectiveAppIds.includes('phone'), false);
    assert.equal(effectiveAppIds.includes('maps'), false);

    const xReasons = appRestrictions.find((r) => r.appId === 'x')?.reasons;
    assert.ok(xReasons);
    assert.equal(xReasons?.some((r) => r.type === 'routine'), true);
  });

  test('Overlapping routine and cooldown: union of reasons prevents accidental early unlocking', () => {
    const cooldown: ActiveCooldown = {
      groupId: 'social',
      startedAt: 1000,
      endsAt: 5000,
    };

    // Both Morning Buffer and Social Cooldown are active
    const { effectiveAppIds, appRestrictions } = computeEffectiveRestrictions(
      [activeWindow],
      cooldown,
      riskGroups,
      apps
    );

    const xRest = appRestrictions.find((r) => r.appId === 'x');
    assert.ok(xRest);
    // Has 2 reasons: routine and cooldown
    assert.equal(xRest?.reasons.length, 2);
    assert.equal(xRest?.reasons.some((r) => r.type === 'routine'), true);
    assert.equal(xRest?.reasons.some((r) => r.type === 'cooldown'), true);

    // Morning Buffer ends (now only cooldown is active)
    const { effectiveAppIds: nextEffective } = computeEffectiveRestrictions(
      [],
      cooldown,
      riskGroups,
      apps
    );

    const diff = diffRestrictions(effectiveAppIds, nextEffective);
    // Because cooldown is still active, 'x' and 'instagram' must NOT be cleared!
    assert.equal(diff.toClear.length, 0);
    assert.deepEqual(nextEffective.sort(), ['instagram', 'x']);
  });
});
