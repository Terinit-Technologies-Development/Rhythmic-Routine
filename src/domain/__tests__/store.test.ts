import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { usePrototypeStore } from '../../store/usePrototypeStore';
import {
  getOpenDayRange,
  getRoutineTargetTime,
  getRoutineWindow,
  getProtectedWindowIdsForGroup,
  getRestrictableAppIds,
} from '../selectors';
import { getPlatformServices } from '../../platform/PlatformServices';
import { RhythmCoordinator } from '../../application/RhythmCoordinator';

describe('Zustand Store Reconciliation Integration Tests', () => {
  test('Routine Propagation: Morning Buffer unlock editing propagates dynamically', () => {
    const store = usePrototypeStore.getState();

    // Change Morning Buffer unlock time to 08:30
    store.updateRoutineWindow('morning-buffer', { endTime: '08:30' });

    const updatedWindows = usePrototypeStore.getState().routineWindows;
    const morning = getRoutineWindow(updatedWindows, 'morning-buffer');

    assert.ok(morning);
    assert.equal(morning?.endTime, '08:30');
    assert.equal(getRoutineTargetTime(morning!), '08:30');
  });

  test('Routine Propagation: Evening Wind-Down editing propagates dynamically', () => {
    const store = usePrototypeStore.getState();

    // Change Evening Wind-Down time to 22:00
    store.updateRoutineWindow('evening-wind-down', { startTime: '22:00' });

    const updatedWindows = usePrototypeStore.getState().routineWindows;
    const evening = getRoutineWindow(updatedWindows, 'evening-wind-down');

    assert.ok(evening);
    assert.equal(evening?.startTime, '22:00');
    assert.equal(getRoutineTargetTime(evening!), '22:00');
  });

  test('Open Day Boundary Adjacency: Open Day range is cleanly derived from adjacent boundaries', () => {
    const store = usePrototypeStore.getState();

    // Set Morning Buffer unlock to 08:30 and Evening Wind-Down to 22:00
    store.updateRoutineWindow('morning-buffer', { endTime: '08:30' });
    store.updateRoutineWindow('evening-wind-down', { startTime: '22:00' });

    const updatedWindows = usePrototypeStore.getState().routineWindows;
    const openRange = getOpenDayRange(updatedWindows);

    assert.deepEqual(openRange, {
      start: '08:30',
      end: '22:00',
    });
  });

  test('Risk Group threshold and cooldown propagation', () => {
    const store = usePrototypeStore.getState();

    store.updateRiskGroup('social', {
      sessionThresholdMinutes: 45,
      cooldownMinutes: 120,
    });

    const social = usePrototypeStore.getState().riskGroups.find((g) => g.id === 'social');
    assert.ok(social);
    assert.equal(social?.sessionThresholdMinutes, 45);
    assert.equal(social?.cooldownMinutes, 120);
  });

  test('Custom Risk Group creation with unique ID', () => {
    const store = usePrototypeStore.getState();

    const id1 = store.addNewRiskGroup('News Feeds', 'Daily news feeds');
    assert.equal(id1, 'news-feeds');

    const id2 = store.addNewRiskGroup('News Feeds', 'Duplicate name test');
    assert.equal(id2, 'news-feeds-2');

    const createdGroup = usePrototypeStore.getState().riskGroups.find((g) => g.id === 'news-feeds');
    assert.ok(createdGroup);
    assert.equal(createdGroup?.name, 'News Feeds');
  });

  test('Relationship Integrity: toggleGroupProtection syncs canonically', () => {
    const store = usePrototypeStore.getState();

    // Protect 'news-feeds' in 'morning-buffer'
    store.toggleGroupProtection('morning-buffer', 'news-feeds', true);
    let windows = usePrototypeStore.getState().routineWindows;
    let protectedIds = getProtectedWindowIdsForGroup(windows, 'news-feeds');
    assert.equal(protectedIds.includes('morning-buffer'), true);

    // Unprotect 'news-feeds' from 'morning-buffer'
    store.toggleGroupProtection('morning-buffer', 'news-feeds', false);
    windows = usePrototypeStore.getState().routineWindows;
    protectedIds = getProtectedWindowIdsForGroup(windows, 'news-feeds');
    assert.equal(protectedIds.includes('morning-buffer'), false);
  });

  test('Essential-App Safety: Reclassifying Risk app to Essential removes it from all Risk Groups', () => {
    const store = usePrototypeStore.getState();

    // Reclassify 'x' from risk to essential
    store.updateAppClassification('x', 'essential');

    const updatedApps = usePrototypeStore.getState().apps;
    const updatedGroups = usePrototypeStore.getState().riskGroups;

    const xApp = updatedApps.find((a) => a.id === 'x');
    assert.equal(xApp?.classification, 'essential');
    assert.equal(xApp?.riskGroupId, undefined);

    // Assert 'x' is removed from social risk group appIds
    const socialGroup = updatedGroups.find((g) => g.id === 'social');
    assert.equal(socialGroup?.appIds.includes('x'), false);

    // Assert restrictable apps excludes 'x'
    const restrictable = getRestrictableAppIds(['x', 'instagram'], updatedApps);
    assert.equal(restrictable.includes('x'), false);
    assert.equal(restrictable.includes('instagram'), true);
  });

  test('Centralized Timer & Expiry: resolveExpiredTimer clears restrictions and resets state', async () => {
    const store = usePrototypeStore.getState();
    const originalRoutines = store.routineWindows;
    const coordinator = RhythmCoordinator.getInstance();

    // Temporarily disable routine windows so the test is deterministic regardless of wall-clock hour
    const disabledRoutines = originalRoutines.map((r) => ({ ...r, enabled: false }));
    await coordinator.updateConfig({ routineWindows: disabledRoutines });
    usePrototypeStore.setState({
      routineWindows: disabledRoutines,
      rhythmState: 'cooldown',
      activeRiskGroupId: 'social',
      activeTimerEndsAt: Date.now() - 10000,
    });

    await store.resolveExpiredTimer();

    const finalState = usePrototypeStore.getState();
    assert.equal(finalState.rhythmState, 'available');
    assert.equal(finalState.activeTimerEndsAt, undefined);

    const { restrictions } = getPlatformServices();
    const restrictedAppIds = await restrictions.getActiveRestrictedApps();
    assert.equal(restrictedAppIds.length, 0);

    // Restore routines
    await coordinator.updateConfig({ routineWindows: originalRoutines });
    usePrototypeStore.setState({ routineWindows: originalRoutines });
  });
});
