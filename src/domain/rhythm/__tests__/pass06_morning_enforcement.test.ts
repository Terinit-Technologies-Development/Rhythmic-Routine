import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { RhythmEngine } from '../RhythmEngine';
import { resolveAttentionDay } from '../attentionDay';
import type { PersistedRuntime, RhythmConfiguration, RhythmRuntime } from '../types';
import type { DeviceApp, RiskGroup, RoutineWindow } from '../../../types/domain';
import type { MeditationSessionEvidence, MeditationEvidenceBridge } from '../meditationEvidence';
import type { DailyReadingEvidenceClient } from '../readingEvidence';
import { configurePlatformServices } from '../../../platform/PlatformServices';
import { MockStorageProvider } from '../../../platform/storage/MockStorageProvider';
import { MockUsageProvider } from '../../../platform/mock/MockUsageProvider';
import { MockRestrictionProvider } from '../../../platform/mock/MockRestrictionProvider';
import { MockPermissionProvider } from '../../../platform/permissions/MockPermissionProvider';
import { RhythmCoordinator } from '../../../application/RhythmCoordinator';
import { PlatformNativeRhythmSyncProvider, requireNativeSave } from '../../../platform/NativeRhythmSyncProvider';

/**
 * B1 — Morning-enforcement vertical slice. These tests drive the production
 * engine/event/reducer path, not isolated helper replicas.
 */

const MONDAY_9AM = new Date(2026, 8, 28, 9, 0, 0, 0).getTime();
const TUESDAY_9AM = new Date(2026, 8, 29, 9, 0, 0, 0).getTime();
const MONDAY_0030 = new Date(2026, 8, 28, 0, 30, 0, 0).getTime();
const TUESDAY_0030 = new Date(2026, 8, 29, 0, 30, 0, 0).getTime();

function morningWindow(overrides: Partial<RoutineWindow> = {}): RoutineWindow {
  return {
    id: 'morning-1',
    name: 'Morning Buffer',
    type: 'morning-buffer',
    startTime: '06:30',
    endTime: '08:30',
    activeDays: [1, 2, 3, 4, 5],
    protectedGroupIds: ['social'],
    enabled: true,
    tagline: 'Morning',
    description: 'Morning buffer',
    ...overrides,
  };
}

const evening: RoutineWindow = {
  id: 'evening-1',
  name: 'Evening Wind-Down',
  type: 'evening-wind-down',
  startTime: '21:30',
  endTime: '22:30',
  activeDays: [1, 2, 3, 4, 5],
  protectedGroupIds: ['social'],
  enabled: true,
  tagline: 'Evening',
  description: 'Wind down',
};

const apps: DeviceApp[] = [
  {
    id: 'com.terinit.rhythmicmeditation',
    name: 'Meditation',
    classification: 'normal',
    iconName: 'sprout',
    iconColor: '#000',
    iconBg: '#fff',
    defaultCategory: 'Wellness',
    usageTodayMinutes: 0,
    sessionMinutes: 0,
  },
  {
    id: 'com.terinit.rhythmicroutine',
    name: 'Routine',
    classification: 'normal',
    iconName: 'waves',
    iconColor: '#000',
    iconBg: '#fff',
    defaultCategory: 'Wellness',
    usageTodayMinutes: 0,
    sessionMinutes: 0,
  },
  {
    id: 'com.instagram.android',
    name: 'Instagram',
    classification: 'risk',
    riskGroupId: 'social',
    iconName: 'camera',
    iconColor: '#000',
    iconBg: '#fff',
    defaultCategory: 'Social',
    usageTodayMinutes: 0,
    sessionMinutes: 0,
  },
  {
    id: 'com.example.game',
    name: 'Game',
    classification: 'normal',
    iconName: 'gamepad',
    iconColor: '#000',
    iconBg: '#fff',
    defaultCategory: 'Entertainment',
    usageTodayMinutes: 0,
    sessionMinutes: 0,
  },
  {
    id: 'dialer',
    name: 'Phone',
    classification: 'essential',
    iconName: 'phone',
    iconColor: '#000',
    iconBg: '#fff',
    defaultCategory: 'Communication',
    usageTodayMinutes: 0,
    sessionMinutes: 0,
  },
];

const groups: RiskGroup[] = [
  {
    id: 'social',
    name: 'Social',
    description: 'Social',
    iconName: 'users',
    iconColor: '#000',
    iconBg: '#fff',
    appIds: ['com.instagram.android'],
    allowanceMinutes: 30,
    cooldownMinutes: 90,
    currentSessionMinutes: 0,
  },
];

