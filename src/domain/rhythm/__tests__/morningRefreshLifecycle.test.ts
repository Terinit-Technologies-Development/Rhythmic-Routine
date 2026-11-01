import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { RhythmCoordinator } from '../../../application/RhythmCoordinator';
import { configurePlatformServices } from '../../../platform/PlatformServices';
import { MockStorageProvider } from '../../../platform/storage/MockStorageProvider';
import { MockUsageProvider } from '../../../platform/mock/MockUsageProvider';
import { MockRestrictionProvider } from '../../../platform/mock/MockRestrictionProvider';
import { MockPermissionProvider } from '../../../platform/permissions/MockPermissionProvider';
import type { DailyReadingEvidenceClient } from '../readingEvidence';
import type {
  MeditationEvidenceBridge,
  MeditationEvidenceResult,
  MeditationSessionEvidence,
} from '../meditationEvidence';
import { getLocalDateKey } from '../allowance';
import type { RoutineWindow } from '../../../types/domain';
import type { PersistedRuntime, RhythmPreferences } from '../types';
import type { MorningMeditationRequirement } from '../morningMeditation';

function boundaryWindow(): RoutineWindow {
  const now = new Date();
  const iso = now.getDay() === 0 ? 7 : now.getDay();
  const previous = iso === 1 ? 7 : iso - 1;
  return {
    id: 'morning-boundary',
    name: 'Morning Boundary',
    type: 'morning-buffer',
    startTime: '23:59',
    endTime: '00:00',
    activeDays: [iso, previous],
    protectedGroupIds: ['social'],
    enabled: true,
    tagline: 'Boundary',
    description: 'Boundary',
  };
}

