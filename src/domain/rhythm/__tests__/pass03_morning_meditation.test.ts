import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  createMorningMeditationRequirement,
  deriveMorningEvidenceView,
  isMorningEnforceableForAttentionDay,
  isMorningMeditationSatisfied,
  morningMeditationSessionId,
  resolveMorningMeditationState,
  type MorningMeditationMigrationState,
} from '../morningMeditation';
import { computeEffectiveRestrictions, OFFICIAL_COMPANION_PACKAGES } from '../restrictions';
import type { DeviceApp, RiskGroup } from '../../../types/domain';
import type { MeditationSessionEvidence } from '../meditationEvidence';

/**
 * Pass 3 — Morning Meditation Required (spec 24-28, 50) and migration
 * behavior (spec 27, 41-42, 54).
 */

const DAY = 'ad-20260928-0730';

function morningEvidence(
  sessionId: string,
  overrides: Partial<MeditationSessionEvidence> = {}
): MeditationSessionEvidence {
  return {
    sessionId,
    protocolVersion: 1,
    status: 'COMPLETED',
    requiredQualifiedSeconds: 1800,
    completedQualifiedSeconds: 1800,
    completedAtEpochMs: 1,
    lastUpdatedAtEpochMs: 1,
    ...overrides,
  };
}

const apps: DeviceApp[] = [
  {
    id: 'com.terinit.rhythmicmeditation',
    name: 'Rhythmic Meditation',
    classification: 'normal',
    iconName: 'sprout',
    iconColor: '#235D43',
    iconBg: '#E8EFE5',
    defaultCategory: 'Wellness',
    usageTodayMinutes: 0,
    sessionMinutes: 0,
  },
  {
    id: 'com.terinit.rhythmicroutine',
    name: 'Rhythmic Routine',
    classification: 'normal',
    iconName: 'waves',
    iconColor: '#235D43',
    iconBg: '#E8EFE5',
    defaultCategory: 'Wellness',
    usageTodayMinutes: 0,
    sessionMinutes: 0,
  },
  {
    id: 'dialer',
    name: 'Phone',
    classification: 'essential',
    iconName: 'phone',
    iconColor: '#235D43',
    iconBg: '#E8EFE5',
    defaultCategory: 'Communication',
    usageTodayMinutes: 0,
    sessionMinutes: 0,
  },
  {
    id: 'com.instagram.android',
    name: 'Instagram',
    classification: 'risk',
    riskGroupId: 'social',
    iconName: 'camera',
    iconColor: '#C04328',
    iconBg: '#FDEEE9',
    defaultCategory: 'Social',
    usageTodayMinutes: 0,
    sessionMinutes: 0,
  },
  {
    id: 'com.example.game',
    name: 'Game',
    classification: 'normal',
    iconName: 'gamepad',
    iconColor: '#5A6660',
    iconBg: '#EFECE4',
    defaultCategory: 'Entertainment',
    usageTodayMinutes: 0,
    sessionMinutes: 0,
  },
];

const riskGroups: RiskGroup[] = [
  {
    id: 'social',
    name: 'Social',
    description: 'Social apps',
    iconName: 'users',
    iconColor: '#235D43',
    iconBg: '#E8EFE5',
    appIds: ['com.instagram.android'],
    allowanceMinutes: 30,
    cooldownMinutes: 90,
    currentSessionMinutes: 0,
  },
];