function config(windows: RoutineWindow[], extraApps: DeviceApp[] = apps): RhythmConfiguration {
  return { routineWindows: windows, riskGroups: groups, apps: [...extraApps] };
}

function completedMorning(
  requirement: { sessionId: string; requiredQualifiedSeconds: number; attentionDayId: string },
  overrides: Partial<MeditationSessionEvidence> = {}
): MeditationSessionEvidence {
  return {
    sessionId: requirement.sessionId,
    protocolVersion: 1,
    status: 'COMPLETED',
    requiredQualifiedSeconds: requirement.requiredQualifiedSeconds,
    completedQualifiedSeconds: requirement.requiredQualifiedSeconds,
    completedAtEpochMs: MONDAY_9AM,
    lastUpdatedAtEpochMs: MONDAY_9AM,
    sessionKind: 'MORNING_REQUIRED',
    sourceCooldownId: null,
    sourceRhythmicDayId: requirement.attentionDayId,
    ...overrides,
  };
}

function engineAt(now: number, windows: RoutineWindow[], persisted?: PersistedRuntime | null) {
  return new RhythmEngine(config(windows), persisted, now);
}

function requirement(runtime: RhythmRuntime) {
  return runtime.morningMeditation?.requirement;
}

describe('B1 — deterministic native/JS morning identity', () => {
  test('eligible morning mints exactly one stable requirement with the boundary timestamp', () => {
    const engine = engineAt(MONDAY_9AM, [morningWindow(), evening]);
    const first = requirement(engine.getRuntime());
    assert.ok(first);
    const day = resolveAttentionDay(MONDAY_9AM, [morningWindow(), evening]);
    assert.equal(first!.sessionId, `morning-${day.id}`);
    assert.equal(first!.attentionDayId, day.id);
    assert.equal(first!.createdAt, day.startedAt);
    assert.equal(first!.sessionKind, 'MORNING_REQUIRED');
    assert.equal(first!.sourceRhythmicDayId, day.id);
    assert.equal(first!.requiredQualifiedSeconds, 1800);

    engine.dispatch({ type: 'RECONCILE', timestamp: MONDAY_9AM + 60_000 });
    engine.dispatch({ type: 'CLOCK_TICK', timestamp: MONDAY_9AM + 120_000 });
    assert.deepEqual(requirement(engine.getRuntime()), first);
  });

  test('restart preserves the exact requirement and migration floor once persisted', () => {
    const engine = engineAt(MONDAY_9AM, [morningWindow(), evening]);
    const persisted = engine.toPersistedRuntime(MONDAY_9AM);
    const restarted = engineAt(MONDAY_9AM + 30_000, [morningWindow(), evening], persisted);
    assert.deepEqual(requirement(restarted.getRuntime()), requirement(engine.getRuntime()));
    assert.deepEqual(
      restarted.getRuntime().morningMeditation?.migration,
      engine.getRuntime().morningMeditation?.migration
    );
    assert.deepEqual(restarted.toPersistedRuntime(MONDAY_9AM + 30_000).morningMeditation?.migration,
      persisted.morningMeditation?.migration);
  });

  test('cross-midnight morning eligibility uses the civil day the window OPENED', () => {
    const crossMidnight = morningWindow({
      startTime: '23:00',
      endTime: '00:30',
      activeDays: [1], // Monday-only window
    });
    // Sunday night -> Monday 00:30 boundary: opening day is Sunday (inactive).
    const sundayOpened = engineAt(MONDAY_0030, [crossMidnight, evening]);
    assert.equal(requirement(sundayOpened.getRuntime()), undefined);

    // Monday night -> Tuesday 00:30 boundary: opening day is Monday (active).
    const mondayOpened = engineAt(TUESDAY_0030, [crossMidnight, evening]);
    assert.ok(requirement(mondayOpened.getRuntime()));
  });

  test('inactive weekday / empty days / disabled / malformed windows create no obligation', () => {
    const cases: RoutineWindow[][] = [
      [morningWindow({ activeDays: [1] }), evening], // Tuesday, Monday-only
      [morningWindow({ activeDays: [] }), evening],
      [morningWindow({ enabled: false }), evening],
      [morningWindow({ endTime: 'not-a-clock' }), evening],
      [morningWindow({ endTime: '' }), evening],
      [evening],
    ];
    for (const windows of cases) {
      const engine = engineAt(TUESDAY_9AM, windows);
      assert.equal(requirement(engine.getRuntime()), undefined);
      assert.notEqual(engine.getRuntime().morningMeditation?.state, 'morning-meditation-required');
    }
  });

  test('upgraded install never locks on the migration day; next eligible day does', () => {
    const legacy: PersistedRuntime = {
      state: 'available',
      activeCooldowns: {},
      activeRoutineWindowIds: [],
      lastReconciledAt: MONDAY_9AM - 3_600_000,
    };
    const engine = engineAt(MONDAY_9AM, [morningWindow(), evening], legacy);
    assert.equal(requirement(engine.getRuntime()), undefined);
    assert.equal(engine.getRuntime().morningMeditation?.migration?.enforceableFromAttentionDayId, undefined);

    engine.dispatch({ type: 'RECONCILE', timestamp: TUESDAY_9AM });
    assert.ok(requirement(engine.getRuntime()), 'next eligible day creates the obligation');
  });

  test('migration comparison handles date-only legacy ids without lexical order bugs', () => {
    const legacy: PersistedRuntime = {
      state: 'available',
      activeCooldowns: {},
      activeRoutineWindowIds: [],
      lastReconciledAt: MONDAY_9AM,
      morningMeditation: {
        migration: {
          migratedAt: MONDAY_9AM,
          migrationAttentionDayId: 'ad-2026-09-28',
        },
      },
    };
    const engine = engineAt(MONDAY_9AM, [morningWindow(), evening], legacy);
    assert.equal(requirement(engine.getRuntime()), undefined, 'same civil migration day is not enforceable');
  });
});

