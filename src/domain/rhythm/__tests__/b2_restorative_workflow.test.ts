import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  createDailyAttentionExchangeState,
  meditationCompletionsForAttentionDay,
  reconcileAttentionExchangeForAttentionDay,
  recordMeditationCompletion,
  resolveMeditationSubstitutionsUsed,
} from '../attentionExchange';
import {
  createRestorativeGateForOrdinal,
  deriveRestorativeStatus,
  evaluateRestorativeGate,
} from '../restorativeGate';
import { isVerifiedCooldownMeditationCompletion } from '../meditationEvidence';
import { processRhythmEvent } from '../events';
import { resolveAttentionDay } from '../attentionDay';
import { getLocalDateKey } from '../allowance';
import type { RhythmConfiguration, RhythmRuntime } from '../types';
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

describe('B2 PD-2 carry and owning-day debit (FR-12 / FR-16 / T06)', () => {
  test('advancing the Attention Day keeps history and starts a new day counter', () => {
    const nextDayId = 'ad-20261102-0730';
    let state = createDailyAttentionExchangeState('2026-11-01', 1_000, ATTENTION_DAY);
    state = recordMeditationCompletion(
      state,
      {
        gateId: 'gate-old-day',
        groupId: 'social',
        providerSessionId: 'm-old',
        attentionDayId: ATTENTION_DAY,
        completedAt: 1_000,
      },
      1_000
    );
    state = { ...state, meditationSubstitutionsUsed: 1 };

    const advanced = reconcileAttentionExchangeForAttentionDay(state, nextDayId, 2_000);
    assert.equal(resolveMeditationSubstitutionsUsed(advanced, ATTENTION_DAY), 1);
    assert.equal(resolveMeditationSubstitutionsUsed(advanced, nextDayId), 0);
    assert.equal(advanced.meditationSubstitutionsUsed, 0);
  });

  test('an unfinished restorative gate survives the Attention-Day boundary', () => {
    const currentDayId = 'ad-20261102-0730';
    const gate = {
      ...readerGate(),
      status: 'in-progress' as const,
      attentionDayId: ATTENTION_DAY,
    };
    const evaluation = evaluateRestorativeGate({
      gate,
      now: 3_000,
      attentionDayId: currentDayId,
      currentDateKey: '2026-11-02',
      acceptedEvidenceDateKeys: ['2026-11-02', '2026-11-01'],
      meditationSubstitutionsUsed: 0,
    });
    assert.ok(evaluation.gate);
    assert.equal(evaluation.gate?.gateId, gate.gateId);
    assert.equal(evaluation.gate?.attentionDayId, ATTENTION_DAY);
    assert.equal(evaluation.gate?.cooldownEndsAt, 2_000);

    const view = deriveRestorativeStatus({
      groupId: 'social',
      gate,
      cooldownEndsAt: 2_000,
      now: 3_000,
      attentionDayId: currentDayId,
      currentDateKey: '2026-11-02',
      acceptedEvidenceDateKeys: ['2026-11-02', '2026-11-01'],
      meditationSubstitutionsUsed: 0,
    });
    assert.equal(view.gateId, gate.gateId);
    assert.notEqual(view.phase, 'complete');
  });

  test('late Meditation completion is charged once to the original day; current day is unchanged', () => {
    const now = new Date(2026, 10, 2, 12, 0, 0).getTime();
    const currentDayId = resolveAttentionDay(now, []).id;
    const config: RhythmConfiguration = { apps: [], riskGroups: [], routineWindows: [] };
    const daily = {
      ...createDailyAttentionExchangeState(getLocalDateKey(now), now, currentDayId),
      // The new day already consumed one substitution independently.
      meditationSubstitutionsUsed: 1,
    };
    const gate = {
      ...(createRestorativeGateForOrdinal({
        groupId: 'social',
        attentionDayId: ATTENTION_DAY,
        dailyCooldownOrdinal: 4,
        createdAt: now - 24 * 60 * 60 * 1000,
        cooldownEndsAt: now - 1_000,
        gateId: 'gate-late-meditation',
      })!),
      selectedProvider: 'meditation' as const,
      providerSessionId: 'm-late',
      status: 'in-progress' as const,
    };
    const runtime: RhythmRuntime = {
      state: 'available',
      activeCooldowns: {},
      activeAccessLeases: {},
      activeRoutineWindowIds: [],
      activeRestrictions: [],
      dailyAttentionExchange: daily,
      activeRestorativeGates: { social: gate },
      nativeAttentionAuthority: false,
    };
    const evidence = {
      sessionId: 'm-late',
      protocolVersion: 1,
      status: 'COMPLETED' as const,
      requiredQualifiedSeconds: 1800,
      completedQualifiedSeconds: 1800,
      completedAtEpochMs: now,
      lastUpdatedAtEpochMs: now,
      sessionKind: 'COOLDOWN_RESTORATIVE',
      sourceCooldownId: gate.gateId,
      sourceRhythmicDayId: ATTENTION_DAY,
    };

    const first = processRhythmEvent(
      runtime,
      { type: 'SYNC_MEDITATION_EVIDENCE', evidence, timestamp: now },
      config
    ).nextRuntime;
    assert.equal(first.activeRestorativeGates?.['social']?.status, 'satisfied');
    assert.equal(first.activeRestorativeGates?.['social']?.attentionDayId, ATTENTION_DAY);
    assert.equal(
      resolveMeditationSubstitutionsUsed(first.dailyAttentionExchange!, ATTENTION_DAY),
      1
    );
    assert.equal(
      resolveMeditationSubstitutionsUsed(first.dailyAttentionExchange!, currentDayId),
      1
    );
    assert.equal(first.dailyAttentionExchange?.meditationSubstitutionsUsed, 1);

    // Repeats/imports/restart projection never double-debit either day.
    const repeated = processRhythmEvent(
      first,
      { type: 'SYNC_MEDITATION_EVIDENCE', evidence, timestamp: now + 1_000 },
      config
    ).nextRuntime;
    assert.equal(
      resolveMeditationSubstitutionsUsed(repeated.dailyAttentionExchange!, ATTENTION_DAY),
      1
    );
    assert.equal(
      resolveMeditationSubstitutionsUsed(repeated.dailyAttentionExchange!, currentDayId),
      1
    );
  });

  test('carried-gate provider selection uses the owning-day cap, not the current day', () => {
    const now = new Date(2026, 10, 2, 12, 0, 0).getTime();
    const currentDayId = resolveAttentionDay(now, []).id;
    const config: RhythmConfiguration = { apps: [], riskGroups: [], routineWindows: [] };

    let daily = createDailyAttentionExchangeState(getLocalDateKey(now), now, currentDayId);
    daily = recordMeditationCompletion(
      daily,
      {
        gateId: 'gate-b-used-1',
        groupId: 'other-b1',
        providerSessionId: 'm-b1',
        attentionDayId: currentDayId,
        completedAt: now,
      },
      now
    );
    daily = recordMeditationCompletion(
      daily,
      {
        gateId: 'gate-b-used-2',
        groupId: 'other-b2',
        providerSessionId: 'm-b2',
        attentionDayId: currentDayId,
        completedAt: now + 1,
      },
      now + 1
    );
    assert.equal(resolveMeditationSubstitutionsUsed(daily, currentDayId), 2);

    const carriedGate = createRestorativeGateForOrdinal({
      groupId: 'social',
      attentionDayId: ATTENTION_DAY,
      dailyCooldownOrdinal: 4,
      createdAt: now - 24 * 60 * 60 * 1000,
      cooldownEndsAt: now - 1_000,
      gateId: 'gate-carried-a',
    })!;
    const runtime: RhythmRuntime = {
      state: 'available',
      activeCooldowns: {},
      activeAccessLeases: {},
      activeRoutineWindowIds: [],
      activeRestrictions: [],
      dailyAttentionExchange: daily,
      activeRestorativeGates: { social: carriedGate },
      nativeAttentionAuthority: false,
    };

    const selected = processRhythmEvent(
      runtime,
      {
        type: 'SELECT_RESTORATIVE_PROVIDER',
        groupId: 'social',
        provider: 'meditation',
        providerSessionId: 'm-carried-a',
        timestamp: now,
      },
      config
    ).nextRuntime;

    assert.equal(selected.activeRestorativeGates?.['social']?.selectedProvider, 'meditation');
    assert.equal(selected.activeRestorativeGates?.['social']?.providerSessionId, 'm-carried-a');
    assert.equal(selected.activeRestorativeGates?.['social']?.attentionDayId, ATTENTION_DAY);
    assert.equal(
      resolveMeditationSubstitutionsUsed(selected.dailyAttentionExchange!, currentDayId),
      2
    );
  });

  test('carried-gate selection is still rejected when its OWNING day cap is exhausted', () => {
    const now = new Date(2026, 10, 2, 12, 0, 0).getTime();
    const currentDayId = resolveAttentionDay(now, []).id;
    const config: RhythmConfiguration = { apps: [], riskGroups: [], routineWindows: [] };

    let daily = createDailyAttentionExchangeState(getLocalDateKey(now), now, currentDayId);
    daily = recordMeditationCompletion(
      daily,
      {
        gateId: 'gate-a-used-1',
        groupId: 'other-a1',
        providerSessionId: 'm-a1',
        attentionDayId: ATTENTION_DAY,
        completedAt: now,
      },
      now
    );
    daily = recordMeditationCompletion(
      daily,
      {
        gateId: 'gate-a-used-2',
        groupId: 'other-a2',
        providerSessionId: 'm-a2',
        attentionDayId: ATTENTION_DAY,
        completedAt: now + 1,
      },
      now + 1
    );
    assert.equal(resolveMeditationSubstitutionsUsed(daily, ATTENTION_DAY), 2);
    assert.equal(resolveMeditationSubstitutionsUsed(daily, currentDayId), 0);

    const carriedGate = createRestorativeGateForOrdinal({
      groupId: 'social',
      attentionDayId: ATTENTION_DAY,
      dailyCooldownOrdinal: 4,
      createdAt: now - 24 * 60 * 60 * 1000,
      cooldownEndsAt: now - 1_000,
      gateId: 'gate-carried-a-used',
    })!;
    const runtime: RhythmRuntime = {
      state: 'available',
      activeCooldowns: {},
      activeAccessLeases: {},
      activeRoutineWindowIds: [],
      activeRestrictions: [],
      dailyAttentionExchange: daily,
      activeRestorativeGates: { social: carriedGate },
      nativeAttentionAuthority: false,
    };

    const blocked = processRhythmEvent(
      runtime,
      {
        type: 'SELECT_RESTORATIVE_PROVIDER',
        groupId: 'social',
        provider: 'meditation',
        providerSessionId: 'm-should-not-bind',
        timestamp: now,
      },
      config
    ).nextRuntime;

    assert.equal(blocked.activeRestorativeGates?.['social']?.selectedProvider, undefined);
    assert.equal(blocked.activeRestorativeGates?.['social']?.providerSessionId, undefined);
    assert.equal(
      resolveMeditationSubstitutionsUsed(blocked.dailyAttentionExchange!, ATTENTION_DAY),
      2
    );
  });

  test('a wrong bound completion still holds the carried gate', () => {
    const now = new Date(2026, 10, 2, 12, 0, 0).getTime();
    const currentDayId = resolveAttentionDay(now, []).id;
    const config: RhythmConfiguration = { apps: [], riskGroups: [], routineWindows: [] };
    const gate = {
      ...(createRestorativeGateForOrdinal({
        groupId: 'social',
        attentionDayId: ATTENTION_DAY,
        dailyCooldownOrdinal: 4,
        createdAt: now - 24 * 60 * 60 * 1000,
        cooldownEndsAt: now - 1_000,
        gateId: 'gate-wrong-bound',
      })!),
      selectedProvider: 'meditation' as const,
      providerSessionId: 'm-wrong',
      status: 'in-progress' as const,
    };
    const runtime: RhythmRuntime = {
      state: 'available',
      activeCooldowns: {},
      activeAccessLeases: {},
      activeRoutineWindowIds: [],
      activeRestrictions: [],
      dailyAttentionExchange: {
        ...createDailyAttentionExchangeState(getLocalDateKey(now), now, currentDayId),
        meditationSubstitutionsUsed: 1,
      },
      activeRestorativeGates: { social: gate },
      nativeAttentionAuthority: false,
    };
    const wrong = processRhythmEvent(
      runtime,
      {
        type: 'SYNC_MEDITATION_EVIDENCE',
        evidence: {
          sessionId: 'm-wrong',
          protocolVersion: 1,
          status: 'COMPLETED',
          requiredQualifiedSeconds: 1800,
          completedQualifiedSeconds: 1800,
          completedAtEpochMs: now,
          lastUpdatedAtEpochMs: now,
          sessionKind: 'COOLDOWN_RESTORATIVE',
          sourceCooldownId: 'some-other-gate',
          sourceRhythmicDayId: ATTENTION_DAY,
        },
        timestamp: now,
      },
      config
    ).nextRuntime;

    assert.notEqual(wrong.activeRestorativeGates?.['social']?.status, 'satisfied');
    assert.equal(
      resolveMeditationSubstitutionsUsed(wrong.dailyAttentionExchange!, currentDayId),
      1
    );
    assert.equal(
      resolveMeditationSubstitutionsUsed(wrong.dailyAttentionExchange!, ATTENTION_DAY),
      0
    );
  });
});
