import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  createRestorativeGateForOrdinal,
  evaluateRestorativeGate,
  deriveRestorativeStatus,
  isMeditationPathAllowed,
  lockGateProvider,
  migrateLegacyReadingGate,
  readingRequirementForKind,
  requirementKindForCooldownOrdinal,
  selectGateProvider,
  type ActiveRestorativeGate,
} from '../restorativeGate';
import {
  legacyReadingRequirementForCooldownOrdinal,
  requirementForCooldownOrdinal,
} from '../attentionExchange';
import {
  isVerifiedMeditationCompletion,
  parseMeditationSessionEvidence,
  type MeditationSessionEvidence,
} from '../meditationEvidence';
import type { RecoverySessionInfo } from '../recovery';

/**
 * Pass 3 — Restorative Gate domain tests (spec sections 46-49, 53).
 *
 * These prove the finalized policy:
 *   CD1-2 separation only / CD3 Reader baseline / CD4+ ONE discrete
 *   restorative requirement (Reader session OR Meditation), with Meditation
 *   capped at two cooldown substitutions per Attention Day, provider locking,
 *   no cross-gate session reuse, and fail-closed provider errors.
 */

const NOW = 1_700_000_000_000;
const DAY = 'ad-20260927-0730';

function cooldownGate(ordinal: number, overrides: Partial<ActiveRestorativeGate> = {}) {
  const gate = createRestorativeGateForOrdinal({
    groupId: 'social',
    attentionDayId: DAY,
    dailyCooldownOrdinal: ordinal,
    createdAt: NOW,
    cooldownEndsAt: NOW + 90 * 60_000,
    gateId: `gate-social-o${ordinal}`,
  });
  assert.ok(gate, `ordinal ${ordinal} must create a gate`);
  return { ...gate, ...overrides };
}

function meditationEvidence(
  sessionId: string,
  overrides: Partial<MeditationSessionEvidence> = {}
): MeditationSessionEvidence {
  return {
    sessionId,
    protocolVersion: 1,
    status: 'COMPLETED',
    requiredQualifiedSeconds: 1800,
    completedQualifiedSeconds: 1800,
    completedAtEpochMs: NOW,
    lastUpdatedAtEpochMs: NOW,
    ...overrides,
  };
}

function readerSession(
  sessionId: string,
  overrides: Partial<RecoverySessionInfo> = {}
): RecoverySessionInfo {
  return {
    sessionId,
    protocolVersion: 1,
    status: 'COMPLETE',
    activeSeconds: 1800,
    qualifiedPages: 11,
    completedAtEpochMs: NOW,
    ...overrides,
  };
}

describe('Pass 3 — Restorative requirement model (spec 46)', () => {
  test('ordinal 1 and 2 carry no restorative gate', () => {
    assert.equal(requirementKindForCooldownOrdinal(1), 'none');
    assert.equal(requirementKindForCooldownOrdinal(2), 'none');
    assert.equal(
      createRestorativeGateForOrdinal({
        groupId: 'social',
        attentionDayId: DAY,
        dailyCooldownOrdinal: 1,
        createdAt: NOW,
        cooldownEndsAt: NOW + 1,
      }),
      undefined
    );
    assert.equal(
      createRestorativeGateForOrdinal({
        groupId: 'social',
        attentionDayId: DAY,
        dailyCooldownOrdinal: 2,
        createdAt: NOW,
        cooldownEndsAt: NOW + 1,
      }),
      undefined
    );
  });

  test('ordinal 3 is BASELINE_READING with 3600 sec / 36 pages', () => {
    assert.equal(requirementKindForCooldownOrdinal(3), 'baseline-reading');
    const gate = cooldownGate(3);
    assert.equal(gate.requirementKind, 'baseline-reading');
    assert.equal(gate.requiredReadingSeconds, 3600);
    assert.equal(gate.requiredQualifiedPages, 36);
    assert.deepEqual(readingRequirementForKind('baseline-reading'), {
      activeSeconds: 3600,
      qualifiedPages: 36,
    });
  });

  test('ordinal 4 and 5 are RESTORATIVE_CHOICE', () => {
    assert.equal(requirementKindForCooldownOrdinal(4), 'restorative-choice');
    assert.equal(requirementKindForCooldownOrdinal(5), 'restorative-choice');
    const gate4 = cooldownGate(4);
    assert.equal(gate4.requirementKind, 'restorative-choice');
    assert.equal(gate4.status, 'pending-selection');
    assert.equal(gate4.requiredMeditationSeconds, 1800);
    assert.equal(gate4.requiredRestorativeReadingSeconds, 1800);
    assert.equal(gate4.requiredRestorativeQualifiedPages, 11);
  });

  test('explicit regression: ordinal 4 must NOT equal 5400 sec / 47 pages', () => {
    const ordinal4 = requirementForCooldownOrdinal(4);
    assert.notDeepEqual(ordinal4, { activeSeconds: 5400, qualifiedPages: 47 });
    assert.deepEqual(ordinal4, { activeSeconds: 1800, qualifiedPages: 11 });
    assert.deepEqual(legacyReadingRequirementForCooldownOrdinal(4), {
      activeSeconds: 5400,
      qualifiedPages: 47,
    });
    // CD5 is discrete too — never 7200/58.
    assert.notDeepEqual(requirementForCooldownOrdinal(5), {
      activeSeconds: 7200,
      qualifiedPages: 58,
    });
  });
});

