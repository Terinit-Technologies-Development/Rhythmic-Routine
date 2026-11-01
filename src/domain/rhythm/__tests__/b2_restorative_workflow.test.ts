import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  createDailyAttentionExchangeState,
  meditationCompletionsForAttentionDay,
  recordMeditationCompletion,
  resolveMeditationSubstitutionsUsed,
} from '../attentionExchange';
import {
  createRestorativeGateForOrdinal,
  evaluateRestorativeGate,
} from '../restorativeGate';
import { isVerifiedCooldownMeditationCompletion } from '../meditationEvidence';
import type { RecoverySessionInfo } from '../recovery';

const ATTENTION_DAY = 'ad-2026-11-01';
const DATE_KEY = '2026-11-01';

function readerGate() {
  const gate = createRestorativeGateForOrdinal({
    groupId: 'social',
    attentionDayId: ATTENTION_DAY,
    dailyCooldownOrdinal: 4,
    createdAt: 1_000,
    cooldownEndsAt: 2_000,
  });
  if (!gate) throw new Error('expected a restorative gate');
  return {
    ...gate,
    selectedProvider: 'reader' as const,
    providerSessionId: 'session-one',
  };
}

function meditationGate() {
  const gate = createRestorativeGateForOrdinal({
    groupId: 'social',
    attentionDayId: ATTENTION_DAY,
    dailyCooldownOrdinal: 4,
    createdAt: 1_000,
    cooldownEndsAt: 2_000,
  });
  if (!gate) throw new Error('expected a restorative gate');
  return {
    ...gate,
    selectedProvider: 'meditation' as const,
    providerSessionId: 'meditation-one',
  };
}

function readerSession(overrides: Partial<RecoverySessionInfo> = {}): RecoverySessionInfo {
  return {
    sessionId: 'session-one',
    protocolVersion: 1,
    status: 'COMPLETE',
    activeSeconds: 1800,
    qualifiedPages: 11,
    completedAtEpochMs: 2_500,
    ...overrides,
  };
}

describe('B2 durable meditation completion ledger (FR-10 / T10 / T21)', () => {
  test('counts a completed gate once across restart and re-import', () => {
    let state = createDailyAttentionExchangeState(DATE_KEY, 1_000, ATTENTION_DAY);
    const entry = {
      gateId: 'gate-ad-2026-11-01-social-o4',
      groupId: 'social',
      providerSessionId: 'meditation-one',
      attentionDayId: ATTENTION_DAY,
      completedAt: 2_500,
    };
    state = recordMeditationCompletion(state, entry, 2_500);
    state = recordMeditationCompletion(state, entry, 2_600);
    assert.equal(resolveMeditationSubstitutionsUsed(state, ATTENTION_DAY), 1);

    // Simulate persistence/restart/re-import.
    const restored = JSON.parse(JSON.stringify(state));
    assert.equal(resolveMeditationSubstitutionsUsed(restored, ATTENTION_DAY), 1);
    assert.equal(meditationCompletionsForAttentionDay(restored, ATTENTION_DAY).length, 1);
  });

  test('counts distinct gates across groups up to the two-per-day cap', () => {
    let state = createDailyAttentionExchangeState(DATE_KEY, 1_000, ATTENTION_DAY);
    const base = {
      providerSessionId: 'meditation-one',
      attentionDayId: ATTENTION_DAY,
      completedAt: 2_500,
    };
    state = recordMeditationCompletion(state, { ...base, gateId: 'gate-a', groupId: 'social' }, 2_500);
    state = recordMeditationCompletion(state, { ...base, gateId: 'gate-b', groupId: 'entertainment' }, 2_600);
    state = recordMeditationCompletion(state, { ...base, gateId: 'gate-c', groupId: 'custom' }, 2_700);
    assert.equal(resolveMeditationSubstitutionsUsed(state, ATTENTION_DAY), 2);
    assert.deepEqual(
      meditationCompletionsForAttentionDay(state, ATTENTION_DAY).map((item) => item.gateId),
      ['gate-a', 'gate-b']
    );
  });

  test('never uses a morning requirement as a cooldown completion', () => {
    const state = createDailyAttentionExchangeState(DATE_KEY, 1_000, ATTENTION_DAY);
    assert.equal(resolveMeditationSubstitutionsUsed(state, ATTENTION_DAY), 0);
    assert.deepEqual(meditationCompletionsForAttentionDay(state, ATTENTION_DAY), []);
  });
});

