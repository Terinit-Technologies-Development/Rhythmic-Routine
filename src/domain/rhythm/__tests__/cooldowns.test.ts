import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  startCooldown,
  isCooldownActive,
  isCooldownExpired,
  restoreCooldowns,
} from '../cooldowns';
import { getActiveCooldowns, getPrimaryCooldown } from '../types';

describe('Rhythm Engine — Multi-Group Cooldown Lifecycle', () => {
  test('startCooldown creates absolute endsAt timestamp based on group cooldown minutes', () => {
    const now = 1700000000000;
    const cooldown = startCooldown('social', now, 90); // 90 minutes

    assert.equal(cooldown.groupId, 'social');
    assert.equal(cooldown.startedAt, now);
    assert.equal(cooldown.endsAt, now + 90 * 60 * 1000);
  });

  test('isCooldownActive and isCooldownExpired evaluate accurately against current time', () => {
    const now = 1700000000000;
    const cooldown = startCooldown('social', now, 60);

    // Active after 30 minutes
    assert.equal(isCooldownActive(cooldown, now + 30 * 60 * 1000), true);
    assert.equal(isCooldownExpired(cooldown, now + 30 * 60 * 1000), false);

    // Expired after 61 minutes
    assert.equal(isCooldownActive(cooldown, now + 61 * 60 * 1000), false);
    assert.equal(isCooldownExpired(cooldown, now + 61 * 60 * 1000), true);
  });

  test('restoreCooldowns restores active cooldowns and purges expired ones after restart', () => {
    const savedNow = 1700000000000;
    const socialCooldown = startCooldown('social', savedNow, 60); // ends in 60m
    const newsCooldown = startCooldown('news', savedNow, 120);    // ends in 120m

    const persistedMap = {
      social: socialCooldown,
      news: newsCooldown,
    };

    // Restart at 80m: social has expired, news is still active
    const restartTime = savedNow + 80 * 60 * 1000;
    const restored = restoreCooldowns(persistedMap, restartTime);

    assert.equal(restored.social, undefined);
    assert.ok(restored.news);
    assert.equal(restored.news?.endsAt, newsCooldown.endsAt);

    // getActiveCooldowns and getPrimaryCooldown
    const activeList = getActiveCooldowns(restored, restartTime);
    assert.equal(activeList.length, 1);
    assert.equal(activeList[0].groupId, 'news');

    const primary = getPrimaryCooldown({
      state: 'cooldown',
      activeCooldowns: restored,
      activeAccessLeases: {},
      activeRoutineWindowIds: [],
      activeRestrictions: [],
    }, restartTime);
    assert.equal(primary?.groupId, 'news');
  });
});
