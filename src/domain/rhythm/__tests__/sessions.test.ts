import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { DeviceApp, RiskGroup } from '../../../types/domain';
import {
  createNewRiskSession,
  getAppRiskGroupId,
  isThresholdReached,
  recordActiveUsage,
  resumeRiskSession,
  shouldContinueSession,
} from '../sessions';
import { SESSION_RESET_GAP_MS } from '../types';

describe('Rhythm Engine — Continuous Risk Sessions & Inactivity Accounting', () => {
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

  const socialGroup: RiskGroup = {
    id: 'social',
    name: 'Social Feeds',
    description: 'Social scroll apps',
    iconName: 'message-square',
    iconColor: '#235D43',
    iconBg: '#E8EFE5',
    appIds: ['com.twitter.android', 'com.instagram.android'],
    sessionThresholdMinutes: 30,
    cooldownMinutes: 90,
    currentSessionMinutes: 0,
  };

  test('getAppRiskGroupId identifies group for risk apps and ignores essential apps', () => {
    assert.equal(getAppRiskGroupId('com.twitter.android', apps), 'social');
    assert.equal(getAppRiskGroupId('phone', apps), undefined);
    assert.equal(getAppRiskGroupId('unknown.app', apps), undefined);
  });

  test('shouldContinueSession allows switching between apps within the same group inside gap', () => {
    const t0 = 1000000;
    const session = createNewRiskSession('social', 'com.twitter.android', t0);

    // Switching to Instagram after 2 minutes (inside gap)
    const t1 = t0 + 2 * 60 * 1000;
    assert.equal(shouldContinueSession(session, 'social', t1), true);

    // Switching to YouTube (different group)
    assert.equal(shouldContinueSession(session, 'entertainment', t1), false);

    // Switching to Instagram after 6 minutes with app in background (gap exceeded)
    const backgroundedSession = { ...session, activeAppId: undefined };
    const t2 = t0 + (SESSION_RESET_GAP_MS + 1000);
    assert.equal(shouldContinueSession(backgroundedSession, 'social', t2), false);
  });

  test('Inactivity gap accounting: 10m X -> 4m Phone -> resume X preserves 10m usage', () => {
    const t0 = 1000000;
    // 1. User opens X
    let session = createNewRiskSession('social', 'com.twitter.android', t0);

    // 2. User spends 10 minutes in X
    const t1 = t0 + 10 * 60 * 1000;
    session = recordActiveUsage(session, 'com.twitter.android', t1);
    assert.equal(session.accumulatedSeconds, 600);

    // 3. User switches to Phone (4 minutes) -> X is backgrounded
    session = recordActiveUsage(session, undefined, t1); // active pointer unset
    assert.equal(session.accumulatedSeconds, 600);
    assert.equal(session.activeAppId, undefined);

    // 4. At 4 minutes later, user reopens X (inside 5m gap)
    const t2 = t1 + 4 * 60 * 1000;
    assert.equal(shouldContinueSession(session, 'social', t2), true);

    session = resumeRiskSession(session, 'com.twitter.android', t2);
    // Accumulated seconds MUST remain 600 (not 840)
    assert.equal(session.accumulatedSeconds, 600);
    assert.equal(session.activeAppId, 'com.twitter.android');

    // 5. User spends 5 more minutes in X
    const t3 = t2 + 5 * 60 * 1000;
    session = recordActiveUsage(session, 'com.twitter.android', t3);
    assert.equal(session.accumulatedSeconds, 900); // 15 minutes total
  });

  test('Inactivity gap exceeded: 10m X -> 6m Phone -> resume X triggers new session at 0', () => {
    const t0 = 1000000;
    let session = createNewRiskSession('social', 'com.twitter.android', t0);
    const t1 = t0 + 10 * 60 * 1000;
    session = recordActiveUsage(session, undefined, t1); // backgrounded

    // 6 minutes later (gap exceeded)
    const t2 = t1 + 6 * 60 * 1000;
    assert.equal(shouldContinueSession(session, 'social', t2), false);

    // New session starts at 0
    const newSession = createNewRiskSession('social', 'com.twitter.android', t2);
    assert.equal(newSession.accumulatedSeconds, 0);
  });

  test('Threshold reached evaluation', () => {
    const session = {
      groupId: 'social',
      startedAt: 0,
      lastActivityAt: 1800000,
      accumulatedSeconds: 1800, // 30 minutes
      activeAppId: 'com.twitter.android',
    };
    assert.equal(isThresholdReached(session, socialGroup), true);
  });
});
