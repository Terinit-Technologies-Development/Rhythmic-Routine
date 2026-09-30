import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  normalizePersistedRuntime,
  RESTORATIVE_MIGRATION_VERSION,
  type PersistedRuntime,
  type RhythmConfiguration,
} from '../types';
import { RhythmEngine } from '../RhythmEngine';
import { initialApps, initialRiskGroups } from '../../../data/mockData';
import type { ActiveRestorativeGate } from '../restorativeGate';
import { getLocalDateKey } from '../allowance';
import { resolveAttentionDay } from '../attentionDay';

/**
 * Pass 3 — v1.2 activeReadingGate migration (spec 41-42, 54) and parallel
 * Risk Group allocation (spec 52).
 */

const NOW = 1_700_000_000_000;

/** A v1.2 persisted state with an active cumulative gate (ordinal 4 / 5400 / 47). */
function seedV12Runtime(): Record<string, unknown> {
  const dateKey = getLocalDateKey(NOW);
  return {
    state: 'cooldown',
    activeCooldowns: {
      social: {
        groupId: 'social',
        startedAt: NOW - 60_000,
        endsAt: NOW + 89 * 60_000,
        dailyCooldownOrdinal: 4,
        attentionDateKey: dateKey,
        requiredReadingSeconds: 5400,
        requiredQualifiedPages: 47,
      },
    },
    activeAccessLeases: {},
    activeRoutineWindowIds: [],
    dailyAttentionExchange: {
      dateKey,
      cooldownsTriggered: 4,
      highestRequiredActiveSeconds: 5400,
      highestRequiredQualifiedPages: 47,
      updatedAt: NOW,
    },
    activeReadingGates: {
      social: {
        groupId: 'social',
        attentionDateKey: dateKey,
        dailyCooldownOrdinal: 4,
        createdAt: NOW - 60_000,
        cooldownEndsAt: NOW + 89 * 60_000,
        requiredReadingSeconds: 5400,
        requiredQualifiedPages: 47,
      },
    },
    lastReconciledAt: NOW,
  };
}