describe('B1 — verified satisfaction and no cap debit', () => {
  test('exact MORNING_REQUIRED completion satisfies; 29:59 / wrong kind/source/cancel do not', () => {
    const engine = engineAt(MONDAY_9AM, [morningWindow(), evening]);
    const req = requirement(engine.getRuntime())!;

    const incomplete = completedMorning(req, { completedQualifiedSeconds: 1799 });
    engine.dispatch({ type: 'SYNC_MEDITATION_EVIDENCE', evidence: incomplete, timestamp: MONDAY_9AM + 1000 });
    assert.equal(requirement(engine.getRuntime())?.satisfiedAt, undefined);

    for (const bad of [
      completedMorning(req, { sessionKind: 'COOLDOWN_RESTORATIVE' }),
      completedMorning(req, { sourceRhythmicDayId: 'ad-20260101-0830' }),
      completedMorning(req, { sourceCooldownId: 'cd-1' }),
      completedMorning(req, { status: 'CANCELLED' }),
      completedMorning(req, { protocolVersion: 2 }),
    ]) {
      engine.dispatch({ type: 'SYNC_MEDITATION_EVIDENCE', evidence: bad, timestamp: MONDAY_9AM + 2000 });
      assert.equal(requirement(engine.getRuntime())?.satisfiedAt, undefined);
    }

    const exact = completedMorning(req);
    engine.dispatch({ type: 'SYNC_MEDITATION_EVIDENCE', evidence: exact, timestamp: MONDAY_9AM + 3000 });
    assert.equal(requirement(engine.getRuntime())?.satisfiedAt, exact.completedAtEpochMs);
    assert.equal(engine.getRuntime().morningMeditation?.state, 'available');
    assert.equal(engine.getRuntime().dailyAttentionExchange?.meditationSubstitutionsUsed ?? 0, 0);
  });

  test('missing identity metadata (old provider) is a capability limitation, not a match', () => {
    const engine = engineAt(MONDAY_9AM, [morningWindow(), evening]);
    const req = requirement(engine.getRuntime())!;
    const legacy = completedMorning(req, {
      sessionKind: undefined,
      sourceCooldownId: undefined,
      sourceRhythmicDayId: undefined,
    });
    engine.dispatch({ type: 'SYNC_MEDITATION_EVIDENCE', evidence: legacy, timestamp: MONDAY_9AM + 1000 });
    assert.equal(requirement(engine.getRuntime())?.satisfiedAt, undefined);
  });

  test('committed satisfaction survives stale/error-looking evidence and restart', () => {
    const engine = engineAt(MONDAY_9AM, [morningWindow(), evening]);
    const req = requirement(engine.getRuntime())!;
    engine.dispatch({
      type: 'SYNC_MEDITATION_EVIDENCE',
      evidence: completedMorning(req),
      timestamp: MONDAY_9AM + 1000,
    });
    const satisfiedAt = requirement(engine.getRuntime())?.satisfiedAt;
    engine.dispatch({
      type: 'SYNC_MEDITATION_EVIDENCE',
      evidence: completedMorning(req, { status: 'ACTIVE', completedQualifiedSeconds: 0 }),
      timestamp: MONDAY_9AM + 2000,
    });
    assert.equal(requirement(engine.getRuntime())?.satisfiedAt, satisfiedAt);

    const restarted = engineAt(
      MONDAY_9AM + 3000,
      [morningWindow(), evening],
      engine.toPersistedRuntime(MONDAY_9AM + 2000)
    );
    assert.equal(requirement(restarted.getRuntime())?.satisfiedAt, satisfiedAt);
  });
});