describe('Pass 3 — Cooldown/Gate truth table (spec 47)', () => {
  const truthTable = [
    { cooldownActive: true, gateSatisfied: false, eligible: false },
    { cooldownActive: true, gateSatisfied: true, eligible: false },
    { cooldownActive: false, gateSatisfied: false, eligible: false },
    { cooldownActive: false, gateSatisfied: true, eligible: true },
  ];

  for (const row of truthTable) {
    test(`cooldown ${row.cooldownActive ? 'ACTIVE' : 'COMPLETE'} / gate ${
      row.gateSatisfied ? 'COMPLETE' : 'INCOMPLETE'
    } -> ${row.eligible ? 'eligible' : 'blocked'} (meditation path)`, () => {
      const gate = cooldownGate(4, {
        selectedProvider: 'meditation',
        providerSessionId: 'm1',
        status: row.gateSatisfied ? 'satisfied' : 'in-progress',
        satisfiedAt: row.gateSatisfied ? NOW : undefined,
        meditationSubstitutionConsumed: row.gateSatisfied,
      });
      const status = deriveRestorativeStatus({
        groupId: 'social',
        gate,
        cooldownEndsAt: row.cooldownActive ? NOW + 60_000 : NOW - 1,
        now: NOW,
        attentionDayId: DAY,
        currentDateKey: '2026-09-27',
        acceptedEvidenceDateKeys: ['2026-09-27'],
        meditationSubstitutionsUsed: 0,
      });

      // "Eligible" = nothing left to do for this group.
      const eligible = status.gateSatisfied && status.cooldownRemainingSeconds === 0;
      assert.equal(eligible, row.eligible);
      if (!row.eligible) {
        assert.ok(
          status.phase !== 'complete',
          'an incomplete obligation must never present as complete'
        );
      }
    });
  }

  test('both reader and meditation paths obey the same timer/gate independence', () => {
    for (const provider of ['reader', 'meditation'] as const) {
      const gate = cooldownGate(4, {
        selectedProvider: provider,
        providerSessionId: provider === 'reader' ? 'r1' : 'm1',
        status: 'in-progress',
      });
      const status = deriveRestorativeStatus({
        groupId: 'social',
        gate,
        cooldownEndsAt: NOW - 1,
        now: NOW,
        attentionDayId: DAY,
        currentDateKey: '2026-09-27',
        acceptedEvidenceDateKeys: ['2026-09-27'],
        meditationSubstitutionsUsed: 0,
      });
      assert.equal(status.gateSatisfied, false);
      assert.equal(status.cooldownRemainingSeconds, 0);
    }
  });
});

