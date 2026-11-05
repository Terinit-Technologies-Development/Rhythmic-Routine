import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { NativeRestrictionProvider } from '../../../platform/native/NativeRestrictionProvider';
import {
  NativeAccessLeasePolicy,
  RestrictionCapability,
  RestrictionLeaseResult,
  RestrictionProvider,
  RestrictionResult,
} from '../../../platform/RestrictionProvider';
import { configurePlatformServices } from '../../../platform/PlatformServices';
import { MockStorageProvider } from '../../../platform/storage/MockStorageProvider';
import { MockUsageProvider } from '../../../platform/mock/MockUsageProvider';
import { MockPermissionProvider } from '../../../platform/permissions/MockPermissionProvider';
import { RhythmCoordinator } from '../../../application/RhythmCoordinator';
import type { DailyReadingEvidenceClient } from '../readingEvidence';
import type { MeditationEvidenceBridge } from '../meditationEvidence';

function fakeDevice(overrides: Record<string, unknown> = {}) {
  return {
    startAccessLease: async () => true,
    endAccessLease: async () => true,
    ...overrides,
  } as unknown as typeof import('../../../../modules/rhythm-device').default;
}

describe('F3 — access lease acknowledgements', () => {
  test('native provider maps false, throw, missing method and success honestly', async () => {
    const lease: NativeAccessLeasePolicy = {
      groupId: 'social',
      appIds: ['com.example.app'],
      startsAt: 1,
      endsAt: 2,
    };
    const failedStart = await new NativeRestrictionProvider(
      fakeDevice({ startAccessLease: async () => false })
    ).startAccessLease(lease);
    assert.equal(failedStart.status, 'failed');

    const thrownStart = await new NativeRestrictionProvider(
      fakeDevice({ startAccessLease: async () => { throw new Error('binder'); } })
    ).startAccessLease(lease);
    assert.equal(thrownStart.status, 'failed');
    assert.match(thrownStart.reason ?? '', /binder/);

    const missingStart = await new NativeRestrictionProvider(
      fakeDevice({ startAccessLease: undefined })
    ).startAccessLease(lease);
    assert.equal(missingStart.status, 'unsupported');

    const acceptedStart = await new NativeRestrictionProvider(fakeDevice()).startAccessLease(lease);
    assert.equal(acceptedStart.status, 'applied');

    const failedEnd = await new NativeRestrictionProvider(
      fakeDevice({ endAccessLease: async () => false })
    ).endAccessLease('social');
    assert.equal(failedEnd.status, 'failed');
    const thrownEnd = await new NativeRestrictionProvider(
      fakeDevice({ endAccessLease: async () => { throw new Error('binder-end'); } })
    ).endAccessLease('social');
    assert.equal(thrownEnd.status, 'failed');
    assert.match(thrownEnd.reason ?? '', /binder-end/);
    const acceptedEnd = await new NativeRestrictionProvider(fakeDevice()).endAccessLease('social');
    assert.equal(acceptedEnd.status, 'applied');
  });

  test('coordinator failed start/end leaves no optimistic runtime/history and ticks cannot resurrect', async () => {
    class ControlledRestrictions implements RestrictionProvider {
      failStart = false;
      failEnd = false;
      startGate?: Promise<void>;
      onStartEntered?: () => void;
      leases = new Map<string, NativeAccessLeasePolicy>();

      async applyRestrictions(appIds: string[]): Promise<RestrictionResult> {
        return { status: 'applied', appIds };
      }
      async clearRestrictions(appIds: string[]): Promise<RestrictionResult> {
        return { status: 'applied', appIds };
      }
      async getActiveRestrictedApps(): Promise<string[]> { return []; }
      async getCapability(): Promise<RestrictionCapability> {
        return {
          status: 'enforced',
          mode: 'continuous-session',
          supportsRoutineWindows: true,
          supportsGroupCooldowns: true,
          supportsContinuousSessionGap: true,
          supportsEmergencyOverride: true,
        };
      }
      async startAccessLease(lease: NativeAccessLeasePolicy): Promise<RestrictionLeaseResult> {
        this.onStartEntered?.();
        if (this.startGate) await this.startGate;
        if (this.failStart) return { status: 'failed', groupId: lease.groupId, reason: 'start-failed' };
        this.leases.set(lease.groupId, lease);
        return { status: 'applied', groupId: lease.groupId };
      }
      async endAccessLease(groupId: string): Promise<RestrictionLeaseResult> {
        if (this.failEnd) return { status: 'failed', groupId, reason: 'end-failed' };
        this.leases.delete(groupId);
        return { status: 'applied', groupId };
      }
    }

    const restrictions = new ControlledRestrictions();
    const storage = new MockStorageProvider();
    configurePlatformServices({
      usage: new MockUsageProvider(),
      restrictions,
      storage,
      permissions: new MockPermissionProvider(),
    });
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
    const bridge: MeditationEvidenceBridge = {
      async isMeditationAvailable() { return 'unavailable'; },
      async startMeditationRecoverySession() { return false; },
      async queryMeditationStatus() { return null; },
    };
    const coordinator = new RhythmCoordinator(daily, bridge);
    try {
      await coordinator.initialize();
      const secondaryGroupId = coordinator.getConfiguration()?.riskGroups
        .find((group) => group.id !== 'social')?.id;
      assert.ok(secondaryGroupId);
      const before = await storage.getHistoryEvents();
      restrictions.failStart = true;
      await assert.rejects(
        coordinator.dispatch({
          type: 'START_ACCESS_LEASE',
          groupId: 'social',
          durationMinutes: 5,
          timestamp: Date.now(),
        }),
        /not acknowledged/
      );
      assert.deepEqual(coordinator.getRuntime()?.activeAccessLeases, {});
      assert.equal((await storage.getHistoryEvents()).length, before.length);

      restrictions.failStart = false;
      const startedAt = Date.now();
      await coordinator.dispatch({
        type: 'START_ACCESS_LEASE',
        groupId: 'social',
        durationMinutes: 5,
        timestamp: startedAt,
      });
      const active = coordinator.getRuntime()?.activeAccessLeases?.social;
      assert.ok(active);
      const socialStarts = (events: Awaited<ReturnType<typeof storage.getHistoryEvents>>) =>
        events.filter((event) => event.type === 'access-lease-started' && event.groupId === 'social');
      assert.equal(
        socialStarts(await storage.getHistoryEvents()).length,
        socialStarts(before).length + 1,
        'successful start records exactly one lease-start event independently of state transitions'
      );

      // While a native start is pending, clock/reconcile work must queue and
      // cannot publish pre-lease state. A second group is preserved.
      let releaseStart: (() => void) | undefined;
      restrictions.startGate = new Promise<void>((resolve) => { releaseStart = resolve; });
      let entered: (() => void) | undefined;
      const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
      restrictions.onStartEntered = () => entered?.();
      const pendingStart = coordinator.dispatch({
        type: 'START_ACCESS_LEASE',
        groupId: secondaryGroupId!,
        durationMinutes: 5,
        timestamp: startedAt + 500,
      });
      await enteredPromise;
      let tickCompleted = false;
      const queuedTick = coordinator.dispatch({
        type: 'CLOCK_TICK',
        timestamp: startedAt + 1000,
      }).then(() => { tickCompleted = true; });
      let resumeCompleted = false;
      const queuedResume = coordinator.handleAppResume().then(() => { resumeCompleted = true; });
      await Promise.resolve();
      assert.equal(tickCompleted, false, 'tick must wait behind pending lease transaction');
      assert.equal(resumeCompleted, false, 'resume/import/sync must wait behind pending lease transaction');
      assert.ok(coordinator.getRuntime()?.activeAccessLeases?.social);
      releaseStart?.();
      await pendingStart;
      await queuedTick;
      await queuedResume;
      restrictions.startGate = undefined;
      restrictions.onStartEntered = undefined;
      assert.ok(coordinator.getRuntime()?.activeAccessLeases?.[secondaryGroupId!]);
      assert.ok(coordinator.getRuntime()?.activeAccessLeases?.social);

      const historyBeforeFailedEnd = (await storage.getHistoryEvents()).length;
      const persistedBeforeFailedEnd = await storage.loadRuntime();
      restrictions.failEnd = true;
      await assert.rejects(
        coordinator.dispatch({ type: 'END_ACCESS_LEASE', groupId: 'social', timestamp: startedAt + 1000 }),
        /not acknowledged/
      );
      assert.ok(coordinator.getRuntime()?.activeAccessLeases?.social);
      assert.equal((await storage.getHistoryEvents()).length, historyBeforeFailedEnd);
      assert.deepEqual(await storage.loadRuntime(), persistedBeforeFailedEnd);

      await coordinator.dispatch({ type: 'CLOCK_TICK', timestamp: startedAt + 2000 });
      assert.ok(coordinator.getRuntime()?.activeAccessLeases?.social);

      restrictions.failEnd = false;
      await coordinator.dispatch({ type: 'END_ACCESS_LEASE', groupId: 'social', timestamp: startedAt + 3000 });
      assert.equal(coordinator.getRuntime()?.activeAccessLeases?.social, undefined);
    } finally {
      coordinator.destroy();
    }
  });
});
