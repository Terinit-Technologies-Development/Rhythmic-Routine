import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  startCooldown,
  isCooldownActive,
  isCooldownExpired,
  restoreCooldown,
} from '../cooldowns';

describe('Rhythm Engine — Cooldown Lifecycle', () => {
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

  test('restoreCooldown restores active cooldown and drops expired ones after app restart', () => {
    const savedNow = 1700000000000;
    const persisted = startCooldown('social', savedNow, 60); // Ends in 1 hour

    // App restarts 20 minutes later (still active)
    const restartTimeActive = savedNow + 20 * 60 * 1000;
    const restored = restoreCooldown(persisted, restartTimeActive);
    assert.ok(restored);
    assert.equal(restored?.endsAt, persisted.endsAt);

    // App restarts 2 hours later (already expired)
    const restartTimeExpired = savedNow + 120 * 60 * 1000;
    const expiredRestored = restoreCooldown(persisted, restartTimeExpired);
    assert.equal(expiredRestored, undefined);
  });
});
