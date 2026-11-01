import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { deriveTouchGrassPresentation } from '../touchGrassPresentation';
import type { AttentionGateStatus } from '../attentionExchange';
import type { MorningMeditationRuntimeState } from '../types';

const morningPending: MorningMeditationRuntimeState = {
  state: 'morning-meditation-required',
  requirement: {
    attentionDayId: 'ad-20260928-0830',
    sessionId: 'morning-ad-20260928-0830',
    requiredQualifiedSeconds: 1800,
    createdAt: 1,
  },
};

const attention: AttentionGateStatus = {
  phase: 'reading-required',
  groupId: 'social',
  requiredReadingSeconds: 1800,
  requiredQualifiedPages: 11,
  verifiedReadingSeconds: 0,
  qualifiedPages: 0,
  remainingReadingSeconds: 1800,
  remainingQualifiedPages: 11,
};

describe('F7 — Touch Grass presentation precedence', () => {
  test('morning-only does not invent allowance exhaustion or a cooldown timer', () => {
    const view = deriveTouchGrassPresentation({
      morning: morningPending,
      hasActiveCooldown: false,
      groupName: 'Social Feeds',
      allowanceMinutes: 30,
      cooldownMinutes: 90,
    });
    assert.equal(view.mode, 'morning');
    assert.equal(view.showCooldownTimer, false);
    assert.equal(view.showCooldownFacts, false);
    assert.equal(view.showMorningFocus, true);
    assert.match(view.badge, /Morning focus/);
    assert.doesNotMatch(view.subtitle, /allowance reached/);
    assert.match(view.emergencyLinkText, /cannot bypass morning/);
  });

  test('cooldown-only remains a real cooldown countdown', () => {
    const view = deriveTouchGrassPresentation({
      hasActiveCooldown: true,
      groupName: 'Social Feeds',
      allowanceMinutes: 30,
      cooldownMinutes: 90,
    });
    assert.equal(view.mode, 'cooldown');
    assert.equal(view.showCooldownTimer, true);
    assert.equal(view.showMorningFocus, false);
    assert.match(view.subtitle, /30 min group allowance reached/);
  });

  test('simultaneous morning and cooldown shows both without hiding either', () => {
    const view = deriveTouchGrassPresentation({
      morning: morningPending,
      hasActiveCooldown: true,
      groupName: 'Social Feeds',
      allowanceMinutes: 30,
      cooldownMinutes: 90,
    });
    assert.equal(view.mode, 'morning-and-cooldown');
    assert.equal(view.showCooldownTimer, true);
    assert.equal(view.showMorningFocus, true);
    assert.match(view.subtitle, /morning meditation/);
    assert.match(view.subtitle, /90 min recovery break/);
  });

  test('post-cooldown reading and morning focus coexist honestly', () => {
    const view = deriveTouchGrassPresentation({
      morning: morningPending,
      hasActiveCooldown: false,
      attention,
    });
    assert.equal(view.mode, 'morning-and-attention');
    assert.equal(view.showReadingRequirements, true);
    assert.equal(view.showMorningFocus, true);
    assert.equal(view.showCooldownTimer, false);
  });

  test('productive attention and neutral states remain accurate', () => {
    const reading = deriveTouchGrassPresentation({ hasActiveCooldown: false, attention });
    assert.equal(reading.mode, 'attention');
    assert.equal(reading.showReadingRequirements, true);

    const neutral = deriveTouchGrassPresentation({ hasActiveCooldown: false });
    assert.equal(neutral.mode, 'none');
    assert.equal(neutral.showCooldownTimer, false);
    assert.equal(neutral.showMorningFocus, false);
    assert.doesNotMatch(neutral.subtitle, /all apps|free|unrestricted/i);

    const satisfied = deriveTouchGrassPresentation({
      morning: { ...morningPending, state: 'available', requirement: { ...morningPending.requirement!, satisfiedAt: 2 } },
      hasActiveCooldown: false,
    });
    assert.equal(satisfied.mode, 'none');
  });

  test('restorative-only after cooldown expiry never claims no active hold', () => {
    const view = deriveTouchGrassPresentation({
      hasActiveCooldown: false,
      restorativeHold: true,
      restorativeGroupName: 'Social Feeds',
      restorativeProvider: 'reader',
      restorativePhase: 'reader-in-progress',
    });

    assert.equal(view.mode, 'restorative');
    assert.equal(view.badge, 'Restorative hold');
    assert.equal(view.showRestorativeHold, true);
    assert.doesNotMatch(view.badge, /No active hold/);
    assert.match(view.subtitle, /bound restorative requirement/);
    assert.match(view.subtitle, /bound Reader session/);
  });

  test('restorative hold coexists with morning, cooldown and reading without hiding either', () => {
    const withMorning = deriveTouchGrassPresentation({
      morning: morningPending,
      hasActiveCooldown: false,
      restorativeHold: true,
      restorativeProvider: 'meditation',
      restorativePhase: 'meditation-unavailable',
    });
    assert.equal(withMorning.mode, 'morning');
    assert.equal(withMorning.showMorningFocus, true);
    assert.equal(withMorning.showRestorativeHold, true);
    assert.match(withMorning.subtitle, /verification is currently unavailable/);
    assert.match(withMorning.subtitle, /bound Meditation session/);

    const withCooldown = deriveTouchGrassPresentation({
      hasActiveCooldown: true,
      restorativeHold: true,
      restorativeProvider: 'reader',
      restorativePhase: 'pending-selection',
    });
    assert.equal(withCooldown.mode, 'cooldown');
    assert.equal(withCooldown.showCooldownTimer, true);
    assert.equal(withCooldown.showRestorativeHold, true);

    const withAttention = deriveTouchGrassPresentation({
      hasActiveCooldown: false,
      attention,
      restorativeHold: true,
      restorativeProvider: 'reader',
    });
    assert.equal(withAttention.mode, 'attention');
    assert.equal(withAttention.showReadingRequirements, true);
    assert.equal(withAttention.showRestorativeHold, true);
  });

  test('completed restorative gate and completed morning do not invent holds', () => {
    const completed = deriveTouchGrassPresentation({
      hasActiveCooldown: false,
      restorativeHold: false,
      restorativeProvider: 'reader',
      restorativePhase: 'complete',
    });
    assert.equal(completed.mode, 'none');
    assert.equal(completed.showRestorativeHold, false);
    assert.doesNotMatch(completed.badge, /Restorative hold/);
  });
});