describe('Pass 3 — Meditation substitutions (spec 48-49)', () => {
  test('CD4 meditation completion satisfies G4 and consumes substitution 1', () => {
    const gate = cooldownGate(4, {
      selectedProvider: 'meditation',
      providerSessionId: 'm1',
    });
    const evaluation = evaluateRestorativeGate({
      gate,
      now: NOW,
      attentionDayId: DAY,
      currentDateKey: '2026-09-27',
      acceptedEvidenceDateKeys: ['2026-09-27'],
      meditationEvidence: meditationEvidence('m1'),
      meditationSubstitutionsUsed: 0,
    });

    assert.equal(evaluation.gate?.status, 'satisfied');
    assert.equal(evaluation.substitutionConsumed, true);
  });

  test('CD5 meditation consumes substitution 2 and CD6 meditation is not offered', () => {
    const gate5 = cooldownGate(5, { selectedProvider: 'meditation', providerSessionId: 'm2' });
    const first = evaluateRestorativeGate({
      gate: gate5,
      now: NOW,
      attentionDayId: DAY,
      currentDateKey: '2026-09-27',
      acceptedEvidenceDateKeys: ['2026-09-27'],
      meditationEvidence: meditationEvidence('m2'),
      meditationSubstitutionsUsed: 1,
    });
    assert.equal(first.gate?.status, 'satisfied');
    assert.equal(first.substitutionConsumed, true);

    // Cap: no meditation path remains after 2 substitutions in the Attention Day.
    assert.equal(isMeditationPathAllowed(2), false);
    const gate6 = cooldownGate(6, { selectedProvider: 'meditation', providerSessionId: 'm3' });
    const capped = evaluateRestorativeGate({
      gate: gate6,
      now: NOW,
      attentionDayId: DAY,
      currentDateKey: '2026-09-27',
      acceptedEvidenceDateKeys: ['2026-09-27'],
      meditationEvidence: meditationEvidence('m3'),
      meditationSubstitutionsUsed: 2,
    });
    // Even a completed session cannot satisfy a gate beyond the cap.
    assert.notEqual(capped.gate?.status, 'satisfied');
    assert.equal(capped.substitutionConsumed, false);

    // Selection refuses to offer the path once exhausted.
    const unselected = cooldownGate(6);
    assert.equal(
      selectGateProvider(unselected, 'meditation', { meditationAllowed: false }).selectedProvider,
      undefined
    );
  });

  test('M1 cannot satisfy G5 (session ids are gate-bound)', () => {
    const gate = cooldownGate(5, {
      selectedProvider: 'meditation',
      providerSessionId: 'm2',
    });
    const evaluation = evaluateRestorativeGate({
      gate,
      now: NOW,
      attentionDayId: DAY,
      currentDateKey: '2026-09-27',
      acceptedEvidenceDateKeys: ['2026-09-27'],
      // Evidence for a DIFFERENT gate's session.
      meditationEvidence: meditationEvidence('m1'),
      meditationSubstitutionsUsed: 1,
    });
    assert.notEqual(evaluation.gate?.status, 'satisfied');
    assert.equal(evaluation.substitutionConsumed, false);
  });

  test('cancelled/incomplete meditation keeps the gate open and consumes nothing', () => {
    const gate = cooldownGate(4, {
      selectedProvider: 'meditation',
      providerSessionId: 'm1',
    });
    const evaluation = evaluateRestorativeGate({
      gate,
      now: NOW,
      attentionDayId: DAY,
      currentDateKey: '2026-09-27',
      acceptedEvidenceDateKeys: ['2026-09-27'],
      meditationEvidence: meditationEvidence('m1', {
        status: 'CANCELLED',
        completedQualifiedSeconds: 1020, // 17 minutes
      }),
      meditationSubstitutionsUsed: 0,
    });
    assert.notEqual(evaluation.gate?.status, 'satisfied');
    assert.equal(evaluation.substitutionConsumed, false);
    // Partial progress locks the provider so progress cannot be re-cut across providers.
    assert.equal(evaluation.gate?.providerLocked, true);
  });

  test('restarting the gate never inherits cancelled progress', () => {
    const cancelled = cooldownGate(4, {
      selectedProvider: 'meditation',
      providerSessionId: 'm1',
    });
    // A fresh attempt is a NEW provider session bound to the same gate.
    const restarted = {
      ...cancelled,
      providerSessionId: 'm1-retry',
      providerLocked: false,
    };
    const evaluation = evaluateRestorativeGate({
      gate: restarted,
      now: NOW,
      attentionDayId: DAY,
      currentDateKey: '2026-09-27',
      acceptedEvidenceDateKeys: ['2026-09-27'],
      meditationEvidence: meditationEvidence('m1-retry', {
        status: 'PENDING',
        completedQualifiedSeconds: 0,
      }),
      meditationSubstitutionsUsed: 0,
    });
    assert.equal(evaluation.gate?.status, 'in-progress');
    assert.equal(evaluation.gate?.meditationSubstitutionConsumed, false);
  });

  test('substitution consumption is idempotent per gate', () => {
    const gate = cooldownGate(4, {
      selectedProvider: 'meditation',
      providerSessionId: 'm1',
    });
    const first = evaluateRestorativeGate({
      gate,
      now: NOW,
      attentionDayId: DAY,
      currentDateKey: '2026-09-27',
      acceptedEvidenceDateKeys: ['2026-09-27'],
      meditationEvidence: meditationEvidence('m1'),
      meditationSubstitutionsUsed: 0,
    });
    const second = evaluateRestorativeGate({
      gate: first.gate!,
      now: NOW + 1000,
      attentionDayId: DAY,
      currentDateKey: '2026-09-27',
      acceptedEvidenceDateKeys: ['2026-09-27'],
      meditationEvidence: meditationEvidence('m1'),
      meditationSubstitutionsUsed: 1,
    });
    assert.equal(first.substitutionConsumed, true);
    assert.equal(second.substitutionConsumed, false);
    assert.equal(second.gate?.status, 'satisfied');
  });
});

