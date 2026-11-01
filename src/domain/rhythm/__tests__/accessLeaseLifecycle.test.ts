import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { RhythmCoordinator } from '../../../application/RhythmCoordinator';
import { resetAccountabilityService } from '../../../application/AccountabilityService';
import { configurePlatformServices, getPlatformServices } from '../../../platform/PlatformServices';
import { MockRestrictionProvider } from '../../../platform/mock/MockRestrictionProvider';
import { MockPermissionProvider } from '../../../platform/permissions/MockPermissionProvider';
import { MockStorageProvider } from '../../../platform/storage/MockStorageProvider';
import { MockUsageProvider } from '../../../platform/mock/MockUsageProvider';
import { InMemorySecureCredentialProvider } from '../../../platform/SecureCredentialProvider';
import type { NativeAccessLeasePolicy } from '../../../platform/RestrictionProvider';
import type { PersistedRuntime } from '../types';
import { usePrototypeStore } from '../../../store/usePrototypeStore';

beforeEach(async () => {
  configurePlatformServices({
    storage: new MockStorageProvider(), usage: new MockUsageProvider(),
    permissions: new MockPermissionProvider(), restrictions: new MockRestrictionProvider(),
    credentials: new InMemorySecureCredentialProvider(),
  });
  resetAccountabilityService();
  usePrototypeStore.getState().cancelPendingApproval();
  usePrototypeStore.setState({ accountability: { enabled: false, partners: [] } });
  await usePrototypeStore.getState().resetDemo();
  usePrototypeStore.setState({ emergencyAccessError: null, emergencyModalVisible: false });
});
afterEach(() => RhythmCoordinator.getInstance().destroy());

class FailedLease extends MockRestrictionProvider {
  calls = 0;
  async startAccessLease(lease: NativeAccessLeasePolicy) {
    this.calls += 1;
    return { status: 'failed' as const, groupId: lease.groupId, reason: 'commit-rejected' };
  }
}

test('disabled-mode native lease rejection remains visible and grants no runtime lease', async () => {
  const provider = new FailedLease();
  configurePlatformServices({ ...getPlatformServices(), restrictions: provider });
  const before = await getPlatformServices().storage.getHistoryEvents();
  await assert.rejects(usePrototypeStore.getState().requestProtectedMutation({
    operation: 'start-access-lease', summary: 'Test emergency access',
    payload: { groupId: 'social', durationMinutes: 5 },
  }), /not acknowledged/);
  const state = usePrototypeStore.getState();
  assert.equal(provider.calls, 1);
  assert.equal(state.pendingApproval, null);
  assert.equal(state.emergencyModalVisible, true);
  assert.match(state.emergencyAccessError ?? '', /could not be confirmed/);
  assert.equal(RhythmCoordinator.getInstance().getRuntime()?.activeAccessLeases.social, undefined);
  assert.deepEqual(await getPlatformServices().storage.getHistoryEvents(), before);
});

test('partner-approved lease rejection survives approval close and retry requires fresh approval', async () => {
  const partner = await usePrototypeStore.getState().createAccountabilityPartner({
    name: 'Lease QA', password: 'fixture-password',
  });
  await usePrototypeStore.getState().enableAccountability(partner.id, 'fixture-password');
  const provider = new FailedLease();
  configurePlatformServices({ ...getPlatformServices(), restrictions: provider });
  const mutation = { operation: 'start-access-lease' as const, summary: 'Test emergency access',
    payload: { groupId: 'social', durationMinutes: 5 } };
  assert.equal((await usePrototypeStore.getState().requestProtectedMutation(mutation)).status, 'pending-approval');
  const approvalId = usePrototypeStore.getState().pendingApproval!.id;
  assert.equal(provider.calls, 0);
  const before = await getPlatformServices().storage.getHistoryEvents();
  await assert.rejects(usePrototypeStore.getState().approveProtectedMutation(partner.id, 'fixture-password'), /not acknowledged/);
  const state = usePrototypeStore.getState();
  assert.equal(state.pendingApproval, null);
  assert.equal(state.accountability.enabled, true);
  assert.equal(state.emergencyModalVisible, true);
  assert.match(state.emergencyAccessError ?? '', /request approval/);
  assert.equal(RhythmCoordinator.getInstance().getRuntime()?.activeAccessLeases.social, undefined);
  assert.deepEqual(await getPlatformServices().storage.getHistoryEvents(), before);
  assert.equal(provider.calls, 1);
  assert.equal((await state.requestProtectedMutation(mutation)).status, 'pending-approval');
  assert.notEqual(usePrototypeStore.getState().pendingApproval!.id, approvalId);
  assert.equal(provider.calls, 1, 'retry must not reuse the consumed authorization');
  usePrototypeStore.getState().cancelPendingApproval();
});

