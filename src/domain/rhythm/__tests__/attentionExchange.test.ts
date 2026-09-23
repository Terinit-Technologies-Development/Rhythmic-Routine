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
  migrateDailyAttentionExchange,
  reconcileAttentionExchangeDate,
  remainingReadingRequirement,
  requirementForCooldownOrdinal,
} from '../attentionExchange';
import { getLocalDateKey } from '../allowance';
import { RhythmConfiguration } from '../types';
import { ReadingEvidenceSnapshot } from '../readingEvidence';

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
  test('fixed policy yields the exact global ordinal boundaries', () => {
    assert.deepEqual(
      Array.from({ length: 7 }, (_, i) => {
        const value = requirementForCooldownOrdinal(i + 1);
        return [value.activeSeconds, value.qualifiedPages];
      }),
      [
        [0, 0],
        [0, 0],
        [3600, 36],
        [5400, 47],
        [7200, 58],
        [9000, 69],
        [10800, 80],
      ]
    );
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
      { activeSeconds: 25 * 60, qualifiedPages: 8 }
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

  test('date reconciliation creates a zeroed daily state', () => {
    const firstDay = localTime(2026, 9, 24, 12);
    const nextDay = localTime(2026, 9, 25, 12);
    const state = {
      dateKey: getLocalDateKey(firstDay),
      cooldownsTriggered: 4,
      highestRequiredActiveSeconds: 5400,
      highestRequiredQualifiedPages: 47,
      updatedAt: firstDay,
    };
    assert.deepEqual(reconcileAttentionExchangeDate(state, nextDay), {
      dateKey: getLocalDateKey(nextDay),
      cooldownsTriggered: 0,
      highestRequiredActiveSeconds: 0,
      highestRequiredQualifiedPages: 0,
      updatedAt: nextDay,
    });
  });
});