const daily: DailyReadingEvidenceClient = {
  async query(dateKey) {
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

function exactEvidence(
  sessionId: string,
  day: string,
  overrides: Partial<MeditationSessionEvidence> = {}
): MeditationSessionEvidence {
  return {
    sessionId,
    protocolVersion: 1,
    status: 'COMPLETED',
    requiredQualifiedSeconds: 1800,
    completedQualifiedSeconds: 1800,
    completedAtEpochMs: Date.now(),
    lastUpdatedAtEpochMs: Date.now(),
    sessionKind: 'MORNING_REQUIRED',
    sourceCooldownId: null,
    sourceRhythmicDayId: day,
    ...overrides,
  };
}

type DeferredQuery = {
  entered: Promise<void>;
  resolve: (result: MeditationEvidenceResult) => void;
};

describe('F6 — delayed morning provider result sequencing', () => {
  test('carried old-day completion is validated at receipt and never clears newer state', async () => {
    const window = boundaryWindow();
    const now = Date.now();
    const oldDay = 'ad-20200101-0000';
    const oldCreatedAt = new Date(2020, 0, 1, 0, 0, 0, 0).getTime();
    const oldRequirement: MorningMeditationRequirement = {
      attentionDayId: oldDay,
      sessionId: `morning-${oldDay}`,
      requiredQualifiedSeconds: 1800,
      createdAt: oldCreatedAt,
      sourceRhythmicDayId: oldDay,
      sessionKind: 'MORNING_REQUIRED',
      sourceCooldownId: null,
    };
    const preferences: RhythmPreferences = {
      routineWindows: [window],
      riskGroups: [
        {
          id: 'social',
          name: 'Social',
          description: 'Social',
          iconName: 'users',
          iconColor: '#000',
          iconBg: '#fff',
          appIds: ['com.example.social'],
          allowanceMinutes: 30,
          cooldownMinutes: 90,
          currentSessionMinutes: 0,
        },
      ],
      appClassifications: {
        'com.example.social': { classification: 'risk', riskGroupId: 'social' },
      },
      sessionResetGapMs: 5 * 60 * 1000,
      onboardingCompleted: true,
      accountability: { enabled: false, partners: [] },
    };
    const persisted: PersistedRuntime = {
      state: 'available',
      activeCooldowns: {},
      activeRoutineWindowIds: [],
      lastReconciledAt: now,
      morningMeditation: {
        requirement: oldRequirement,
        requirements: [oldRequirement],
        migration: {
          migratedAt: oldCreatedAt,
          migrationAttentionDayId: oldDay,
          enforceableFromAttentionDayId: oldDay,
        },
      },
    };
    configurePlatformServices({
      usage: new MockUsageProvider([
        {
          id: 'com.example.social',
          name: 'Social',
          classification: 'risk',
          riskGroupId: 'social',
          iconName: 'users',
          iconColor: '#000',
          iconBg: '#fff',
          defaultCategory: 'Social',
          usageTodayMinutes: 0,
          sessionMinutes: 0,
        },
      ]),
      restrictions: new MockRestrictionProvider(),
      storage: new MockStorageProvider(preferences, persisted),
      permissions: new MockPermissionProvider(),
    });

    let armed = false;
    let deferred: DeferredQuery | undefined;
    const bridge: MeditationEvidenceBridge = {
      async isMeditationAvailable() { return 'available'; },
      async startMeditationRecoverySession() { return true; },
      async queryMeditationStatus(sessionId) {
        const result = await this.queryMeditationStatusResult!(sessionId);
        return result.evidence ?? null;
      },
      queryMeditationStatusResult() {
        if (!armed) {
          return Promise.resolve({
            availability: 'available',
            identityMetadataAvailable: true,
            evidence: undefined,
          });
        }
        let enteredResolve: (() => void) | undefined;
        let resultResolve: ((result: MeditationEvidenceResult) => void) | undefined;
        const entered = new Promise<void>((resolve) => { enteredResolve = resolve; });
        const result = new Promise<MeditationEvidenceResult>((resolve) => {
          resultResolve = resolve;
        });
        deferred = {
          entered,
          resolve: (value) => {
            deferred = undefined;
            resultResolve?.(value);
          },
        };
        enteredResolve?.();
        return result;
      },
    };

    const coordinator = new RhythmCoordinator(daily, bridge);
    try {
      const initial = await coordinator.initialize();
      const requirements = initial.morningMeditation?.requirements ?? [];
      const carried = requirements.find((item) => item.sessionId === oldRequirement.sessionId);
      const current = requirements.find((item) => item.sessionId !== oldRequirement.sessionId);
      assert.ok(carried, 'old-day carried binding survives initialization');
      assert.ok(current, 'current eligible day has its own binding');
      assert.equal(initial.morningMeditation?.requirement?.sessionId, oldRequirement.sessionId);

      const existing = coordinator.getRuntime()!;
      const gateAt = Date.now();
      await coordinator.dispatch({
        type: 'SYNC_NATIVE_ATTENTION_EXCHANGE',
        dailyAttentionExchange: {
          dateKey: existing.dailyAttentionExchange!.dateKey,
          cooldownsTriggered: 0,
          highestRequiredActiveSeconds: 0,
          highestRequiredQualifiedPages: 0,
          updatedAt: gateAt,
          attentionDayId: existing.dailyAttentionExchange!.attentionDayId ?? oldDay,
        },
        activeReadingGates: {
          social: {
            groupId: 'social',
            attentionDateKey: getLocalDateKey(gateAt),
            dailyCooldownOrdinal: 3,
            createdAt: gateAt,
            cooldownEndsAt: gateAt - 1,
            requiredReadingSeconds: 3600,
            requiredQualifiedPages: 36,
          },
        },
        activeCooldowns: {},
        activeAccessLeases: {},
        groupAllowanceUsage: {},
        timestamp: gateAt,
      });
      assert.ok(coordinator.getRuntime()?.activeReadingGates?.social);

      armed = true;
      const first = coordinator.refreshMorningMeditationEvidence(now - 86_400_000);
      for (let i = 0; i < 50 && !deferred; i += 1) await Promise.resolve();
      assert.ok(deferred);
      const firstDeferred = deferred as DeferredQuery;
      await Promise.race([
        firstDeferred.entered,
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('provider query did not start')), 2000)
        ),
      ]);
      let tickCompleted = false;
      const queuedTick = coordinator.dispatch({
        type: 'CLOCK_TICK',
        timestamp: Date.now(),
      }).then(() => { tickCompleted = true; });
      await Promise.resolve();
      assert.equal(tickCompleted, false, 'queued newer state waits behind refresh');
      firstDeferred.resolve({
        availability: 'available',
        identityMetadataAvailable: true,
        evidence: exactEvidence(oldRequirement.sessionId, oldDay, {
          sessionKind: 'COOLDOWN_RESTORATIVE',
          sourceCooldownId: 'cd-1',
        }),
      });
      await first;
      await queuedTick;
      assert.ok(coordinator.getRuntime()?.activeReadingGates?.social);
      assert.equal(
        coordinator.getRuntime()?.morningMeditation?.requirements?.find(
          (item) => item.sessionId === oldRequirement.sessionId
        )?.satisfiedAt,
        undefined
      );
      assert.equal(coordinator.getMorningMeditationDiagnostics().satisfied, false);

      const second = coordinator.refreshMorningMeditationEvidence(now - 86_400_000);
      for (let i = 0; i < 50 && !deferred; i += 1) await Promise.resolve();
      assert.ok(deferred);
      const secondDeferred = deferred as DeferredQuery;
      await Promise.race([
        secondDeferred.entered,
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('provider query did not start')), 2000)
        ),
      ]);
      secondDeferred.resolve({
        availability: 'available',
        identityMetadataAvailable: true,
        evidence: exactEvidence(oldRequirement.sessionId, oldDay),
      });
      await second;
      const afterOld = coordinator.getRuntime()!;
      assert.ok(afterOld.morningMeditation?.requirements?.find(
        (item) => item.sessionId === oldRequirement.sessionId
      )?.satisfiedAt !== undefined);
      assert.equal(afterOld.morningMeditation?.requirement?.sessionId, current!.sessionId);
      const diagnostics = coordinator.getMorningMeditationDiagnostics();
      assert.equal(diagnostics.requirement?.sessionId, current!.sessionId);
      assert.equal(diagnostics.satisfied, false);
      assert.ok(afterOld.activeReadingGates?.social);
      assert.equal(afterOld.dailyAttentionExchange?.meditationSubstitutionsUsed ?? 0, 0);

      const third = coordinator.refreshMorningMeditationEvidence(now - 86_400_000);
      for (let i = 0; i < 50 && !deferred; i += 1) await Promise.resolve();
      assert.ok(deferred);
      const thirdDeferred = deferred as DeferredQuery;
      await Promise.race([
        thirdDeferred.entered,
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('provider query did not start')), 2000)
        ),
      ]);
      thirdDeferred.resolve({
        availability: 'available',
        identityMetadataAvailable: true,
        evidence: exactEvidence(current!.sessionId, current!.attentionDayId),
      });
      await third;
      assert.equal(coordinator.getMorningMeditationDiagnostics().satisfied, true);
      const finalMorning = coordinator.getRuntime()!.morningMeditation!;
      assert.ok(finalMorning.requirements?.find(
        (item) => item.sessionId === current!.sessionId
      )?.satisfiedAt !== undefined, 'the current-day obligation itself must be complete');
      assert.equal(
        coordinator.getMorningMeditationDiagnostics().requirement?.sessionId,
        finalMorning.requirement?.sessionId,
        'diagnostics must describe the canonical displayed requirement after all obligations complete'
      );
    } finally {
      if (deferred) {
        deferred.resolve({ availability: 'unavailable' });
      }
      coordinator.destroy();
    }
  });
});
