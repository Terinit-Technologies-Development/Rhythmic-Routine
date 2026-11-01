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

    const satisfied = deriveTouchGrassPresentation({
      morning: { ...morningPending, state: 'available', requirement: { ...morningPending.requirement!, satisfiedAt: 2 } },
      hasActiveCooldown: false,
    });
    assert.equal(satisfied.mode, 'none');
  });
});