describe('Pass 3 — v1.2 activeReadingGate migration (spec 41, 54)', () => {
  test('an active 5400s/47p gate migrates to LEGACY_READING with the same numbers', () => {
    const migrated = normalizePersistedRuntime(seedV12Runtime(), NOW) as PersistedRuntime;

    assert.equal(migrated.restorativeMigrationVersion, RESTORATIVE_MIGRATION_VERSION);
    const gate = migrated.activeRestorativeGates?.social as ActiveRestorativeGate;
    assert.ok(gate, 'the migrated gate must exist');
    assert.equal(gate.requirementKind, 'legacy-reading');
    assert.equal(gate.requiredReadingSeconds, 5400);
    assert.equal(gate.requiredQualifiedPages, 47);
    assert.equal(gate.dailyCooldownOrdinal, 4);
    assert.equal(gate.groupId, 'social');
    assert.equal(gate.cooldownEndsAt, NOW + 89 * 60_000);
    assert.equal(gate.gateId, 'legacy-gate-social');
    // Never silently converted to the new 1800/11 choice.
    assert.notEqual(gate.requiredReadingSeconds, 1800);
    assert.notEqual(gate.requiredQualifiedPages, 11);
    // The v1.2 compat view is preserved.
    assert.equal(migrated.activeReadingGates?.social?.requiredReadingSeconds, 5400);
  });

  test('running the migration twice produces identical state (idempotent)', () => {
    const once = normalizePersistedRuntime(seedV12Runtime(), NOW) as PersistedRuntime;
    const twice = normalizePersistedRuntime(
      JSON.parse(JSON.stringify(once)),
      NOW + 1000
    ) as PersistedRuntime;

    assert.deepEqual(twice.activeRestorativeGates, once.activeRestorativeGates);
    assert.equal(twice.restorativeMigrationVersion, once.restorativeMigrationVersion);
    assert.deepEqual(twice.activeReadingGates, once.activeReadingGates);
    // No duplicate gates, no new ordinals, no regenerated ids.
    assert.equal(Object.keys(twice.activeRestorativeGates ?? {}).length, 1);
  });

  test('migration preserves the daily ordinal and substitution counters', () => {
    const seeded = seedV12Runtime();
    (seeded.dailyAttentionExchange as Record<string, unknown>).meditationSubstitutionsUsed = 1;
    (seeded.dailyAttentionExchange as Record<string, unknown>).attentionDayId = 'ad-20260927-0730';
    const migrated = normalizePersistedRuntime(seeded, NOW) as PersistedRuntime;

    assert.equal(migrated.dailyAttentionExchange?.cooldownsTriggered, 4);
    assert.equal(migrated.dailyAttentionExchange?.meditationSubstitutionsUsed, 1);
    assert.equal(migrated.dailyAttentionExchange?.attentionDayId, 'ad-20260927-0730');
  });

  test('repeated engine restore never regenerates gate identities', () => {
    const config: RhythmConfiguration = {
      apps: initialApps,
      riskGroups: initialRiskGroups,
      routineWindows: [],
    };
    const engine = new RhythmEngine(
      config,
      seedV12Runtime() as unknown as PersistedRuntime,
      NOW
    );
    const first = engine.toPersistedRuntime(NOW);
    const engine2 = new RhythmEngine(
      config,
      JSON.parse(JSON.stringify(first)) as PersistedRuntime,
      NOW
    );
    const second = engine2.toPersistedRuntime(NOW);

    assert.deepEqual(
      Object.keys(second.activeRestorativeGates ?? {}).sort(),
      Object.keys(first.activeRestorativeGates ?? {}).sort()
    );
    assert.equal(
      first.activeRestorativeGates?.social?.gateId,
      second.activeRestorativeGates?.social?.gateId
    );
  });

  test('a bound CD4 Reader gate survives the engine persistence round trip', () => {
    const config: RhythmConfiguration = {
      apps: initialApps,
      riskGroups: initialRiskGroups,
      routineWindows: [
        {
          id: 'morning-buffer',
          name: 'Morning Buffer',
          type: 'morning-buffer',
          startTime: '06:30',
          endTime: '07:30',
          activeDays: [1, 2, 3, 4, 5, 6, 7],
          protectedGroupIds: [],
          enabled: true,
          tagline: 'Morning Buffer',
          description: 'Attention Day boundary fixture',
        },
      ],
    };
    const dateKey = getLocalDateKey(NOW);
    const attentionDayId = resolveAttentionDay(NOW, config.routineWindows).id;
    const cooldownEndsAt = NOW + 90 * 60_000;
    const gate: ActiveRestorativeGate = {
      gateId: `gate-${attentionDayId}-videos-o4`,
      groupId: 'videos',
      attentionDayId,
      dailyCooldownOrdinal: 4,
      createdAt: NOW,
      cooldownEndsAt,
      requirementKind: 'restorative-choice',
      selectedProvider: 'reader',
      providerSessionId: 'reader-session-cd4',
      status: 'in-progress',
      providerLocked: true,
      requiredRestorativeReadingSeconds: 1800,
      requiredRestorativeQualifiedPages: 11,
      requiredMeditationSeconds: 1800,
    };
    const persisted: PersistedRuntime = {
      state: 'cooldown',
      activeCooldowns: {
        videos: {
          groupId: 'videos',
          startedAt: NOW,
          endsAt: cooldownEndsAt,
          attentionDateKey: dateKey,
          dailyCooldownOrdinal: 4,
          requirementKind: 'restorative-choice',
          requiredReadingSeconds: 0,
          requiredQualifiedPages: 0,
          restorativeReadingSeconds: 1800,
          restorativeReadingPages: 11,
          requiredMeditationSeconds: 1800,
        },
      },
      activeAccessLeases: {},
      activeRoutineWindowIds: [],
      dailyAttentionExchange: {
        dateKey,
        cooldownsTriggered: 4,
        highestRequiredActiveSeconds: 3600,
        highestRequiredQualifiedPages: 36,
        updatedAt: NOW,
        meditationSubstitutionsUsed: 0,
        attentionDayId,
      },
      activeReadingGates: {},
      activeRestorativeGates: { videos: gate },
      restorativeMigrationVersion: RESTORATIVE_MIGRATION_VERSION,
      nativeAttentionAuthority: true,
      lastReconciledAt: NOW,
    };

    const firstEngine = new RhythmEngine(config, persisted, NOW);
    const saved = firstEngine.toPersistedRuntime(NOW);
    assert.deepEqual(saved.activeRestorativeGates?.videos, gate);

    const restartedEngine = new RhythmEngine(
      config,
      JSON.parse(JSON.stringify(saved)) as PersistedRuntime,
      NOW + 1000
    );
    assert.deepEqual(restartedEngine.getRuntime().activeRestorativeGates?.videos, gate);
  });
});

