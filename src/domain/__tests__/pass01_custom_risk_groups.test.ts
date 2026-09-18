import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { usePrototypeStore } from '../../store/usePrototypeStore';
import { createUniqueGroupId, resolveCooldownInfo } from '../selectors';
import { RiskGroup } from '../../types/domain';

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
    assert.equal(createdDefault?.sessionThresholdMinutes, 30);
    assert.equal(createdDefault?.allowanceMinutes, 30);
    assert.equal(createdDefault?.cooldownMinutes, 60);
    assert.equal(createdDefault?.origin, 'custom');

    // Explicit custom configuration
    const customId = await store.createRiskGroup({
      name: 'Gaming & Streams',
      description: 'Mobile games and live streaming',
      sessionThresholdMinutes: 45,
      cooldownMinutes: 120,
    });

    const createdCustom = usePrototypeStore
      .getState()
      .riskGroups.find((g) => g.id === customId);

    assert.ok(createdCustom);
    assert.equal(createdCustom?.name, 'Gaming & Streams');
    assert.equal(createdCustom?.sessionThresholdMinutes, 45);
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
      sessionThresholdMinutes: 30,
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
    assert.equal(gamingInfo.subtitle, '45 min session reached · 90 min recovery');

    const newsInfo = resolveCooldownInfo(mockGroups, 'news');
    assert.equal(newsInfo.groupName, 'News & Feeds');
    assert.equal(newsInfo.sessionThresholdMinutes, 20);
    assert.equal(newsInfo.cooldownMinutes, 40);
    assert.equal(newsInfo.title, 'News & Feeds cooldown');
    assert.equal(newsInfo.subtitle, '20 min session reached · 40 min recovery');
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
});