describe('B2 bound provider evidence (FR-08 / FR-09 / FR-10)', () => {
  test('does not accept Reader V2 daily aggregate for a CD4+ restorative gate', () => {
    const evaluation = evaluateRestorativeGate({
      gate: readerGate(),
      now: 3_000,
      attentionDayId: ATTENTION_DAY,
      currentDateKey: DATE_KEY,
      acceptedEvidenceDateKeys: [DATE_KEY],
      readerDailyEvidence: {
        dateKey: DATE_KEY,
        providerAvailable: true,
        protocolCompatible: true,
        verifiedActiveSeconds: 3600,
        qualifiedPages: 36,
      },
      meditationSubstitutionsUsed: 0,
    });
    assert.notEqual(evaluation.gate?.status, 'satisfied');
  });

  test('accepts only the exact bound Reader V1 session at 1800s AND 11 pages', () => {
    const partial = evaluateRestorativeGate({
      gate: readerGate(),
      now: 3_000,
      attentionDayId: ATTENTION_DAY,
      currentDateKey: DATE_KEY,
      acceptedEvidenceDateKeys: [DATE_KEY],
      readerSessionEvidence: readerSession({ activeSeconds: 1799 }),
      meditationSubstitutionsUsed: 0,
    });
    assert.notEqual(partial.gate?.status, 'satisfied');

    const wrongSession = evaluateRestorativeGate({
      gate: readerGate(),
      now: 3_000,
      attentionDayId: ATTENTION_DAY,
      currentDateKey: DATE_KEY,
      acceptedEvidenceDateKeys: [DATE_KEY],
      readerSessionEvidence: readerSession({ sessionId: 'other-session' }),
      meditationSubstitutionsUsed: 0,
    });
    assert.notEqual(wrongSession.gate?.status, 'satisfied');

    const complete = evaluateRestorativeGate({
      gate: readerGate(),
      now: 3_000,
      attentionDayId: ATTENTION_DAY,
      currentDateKey: DATE_KEY,
      acceptedEvidenceDateKeys: [DATE_KEY],
      readerSessionEvidence: readerSession(),
      meditationSubstitutionsUsed: 0,
    });
    assert.equal(complete.gate?.status, 'satisfied');
  });

  test('requires CD4+ Meditation identity kind/source and consumes once', () => {
    const gate = meditationGate();
    const evidence = {
      sessionId: 'meditation-one',
      protocolVersion: 1,
      status: 'COMPLETED' as const,
      requiredQualifiedSeconds: 1800,
      completedQualifiedSeconds: 1800,
      completedAtEpochMs: 2_500,
      lastUpdatedAtEpochMs: 2_500,
      sessionKind: 'COOLDOWN_RESTORATIVE',
      sourceCooldownId: gate.gateId,
      sourceRhythmicDayId: ATTENTION_DAY,
    };

    assert.equal(
      isVerifiedCooldownMeditationCompletion({
        evidence,
        sessionId: 'meditation-one',
        sourceCooldownId: gate.gateId,
      }),
      true
    );
    assert.equal(
      isVerifiedCooldownMeditationCompletion({
        evidence: { ...evidence, sourceCooldownId: 'another-gate' },
        sessionId: 'meditation-one',
        sourceCooldownId: gate.gateId,
      }),
      false
    );
    assert.equal(
      isVerifiedCooldownMeditationCompletion({
        evidence: { ...evidence, sessionKind: 'MORNING_REQUIRED' },
        sessionId: 'meditation-one',
        sourceCooldownId: gate.gateId,
      }),
      false
    );
    assert.equal(
      isVerifiedCooldownMeditationCompletion({
        evidence: {
          ...evidence,
          sessionKind: undefined,
          sourceCooldownId: undefined,
          sourceRhythmicDayId: undefined,
        },
        sessionId: 'meditation-one',
        sourceCooldownId: gate.gateId,
      }),
      false
    );

    const evaluation = evaluateRestorativeGate({
      gate,
      now: 3_000,
      attentionDayId: ATTENTION_DAY,
      currentDateKey: DATE_KEY,
      acceptedEvidenceDateKeys: [DATE_KEY],
      meditationEvidence: evidence,
      meditationSubstitutionsUsed: 0,
    });
    assert.equal(evaluation.gate?.status, 'satisfied');
    assert.equal(evaluation.substitutionConsumed, true);

    const alreadyRecorded = evaluateRestorativeGate({
      gate: { ...gate, meditationSubstitutionConsumed: true },
      now: 3_000,
      attentionDayId: ATTENTION_DAY,
      currentDateKey: DATE_KEY,
      acceptedEvidenceDateKeys: [DATE_KEY],
      meditationEvidence: evidence,
      meditationSubstitutionsUsed: 1,
    });
    assert.equal(alreadyRecorded.substitutionConsumed, false);
  });
});