describe('Pass 3 — parallel Risk Groups keep independent cooldowns (spec 52)', () => {
  test('Social o3 / Entertainment o4 / Social o5 with correct gate association', () => {
    const config: RhythmConfiguration = {
      apps: initialApps,
      riskGroups: initialRiskGroups,
      routineWindows: [],
    };
    const engine = new RhythmEngine(config, null, NOW);

    engine.dispatch({ type: 'COOLDOWN_STARTED', groupId: 'social', endsAt: NOW + 90 * 60_000, timestamp: NOW });
    engine.dispatch({ type: 'COOLDOWN_STARTED', groupId: 'entertainment', endsAt: NOW + 90 * 60_000, timestamp: NOW + 1 });
    engine.dispatch({ type: 'COOLDOWN_STARTED', groupId: 'social', endsAt: NOW + 120 * 60_000, timestamp: NOW + 2 });

    const runtime = engine.getRuntime();
    assert.equal(runtime.dailyAttentionExchange?.cooldownsTriggered, 3);
    assert.equal(runtime.activeCooldowns.social?.dailyCooldownOrdinal, 3);
    assert.equal(runtime.activeCooldowns.entertainment?.dailyCooldownOrdinal, 2);

    const gates = runtime.activeRestorativeGates ?? {};
    assert.equal(gates.social?.dailyCooldownOrdinal, 3);
    assert.equal(gates.social?.requirementKind, 'baseline-reading');
    assert.equal(gates.entertainment, undefined, 'ordinal 2 carries no gate');

    // Independent group cooldowns coexist.
    assert.ok(runtime.activeCooldowns.social);
    assert.ok(runtime.activeCooldowns.entertainment);
    assert.notEqual(runtime.activeCooldowns.social?.endsAt, runtime.activeCooldowns.entertainment?.endsAt);
  });

  test('a NEW cooldown allocation produces a discrete CD4 gate, not cumulative debt', () => {
    const config: RhythmConfiguration = {
      apps: initialApps,
      riskGroups: initialRiskGroups,
      routineWindows: [],
    };
    const engine = new RhythmEngine(config, null, NOW);
    // social -> o1, entertainment -> o2, social -> o3, social -> o4
    const sequence = ['social', 'entertainment', 'social', 'social'];
    sequence.forEach((groupId, i) => {
      engine.dispatch({
        type: 'COOLDOWN_STARTED',
        groupId,
        endsAt: NOW + (90 + i) * 60_000,
        timestamp: NOW + i,
      });
    });
    const gates = engine.getRuntime().activeRestorativeGates ?? {};
    const social = gates.social;
    assert.equal(social?.dailyCooldownOrdinal, 4);
    assert.equal(social?.requirementKind, 'restorative-choice');
    assert.equal(social?.requiredRestorativeReadingSeconds, 1800);
    assert.equal(social?.requiredRestorativeQualifiedPages, 11);
    assert.equal(social?.requiredMeditationSeconds, 1800);
    // Explicit regression: the gate is NOT cumulative 5400/47 debt.
    assert.notEqual(social?.requiredRestorativeReadingSeconds, 5400);
  });
});