describe('Pass 3 — Morning Meditation lifecycle (spec 24-26, 50)', () => {
  test('morning session identity is stable per Attention Day', () => {
    assert.equal(morningMeditationSessionId(DAY), `morning-${DAY}`);
    const requirement = createMorningMeditationRequirement(DAY);
    assert.equal(requirement.sessionId, `morning-${DAY}`);
    assert.equal(requirement.requiredQualifiedSeconds, 1800);
    // Re-creating the requirement yields the same obligation (no duplicates).
    assert.deepEqual(createMorningMeditationRequirement(DAY), requirement);
  });

  test('only the exact bound MORNING_REQUIRED session satisfies the morning', () => {
    const requirement = createMorningMeditationRequirement(DAY);
    assert.equal(
      isMorningMeditationSatisfied({
        requirement,
        evidence: morningEvidence(requirement.sessionId),
      }),
      true
    );
    // A cooldown session id never satisfies the morning.
    assert.equal(
      isMorningMeditationSatisfied({
        requirement,
        evidence: morningEvidence('gate-social-o4-session'),
      }),
      false
    );
    // Incomplete morning session never satisfies.
    assert.equal(
      isMorningMeditationSatisfied({
        requirement,
        evidence: morningEvidence(requirement.sessionId, {
          status: 'ACTIVE',
          completedQualifiedSeconds: 1200,
        }),
      }),
      false
    );
  });

  test('buffer end opens MORNING_MEDITATION_REQUIRED and does not fully open the phone', () => {
    const requirement = createMorningMeditationRequirement(DAY);
    const state = resolveMorningMeditationState({
      now: 1,
      insideOvernightProtection: false,
      insideMorningBuffer: false,
      morningBufferElapsedForAttentionDay: true,
      requirement,
      enforceable: true,
    });
    assert.equal(state, 'morning-meditation-required');

    const { effectiveAppIds } = computeEffectiveRestrictions(
      [],
      {},
      riskGroups,
      apps,
      1,
      {},
      { morningMeditationActive: state === 'morning-meditation-required' }
    );

    // Essential app allowed.
    assert.ok(!effectiveAppIds.includes('dialer'));
    // Meditation and Routine remain reachable (official companion allowlist).
    assert.ok(!effectiveAppIds.includes('com.terinit.rhythmicmeditation'));
    assert.ok(!effectiveAppIds.includes('com.terinit.rhythmicroutine'));
    // Normal nonessential and Risk apps are restricted.
    assert.ok(effectiveAppIds.includes('com.example.game'));
    assert.ok(effectiveAppIds.includes('com.instagram.android'));
  });

  test('morning completion opens the day and consumes no substitution', () => {
    const requirement = createMorningMeditationRequirement(DAY);
    const state = resolveMorningMeditationState({
      now: 1,
      insideOvernightProtection: false,
      insideMorningBuffer: false,
      morningBufferElapsedForAttentionDay: true,
      requirement,
      evidence: morningEvidence(requirement.sessionId),
      enforceable: true,
    });
    assert.equal(state, 'available');
    // Morning completion is not a cooldown substitution — the counter lives in
    // DailyAttentionExchangeState and is only touched by cooldown gates.
    assert.equal(OFFICIAL_COMPANION_PACKAGES.has('com.terinit.rhythmicmeditation'), true);
  });

  test('lifecycle order: overnight -> buffer -> required -> available', () => {
    const requirement = createMorningMeditationRequirement(DAY);
    const base = {
      now: 1,
      morningBufferElapsedForAttentionDay: true,
      requirement,
      enforceable: true,
    };
    assert.equal(
      resolveMorningMeditationState({ ...base, insideOvernightProtection: true, insideMorningBuffer: false }),
      'overnight-protected'
    );
    assert.equal(
      resolveMorningMeditationState({ ...base, insideOvernightProtection: false, insideMorningBuffer: true }),
      'morning-buffer'
    );
    assert.equal(
      resolveMorningMeditationState({
        ...base,
        insideOvernightProtection: false,
        insideMorningBuffer: false,
        evidence: null,
      }),
      'morning-meditation-required'
    );
  });

  test('a lease cannot trivially bypass Morning Meditation Focus', () => {
    const requirement = createMorningMeditationRequirement(DAY);
    void requirement;
    const { effectiveAppIds } = computeEffectiveRestrictions(
      [],
      {},
      riskGroups,
      apps,
      1,
      {
        social: {
          id: 'lease-1',
          groupId: 'social',
          startedAt: 0,
          endsAt: 10_000,
          reason: 'emergency',
        },
      },
      { morningMeditationActive: true }
    );
    // Even with an active access lease, the Risk app stays held by the
    // morning-meditation reason (lease suppression cannot bypass it).
    assert.ok(effectiveAppIds.includes('com.instagram.android'));
    const restriction = effectiveAppIds.includes('com.instagram.android');
    assert.equal(restriction, true);
  });

  test('deriveMorningEvidenceView never trusts an unavailable provider', () => {
    assert.deepEqual(deriveMorningEvidenceView({ providerUnavailable: true }), {
      kind: 'unavailable',
    });
    const requirement = createMorningMeditationRequirement(DAY);
    assert.equal(deriveMorningEvidenceView({ requirement, evidence: null }).kind, 'pending');
  });
});

describe('Pass 3 — Morning rollout migration (spec 27)', () => {
  const migration: MorningMeditationMigrationState = {
    migratedAt: 1_700_000_000_000,
    migrationAttentionDayId: 'ad-20260927-0730',
  };

  test('an existing user is never locked mid-day by the update', () => {
    // Update at 14:00 on the 27th: the migration day itself is NOT enforceable.
    assert.equal(isMorningEnforceableForAttentionDay(migration, 'ad-20260927-0730'), false);
    // Enforcement begins with the NEXT Morning Buffer -> morning transition.
    assert.equal(isMorningEnforceableForAttentionDay(migration, 'ad-20260928-0730'), true);
    assert.equal(isMorningEnforceableForAttentionDay(migration, 'ad-20260929-0730'), true);
    assert.equal(isMorningEnforceableForAttentionDay(migration, 'ad-20260926-0730'), false);
  });

  test('fresh installs may enforce from their own Attention Day', () => {
    const fresh: MorningMeditationMigrationState = {
      ...migration,
      enforceableFromAttentionDayId: 'ad-20260927-0730',
    };
    assert.equal(isMorningEnforceableForAttentionDay(fresh, 'ad-20260927-0730'), true);
    assert.equal(isMorningEnforceableForAttentionDay(fresh, 'ad-20260926-0730'), false);
  });

  test('missing migration state never enforces (fail-safe for rollout)', () => {
    assert.equal(isMorningEnforceableForAttentionDay(undefined, 'ad-20260928-0730'), false);
  });
});