describe('Pass 3 — Provider locking (spec 23)', () => {
  test('provider may change before meaningful progress', () => {
    const gate = cooldownGate(4);
    const selected = selectGateProvider(gate, 'reader');
    assert.equal(selected.selectedProvider, 'reader');
    const switched = selectGateProvider(selected, 'meditation');
    assert.equal(switched.selectedProvider, 'meditation');
  });

  test('partial progress on one provider can never be combined with the other', () => {
    const readerGate = cooldownGate(4, {
      selectedProvider: 'reader',
      providerSessionId: 'r4',
    });
    const afterProgress = evaluateRestorativeGate({
      gate: readerGate,
      now: NOW,
      attentionDayId: DAY,
      currentDateKey: '2026-09-27',
      acceptedEvidenceDateKeys: ['2026-09-27'],
      readerSessionEvidence: readerSession('r4', { activeSeconds: 600, qualifiedPages: 4 }),
      meditationSubstitutionsUsed: 0,
    });
    assert.equal(afterProgress.gate?.providerLocked, true);
    // Locked gate ignores a provider switch.
    const attempted = selectGateProvider(afterProgress.gate!, 'meditation');
    assert.equal(attempted.selectedProvider, 'reader');
    // And a satisfied meditation session for another gate cannot finish it.
    const mixed = evaluateRestorativeGate({
      gate: attempted,
      now: NOW,
      attentionDayId: DAY,
      currentDateKey: '2026-09-27',
      acceptedEvidenceDateKeys: ['2026-09-27'],
      readerSessionEvidence: readerSession('r4', { activeSeconds: 600, qualifiedPages: 4 }),
      meditationEvidence: meditationEvidence('m1'),
      meditationSubstitutionsUsed: 0,
    });
    assert.notEqual(mixed.gate?.status, 'satisfied');
  });

  test('a reader session cannot satisfy a second gate', () => {
    const gateA = cooldownGate(4, { selectedProvider: 'reader', providerSessionId: 'r4' });
    const gateB = cooldownGate(5, { selectedProvider: 'reader', providerSessionId: 'r5' });
    const evidence = readerSession('r4'); // complete, but bound to gate A

    const a = evaluateRestorativeGate({
      gate: gateA,
      now: NOW,
      attentionDayId: DAY,
      currentDateKey: '2026-09-27',
      acceptedEvidenceDateKeys: ['2026-09-27'],
      readerSessionEvidence: evidence,
      meditationSubstitutionsUsed: 0,
    });
    const b = evaluateRestorativeGate({
      gate: gateB,
      now: NOW,
      attentionDayId: DAY,
      currentDateKey: '2026-09-27',
      acceptedEvidenceDateKeys: ['2026-09-27'],
      readerSessionEvidence: evidence,
      meditationSubstitutionsUsed: 0,
    });

    assert.equal(a.gate?.status, 'satisfied');
    assert.notEqual(b.gate?.status, 'satisfied');
  });
});

