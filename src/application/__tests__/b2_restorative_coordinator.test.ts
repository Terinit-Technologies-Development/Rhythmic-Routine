import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { RhythmCoordinator } from '../RhythmCoordinator';
import { configurePlatformServices } from '../../platform/PlatformServices';
import { MockStorageProvider } from '../../platform/storage/MockStorageProvider';
import { MockRestrictionProvider } from '../../platform/mock/MockRestrictionProvider';
import { MockPermissionProvider } from '../../platform/permissions/MockPermissionProvider';
import { mockUsageProvider } from '../../platform/mock/MockUsageProvider';
import { NoopNativeRhythmSyncProvider } from '../../platform/NativeRhythmSyncProvider';
import {
  createDailyAttentionExchangeState,
  type DailyAttentionExchangeState,
} from '../../domain/rhythm/attentionExchange';
import { resolveAttentionDay } from '../../domain/rhythm/attentionDay';
import { getLocalDateKey } from '../../domain/rhythm/allowance';
import { initialRoutineWindows } from '../../data/mockData';
import type { DailyReadingEvidenceClient } from '../../domain/rhythm/readingEvidence';
import type { MeditationEvidenceBridge } from '../../domain/rhythm/meditationEvidence';
import type { RecoveryProviderClient } from '../../domain/rhythm/recovery';

const now = Date.now();
const dateKey = getLocalDateKey(now);
const attentionDayId = resolveAttentionDay(now, initialRoutineWindows).id;

function baseRuntime(): Record<string, unknown> {
  const dailyAttentionExchange: DailyAttentionExchangeState = {
    ...createDailyAttentionExchangeState(dateKey, now, attentionDayId),
  };
  return {
    state: 'cooldown',
    activeCooldowns: {
      social: {
        groupId: 'social',
        startedAt: now - 120_000,
        endsAt: now - 1_000,
        dailyCooldownOrdinal: 4,
        attentionDateKey: dateKey,
        attentionDayId,
        requirementKind: 'restorative-choice',
      },
    },
    activeAccessLeases: {},
    activeRoutineWindowIds: [],
    dailyAttentionExchange,
    activeRestorativeGates: {
      social: {
        gateId: 'gate-b2-reader',
        groupId: 'social',
        attentionDayId,
        dailyCooldownOrdinal: 4,
        createdAt: now,
        cooldownEndsAt: now - 1_000,
        requirementKind: 'restorative-choice',
        selectedProvider: 'reader',
        providerSessionId: 'reader-session-b2',
        status: 'in-progress',
        providerLocked: false,
        requiredRestorativeReadingSeconds: 1800,
        requiredRestorativeQualifiedPages: 11,
        requiredMeditationSeconds: 1800,
        meditationSubstitutionConsumed: false,
      },
    },
    restorativeMigrationVersion: 2,
    lastReconciledAt: now,
  };
}

const readingClient: DailyReadingEvidenceClient = {
  async query(key: string) {
    return {
      dateKey: key,
      providerAvailable: true,
      protocolCompatible: true,
      verifiedActiveSeconds: 0,
      qualifiedPages: 0,
      syncedAtEpochMs: now,
    };
  },
};

const meditationBridge: MeditationEvidenceBridge = {
  async isMeditationAvailable() {
    return 'available';
  },
  async startMeditationRecoverySession() {
    return true;
  },
  async queryMeditationStatus() {
    return null;
  },
  async queryMeditationStatusResult() {
    return { availability: 'available', queryStatus: 'available' };
  },
};

function installServices(runtime: Record<string, unknown>): void {
  configurePlatformServices({
    usage: mockUsageProvider,
    restrictions: new MockRestrictionProvider(),
    storage: new MockStorageProvider(null, runtime),
    permissions: new MockPermissionProvider(),
    nativeRhythm: new NoopNativeRhythmSyncProvider(),
  });
}

function readerProvider(status: 'COMPLETE' | null): RecoveryProviderClient {
  return {
    async isReaderAvailable() {
      return true;
    },
    async startRecoverySession() {
      return true;
    },
    async queryRecoveryStatus(sessionId: string) {
      if (status !== 'COMPLETE') return null;
      return {
        sessionId,
        protocolVersion: 1,
        status: 'COMPLETE',
        activeSeconds: 1800,
        qualifiedPages: 11,
        completedAtEpochMs: now,
      };
    },
  };
}

function readerDetailedProvider(
  result:
    | { availability: 'permission-denied'; queryStatus: 'permission-denied' }
    | { availability: 'available'; queryStatus: 'available'; status: 'ACTIVE' | 'COMPLETE' }
): RecoveryProviderClient {
  return {
    async isReaderAvailable() {
      return true;
    },
    async startRecoverySession() {
      return true;
    },
    async queryRecoveryStatus() {
      return null;
    },
    async queryRecoveryStatusResult(sessionId: string) {
      if (result.availability !== 'available') {
        return {
          availability: result.availability,
          queryStatus: result.queryStatus,
        };
      }
      return {
        availability: 'available',
        queryStatus: 'available',
        evidence: {
          sessionId,
          protocolVersion: 1,
          status: result.status,
          activeSeconds: result.status === 'COMPLETE' ? 1800 : 900,
          qualifiedPages: result.status === 'COMPLETE' ? 11 : 4,
          completedAtEpochMs: result.status === 'COMPLETE' ? now : 0,
        },
      };
    },
  };
}

const coordinators: RhythmCoordinator[] = [];

afterEach(() => {
  while (coordinators.length > 0) coordinators.pop()!.destroy();
});

