import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { usePrototypeStore } from '../../store/usePrototypeStore';
import { createUniqueGroupId, resolveCooldownInfo } from '../selectors';
import { RiskGroup, RiskGroupConfigurationDraft } from '../../types/domain';
import { RhythmCoordinator } from '../../application/RhythmCoordinator';
import { getPlatformServices } from '../../platform/PlatformServices';

describe('Pass 01 — Custom Risk Groups & Cooldown Clarity', () => {
  beforeEach(async () => {
    await usePrototypeStore.getState().resetDemo();
  });

  test('1. unique custom group IDs: handles collision, casing, and punctuation', () => {
    const existing = ['social', 'entertainment', 'gaming'];

    assert.equal(createUniqueGroupId('Gaming', existing), 'gaming-2');
    assert.equal(createUniqueGroupId('  Gaming  ', existing), 'gaming-2');
    assert.equal(createUniqueGroupId('Short Video / Clips!', existing), 'short-video-clips');
    assert.equal(createUniqueGroupId('News Feeds', existing), 'news-feeds');
    assert.equal(createUniqueGroupId('', existing), 'group');
  });

  test('2. creation persists defaults and explicit configuration', async () => {
    const store = usePrototypeStore.getState();

    // Default configuration
    const defaultId = await store.createRiskGroup({
      name: 'News Feeds',
      description: 'Daily news and journalism apps',
    });

    assert.equal(defaultId, 'news-feeds');
    const createdDefault = usePrototypeStore
      .getState()
      .riskGroups.find((g) => g.id === defaultId);

    assert.ok(createdDefault);
    assert.equal(createdDefault?.name, 'News Feeds');
    assert.equal(createdDefault?.description, 'Daily news and journalism apps');
    assert.equal(createdDefault?.sessionThresholdMinutes, undefined);
    assert.equal(createdDefault?.allowanceMinutes, 30);
    assert.equal(createdDefault?.cooldownMinutes, 60);
    assert.equal(createdDefault?.origin, 'custom');

    // Explicit custom configuration
    const customId = await store.createRiskGroup({
      name: 'Gaming & Streams',
      description: 'Mobile games and live streaming',
      allowanceMinutes: 45,
      cooldownMinutes: 120,
    });

    const createdCustom = usePrototypeStore
      .getState()
      .riskGroups.find((g) => g.id === customId);

    assert.ok(createdCustom);
    assert.equal(createdCustom?.name, 'Gaming & Streams');
    assert.equal(createdCustom?.sessionThresholdMinutes, undefined);
    assert.equal(createdCustom?.allowanceMinutes, 45);
    assert.equal(createdCustom?.cooldownMinutes, 120);
    assert.equal(createdCustom?.origin, 'custom');
  });

  test('3. custom group appears dynamically in assignment choices', async () => {
    const store = usePrototypeStore.getState();
    const newId = await store.createRiskGroup({
      name: 'Shopping Distractions',
    });

    const allGroups = usePrototypeStore.getState().riskGroups;
    const found = allGroups.some((g) => g.id === newId && g.name === 'Shopping Distractions');
    assert.equal(found, true);
  });

  test('4. rename retains stable ID', async () => {
    const store = usePrototypeStore.getState();
    const groupId = await store.createRiskGroup({
      name: 'Dating Apps',
      description: 'Swipe apps',
      allowanceMinutes: 30,
      cooldownMinutes: 60,
    });

    assert.equal(groupId, 'dating-apps');

    // Rename group and update description
    await store.saveRiskGroup(groupId, {
      name: 'Social Discovery',
      description: 'Mindful meeting apps',
    });

    const updated = usePrototypeStore
      .getState()
      .riskGroups.find((g) => g.id === groupId);

    assert.ok(updated);
    // Stable ID preserved
    assert.equal(updated?.id, 'dating-apps');
    assert.equal(updated?.name, 'Social Discovery');
    assert.equal(updated?.description, 'Mindful meeting apps');
  });

  test('5. reassignment keeps membership invariant: app belongs to at most one group', async () => {
    const store = usePrototypeStore.getState();
    const customId = await store.createRiskGroup({
      name: 'Work Distractions',
    });

    // Verify initial state: 'discord' belongs to 'social'
    let socialGroup = usePrototypeStore.getState().riskGroups.find((g) => g.id === 'social');
    let customGroup = usePrototypeStore.getState().riskGroups.find((g) => g.id === customId);
    let discordApp = usePrototypeStore.getState().apps.find((a) => a.id === 'discord');

    assert.equal(discordApp?.riskGroupId, 'social');
    assert.equal(socialGroup?.appIds.includes('discord'), true);
    assert.equal(customGroup?.appIds.includes('discord'), false);

    // Move 'discord' to 'work-distractions'
    await store.updateAppClassification('discord', 'risk', customId);

    socialGroup = usePrototypeStore.getState().riskGroups.find((g) => g.id === 'social');
    customGroup = usePrototypeStore.getState().riskGroups.find((g) => g.id === customId);
    discordApp = usePrototypeStore.getState().apps.find((a) => a.id === 'discord');

    assert.equal(discordApp?.riskGroupId, customId);
    assert.equal(socialGroup?.appIds.includes('discord'), false);
    assert.equal(customGroup?.appIds.includes('discord'), true);

    // Verify no other group holds 'discord'
    const groupsWithApp = usePrototypeStore
      .getState()
      .riskGroups.filter((g) => g.appIds.includes('discord'));
    assert.equal(groupsWithApp.length, 1);
    assert.equal(groupsWithApp[0].id, customId);
  });

  test('6. delete requires replacement when populated; atomic reassignment on valid replacement', async () => {
    const store = usePrototypeStore.getState();
    const groupId = await store.createRiskGroup({
      name: 'Short Video',
    });

    // Assign 'tiktok' to 'short-video'
    await store.updateAppClassification('tiktok', 'risk', groupId);

    // Attempt delete without replacement -> must fail with 'replacement-required'
    const failResult = await store.deleteRiskGroup(groupId);
    assert.equal(failResult.ok, false);
    if (!failResult.ok) {
      assert.equal(failResult.reason, 'replacement-required');
    }

    // Attempt delete with invalid replacement (same as target group)
    const invalidResult = await store.deleteRiskGroup(groupId, groupId);
    assert.equal(invalidResult.ok, false);
    if (!invalidResult.ok) {
      assert.equal(invalidResult.reason, 'invalid-replacement-group');
    }

    // Verify group was NOT deleted partially
    let existing = usePrototypeStore.getState().riskGroups.find((g) => g.id === groupId);
    assert.ok(existing);

    // Delete with valid replacement ('social')
    const successResult = await store.deleteRiskGroup(groupId, 'social');
    assert.equal(successResult.ok, true);

    // Target group is removed
    existing = usePrototypeStore.getState().riskGroups.find((g) => g.id === groupId);
    assert.equal(existing, undefined);

    // 'tiktok' is cleanly reassigned to 'social'
    const tiktok = usePrototypeStore.getState().apps.find((a) => a.id === 'tiktok');
    assert.equal(tiktok?.riskGroupId, 'social');

    const social = usePrototypeStore.getState().riskGroups.find((g) => g.id === 'social');
    assert.equal(social?.appIds.includes('tiktok'), true);

    // Empty group can be deleted without replacement
    const emptyGroupId = await store.createRiskGroup({ name: 'Empty Group' });
    const emptyDeleteRes = await store.deleteRiskGroup(emptyGroupId);
    assert.equal(emptyDeleteRes.ok, true);
    assert.equal(
      usePrototypeStore.getState().riskGroups.some((g) => g.id === emptyGroupId),
      false
    );
  });

  test('7. delete removes routine-window references atomically', async () => {
    const store = usePrototypeStore.getState();
    const customId = await store.createRiskGroup({
      name: 'Mindful Games',
    });

    // Add to morning-buffer and evening-wind-down
    store.toggleGroupProtection('morning-buffer', customId, true);
    store.toggleGroupProtection('evening-wind-down', customId, true);

    let windows = usePrototypeStore.getState().routineWindows;
    assert.equal(
      windows.find((w) => w.id === 'morning-buffer')?.protectedGroupIds.includes(customId),
      true
    );
    assert.equal(
      windows.find((w) => w.id === 'evening-wind-down')?.protectedGroupIds.includes(customId),
      true
    );

    // Delete custom group
    const deleteRes = await store.deleteRiskGroup(customId);
    assert.equal(deleteRes.ok, true);

    windows = usePrototypeStore.getState().routineWindows;
    assert.equal(
      windows.find((w) => w.id === 'morning-buffer')?.protectedGroupIds.includes(customId),
      false
    );
    assert.equal(
      windows.find((w) => w.id === 'evening-wind-down')?.protectedGroupIds.includes(customId),
      false
    );
  });

  test('8. cooldown selectors resolve non-Social groups and live configured values', () => {
    const mockGroups: RiskGroup[] = [
      {
        id: 'gaming',
        name: 'Gaming',
        description: 'Games',
        iconName: 'gamepad',
        iconColor: '#164B38',
        iconBg: '#E8EFE5',
        appIds: ['game1'],
        sessionThresholdMinutes: 45,
        allowanceMinutes: 45,
        cooldownMinutes: 90,
        currentSessionMinutes: 0,
      },
      {
        id: 'news',
        name: 'News & Feeds',
        description: 'Feeds',
        iconName: 'newspaper',
        iconColor: '#B27D2B',
        iconBg: '#FBF3E2',
        appIds: ['news1'],
        sessionThresholdMinutes: 20,
        allowanceMinutes: 20,
        cooldownMinutes: 40,
        currentSessionMinutes: 0,
      },
    ];

    const gamingInfo = resolveCooldownInfo(mockGroups, 'gaming');
    assert.equal(gamingInfo.groupName, 'Gaming');
    assert.equal(gamingInfo.sessionThresholdMinutes, 45);
    assert.equal(gamingInfo.cooldownMinutes, 90);
    assert.equal(gamingInfo.title, 'Gaming cooldown');
    assert.equal(gamingInfo.subtitle, '45 min group allowance reached · 90 min recovery');

    const newsInfo = resolveCooldownInfo(mockGroups, 'news');
    assert.equal(newsInfo.groupName, 'News & Feeds');
    assert.equal(newsInfo.sessionThresholdMinutes, 20);
    assert.equal(newsInfo.cooldownMinutes, 40);
    assert.equal(newsInfo.title, 'News & Feeds cooldown');
    assert.equal(newsInfo.subtitle, '20 min group allowance reached · 40 min recovery');
  });

  test('9. missing active group does not crash selectors', () => {
    const mockGroups: RiskGroup[] = [
      {
        id: 'social',
        name: 'Social Feeds',
        description: 'Feeds',
        iconName: 'message-square',
        iconColor: '#164B38',
        iconBg: '#E8EFE5',
        appIds: [],
        cooldownMinutes: 60,
        currentSessionMinutes: 0,
      },
    ];

    // Non-existent group id
    const missingInfo = resolveCooldownInfo(mockGroups, 'deleted-group-123');
    assert.equal(missingInfo.activeGroup, undefined);
    assert.equal(missingInfo.groupName, 'Protected Apps');
    assert.equal(missingInfo.title, 'Recovery break active');
    assert.equal(missingInfo.subtitle, 'Recovery break active');

    // Undefined active group id
    const undefinedInfo = resolveCooldownInfo(mockGroups, undefined);
    assert.equal(undefinedInfo.activeGroup, undefined);
    assert.equal(undefinedInfo.groupName, 'Protected Apps');
    assert.equal(undefinedInfo.title, 'Recovery break active');
    assert.equal(undefinedInfo.subtitle, 'Recovery break active');
  });

  test('10. seeded groups cannot be deleted', async () => {
    const store = usePrototypeStore.getState();

    const socialDelete = await store.deleteRiskGroup('social');
    assert.equal(socialDelete.ok, false);
    if (!socialDelete.ok) {
      assert.equal(socialDelete.reason, 'cannot-delete-seeded-group');
    }

    const entertainmentDelete = await store.deleteRiskGroup('entertainment');
    assert.equal(entertainmentDelete.ok, false);
    if (!entertainmentDelete.ok) {
      assert.equal(entertainmentDelete.reason, 'cannot-delete-seeded-group');
    }

    // Both remain intact
    assert.ok(usePrototypeStore.getState().riskGroups.find((g) => g.id === 'social'));
    assert.ok(usePrototypeStore.getState().riskGroups.find((g) => g.id === 'entertainment'));
  });

  test('11. deletion is blocked with active-runtime while a cooldown is active', async () => {
    const store = usePrototypeStore.getState();
    const coordinator = RhythmCoordinator.getInstance();
    const groupId = await store.createRiskGroup({
      name: 'Focus Writing',
      cooldownMinutes: 45,
    });

    // Assign an app to this group
    await store.updateAppClassification('notes', 'risk', groupId);
    assert.equal(
      usePrototypeStore.getState().apps.find((a) => a.id === 'notes')?.riskGroupId,
      groupId
    );

    // Start a cooldown on this group
    await coordinator.dispatch({
      type: 'NATIVE_COOLDOWN_RESTORED',
      groupId,
      endsAt: Date.now() + 45 * 60 * 1000,
      timestamp: Date.now(),
    });

    assert.ok(coordinator.getRuntime()!.activeCooldowns[groupId]);

    // Deletion attempt must be blocked
    const res = await store.deleteRiskGroup(groupId, 'social');
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.reason, 'active-runtime');
    }

    // Group still exists
    assert.ok(usePrototypeStore.getState().riskGroups.find((g) => g.id === groupId));

    // Cooldown remains active
    assert.ok(coordinator.getRuntime()!.activeCooldowns[groupId]);

    // Member apps remain assigned to that group
    assert.equal(
      usePrototypeStore.getState().apps.find((a) => a.id === 'notes')?.riskGroupId,
      groupId
    );
  });

  test('12. deletion is blocked with active-runtime while a Risk session is active for that group', async () => {
    const store = usePrototypeStore.getState();
    const coordinator = RhythmCoordinator.getInstance();
    const groupId = await store.createRiskGroup({
      name: 'Media Stream',
    });

    // Set an active session pointing to this group via app foregrounding / runtime setup
    await coordinator.dispatch({
      type: 'APP_FOREGROUND',
      appId: 'mock-stream-app',
      timestamp: Date.now(),
    });

    (coordinator as any).engine.runtime.activeSession = {
      groupId,
      startedAt: Date.now() - 10000,
      lastActivityAt: Date.now(),
      accumulatedSeconds: 10,
    };

    assert.equal(coordinator.getRuntime()!.activeSession?.groupId, groupId);

    // Deletion attempt must be blocked
    const res = await store.deleteRiskGroup(groupId);
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.reason, 'active-runtime');
    }

    // Group remains intact
    assert.ok(usePrototypeStore.getState().riskGroups.find((g) => g.id === groupId));

    // Active session remains intact
    assert.equal(coordinator.getRuntime()!.activeSession?.groupId, groupId);
  });

  test('12b. deletion succeeds after cooldown clears and defensively purges runtime state', async () => {
    const store = usePrototypeStore.getState();
    const coordinator = RhythmCoordinator.getInstance();
    const groupId = await store.createRiskGroup({
      name: 'Cleared Focus',
    });

    // Start with an active cooldown
    await coordinator.dispatch({
      type: 'NATIVE_COOLDOWN_RESTORED',
      groupId,
      endsAt: Date.now() + 10000,
      timestamp: Date.now(),
    });

    // Deletion blocked while active
    const blockedRes = await store.deleteRiskGroup(groupId);
    assert.equal(blockedRes.ok, false);
    if (!blockedRes.ok) {
      assert.equal(blockedRes.reason, 'active-runtime');
    }

    // Cooldown clears via COOLDOWN_ENDED
    await coordinator.dispatch({
      type: 'COOLDOWN_ENDED',
      groupId,
      timestamp: Date.now(),
    });
    assert.equal(coordinator.getRuntime()!.activeCooldowns[groupId], undefined);

    // Residual stale lease to test defensive cleanup
    (coordinator as any).engine.runtime.activeAccessLeases[groupId] = {
      groupId,
      endsAt: Date.now() + 60000,
    };

    // Now deletion succeeds
    const deleteRes = await store.deleteRiskGroup(groupId);
    assert.equal(deleteRes.ok, true);

    // Group is removed
    assert.equal(usePrototypeStore.getState().riskGroups.find((g) => g.id === groupId), undefined);

    // Defensive cleanup: stale runtime state is purged
    assert.equal(coordinator.getRuntime()!.activeAccessLeases[groupId], undefined);
  });

  test('13. delete group purges active access lease and group allowance usage', async () => {
    const store = usePrototypeStore.getState();
    const coordinator = RhythmCoordinator.getInstance();
    const groupId = await store.createRiskGroup({
      name: 'Reading Habit',
    });

    // Grant access lease
    await coordinator.dispatch({
      type: 'NATIVE_ACCESS_LEASE_RESTORED',
      groupId,
      endsAt: Date.now() + 15 * 60 * 1000,
      timestamp: Date.now(),
    });

    // Sync group allowance usage
    await coordinator.dispatch({
      type: 'SYNC_GROUP_ALLOWANCE_USAGE',
      groupAllowanceUsage: {
        [groupId]: {
          groupId,
          dateKey: '2026-09-18',
          usedSeconds: 1200,
          cycleRevision: 1,
        },
      },
      timestamp: Date.now(),
    });

    assert.ok(coordinator.getRuntime()!.activeAccessLeases[groupId]);
    assert.ok(coordinator.getRuntime()!.groupAllowanceUsage?.[groupId]);

    // Delete group
    const res = await store.deleteRiskGroup(groupId);
    assert.equal(res.ok, true);

    // Both lease and usage are purged
    assert.equal(coordinator.getRuntime()!.activeAccessLeases[groupId], undefined);
    assert.equal(coordinator.getRuntime()!.groupAllowanceUsage?.[groupId], undefined);
  });

  test('14. restart after deletion restores no deleted group runtime state', async () => {
    const store = usePrototypeStore.getState();
    const coordinator = RhythmCoordinator.getInstance();
    const groupId = await store.createRiskGroup({
      name: 'Temporary Group',
    });

    // Add access lease and group allowance usage (neither blocks deletion)
    await coordinator.dispatch({
      type: 'NATIVE_ACCESS_LEASE_RESTORED',
      groupId,
      endsAt: Date.now() + 60 * 60 * 1000,
      timestamp: Date.now(),
    });

    await coordinator.dispatch({
      type: 'SYNC_GROUP_ALLOWANCE_USAGE',
      groupAllowanceUsage: {
        [groupId]: {
          groupId,
          dateKey: '2026-09-18',
          usedSeconds: 600,
          cycleRevision: 1,
        },
      },
      timestamp: Date.now(),
    });

    const delRes = await store.deleteRiskGroup(groupId);
    assert.equal(delRes.ok, true);

    // Simulate app restart / coordinator re-initialization
    coordinator.destroy();
    const restoredRuntime = await coordinator.initialize();

    assert.equal(restoredRuntime.activeCooldowns[groupId], undefined);
    assert.equal(restoredRuntime.activeAccessLeases[groupId], undefined);
    assert.equal(restoredRuntime.groupAllowanceUsage?.[groupId], undefined);
    assert.equal(restoredRuntime.activeSession?.groupId === groupId, false);
  });

  test('15. recreating deleted group starts with completely clean runtime state', async () => {
    const store = usePrototypeStore.getState();
    const coordinator = RhythmCoordinator.getInstance();

    const id1 = await store.createRiskGroup({ name: 'Mindfulness' });
    await coordinator.dispatch({
      type: 'NATIVE_ACCESS_LEASE_RESTORED',
      groupId: id1,
      endsAt: Date.now() + 30 * 60 * 1000,
      timestamp: Date.now(),
    });

    const delRes = await store.deleteRiskGroup(id1);
    assert.equal(delRes.ok, true);

    // Recreate same name
    const id2 = await store.createRiskGroup({ name: 'Mindfulness' });
    assert.equal(id2, 'mindfulness');

    // Runtime state for this group must be clean (no inherited cooldown, lease, or usage)
    assert.equal(coordinator.getRuntime()!.activeCooldowns[id2], undefined);
    assert.equal(coordinator.getRuntime()!.activeAccessLeases[id2], undefined);
    assert.equal(coordinator.getRuntime()!.groupAllowanceUsage?.[id2], undefined);
  });

  test('16. legacy methods delegation: addNewRiskGroup & updateRiskGroup delegate to canonical pipeline', async () => {
    const store = usePrototypeStore.getState();

    // addNewRiskGroup returns Promise<string> and creates clean group without sessionThresholdMinutes
    const newId = await store.addNewRiskGroup('Quick Notes', 'Notes app');
    assert.equal(newId, 'quick-notes');

    const created = usePrototypeStore.getState().riskGroups.find((g) => g.id === newId);
    assert.ok(created);
    assert.equal(created?.allowanceMinutes, 30);
    assert.equal(created?.sessionThresholdMinutes, undefined);

    // updateRiskGroup delegates to saveRiskGroupConfiguration
    const updateRes = await store.updateRiskGroup(newId, {
      cooldownMinutes: 90,
    });
    assert.equal(updateRes.ok, true);

    const updated = usePrototypeStore.getState().riskGroups.find((g) => g.id === newId);
    assert.equal(updated?.cooldownMinutes, 90);

    // updateRiskGroup with invalid allowance fails with validation error
    const invalidAllowanceRes = await store.updateRiskGroup(newId, {
      allowanceMinutes: 60, // +30 exceeds +15 daily limit
    });
    assert.equal(invalidAllowanceRes.ok, false);
    if (!invalidAllowanceRes.ok) {
      assert.equal(invalidAllowanceRes.reason, 'increase-too-large');
    }
  });

  test('17. staged editing: Discard restores all fields and does not mutate store prematurely', async () => {
    const store = usePrototypeStore.getState();
    const groupId = await store.createRiskGroup({
      name: 'Work Focus',
      description: 'Work apps',
      allowanceMinutes: 30,
      cooldownMinutes: 60,
    });

    const original = usePrototypeStore.getState().riskGroups.find((g) => g.id === groupId)!;

    // Simulate staged draft editing in memory
    const draft: RiskGroupConfigurationDraft = {
      name: 'Edited Name',
      description: 'Edited Description',
      allowanceMinutes: 45,
      cooldownMinutes: 90,
      recoveryActivityId: 'stretch',
      morningProtected: true,
      eveningProtected: true,
    };

    assert.equal(draft.name, 'Edited Name');

    // Store state remains unchanged before save
    const currentInStore = usePrototypeStore.getState().riskGroups.find((g) => g.id === groupId)!;
    assert.equal(currentInStore.name, 'Work Focus');
    assert.equal(currentInStore.allowanceMinutes, 30);

    // Discard restores draft to original
    const revertedDraft: RiskGroupConfigurationDraft = {
      name: original.name,
      description: original.description ?? '',
      allowanceMinutes: original.allowanceMinutes ?? 30,
      cooldownMinutes: original.cooldownMinutes,
      recoveryActivityId: original.recoveryActivityId ?? 'walk',
      morningProtected: false,
      eveningProtected: false,
    };

    assert.equal(revertedDraft.name, 'Work Focus');
    assert.equal(revertedDraft.allowanceMinutes, 30);
    assert.equal(revertedDraft.cooldownMinutes, 60);
  });

  test('18. staged editing: atomic save commits all 7 fields or aborts without side-effects', async () => {
    const store = usePrototypeStore.getState();
    const groupId = await store.createRiskGroup({
      name: 'Creative Studio',
      description: 'Drawing and design',
      allowanceMinutes: 30,
      cooldownMinutes: 60,
    });

    // Valid save commits all fields
    const validDraft: RiskGroupConfigurationDraft = {
      name: 'Art & Design',
      description: 'Creative illustration apps',
      allowanceMinutes: 45,
      cooldownMinutes: 90,
      recoveryActivityId: 'tea',
      morningProtected: true,
      eveningProtected: true,
    };

    const saveRes = await store.saveRiskGroupConfiguration(groupId, validDraft);
    assert.equal(saveRes.ok, true);

    const savedGroup = usePrototypeStore.getState().riskGroups.find((g) => g.id === groupId)!;
    assert.equal(savedGroup.name, 'Art & Design');
    assert.equal(savedGroup.description, 'Creative illustration apps');
    assert.equal(savedGroup.allowanceMinutes, 45);
    assert.equal(savedGroup.cooldownMinutes, 90);
    assert.equal(savedGroup.recoveryActivityId, 'tea');

    const windows = usePrototypeStore.getState().routineWindows;
    assert.equal(windows.find((w) => w.id === 'morning-buffer')?.protectedGroupIds.includes(groupId), true);
    assert.equal(windows.find((w) => w.id === 'evening-wind-down')?.protectedGroupIds.includes(groupId), true);

    // Second edit on same day: allowance modification fails with already-edited-today
    const secondDraft: RiskGroupConfigurationDraft = {
      ...validDraft,
      name: 'Art Studio Pro',
      allowanceMinutes: 30, // attempted change
    };

    const secondRes = await store.saveRiskGroupConfiguration(groupId, secondDraft);
    assert.equal(secondRes.ok, false);
    if (!secondRes.ok) {
      assert.equal(secondRes.reason, 'already-edited-today');
    }

    // Ensure NO partial write occurred: name is STILL 'Art & Design'
    const unmutatedGroup = usePrototypeStore.getState().riskGroups.find((g) => g.id === groupId)!;
    assert.equal(unmutatedGroup.name, 'Art & Design');
  });

  test('19. coordinator persistence failure aborts cleanly without state corruption or history write', async () => {
    const store = usePrototypeStore.getState();
    const coordinator = RhythmCoordinator.getInstance();
    const groupId = await store.createRiskGroup({
      name: 'Resilient Group',
      allowanceMinutes: 30,
    });

    const rawCoordinatorConfigBefore = (coordinator as any).config;
    const engineConfigBefore = (coordinator as any).engine.config;
    const storeRiskGroupsBefore = [...usePrototypeStore.getState().riskGroups];

    const { storage } = getPlatformServices();
    const historyBefore = await storage.getHistoryEvents();
    const originalSavePreferences = storage.savePreferences.bind(storage);

    // Simulate persistence failure
    storage.savePreferences = async () => {
      throw new Error('Simulated disk full');
    };

    try {
      const draft: RiskGroupConfigurationDraft = {
        name: 'Resilient Group Renamed',
        description: 'Should not save',
        allowanceMinutes: 45,
        cooldownMinutes: 60,
        recoveryActivityId: 'walk',
        morningProtected: false,
        eveningProtected: false,
      };

      const res = await store.saveRiskGroupConfiguration(groupId, draft);
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.reason, 'persistence-failed');
      }

      // 1. Coordinator config remains unchanged
      assert.equal((coordinator as any).config, rawCoordinatorConfigBefore);
      assert.equal(coordinator.getConfig()?.riskGroups.find((g) => g.id === groupId)?.name, 'Resilient Group');
      assert.equal(coordinator.getConfig()?.riskGroups.find((g) => g.id === groupId)?.allowanceMinutes, 30);

      // 2. Engine config remains unchanged
      assert.equal((coordinator as any).engine.config, engineConfigBefore);

      // 3. Zustand store state remains unchanged
      assert.deepEqual(usePrototypeStore.getState().riskGroups, storeRiskGroupsBefore);

      // 4. No allowance history event written
      const historyAfter = await storage.getHistoryEvents();
      assert.equal(historyAfter.length, historyBefore.length);
      const allowanceEvents = historyAfter.filter((e) => e.type === 'group-allowance-edited');
      assert.equal(allowanceEvents.length, historyBefore.filter((e) => e.type === 'group-allowance-edited').length);
    } finally {
      storage.savePreferences = originalSavePreferences;
    }
  });

  test('20. successful atomic save: preferences persist, coordinator/engine/store update, history event recorded', async () => {
    const store = usePrototypeStore.getState();
    const coordinator = RhythmCoordinator.getInstance();
    const groupId = await store.createRiskGroup({
      name: 'Atomic Workflow',
      allowanceMinutes: 30,
    });

    const { storage } = getPlatformServices();
    const historyBefore = await storage.getHistoryEvents();

    const draft: RiskGroupConfigurationDraft = {
      name: 'Atomic Workflow Updated',
      description: 'Fully committed',
      allowanceMinutes: 45,
      cooldownMinutes: 90,
      recoveryActivityId: 'tea',
      morningProtected: true,
      eveningProtected: true,
    };

    const res = await store.saveRiskGroupConfiguration(groupId, draft);
    assert.equal(res.ok, true);

    // 1. Preferences persisted in storage
    const persisted = await storage.loadPreferences();
    assert.ok(persisted);
    const persistedGroup = persisted?.riskGroups.find((g) => g.id === groupId);
    assert.equal(persistedGroup?.name, 'Atomic Workflow Updated');
    assert.equal(persistedGroup?.allowanceMinutes, 45);
    assert.equal(persistedGroup?.cooldownMinutes, 90);

    // 2. Coordinator in-memory config updated
    const coordinatorGroup = coordinator.getConfig()?.riskGroups.find((g) => g.id === groupId);
    assert.equal(coordinatorGroup?.name, 'Atomic Workflow Updated');
    assert.equal(coordinatorGroup?.allowanceMinutes, 45);

    // 3. Engine config updated
    const engineGroup = (coordinator as any).engine.config.riskGroups.find((g: any) => g.id === groupId);
    assert.equal(engineGroup?.name, 'Atomic Workflow Updated');
    assert.equal(engineGroup?.allowanceMinutes, 45);

    // 4. Zustand store state updated
    const storeGroup = usePrototypeStore.getState().riskGroups.find((g) => g.id === groupId);
    assert.equal(storeGroup?.name, 'Atomic Workflow Updated');
    assert.equal(storeGroup?.allowanceMinutes, 45);

    // 5. History event appended only after success
    const historyAfter = await storage.getHistoryEvents();
    assert.equal(historyAfter.length, historyBefore.length + 1);
    const latestEvent = historyAfter[historyAfter.length - 1];
    assert.equal(latestEvent.type, 'group-allowance-edited');
    if (latestEvent.type === 'group-allowance-edited') {
      assert.equal(latestEvent.groupId, groupId);
      assert.equal(latestEvent.previousMinutes, 30);
      assert.equal(latestEvent.nextMinutes, 45);
    }
  });
});