test('concurrent initialization waits for native activation before either caller completes', async () => {
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  class DeferredPermissions extends MockPermissionProvider {
    calls = 0;
    async getStatus() {
      if (++this.calls === 2) { enter(); await gate; }
      return super.getStatus();
    }
  }
  configurePlatformServices({ ...getPlatformServices(), permissions: new DeferredPermissions() });
  const coordinator = new RhythmCoordinator();
  const first = coordinator.initialize();
  let second: ReturnType<typeof coordinator.initialize> | undefined;
  try {
    await entered;
    let completed = false;
    second = coordinator.initialize().then((runtime) => { completed = true; return runtime; });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(completed, false);
    release();
    const [a, b] = await Promise.all([first, second]);
    assert.deepEqual(a, b);
  } finally {
    release();
    await Promise.allSettled(second ? [first, second] : [first]);
    coordinator.destroy();
  }
});

test('dispatch after failed activation cannot use a partially initialized engine', async () => {
  class FailedActivation extends MockPermissionProvider {
    calls = 0;
    async getStatus() {
      if (++this.calls === 2) throw new Error('activation-failed');
      return super.getStatus();
    }
  }
  const permissions = new FailedActivation();
  configurePlatformServices({ ...getPlatformServices(), permissions });
  const coordinator = new RhythmCoordinator();
  try {
    await assert.rejects(coordinator.initialize(), /activation-failed/);
    const result = await Promise.allSettled([
      coordinator.dispatch({ type: 'CLOCK_TICK', timestamp: Date.now() }),
    ]);
    if (result[0].status === 'fulfilled') {
      assert.ok(permissions.calls >= 4, 'dispatch must complete a successful startup before operating');
    }
    await coordinator.initialize();
    assert.ok(permissions.calls >= 4);
  } finally { coordinator.destroy(); }
});

test('rejected group deletion retains its cooldown when native lease removal fails', async () => {
  const coordinator = RhythmCoordinator.getInstance();
  const now = Date.now();
  await coordinator.dispatch({
    type: 'NATIVE_COOLDOWN_RESTORED', groupId: 'social',
    endsAt: now + 90 * 60_000, legacy: true, timestamp: now,
  });
  await coordinator.dispatch({
    type: 'START_ACCESS_LEASE', groupId: 'social', durationMinutes: 5, timestamp: now,
  });
  const before = coordinator.getRuntime()!;
  assert.ok(before.activeCooldowns.social);
  assert.ok(before.activeAccessLeases.social);
  class FailedEnd extends MockRestrictionProvider {
    async endAccessLease(groupId: string) {
      return { status: 'failed' as const, groupId, reason: 'remove-not-persisted' };
    }
  }
  configurePlatformServices({ ...getPlatformServices(), restrictions: new FailedEnd() });
  await assert.rejects(coordinator.deleteRiskGroup('social', now + 1), /not acknowledged/);
  const after = coordinator.getRuntime()!;
  assert.deepEqual(after.activeAccessLeases, before.activeAccessLeases);
  assert.deepEqual(after.activeCooldowns, before.activeCooldowns,
    'failed lease removal must not silently drop the retained group cooldown');
});

test('post-acknowledgement storage failure does not falsely report that native access was never granted', async () => {
  const coordinator = RhythmCoordinator.getInstance();
  await coordinator.initialize();
  let nativeApplied = false;
  class AppliedLease extends MockRestrictionProvider {
    async startAccessLease(lease: NativeAccessLeasePolicy) {
      nativeApplied = true;
      return { status: 'applied' as const, groupId: lease.groupId };
    }
  }
  class FailedProjection extends MockStorageProvider {
    async saveRuntime(runtime: PersistedRuntime): Promise<void> {
      if (runtime.activeAccessLeases?.social) throw new Error('local-projection-failed');
      await super.saveRuntime(runtime);
    }
  }
  configurePlatformServices({
    ...getPlatformServices(), restrictions: new AppliedLease(), storage: new FailedProjection(),
  });
  await assert.rejects(usePrototypeStore.getState().requestProtectedMutation({
    operation: 'start-access-lease', summary: 'Test emergency access',
    payload: { groupId: 'social', durationMinutes: 5 },
  }), /local-projection-failed/);
  assert.equal(nativeApplied, true);
  assert.ok(coordinator.getRuntime()?.activeAccessLeases.social);
  const state = usePrototypeStore.getState();
  assert.equal(state.emergencyModalVisible, true);
  assert.ok(state.emergencyAccessError);
  assert.doesNotMatch(state.emergencyAccessError, /not granted|never granted/);
});