test('cold start queries the exact bound Reader V1 session and satisfies CD4', async () => {
  installServices(baseRuntime());
  const coordinator = new RhythmCoordinator(readingClient, meditationBridge, readerProvider('COMPLETE'));
  coordinators.push(coordinator);

  await coordinator.initialize();

  const runtime = coordinator.getRuntimeSnapshot();
  const gate = runtime?.activeRestorativeGates?.['social'];
  assert.equal(gate?.status, 'satisfied');
  assert.equal(gate?.providerSessionId, 'reader-session-b2');
  // A Reader completion never consumes the Meditation substitution cap.
  assert.equal(runtime?.dailyAttentionExchange?.meditationSubstitutionsUsed, 0);
});

test('detailed Reader permission denial keeps CD4 open and surfaces the typed reason', async () => {
  installServices(baseRuntime());
  const coordinator = new RhythmCoordinator(
    readingClient,
    meditationBridge,
    readerDetailedProvider({
      availability: 'permission-denied',
      queryStatus: 'permission-denied',
    })
  );
  coordinators.push(coordinator);

  await coordinator.initialize();

  const runtime = coordinator.getRuntimeSnapshot();
  assert.notEqual(runtime?.activeRestorativeGates?.['social']?.status, 'satisfied');
  const diagnostic = coordinator.getRestorativeProviderDiagnostics().reader;
  assert.equal(diagnostic?.availability, 'permission-denied');
  assert.equal(diagnostic?.queryStatus, 'permission-denied');
});

test('detailed Reader completion satisfies CD4 and reports an available status', async () => {
  installServices(baseRuntime());
  const coordinator = new RhythmCoordinator(
    readingClient,
    meditationBridge,
    readerDetailedProvider({
      availability: 'available',
      queryStatus: 'available',
      status: 'COMPLETE',
    })
  );
  coordinators.push(coordinator);

  await coordinator.initialize();

  const runtime = coordinator.getRuntimeSnapshot();
  assert.equal(runtime?.activeRestorativeGates?.['social']?.status, 'satisfied');
  const diagnostic = coordinator.getRestorativeProviderDiagnostics().reader;
  assert.equal(diagnostic?.availability, 'available');
  assert.equal(diagnostic?.queryStatus, 'available');
});


test('cold start queries the exact bound Meditation V1 session and consumes one substitution', async () => {
  const runtime = baseRuntime();
  runtime.activeRestorativeGates = {
    social: {
      gateId: 'gate-b2-meditation',
      groupId: 'social',
      attentionDayId,
      dailyCooldownOrdinal: 4,
      createdAt: now,
      cooldownEndsAt: now - 1_000,
      requirementKind: 'restorative-choice',
      selectedProvider: 'meditation',
      providerSessionId: 'meditation-session-b2',
      status: 'in-progress',
      providerLocked: false,
      requiredRestorativeReadingSeconds: 1800,
      requiredRestorativeQualifiedPages: 11,
      requiredMeditationSeconds: 1800,
      meditationSubstitutionConsumed: false,
    },
  };
  installServices(runtime);

  const meditationCompleted: MeditationEvidenceBridge = {
    async isMeditationAvailable() {
      return 'available';
    },
    async startMeditationRecoverySession() {
      return true;
    },
    async queryMeditationStatus() {
      return null;
    },
    async queryMeditationStatusResult(sessionId: string) {
      return {
        availability: 'available',
        queryStatus: 'available',
        identityMetadataAvailable: true,
        evidence: {
          sessionId,
          protocolVersion: 1,
          status: 'COMPLETED',
          requiredQualifiedSeconds: 1800,
          completedQualifiedSeconds: 1800,
          completedAtEpochMs: now,
          lastUpdatedAtEpochMs: now,
          sessionKind: 'COOLDOWN_RESTORATIVE',
          sourceCooldownId: 'gate-b2-meditation',
          sourceRhythmicDayId: attentionDayId,
        },
      };
    },
  };

  const coordinator = new RhythmCoordinator(
    readingClient,
    meditationCompleted,
    readerProvider(null)
  );
  coordinators.push(coordinator);

  await coordinator.initialize();

  const after = coordinator.getRuntimeSnapshot();
  const gate = after?.activeRestorativeGates?.['social'];
  assert.equal(gate?.status, 'satisfied');
  assert.equal(gate?.providerSessionId, 'meditation-session-b2');
  assert.equal(after?.dailyAttentionExchange?.meditationSubstitutionsUsed, 1);
});

test('resume/provider query failure keeps the obligation enforced (no fail-open)', async () => {
  installServices(baseRuntime());
  const coordinator = new RhythmCoordinator(readingClient, meditationBridge, readerProvider(null));
  coordinators.push(coordinator);

  await coordinator.initialize();
  const gate = coordinator.getRuntimeSnapshot()?.activeRestorativeGates?.['social'];
  assert.notEqual(gate?.status, 'satisfied');
  assert.equal(gate?.providerSessionId, 'reader-session-b2');

  // Resume and bounded reconciliation must not clear the hold on a failed query.
  await coordinator.handleAppResume();
  assert.notEqual(
    coordinator.getRuntimeSnapshot()?.activeRestorativeGates?.['social']?.status,
    'satisfied'
  );
  await coordinator.refreshRestorativeProviderEvidence(now + 60_000);
  assert.notEqual(
    coordinator.getRuntimeSnapshot()?.activeRestorativeGates?.['social']?.status,
    'satisfied'
  );
});
