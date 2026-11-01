import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { RhythmCoordinator, createNativeMorningProjection } from '../../../application/RhythmCoordinator';
import { getLocalDateKey } from '../allowance';
import type { PersistedRuntime } from '../types';
import type {
  NativeAttentionExchangeSnapshot,
  NativeMorningMeditationInput,
} from '../../../../modules/rhythm-device/src/RhythmDevice.types';
import {
  configurePlatformServices,
  getPlatformServices,
  type PlatformServices,
} from '../../../platform/PlatformServices';
import { MockUsageProvider } from '../../../platform/mock/MockUsageProvider';
import { MockRestrictionProvider } from '../../../platform/mock/MockRestrictionProvider';
import { MockPermissionProvider } from '../../../platform/permissions/MockPermissionProvider';
import type { StorageProvider } from '../../../platform/StorageProvider';
import type {
  DailyReadingEvidenceClient,
  ReadingEvidenceSnapshot,
} from '../readingEvidence';
import type {
  MeditationEvidenceBridge,
  MeditationEvidenceResult,
  MeditationProviderAvailability,
  MeditationRecoveryRequestPayload,
  MeditationSessionEvidence,
} from '../meditationEvidence';

const oldDay = 'ad-20260927-0830';
const oldCreatedAt = 1_758_960_000_000;
const oldRequirement: NativeMorningMeditationInput = {
  attentionDayId: oldDay,
  sessionId: `morning-${oldDay}`,
  requiredQualifiedSeconds: 1800,
  createdAt: oldCreatedAt,
  sourceRhythmicDayId: oldDay,
  sessionKind: 'MORNING_REQUIRED',
  satisfied: false,
};

function snapshot(
  morningRequirements?: NativeMorningMeditationInput[],
  migration?: NativeAttentionExchangeSnapshot['morningMigration']
): NativeAttentionExchangeSnapshot {
  const now = Date.now();
  return {
    attentionStateInitialized: false,
    dateKey: getLocalDateKey(now),
    cooldownsTriggered: 99,
    highestRequiredActiveSeconds: 0,
    highestRequiredQualifiedPages: 0,
    cooldowns: [],
    readingGates: [],
    groupUsage: [],
    activeAccessLeases: [],
    updatedAt: now,
    ...(morningRequirements ? { morningRequirements } : {}),
    ...(migration ? { morningMigration: migration } : {}),
  };
}

class TestStorage implements StorageProvider {
  constructor(private readonly persisted: PersistedRuntime | null = null) {}
  async loadPreferences() {
    return null;
  }
  async savePreferences() {}
  async loadRuntime() {
    return this.persisted;
  }
  async saveRuntime() {}
  async appendHistoryEvent() {}
  async getHistoryEvents() {
    return [];
  }
  async clearAll() {}
}

class TestMeditationBridge implements MeditationEvidenceBridge {
  requests: MeditationRecoveryRequestPayload[] = [];
  async isMeditationAvailable(): Promise<MeditationProviderAvailability> {
    return 'available';
  }
  async startMeditationRecoverySession(
    request: MeditationRecoveryRequestPayload
  ): Promise<boolean> {
    this.requests.push(request);
    return true;
  }
  async queryMeditationStatus(
    _sessionId: string
  ): Promise<MeditationSessionEvidence | null> {
    return null;
  }
  async queryMeditationStatusResult(
    _sessionId: string
  ): Promise<MeditationEvidenceResult> {
    return {
      availability: 'available',
      queryStatus: 'session-missing',
      sessionMissing: true,
    };
  }
}

const reader: DailyReadingEvidenceClient = {
  async query(dateKey: string): Promise<ReadingEvidenceSnapshot> {
    return {
      dateKey,
      providerAvailable: false,
      protocolCompatible: false,
      verifiedActiveSeconds: 0,
      qualifiedPages: 0,
      syncedAtEpochMs: Date.now(),
    };
  },
};

let original: PlatformServices;
let originalPlatformOverride: string | undefined;

function installServices(
  androidSnapshot: NativeAttentionExchangeSnapshot,
  storage: StorageProvider
) {
  const native = {
    currentSnapshot: androidSnapshot,
    async sync() {},
    async getAndroidSnapshot() {
      return native.currentSnapshot;
    },
    async getSnapshot() {
      return null;
    },
    getLastSyncDiagnostics() {
      return { success: true, updatedAt: Date.now() };
    },
    forceReproject() {},
  };
  configurePlatformServices({
    usage: new MockUsageProvider(),
    restrictions: new MockRestrictionProvider(),
    permissions: new MockPermissionProvider(),
    storage,
    nativeRhythm: native,
  });
  return native;
}

async function initializeCoordinator(
  androidSnapshot: NativeAttentionExchangeSnapshot,
  storage: StorageProvider = new TestStorage()
) {
  const native = installServices(androidSnapshot, storage);
  const meditation = new TestMeditationBridge();
  const coordinator = new RhythmCoordinator(reader, meditation);
  await coordinator.initialize();
  return { coordinator, meditation, native };
}

