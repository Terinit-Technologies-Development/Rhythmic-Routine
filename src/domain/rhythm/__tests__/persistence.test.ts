import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { WebStorageProvider } from '../../../platform/storage/WebStorageProvider';
import { MockStorageProvider } from '../../../platform/storage/MockStorageProvider';
import { PersistedRuntime, RhythmHistoryEvent, RhythmPreferences, normalizePersistedRuntime } from '../types';
import { initialRiskGroups, initialRoutineWindows } from '../../../data/mockData';

describe('Rhythm Engine — Local Persistence Adapter & Migration', () => {
  const preferences: RhythmPreferences = {
    routineWindows: initialRoutineWindows,
    riskGroups: initialRiskGroups,
    appClassifications: {
      'com.twitter.android': { classification: 'risk', riskGroupId: 'social' },
      phone: { classification: 'essential' },
    },
    sessionResetGapMs: 5 * 60 * 1000,
    onboardingCompleted: true,
  };

  const runtime: PersistedRuntime = {
    state: 'cooldown',
    activeCooldowns: {
      social: {
        groupId: 'social',
        startedAt: 1700000000000,
        endsAt: 1700005400000,
      },
    },
    activeAccessLeases: {},
    activeRoutineWindowIds: [],
    lastReconciledAt: 1700000000000,
  };

  test('MockStorageProvider saves and loads preferences and multi-cooldown runtime', async () => {
    const storage = new MockStorageProvider();

    assert.equal(await storage.loadPreferences(), null);
    await storage.savePreferences(preferences);
    const loadedPrefs = await storage.loadPreferences();
    assert.deepEqual(loadedPrefs, preferences);

    await storage.saveRuntime(runtime);
    const loadedRuntime = await storage.loadRuntime();
    assert.deepEqual(loadedRuntime, runtime);
  });

  test('WebStorageProvider persists absolute timestamps and history events', async () => {
    const storage = new WebStorageProvider();
    await storage.clearAll();

    await storage.savePreferences(preferences);
    const loadedPrefs = await storage.loadPreferences();
    assert.deepEqual(loadedPrefs, preferences);

    await storage.saveRuntime(runtime);
    const loadedRuntime = await storage.loadRuntime();
    assert.deepEqual(loadedRuntime, runtime);

    const historyEvent: RhythmHistoryEvent = {
      type: 'cooldown-started',
      groupId: 'social',
      timestamp: 1700000000000,
    };
    await storage.appendHistoryEvent(historyEvent);
    const events = await storage.getHistoryEvents();
    assert.equal(events.length, 1);
    assert.deepEqual(events[0], historyEvent);
  });

  test('normalizePersistedRuntime cleanly migrates legacy single activeCooldown', () => {
    const legacyRaw = {
      state: 'cooldown',
      activeCooldown: {
        groupId: 'social',
        startedAt: 1700000000000,
        endsAt: 1700005400000,
      },
      activeRoutineWindowIds: ['morning-buffer'],
      lastReconciledAt: 1700000000000,
    };

    const normalized = normalizePersistedRuntime(legacyRaw);
    assert.ok(normalized);
    assert.equal(normalized?.activeCooldowns.social.groupId, 'social');
    assert.equal(normalized?.activeCooldowns.social.endsAt, 1700005400000);
    assert.equal(normalized?.state, 'cooldown');
  });
});