describe('Pass 3 — Provider trust is fail-closed (spec 53)', () => {
  test('missing session evidence never satisfies a meditation gate', () => {
    const gate = cooldownGate(4, { selectedProvider: 'meditation', providerSessionId: 'm1' });
    for (const evidence of [null, undefined]) {
      const evaluation = evaluateRestorativeGate({
        gate,
        now: NOW,
        attentionDayId: DAY,
        currentDateKey: '2026-09-27',
        acceptedEvidenceDateKeys: ['2026-09-27'],
        meditationEvidence: evidence,
        meditationSubstitutionsUsed: 0,
      });
      assert.notEqual(evaluation.gate?.status, 'satisfied');
    }
  });

  test('COMPLETED for the wrong session id never satisfies', () => {
    assert.equal(
      isVerifiedMeditationCompletion({
        evidence: meditationEvidence('other-session'),
        sessionId: 'm1',
      }),
      false
    );
  });

  test('wrong protocol version is incompatible, never trusted', () => {
    assert.equal(
      isVerifiedMeditationCompletion({
        evidence: meditationEvidence('m1', { protocolVersion: 2 }),
        sessionId: 'm1',
      }),
      false
    );
    assert.equal(
      isVerifiedMeditationCompletion({
        evidence: meditationEvidence('m1', { protocolVersion: 0 }),
        sessionId: 'm1',
      }),
      false
    );
  });

  test('ACTIVE state and wall-clock duration never satisfy', () => {
    assert.equal(
      isVerifiedMeditationCompletion({
        evidence: meditationEvidence('m1', {
          status: 'ACTIVE',
          completedQualifiedSeconds: 1799,
        }),
        sessionId: 'm1',
      }),
      false
    );
    // 30 wall-clock minutes with only 17 qualified minutes is not enough.
    assert.equal(
      isVerifiedMeditationCompletion({
        evidence: meditationEvidence('m1', {
          status: 'COMPLETED',
          completedQualifiedSeconds: 1020,
        }),
        sessionId: 'm1',
      }),
      false
    );
    // Exactly at the requirement qualifies.
    assert.equal(
      isVerifiedMeditationCompletion({
        evidence: meditationEvidence('m1', { completedQualifiedSeconds: 1800 }),
        sessionId: 'm1',
      }),
      true
    );
  });

  test('corrupt provider rows are reported, never trusted', () => {
    assert.equal(parseMeditationSessionEvidence(null), null);
    assert.equal(parseMeditationSessionEvidence({}), null);
    assert.equal(
      parseMeditationSessionEvidence({
        sessionId: 'm1',
        protocolVersion: 'one',
        status: 'COMPLETED',
        requiredQualifiedSeconds: 1800,
        completedQualifiedSeconds: 1800,
        completedAtEpochMs: null,
        lastUpdatedAtEpochMs: 1,
      }),
      null
    );
    const unknownStatus = parseMeditationSessionEvidence({
      sessionId: 'm1',
      protocolVersion: 1,
      status: 'SOMETHING_ELSE',
      requiredQualifiedSeconds: 1800,
      completedQualifiedSeconds: 1800,
      completedAtEpochMs: null,
      lastUpdatedAtEpochMs: 1,
    });
    assert.equal(unknownStatus?.status, 'UNKNOWN');
    assert.equal(
      isVerifiedMeditationCompletion({ evidence: unknownStatus, sessionId: 'm1' }),
      false
    );
  });

  test('legacy migrated gates keep their original numbers (spec 41)', () => {
    const legacy = migrateLegacyReadingGate({
      groupId: 'social',
      attentionDateKey: '2026-09-27',
      dailyCooldownOrdinal: 4,
      createdAt: NOW,
      cooldownEndsAt: NOW + 90 * 60_000,
      requiredReadingSeconds: 5400,
      requiredQualifiedPages: 47,
    });
    assert.equal(legacy.requirementKind, 'legacy-reading');
    assert.equal(legacy.requiredReadingSeconds, 5400);
    assert.equal(legacy.requiredQualifiedPages, 47);
    assert.equal(legacy.gateId, 'legacy-gate-social');

    // Legacy satisfaction keeps v1.2 aggregate Reader evidence semantics.
    const satisfied = evaluateRestorativeGate({
      gate: legacy,
      now: NOW,
      attentionDayId: DAY,
      currentDateKey: '2026-09-27',
      acceptedEvidenceDateKeys: ['2026-09-27'],
      readerDailyEvidence: {
        dateKey: '2026-09-27',
        providerAvailable: true,
        protocolCompatible: true,
        verifiedActiveSeconds: 5400,
        qualifiedPages: 47,
      },
      meditationSubstitutionsUsed: 0,
    });
    assert.equal(satisfied.gate?.status, 'satisfied');

    // ...but 1800/11 (the new discrete requirement) must NOT satisfy it mid-cycle.
    const notEnough = evaluateRestorativeGate({
      gate: legacy,
      now: NOW,
      attentionDayId: DAY,
      currentDateKey: '2026-09-27',
      acceptedEvidenceDateKeys: ['2026-09-27'],
      readerDailyEvidence: {
        dateKey: '2026-09-27',
        providerAvailable: true,
        protocolCompatible: true,
        verifiedActiveSeconds: 1800,
        qualifiedPages: 11,
      },
      meditationSubstitutionsUsed: 0,
    });
    assert.notEqual(notEnough.gate?.status, 'satisfied');
  });

  test('lockGateProvider is idempotent', () => {
    const gate = cooldownGate(4, { selectedProvider: 'reader', providerSessionId: 'r4' });
    const locked = lockGateProvider(gate);
    assert.equal(locked.providerLocked, true);
    assert.equal(lockGateProvider(locked).providerLocked, true);
  });
});