describe('B1 — effective restriction union and native projection', () => {
  test('morning holds managed nonessential/risk, keeps Essential/Routine/Meditation, and leases cannot bypass', () => {
    const engine = engineAt(MONDAY_9AM, [morningWindow(), evening]);
    const restricted = engine.getRuntime().activeRestrictions.map((item) => item.appId);
    assert.ok(restricted.includes('com.example.game'));
    assert.ok(restricted.includes('com.instagram.android'));
    assert.ok(!restricted.includes('dialer'));
    assert.ok(!restricted.includes('com.terinit.rhythmicmeditation'));
    assert.ok(!restricted.includes('com.terinit.rhythmicroutine'));

    engine.dispatch({
      type: 'START_ACCESS_LEASE',
      groupId: 'social',
      durationMinutes: 15,
      timestamp: MONDAY_9AM + 1000,
    });
    assert.ok(
      engine.getRuntime().activeRestrictions.some((item) => item.appId === 'com.instagram.android' &&
        item.reasons.some((reason) => reason.type === 'morning-meditation')),
      'ordinary lease cannot suppress the morning reason'
    );
  });

  test('an Essential app inside a Risk Group stays reachable under morning focus', () => {
    const engine = new RhythmEngine(
      {
        routineWindows: [morningWindow(), evening],
        riskGroups: [{ ...groups[0], appIds: ['com.instagram.android', 'dialer'] }],
        apps,
      },
      null,
      MONDAY_9AM
    );
    const restricted = engine.getRuntime().activeRestrictions.map((item) => item.appId);
    assert.ok(!restricted.includes('dialer'));
    assert.ok(restricted.includes('com.instagram.android'));
  });

  test('schedule edit cannot end the current accounting day early or clear the hold', () => {
    const engine = engineAt(MONDAY_9AM, [morningWindow(), evening]);
    const before = engine.getRuntime();
    const req = requirement(before)!;
    engine.updateConfiguration(
      config([morningWindow({ endTime: '10:30' }), evening]),
      MONDAY_9AM
    );
    const after = engine.getRuntime();
    assert.equal(after.dailyAttentionExchange?.attentionDayId, req.attentionDayId);
    const pinnedUntil = after.dailyAttentionExchange?.attentionDayNextBoundaryAt ?? 0;
    assert.ok(pinnedUntil >= (before.dailyAttentionExchange?.attentionDayNextBoundaryAt ?? 0));
    assert.deepEqual(requirement(after), req);

    engine.dispatch({ type: 'RECONCILE', timestamp: pinnedUntil - 1000 });
    assert.equal(engine.getRuntime().dailyAttentionExchange?.attentionDayId, req.attentionDayId);
    assert.deepEqual(requirement(engine.getRuntime()), req);
  });

  test('unfinished morning binding carries across inactive and eligible days without mutation', () => {
    const mondayOnly = [morningWindow({ activeDays: [1] }), evening];
    const mondayEngine = engineAt(MONDAY_9AM, mondayOnly);
    const mondayRequirement = requirement(mondayEngine.getRuntime())!;

    mondayEngine.dispatch({ type: 'RECONCILE', timestamp: TUESDAY_9AM });
    const carried = requirement(mondayEngine.getRuntime())!;
    assert.equal(carried.attentionDayId, mondayRequirement.attentionDayId);
    assert.equal(carried.sessionId, mondayRequirement.sessionId);
    assert.equal(carried.createdAt, mondayRequirement.createdAt);
    assert.equal(mondayEngine.getRuntime().morningMeditation?.requirements?.length, 1);
    assert.equal(mondayEngine.getRuntime().morningMeditation?.state, 'morning-meditation-required');
    const carriedRestrictions = mondayEngine.getRuntime().activeRestrictions;
    assert.ok(
      carriedRestrictions.some(
        (item) =>
          item.appId === 'com.example.game' &&
          item.reasons.some((reason) => reason.type === 'morning-meditation')
      ),
      'carried unfinished hold must remain an effective restriction'
    );

    mondayEngine.dispatch({
      type: 'SYNC_MEDITATION_EVIDENCE',
      evidence: completedMorning(mondayRequirement, { completedAtEpochMs: TUESDAY_9AM }),
      timestamp: TUESDAY_9AM + 1000,
    });
    assert.equal(requirement(mondayEngine.getRuntime())?.satisfiedAt, TUESDAY_9AM);
    assert.equal(mondayEngine.getRuntime().dailyAttentionExchange?.meditationSubstitutionsUsed ?? 0, 0);

    const eligibleBoth = [morningWindow({ activeDays: [1, 2] }), evening];
    const dual = engineAt(MONDAY_9AM, eligibleBoth);
    const first = requirement(dual.getRuntime())!;
    dual.dispatch({ type: 'RECONCILE', timestamp: TUESDAY_9AM });
    const all = dual.getRuntime().morningMeditation?.requirements ?? [];
    assert.equal(all.length, 2, 'new eligible day keeps distinct binding');
    assert.equal(requirement(dual.getRuntime())?.attentionDayId, first.attentionDayId);
    dual.dispatch({
      type: 'SYNC_MEDITATION_EVIDENCE',
      evidence: completedMorning(first, { completedAtEpochMs: TUESDAY_9AM }),
      timestamp: TUESDAY_9AM + 1000,
    });
    assert.equal(
      requirement(dual.getRuntime())?.attentionDayId,
      all.find((item) => item.attentionDayId !== first.attentionDayId)?.attentionDayId
    );
  });

  test('native import adds/satisfies the exact same day but never clears or downgrades', () => {
    const engine = engineAt(MONDAY_9AM, [morningWindow(), evening]);
    const req = requirement(engine.getRuntime())!;
    engine.dispatch({
      type: 'SYNC_NATIVE_ATTENTION_EXCHANGE',
      dailyAttentionExchange: {
        dateKey: engine.getRuntime().dailyAttentionExchange!.dateKey,
        cooldownsTriggered: 0,
        highestRequiredActiveSeconds: 0,
        highestRequiredQualifiedPages: 0,
        updatedAt: MONDAY_9AM,
        attentionDayId: req.attentionDayId,
      },
      activeReadingGates: {},
      activeCooldowns: {},
      activeAccessLeases: {},
      groupAllowanceUsage: {},
      morningMeditation: {
        requirement: { ...req, satisfiedAt: MONDAY_9AM + 500 },
      },
      timestamp: MONDAY_9AM + 1000,
    });
    assert.equal(requirement(engine.getRuntime())?.satisfiedAt, MONDAY_9AM + 500);

    engine.dispatch({
      type: 'SYNC_NATIVE_ATTENTION_EXCHANGE',
      dailyAttentionExchange: {
        dateKey: engine.getRuntime().dailyAttentionExchange!.dateKey,
        cooldownsTriggered: 0,
        highestRequiredActiveSeconds: 0,
        highestRequiredQualifiedPages: 0,
        updatedAt: MONDAY_9AM,
        attentionDayId: req.attentionDayId,
      },
      activeReadingGates: {},
      activeCooldowns: {},
      activeAccessLeases: {},
      groupAllowanceUsage: {},
      timestamp: MONDAY_9AM + 2000,
    });
    assert.equal(requirement(engine.getRuntime())?.satisfiedAt, MONDAY_9AM + 500);
  });
});

