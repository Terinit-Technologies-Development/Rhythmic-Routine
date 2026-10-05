import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { initialApps, initialRiskGroups } from '../../../data/mockData';
import { RhythmEngine } from '../RhythmEngine';
import {
  ActiveReadingGate,
  allocateCooldownRequirement,
  createDailyAttentionExchangeState,
  deriveAttentionGateStatus,
  isReadingRequirementSatisfied,
  isTrustedEvidenceForDate,
  legacyReadingRequirementForCooldownOrdinal,
  migrateDailyAttentionExchange,
  reconcileAttentionExchangeDate,
  remainingReadingRequirement,
  requirementForCooldownOrdinal,
} from '../attentionExchange';
import { getLocalDateKey } from '../allowance';
import { RhythmConfiguration } from '../types';
import { ReadingEvidenceSnapshot } from '../readingEvidence';
import { resolveAttentionDay } from '../attentionDay';

const config: RhythmConfiguration = {
  apps: initialApps,
  riskGroups: initialRiskGroups,
  routineWindows: [],
};

function localTime(year: number, month: number, day: number, hour: number, minute = 0): number {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

function evidence(dateKey: string, seconds: number, pages: number): ReadingEvidenceSnapshot {
  return {
    dateKey,
    providerAvailable: true,
    protocolCompatible: true,
    verifiedActiveSeconds: seconds,
    qualifiedPages: pages,
    readerUpdatedAtEpochMs: 1,
    syncedAtEpochMs: 2,
  };
}

function startThirdOrdinalCooldown(
  engine: RhythmEngine,
  start: number,
  end: number
): void {
  engine.dispatch({ type: 'COOLDOWN_STARTED', groupId: 'social', endsAt: end, timestamp: start });
  engine.dispatch({ type: 'COOLDOWN_STARTED', groupId: 'entertainment', endsAt: end, timestamp: start + 1 });
  engine.dispatch({ type: 'COOLDOWN_STARTED', groupId: 'social', endsAt: end, timestamp: start + 2 });
}

describe('v1.2 Productive Attention Exchange domain', () => {
  test('Pass 3 discrete policy yields the exact global ordinal boundaries', () => {
    assert.deepEqual(
      Array.from({ length: 7 }, (_, i) => {
        const value = requirementForCooldownOrdinal(i + 1);
        return [value.activeSeconds, value.qualifiedPages];
      }),
      [
        [0, 0],
        [0, 0],
        [3600, 36],
        [1800, 11],
        [1800, 11],
        [1800, 11],
        [1800, 11],
      ]
    );
  });

  test('Pass 3 regression: ordinal 4 must NOT be the v1.2 cumulative 5400/47', () => {
    const ordinal4 = requirementForCooldownOrdinal(4);
    assert.notDeepEqual(ordinal4, { activeSeconds: 5400, qualifiedPages: 47 });
    assert.deepEqual(ordinal4, { activeSeconds: 1800, qualifiedPages: 11 });
    // The cumulative formula survives ONLY as the legacy audit/migration path.
    assert.deepEqual(legacyReadingRequirementForCooldownOrdinal(4), {
      activeSeconds: 5400,
      qualifiedPages: 47,
    });
  });

  test('allocates ordinals globally across Risk Groups and never uses cycleRevision', () => {
    const now = localTime(2026, 9, 24, 12);
    let daily = createDailyAttentionExchangeState(getLocalDateKey(now), now);
    const engine = new RhythmEngine(config, {
      state: 'available',
      activeCooldowns: {},
      activeAccessLeases: {},
      activeRoutineWindowIds: [],
      groupAllowanceUsage: {
        social: {
          groupId: 'social',
          dateKey: getLocalDateKey(now),
          usedSeconds: 0,
          cycleRevision: 99,
        },
      },
      lastReconciledAt: now,
    }, now);

    const ordinals: number[] = [];
    for (const [groupId, minute] of [['social', 0], ['entertainment', 1], ['social', 2]] as const) {
      const allocated = allocateCooldownRequirement(daily, now + minute * 60_000);
      daily = allocated.nextState;
      ordinals.push(allocated.ordinal);
      engine.dispatch({
        type: 'COOLDOWN_STARTED',
        groupId,
        endsAt: now + (minute + 90) * 60_000,
        timestamp: now + minute * 60_000,
      });
    }

    assert.deepEqual(ordinals, [1, 2, 3]);
    assert.equal(engine.getRuntime().activeCooldowns.social?.dailyCooldownOrdinal, 3);
    assert.equal(engine.getRuntime().activeCooldowns.entertainment?.dailyCooldownOrdinal, 2);
    assert.equal(engine.getRuntime().dailyAttentionExchange?.cooldownsTriggered, 3);
    assert.equal(engine.getAttentionGateStatus('entertainment', now + 3).phase, 'cooldown-active');
    assert.equal(engine.getAttentionGateStatus('entertainment', now + 3).requiredReadingSeconds, 0);
  });

  test('proactive reading satisfies smaller requirements while both dimensions remain mandatory', () => {
    const proactiveEvidence = { verifiedActiveSeconds: 95 * 60, qualifiedPages: 50 };
    assert.equal(isReadingRequirementSatisfied(proactiveEvidence, requirementForCooldownOrdinal(3)), true);
    assert.equal(isReadingRequirementSatisfied(proactiveEvidence, requirementForCooldownOrdinal(4)), true);
    assert.deepEqual(
      remainingReadingRequirement(proactiveEvidence, requirementForCooldownOrdinal(5)),
      { activeSeconds: 0, qualifiedPages: 0 }
    );
    assert.equal(
      isReadingRequirementSatisfied({ verifiedActiveSeconds: 3600, qualifiedPages: 35 }, { activeSeconds: 3600, qualifiedPages: 36 }),
      false
    );
    assert.equal(
      isReadingRequirementSatisfied({ verifiedActiveSeconds: 3599, qualifiedPages: 60 }, { activeSeconds: 3600, qualifiedPages: 36 }),
      false
    );
    assert.equal(isReadingRequirementSatisfied({ verifiedActiveSeconds: 3600, qualifiedPages: 36 }, { activeSeconds: 3600, qualifiedPages: 36 }), true);
    assert.equal(isReadingRequirementSatisfied({ verifiedActiveSeconds: 6000, qualifiedPages: 50 }, { activeSeconds: 5400, qualifiedPages: 47 }), true);
  });

  test('a gate survives a satisfied reading target until its cooldown ends', () => {
    const start = localTime(2026, 9, 24, 12);
    const end = start + 60 * 60_000;
    const dateKey = getLocalDateKey(start);
    const engine = new RhythmEngine(config, null, start);
    startThirdOrdinalCooldown(engine, start, end);
    engine.dispatch({
      type: 'SYNC_DAILY_READING_EVIDENCE',
      evidence: evidence(dateKey, 3600, 36),
      timestamp: start + 3,
    });

    assert.ok(engine.getRuntime().activeReadingGates?.social);
    assert.equal(engine.getAttentionGateStatus('social', start + 4).phase, 'cooldown-active');
    engine.dispatch({ type: 'RECONCILE', timestamp: end });
    assert.equal(engine.getRuntime().activeReadingGates?.social, undefined);
    assert.equal(engine.getAttentionGateStatus('social', end).phase, 'none');
  });

  test('expired incomplete gate remains required and can be cleared by later evidence', () => {
    const start = localTime(2026, 9, 24, 12);
    const end = start + 30 * 60_000;
    const dateKey = getLocalDateKey(start);
    const engine = new RhythmEngine(config, null, start);
    startThirdOrdinalCooldown(engine, start, end);
    engine.dispatch({ type: 'RECONCILE', timestamp: end });

    assert.equal(engine.getRuntime().activeCooldowns.social, undefined);
    assert.ok(engine.getRuntime().activeReadingGates?.social);
    assert.equal(engine.getAttentionGateStatus('social', end).phase, 'reader-unavailable');

    engine.dispatch({
      type: 'SYNC_DAILY_READING_EVIDENCE',
      evidence: evidence(dateKey, 3599, 36),
      timestamp: end + 1,
    });
    assert.equal(engine.getAttentionGateStatus('social', end + 1).phase, 'reading-required');

    engine.dispatch({
      type: 'SYNC_DAILY_READING_EVIDENCE',
      evidence: evidence(dateKey, 3600, 36),
      timestamp: end + 2,
    });
    assert.equal(engine.getRuntime().activeReadingGates?.social, undefined);
  });

  test('Reader unavailable and incompatible evidence never satisfies a requirement', () => {
    const dateKey = '2026-09-24';
    const requirement = requirementForCooldownOrdinal(3);
    const unavailable = evidence(dateKey, 3600, 36);
    unavailable.providerAvailable = false;
    const incompatible = evidence(dateKey, 3600, 36);
    incompatible.protocolCompatible = false;
    assert.equal(isTrustedEvidenceForDate(unavailable, dateKey), false);
    assert.equal(isTrustedEvidenceForDate(incompatible, dateKey), false);

    const gate: ActiveReadingGate = {
      groupId: 'social',
      attentionDateKey: dateKey,
      dailyCooldownOrdinal: 3,
      createdAt: 1,
      cooldownEndsAt: 1,
      requiredReadingSeconds: requirement.activeSeconds,
      requiredQualifiedPages: requirement.qualifiedPages,
    };
    for (const badEvidence of [unavailable, incompatible]) {
      assert.equal(
        deriveAttentionGateStatus({
          gate,
          evidence: badEvidence,
          now: 2,
          currentDateKey: dateKey,
        }).phase,
        badEvidence.providerAvailable ? 'reader-incompatible' : 'reader-unavailable'
      );
    }
  });

  test('midnight resets daily totals and gates but preserves a cross-midnight timer', () => {
    const start = localTime(2026, 9, 24, 23, 50);
    const end = start + 60 * 60_000;
    const midnight = localTime(2026, 9, 25, 0, 0);
    const engine = new RhythmEngine(config, null, start);
    startThirdOrdinalCooldown(engine, start, end);
    engine.dispatch({
      type: 'SYNC_DAILY_READING_EVIDENCE',
      evidence: evidence(getLocalDateKey(start), 1200, 10),
      timestamp: start + 3,
    });
    engine.dispatch({ type: 'CLOCK_TICK', timestamp: midnight });

    const runtime = engine.getRuntime();
    assert.equal(runtime.dailyAttentionExchange?.dateKey, getLocalDateKey(midnight));
    assert.equal(runtime.dailyAttentionExchange?.cooldownsTriggered, 0);
    assert.equal(runtime.dailyAttentionExchange?.highestRequiredActiveSeconds, 0);
    assert.deepEqual(runtime.activeReadingGates, {});
    assert.equal(runtime.activeCooldowns.social?.endsAt, end);
    assert.equal(runtime.readingEvidence, undefined);
    assert.equal(engine.getAttentionGateStatus('social', midnight).phase, 'cooldown-active');
    assert.equal(engine.getAttentionGateStatus('social', midnight).requiredQualifiedPages, 0);
  });

  test('runtime persistence restores ordinal, gates, cached evidence, and cooldown snapshots defensively', () => {
    const start = localTime(2026, 9, 24, 12);
    const end = start + 90 * 60_000;
    const dateKey = getLocalDateKey(start);
    const engine = new RhythmEngine(config, null, start);
    engine.dispatch({ type: 'COOLDOWN_STARTED', groupId: 'social', endsAt: end, timestamp: start });
    engine.dispatch({ type: 'COOLDOWN_STARTED', groupId: 'entertainment', endsAt: end, timestamp: start + 1 });
    engine.dispatch({ type: 'COOLDOWN_STARTED', groupId: 'social', endsAt: end, timestamp: start + 2 });
    engine.dispatch({
      type: 'SYNC_DAILY_READING_EVIDENCE',
      evidence: evidence(dateKey, 120, 2),
      timestamp: start + 3,
    });

    const persisted = engine.toPersistedRuntime(start + 4);
    const restored = new RhythmEngine(config, persisted, start + 5).getRuntime();
    assert.equal(restored.dailyAttentionExchange?.cooldownsTriggered, 3);
    assert.equal(restored.activeCooldowns.social?.dailyCooldownOrdinal, 3);
    assert.equal(restored.activeCooldowns.social?.requiredQualifiedPages, 36);
    assert.equal(restored.activeReadingGates?.social?.dailyCooldownOrdinal, 3);
    assert.deepEqual(restored.readingEvidence, evidence(dateKey, 120, 2));

    const returned = engine.getRuntime();
    returned.dailyAttentionExchange!.cooldownsTriggered = 900;
    returned.activeReadingGates!.social!.requiredQualifiedPages = 900;
    returned.readingEvidence!.qualifiedPages = 900;
    returned.activeCooldowns.social!.requiredQualifiedPages = 900;
    assert.equal(engine.getRuntime().dailyAttentionExchange?.cooldownsTriggered, 3);
    assert.equal(engine.getRuntime().activeReadingGates?.social?.requiredQualifiedPages, 36);
    assert.equal(engine.getRuntime().readingEvidence?.qualifiedPages, 2);
    assert.equal(engine.getRuntime().activeCooldowns.social?.requiredQualifiedPages, 36);
  });

  test('pre-v1.2 current-day cooldowns count conservatively without retroactive reading gates', () => {
    const now = localTime(2026, 9, 24, 12);
    const legacy = {
      state: 'cooldown' as const,
      activeCooldowns: {
        social: { groupId: 'social', startedAt: now - 60_000, endsAt: now + 60 * 60_000 },
        entertainment: { groupId: 'entertainment', startedAt: now - 30_000, endsAt: now + 30 * 60_000 },
      },
      activeAccessLeases: {},
      activeRoutineWindowIds: [],
      lastReconciledAt: now,
    };
    const migrated = migrateDailyAttentionExchange(legacy.activeCooldowns, now, {});
    const engine = new RhythmEngine(config, legacy, now);

    assert.equal(migrated.cooldownsTriggered, 2);
    assert.equal(engine.getRuntime().dailyAttentionExchange?.cooldownsTriggered, 2);
    assert.equal(engine.getRuntime().activeReadingGates && Object.keys(engine.getRuntime().activeReadingGates!).length, 0);
    assert.equal(engine.getRuntime().activeCooldowns.social?.dailyCooldownOrdinal, undefined);
  });

  test('deleting a Risk Group removes only its gate; an access lease does not satisfy it', () => {
    const now = localTime(2026, 9, 24, 12);
    const engine = new RhythmEngine(config, null, now);
    engine.dispatch({ type: 'COOLDOWN_STARTED', groupId: 'social', endsAt: now + 60 * 60_000, timestamp: now });
    engine.dispatch({ type: 'COOLDOWN_STARTED', groupId: 'entertainment', endsAt: now + 60 * 60_000, timestamp: now + 1 });
    engine.dispatch({ type: 'COOLDOWN_STARTED', groupId: 'social', endsAt: now + 60 * 60_000, timestamp: now + 2 });
    engine.dispatch({
      type: 'START_ACCESS_LEASE',
      groupId: 'social',
      durationMinutes: 10,
      reason: 'emergency',
      timestamp: now + 3,
    });
    assert.ok(engine.getRuntime().activeReadingGates?.social);
    assert.equal(engine.getRuntime().dailyAttentionExchange?.cooldownsTriggered, 3);
    assert.equal(engine.getRuntime().readingEvidence, undefined);

    engine.dispatch({ type: 'RISK_GROUP_DELETED', groupId: 'social', timestamp: now + 4 });
    assert.equal(engine.getRuntime().activeReadingGates?.social, undefined);
    assert.equal(engine.getRuntime().dailyAttentionExchange?.cooldownsTriggered, 3);
  });

  test('native authority keeps expired reading gates through JS evidence sync and access leases', () => {
    const now = localTime(2026, 9, 24, 12);
    const dateKey = getLocalDateKey(now);
    const gate: ActiveReadingGate = {
      groupId: 'social',
      attentionDateKey: dateKey,
      dailyCooldownOrdinal: 3,
      createdAt: now - 90 * 60_000,
      cooldownEndsAt: now - 1,
      requiredReadingSeconds: 3600,
      requiredQualifiedPages: 36,
    };
    const engine = new RhythmEngine(config, null, now);
    engine.dispatch({
      type: 'SYNC_NATIVE_ATTENTION_EXCHANGE',
      dailyAttentionExchange: {
        dateKey,
        cooldownsTriggered: 3,
        highestRequiredActiveSeconds: 3600,
        highestRequiredQualifiedPages: 36,
        updatedAt: now,
      },
      activeReadingGates: { social: gate },
      activeCooldowns: {},
      activeAccessLeases: {},
      groupAllowanceUsage: {},
      timestamp: now,
    });
    engine.dispatch({
      type: 'SYNC_DAILY_READING_EVIDENCE',
      evidence: evidence(dateKey, 3600, 36),
      timestamp: now + 1,
    });

    let runtime = engine.getRuntime();
    assert.equal(runtime.nativeAttentionAuthority, true);
    assert.ok(runtime.activeReadingGates?.social);
    assert.ok(runtime.activeRestrictions.some((restriction) =>
      restriction.reasons.some((reason) => reason.type === 'reading-quota' && reason.sourceId === 'social')
    ));

    engine.dispatch({
      type: 'START_ACCESS_LEASE',
      groupId: 'social',
      durationMinutes: 1,
      timestamp: now + 2,
    });
    runtime = engine.getRuntime();
    assert.ok(runtime.activeReadingGates?.social, 'access lease must not remove native gate state');
    assert.equal(runtime.activeRestrictions.some((restriction) => restriction.appId === 'instagram'), false);

    engine.dispatch({ type: 'RECONCILE', timestamp: now + 60_003 });
    runtime = engine.getRuntime();
    assert.ok(runtime.activeReadingGates?.social, 'JS expiry must not satisfy a native gate');
    assert.ok(runtime.activeRestrictions.some((restriction) => restriction.appId === 'instagram'));

    engine.dispatch({
      type: 'SYNC_NATIVE_ATTENTION_EXCHANGE',
      dailyAttentionExchange: {
        dateKey,
        cooldownsTriggered: 3,
        highestRequiredActiveSeconds: 3600,
        highestRequiredQualifiedPages: 36,
        updatedAt: now + 60_004,
      },
      activeReadingGates: {},
      activeCooldowns: {},
      activeAccessLeases: {},
      groupAllowanceUsage: {},
      readingEvidence: evidence(dateKey, 3600, 36),
      timestamp: now + 60_004,
    });
    assert.equal(engine.getRuntime().activeReadingGates?.social, undefined);
  });

  test('repeated native restoration allocates one ordinal for a newly observed cooldown', () => {
    const now = localTime(2026, 9, 24, 12);
    const engine = new RhythmEngine(config, null, now);
    const restore = {
      type: 'NATIVE_COOLDOWN_RESTORED' as const,
      groupId: 'social',
      endsAt: now + 60 * 60_000,
      timestamp: now,
    };
    engine.dispatch(restore);
    engine.dispatch(restore);
    assert.equal(engine.getRuntime().dailyAttentionExchange?.cooldownsTriggered, 1);
    assert.equal(engine.getRuntime().activeCooldowns.social?.dailyCooldownOrdinal, 1);
  });

  test('calendar-date reconciliation preserves Attention Day counters across midnight', () => {
    const firstDay = localTime(2026, 9, 24, 12);
    const nextDay = localTime(2026, 9, 25, 0, 1);
    const state = {
      dateKey: getLocalDateKey(firstDay),
      cooldownsTriggered: 4,
      highestRequiredActiveSeconds: 5400,
      highestRequiredQualifiedPages: 47,
      updatedAt: firstDay,
      attentionDayId: 'ad-20260924-0730',
      attentionDayNextBoundaryAt: localTime(2026, 9, 25, 7, 30),
      meditationSubstitutionsUsed: 2,
    };
    assert.deepEqual(reconcileAttentionExchangeDate(state, nextDay), {
      dateKey: getLocalDateKey(nextDay),
      cooldownsTriggered: 4,
      highestRequiredActiveSeconds: 5400,
      highestRequiredQualifiedPages: 47,
      updatedAt: nextDay,
      attentionDayId: 'ad-20260924-0730',
      attentionDayNextBoundaryAt: localTime(2026, 9, 25, 7, 30),
      meditationSubstitutionsUsed: 2,
    });
  });

  test('editing Morning Buffer time keeps the active gate and counters until the next edited boundary', () => {
    const start = localTime(2026, 9, 27, 12);
    const morningBuffer = (endTime: string) => ({
      id: 'morning-buffer',
      name: 'Morning Buffer',
      type: 'morning-buffer' as const,
      startTime: '06:30',
      endTime,
      activeDays: [1, 2, 3, 4, 5, 6, 7],
      protectedGroupIds: [],
      enabled: true,
      tagline: '',
      description: '',
    });
    const beforeEdit: RhythmConfiguration = {
      ...config,
      routineWindows: [morningBuffer('07:30')],
    };
    const engine = new RhythmEngine(beforeEdit, null, start);
    ['social', 'entertainment', 'social', 'social'].forEach((groupId, index) => {
      engine.dispatch({
        type: 'COOLDOWN_STARTED',
        groupId,
        endsAt: start + 90 * 60_000 + index,
        timestamp: start + index,
      });
    });

    const original = engine.getRuntime();
    const originalGate = original.activeRestorativeGates?.social;
    assert.ok(originalGate);
    assert.equal(originalGate.dailyCooldownOrdinal, 4);
    assert.equal(originalGate.requirementKind, 'restorative-choice');

    const editedSchedule: RhythmConfiguration = {
      ...beforeEdit,
      routineWindows: [morningBuffer('08:30')],
    };
    engine.updateConfiguration(editedSchedule, start + 5);

    let afterEdit = engine.getRuntime();
    assert.equal(afterEdit.dailyAttentionExchange?.attentionDayId, originalGate.attentionDayId);
    assert.equal(afterEdit.dailyAttentionExchange?.cooldownsTriggered, 4);
    assert.deepEqual(afterEdit.activeRestorativeGates?.social, originalGate);

    const nextBoundary = resolveAttentionDay(start + 5, editedSchedule.routineWindows).nextBoundaryAt;
    engine.reconcile(nextBoundary - 1);
    afterEdit = engine.getRuntime();
    assert.equal(afterEdit.dailyAttentionExchange?.attentionDayId, originalGate.attentionDayId);
    assert.deepEqual(afterEdit.activeRestorativeGates?.social, originalGate);

    engine.reconcile(nextBoundary);
    const nextDay = engine.getRuntime();
    assert.equal(nextDay.dailyAttentionExchange?.attentionDayId, resolveAttentionDay(nextBoundary, editedSchedule.routineWindows).id);
    assert.equal(nextDay.dailyAttentionExchange?.cooldownsTriggered, 0);
    assert.equal(nextDay.activeRestorativeGates?.social, undefined);
  });
});
