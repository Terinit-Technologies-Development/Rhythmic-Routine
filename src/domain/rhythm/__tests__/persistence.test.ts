import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalStorageProvider } from '../../../platform/storage/LocalStorageProvider';
import { MockStorageProvider } from '../../../platform/storage/MockStorageProvider';
import { PersistedRuntime, RhythmHistoryEvent, RhythmPreferences } from '../types';
import { initialRiskGroups, initialRoutineWindows } from '../../../data/mockData';

describe('Rhythm Engine — Local Persistence Adapter', () => {
  const preferences: RhythmPreferences = {
    routineWindows: initialRoutineWindows,
    riskGroups: initialRiskGroups,
    appClassifications: {
      x: { classification: 'risk', riskGroupId: 'social' },
      phone: { classification: 'essential' },
    },
    sessionResetGapMs: 5 * 60 * 1000,
    onboardingCompleted: true,
  };

  const runtime: PersistedRuntime = {
    state: 'cooldown',
    activeCooldown: {
      groupId: 'social',
      startedAt: 1700000000000,
      endsAt: 1700005400000,
    },
    activeRoutineWindowIds: [],
    lastReconciledAt: 1700000000000,
  };

  test('MockStorageProvider saves and loads preferences and runtime', async () => {
    const storage = new MockStorageProvider();

    assert.equal(await storage.loadPreferences(), null);
    await storage.savePreferences(preferences);
    const loadedPrefs = await storage.loadPreferences();
    assert.deepEqual(loadedPrefs, preferences);

    await storage.saveRuntime(runtime);
    const loadedRuntime = await storage.loadRuntime();
    assert.deepEqual(loadedRuntime, runtime);
  });

  test('LocalStorageProvider persists absolute timestamps and history events', async () => {
    const storage = new LocalStorageProvider();
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
});