describe('B1 — coordinator central polling and native write acknowledgement', () => {
  test('Touch Grass launches the exact bound tuple; central polling marks only verified metadata completion', async () => {
    const now = Date.now();
    const isoToday = new Date(now).getDay() === 0 ? 7 : new Date(now).getDay();
    const isoYesterday = isoToday === 1 ? 7 : isoToday - 1;
    const boundaryWindow: RoutineWindow = {
      id: 'morning-boundary',
      name: 'Morning Boundary',
      type: 'morning-buffer',
      startTime: '23:59',
      endTime: '00:00',
      activeDays: [isoToday, isoYesterday],
      protectedGroupIds: ['social'],
      enabled: true,
      tagline: 'Boundary',
      description: 'Test boundary',
    };
    const preferences = {
      routineWindows: [boundaryWindow],
      riskGroups: groups,
      appClassifications: Object.fromEntries(
        apps.map((app) => [app.id, { classification: app.classification, riskGroupId: app.riskGroupId }])
      ),
      sessionResetGapMs: 5 * 60 * 1000,
      onboardingCompleted: true,
      accountability: { enabled: false, partners: [] },
    };
    const storage = new MockStorageProvider(preferences, null);
    configurePlatformServices({
      usage: new MockUsageProvider(apps),
      restrictions: new MockRestrictionProvider(),
      storage,
      permissions: new MockPermissionProvider(),
    });

    let lastRequest: Record<string, unknown> | undefined;
    let completed = false;
    const queryResult = async (sessionId: string) => {
      const sourceDay = sessionId.replace(/^morning-/, '');
      return {
        availability: 'available' as const,
        identityMetadataAvailable: true,
        evidence: {
          sessionId,
          protocolVersion: 1,
          status: completed ? ('COMPLETED' as const) : ('ACTIVE' as const),
          requiredQualifiedSeconds: 1800,
          completedQualifiedSeconds: completed ? 1800 : 0,
          completedAtEpochMs: completed ? now : null,
          lastUpdatedAtEpochMs: now,
          sessionKind: 'MORNING_REQUIRED' as const,
          sourceCooldownId: null,
          sourceRhythmicDayId: sourceDay,
        },
      };
    };
    const bridge: MeditationEvidenceBridge = {
      async isMeditationAvailable() {
        return 'available';
      },
      async startMeditationRecoverySession(request) {
        lastRequest = request as unknown as Record<string, unknown>;
        return true;
      },
      async queryMeditationStatus(sessionId) {
        return (await queryResult(sessionId)).evidence ?? null;
      },
      queryMeditationStatusResult: queryResult,
    };
    const daily: DailyReadingEvidenceClient = {
      async query(dateKey) {
        return {
          dateKey,
          providerAvailable: false,
          protocolCompatible: false,
          verifiedActiveSeconds: 0,
          qualifiedPages: 0,
          syncedAtEpochMs: now,
        };
      },
    };

    const coordinator = new RhythmCoordinator(daily, bridge);
    try {
      const runtime = await coordinator.initialize();
      const bound = runtime.morningMeditation?.requirement;
      assert.ok(bound, 'coordinator initializes and mints the bound requirement');
      assert.equal(bound!.sessionId, `morning-${bound!.attentionDayId}`);

      const launch = await coordinator.launchMorningMeditation(now);
      assert.equal(launch.ok, true);
      assert.equal(lastRequest?.session_id, bound!.sessionId);
      assert.equal(lastRequest?.session_kind, 'MORNING_REQUIRED');
      assert.equal(lastRequest?.source_rhythmic_day_id, bound!.attentionDayId);
      assert.equal(lastRequest?.source_cooldown_id, undefined);
      assert.equal(lastRequest?.created_at_epoch_ms, bound!.createdAt);

      // A non-completed exact session does not satisfy.
      await coordinator.refreshMorningMeditationEvidence(now);
      assert.equal(
        coordinator.getRuntime()?.morningMeditation?.requirement?.satisfiedAt,
        undefined
      );

      completed = true;
      await coordinator.refreshMorningMeditationEvidence(now + 1000);
      assert.equal(
        coordinator.getRuntime()?.morningMeditation?.requirement?.satisfiedAt,
        now
      );
    } finally {
      coordinator.destroy();
    }
  });

  test('a rejected native save is never reported as enforced success', async () => {
    assert.throws(
      () => requireNativeSave('morning-meditation', 'setAttentionExchangeState', false),
      /native save not confirmed/
    );
    const previous = process.env.RHYTHM_PLATFORM_OVERRIDE;
    process.env.RHYTHM_PLATFORM_OVERRIDE = 'android';
    try {
      const provider = new PlatformNativeRhythmSyncProvider();
      const engine = engineAt(MONDAY_9AM, [morningWindow(), evening]);
      await provider.sync(engine.getRuntime(), config([morningWindow(), evening]));
      const diagnostics = provider.getLastSyncDiagnostics();
      assert.equal(diagnostics.success, false);
      assert.equal(diagnostics.failedStage, 'module');
    } finally {
      if (previous === undefined) delete process.env.RHYTHM_PLATFORM_OVERRIDE;
      else process.env.RHYTHM_PLATFORM_OVERRIDE = previous;
    }
  });
});
