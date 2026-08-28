import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { DeviceApp, RiskGroup } from '../../../types/domain';
import {
  getAppRiskGroupId,
  shouldContinueSession,
  createNewRiskSession,
  recordSessionActivity,
  isThresholdReached,
} from '../sessions';
import { SESSION_RESET_GAP_MS } from '../types';

describe('Rhythm Engine — Continuous Risk Sessions', () => {
  const apps: DeviceApp[] = [
    {
      id: 'x',
      name: 'X',
      classification: 'risk',
      riskGroupId: 'social',
      iconName: 'x',
      iconColor: '#000',
      iconBg: '#eee',
      defaultCategory: 'Social',
      usageTodayMinutes: 20,
      sessionMinutes: 10,
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
      usageTodayMinutes: 15,
      sessionMinutes: 5,
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
      usageTodayMinutes: 30,
      sessionMinutes: 20,
    },
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
  ];

  const socialGroup: RiskGroup = {
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
  };

  test('getAppRiskGroupId identifies group for risk apps and ignores essential apps', () => {
    assert.equal(getAppRiskGroupId('x', apps), 'social');
    assert.equal(getAppRiskGroupId('instagram', apps), 'social');
    assert.equal(getAppRiskGroupId('youtube', apps), 'entertainment');
    assert.equal(getAppRiskGroupId('phone', apps), undefined);
  });

  test('shouldContinueSession allows switching between apps within the same group inside gap', () => {
    const t0 = 1000000;
    const session = createNewRiskSession('social', 'x', t0);

    // Switching to Instagram 30 seconds later (same group, under 5m gap)
    const t1 = t0 + 30 * 1000;
    assert.equal(shouldContinueSession(session, 'social', t1), true);

    // Switching to YouTube (different group)
    assert.equal(shouldContinueSession(session, 'entertainment', t1), false);

    // Switching to Instagram after 6 minutes with app in background (gap exceeded)
    const backgroundedSession = { ...session, activeAppId: undefined };
    const t2 = t0 + (SESSION_RESET_GAP_MS + 1000);
    assert.equal(shouldContinueSession(backgroundedSession, 'social', t2), false);
  });

  test('X then Instagram accumulates into a single continuous Social Feeds session', () => {
    const t0 = 1700000000000;
    let session = createNewRiskSession('social', 'x', t0);

    // User uses X for 18 minutes (1080 seconds)
    const t1 = t0 + 18 * 60 * 1000;
    session = recordSessionActivity(session, 'x', t1);
    assert.equal(session.accumulatedSeconds, 1080);
    assert.equal(isThresholdReached(session, socialGroup), false);

    // User switches to Instagram immediately and uses it for 12 minutes (720 seconds)
    const t2 = t1 + 12 * 60 * 1000;
    session = recordSessionActivity(session, 'instagram', t2);
    assert.equal(session.accumulatedSeconds, 1800); // 18 + 12 = 30 minutes total!

    // 30 min threshold reached!
    assert.equal(isThresholdReached(session, socialGroup), true);
  });
});