beforeEach(() => {
  original = { ...getPlatformServices() };
  originalPlatformOverride = process.env.RHYTHM_PLATFORM_OVERRIDE;
  process.env.RHYTHM_PLATFORM_OVERRIDE = 'android';
});

afterEach(() => {
  configurePlatformServices(original);
  if (originalPlatformOverride === undefined) {
    delete process.env.RHYTHM_PLATFORM_OVERRIDE;
  } else {
    process.env.RHYTHM_PLATFORM_OVERRIDE = originalPlatformOverride;
  }
});

describe('F18 — native morning import is independent of attention initialization', () => {
  test('cold start attention-false imports the oldest carried binding and launches it exactly', async () => {
    const { coordinator, meditation } = await initializeCoordinator(
      snapshot([oldRequirement])
    );

    const runtime = coordinator.getRuntimeSnapshot();
    assert.equal(runtime?.morningMeditation?.requirement?.attentionDayId, oldDay);
    assert.equal(runtime?.morningMeditation?.requirement?.sessionId, oldRequirement.sessionId);
    assert.equal(runtime?.morningMeditation?.requirement?.createdAt, oldCreatedAt);
    assert.equal(runtime?.morningMeditation?.requirement?.satisfiedAt, undefined);
    assert.equal(runtime?.dailyAttentionExchange?.cooldownsTriggered, 0);
    assert.equal(runtime?.nativeAttentionAuthority, false);

    const launched = await coordinator.launchMorningMeditation(Date.now());
    assert.equal(launched.ok, true);
    assert.equal(launched.sessionId, oldRequirement.sessionId);
    assert.equal(meditation.requests.length, 1);
    const request = meditation.requests[0]!;
    assert.equal(request.session_id, oldRequirement.sessionId);
    assert.equal(request.session_kind, 'MORNING_REQUIRED');
    assert.equal(request.source_rhythmic_day_id, oldDay);
    assert.equal(request.created_at_epoch_ms, oldCreatedAt);
  });

  test('projection preserves the exact oldest pending carried binding', () => {
    const newer: NativeMorningMeditationInput = {
      attentionDayId: 'ad-20260928-0830',
      sessionId: 'morning-ad-20260928-0830',
      requiredQualifiedSeconds: 1800,
      createdAt: oldCreatedAt + 86_400_000,
      sourceRhythmicDayId: 'ad-20260928-0830',
      sessionKind: 'MORNING_REQUIRED',
      satisfied: false,
    };
    const projection = createNativeMorningProjection(snapshot([newer, oldRequirement]));

    assert.equal(projection?.requirement?.sessionId, oldRequirement.sessionId);
    assert.equal(projection?.requirement?.createdAt, oldCreatedAt);
    assert.deepEqual(
      projection?.requirements?.map((item) => item.attentionDayId),
      [oldDay, newer.attentionDayId]
    );
  });

  test('resume imports migration with attention-false without attention or cap side effects', async () => {
    const migration = {
      migratedAt: 1_758_960_100_000,
      migrationAttentionDayId: oldDay,
      enforceableFromAttentionDayId: 'ad-20260928-0830',
    };
    const { coordinator } = await initializeCoordinator(snapshot(undefined, migration));
    const runtime = coordinator.getRuntimeSnapshot();

    assert.equal(runtime?.morningMeditation?.migration?.migratedAt, migration.migratedAt);
    assert.equal(
      runtime?.morningMeditation?.migration?.enforceableFromAttentionDayId,
      migration.enforceableFromAttentionDayId
    );
    assert.equal(runtime?.nativeAttentionAuthority, false);
    assert.equal(runtime?.dailyAttentionExchange?.cooldownsTriggered, 0);
  });

  test('resume imports a carried morning created while native held the foreground', async () => {
    const { coordinator, native } = await initializeCoordinator(snapshot());
    assert.equal(
      coordinator
        .getRuntimeSnapshot()
        ?.morningMeditation?.requirements?.find((item) => item.attentionDayId === oldDay),
      undefined
    );

    native.currentSnapshot = snapshot([oldRequirement]);
    await coordinator.handleAppResume();
    const carried = coordinator
      .getRuntimeSnapshot()
      ?.morningMeditation?.requirements?.find((item) => item.attentionDayId === oldDay);

    assert.equal(carried?.sessionId, oldRequirement.sessionId);
    assert.equal(carried?.createdAt, oldCreatedAt);
    assert.equal(carried?.satisfiedAt, undefined);
  });

  test('missing old-bridge morning fields preserve local pending debt and migration', async () => {
    const today = getLocalDateKey(Date.now());
    const localRequirement = {
      attentionDayId: oldDay,
      sessionId: `morning-${oldDay}`,
      requiredQualifiedSeconds: 1800,
      createdAt: oldCreatedAt,
      sourceRhythmicDayId: oldDay,
      sessionKind: 'MORNING_REQUIRED' as const,
      sourceCooldownId: null,
    };
    const localMigration = {
      migratedAt: 1,
      migrationAttentionDayId: oldDay,
      enforceableFromAttentionDayId: 'ad-20260928-0830',
    };
    const persisted: PersistedRuntime = {
      state: 'available',
      activeCooldowns: {},
      activeAccessLeases: {},
      activeRoutineWindowIds: [],
      lastReconciledAt: Date.now(),
      dailyAttentionExchange: {
        dateKey: today,
        cooldownsTriggered: 3,
        highestRequiredActiveSeconds: 0,
        highestRequiredQualifiedPages: 0,
        updatedAt: Date.now(),
      },
      morningMeditation: {
        requirement: localRequirement,
        requirements: [localRequirement],
        migration: localMigration,
      },
    };
    const { coordinator } = await initializeCoordinator(
      snapshot(),
      new TestStorage(persisted)
    );
    const runtime = coordinator.getRuntimeSnapshot();

    assert.equal(createNativeMorningProjection(snapshot()), undefined);
    assert.equal(runtime?.morningMeditation?.requirement?.sessionId, localRequirement.sessionId);
    assert.equal(runtime?.morningMeditation?.requirement?.createdAt, oldCreatedAt);
    assert.equal(runtime?.morningMeditation?.migration?.migratedAt, 1);
    assert.equal(runtime?.morningMeditation?.migration?.enforceableFromAttentionDayId, 'ad-20260928-0830');
    assert.equal(runtime?.dailyAttentionExchange?.cooldownsTriggered, 3);
  });

  test('wrong completed identity cannot clear local pending or debit the cap', async () => {
    const today = getLocalDateKey(Date.now());
    const localRequirement = {
      attentionDayId: oldDay,
      sessionId: `morning-${oldDay}`,
      requiredQualifiedSeconds: 1800,
      createdAt: oldCreatedAt,
      sourceRhythmicDayId: oldDay,
      sessionKind: 'MORNING_REQUIRED' as const,
      sourceCooldownId: null,
    };
    const persisted: PersistedRuntime = {
      state: 'available',
      activeCooldowns: {},
      activeAccessLeases: {},
      activeRoutineWindowIds: [],
      lastReconciledAt: Date.now(),
      dailyAttentionExchange: {
        dateKey: today,
        cooldownsTriggered: 3,
        highestRequiredActiveSeconds: 0,
        highestRequiredQualifiedPages: 0,
        updatedAt: Date.now(),
      },
      morningMeditation: {
        requirement: localRequirement,
        requirements: [localRequirement],
        migration: { migratedAt: 1, migrationAttentionDayId: oldDay },
      },
    };
    const wrongCompleted: NativeMorningMeditationInput = {
      ...oldRequirement,
      sessionId: `morning-${oldDay}-wrong`,
      satisfied: true,
      satisfiedAt: Date.now(),
    };
    const { coordinator } = await initializeCoordinator(
      snapshot([wrongCompleted]),
      new TestStorage(persisted)
    );
    const runtime = coordinator.getRuntimeSnapshot();

    assert.equal(createNativeMorningProjection(snapshot([wrongCompleted])), undefined);
    assert.equal(runtime?.morningMeditation?.requirement?.sessionId, localRequirement.sessionId);
    assert.equal(runtime?.morningMeditation?.requirement?.satisfiedAt, undefined);
    assert.equal(runtime?.dailyAttentionExchange?.cooldownsTriggered, 3);
  });

  test('exact completed identity is imported without manufacturing a new binding', async () => {
    const completed: NativeMorningMeditationInput = {
      ...oldRequirement,
      satisfied: true,
      satisfiedAt: Date.now(),
    };
    const projection = createNativeMorningProjection(snapshot([completed]));
    assert.equal(projection?.requirement?.sessionId, oldRequirement.sessionId);
    assert.equal(projection?.requirement?.createdAt, oldCreatedAt);
    const { coordinator } = await initializeCoordinator(snapshot([completed]));
    const runtime = coordinator.getRuntimeSnapshot();
    const carried = runtime?.morningMeditation?.requirements?.find(
      (item) => item.attentionDayId === oldDay
    );

    assert.equal(carried?.sessionId, oldRequirement.sessionId);
    assert.equal(carried?.createdAt, oldCreatedAt);
    assert.equal(carried?.satisfiedAt, completed.satisfiedAt);
  });
  test('an explicit cooldown source cannot be rewritten into a completed morning binding', () => {
    const invalid: NativeMorningMeditationInput = {
      ...oldRequirement,
      sourceCooldownId: 'unrelated-cooldown',
      satisfied: true,
      satisfiedAt: Date.now(),
    };
    assert.equal(createNativeMorningProjection(snapshot([invalid])), undefined);
  });

  test('a false native completion flag cannot gain completion from a stale timestamp', () => {
    const inconsistent: NativeMorningMeditationInput = {
      ...oldRequirement,
      satisfied: false,
      satisfiedAt: Date.now(),
    };
    const projection = createNativeMorningProjection(snapshot([inconsistent]));
    assert.equal(projection?.requirement?.sessionId, oldRequirement.sessionId);
    assert.equal(projection?.requirement?.satisfiedAt, undefined);
  });
});
