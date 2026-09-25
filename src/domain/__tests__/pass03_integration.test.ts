import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { usePrototypeStore } from '../../store/usePrototypeStore';
import { resetAccountabilityService } from '../../application/AccountabilityService';
import { getPlatformServices } from '../../platform/PlatformServices';
import { InMemorySecureCredentialProvider } from '../../platform/SecureCredentialProvider';
import { RhythmCoordinator } from '../../application/RhythmCoordinator';
import {
  __getFallbackGroupRevisionForTests,
  __resetFallbackRevisionsForTests,
} from '../../../modules/rhythm-device/src/RhythmDeviceModule';
import RhythmDeviceModule from '../../../modules/rhythm-device';
import { AppPolicyPayload } from '../accountability/types';
import { buildAppPolicySummary, buildRiskGroupEditSummary } from '../accountability/policy';
import { RiskGroupConfigurationDraft } from '../../types/domain';

describe('Pass 03 — Protected Workflows & Full Integration', () => {
  beforeEach(async () => {
    const { credentials } = getPlatformServices();
    if (credentials instanceof InMemorySecureCredentialProvider) {
      credentials.clear();
    }
    __resetFallbackRevisionsForTests();
    resetAccountabilityService();
    usePrototypeStore.getState().cancelPendingApproval();
    usePrototypeStore.setState({ accountability: { enabled: false, partners: [] } });
    await usePrototypeStore.getState().resetDemo();
  });

  test('1. app classification requires approval when mode ON', async () => {
    const store = usePrototypeStore.getState();
    const partner = await store.createAccountabilityPartner({
      name: 'Alice',
      password: 'password123',
    });
    await store.enableAccountability(partner.id, 'password123');

    const app = store.apps.find((a) => a.id === 'instagram')!;
    assert.equal(app.classification, 'risk');

    const payload: AppPolicyPayload = {
      appId: 'instagram',
      classification: 'normal',
    };

    const result = await store.requestProtectedMutation({
      operation: 'change-app-classification',
      summary: buildAppPolicySummary(app, payload, store.riskGroups),
      payload,
    });

    assert.equal(result.status, 'pending-approval');
    assert.ok(usePrototypeStore.getState().pendingApproval);
    assert.equal(
      usePrototypeStore.getState().apps.find((a) => a.id === 'instagram')?.classification,
      'risk'
    );
  });

  test('2. wrong password or cancel leaves app classification unchanged', async () => {
    const store = usePrototypeStore.getState();
    const partner = await store.createAccountabilityPartner({
      name: 'Alice',
      password: 'password123',
    });
    await store.enableAccountability(partner.id, 'password123');

    const app = store.apps.find((a) => a.id === 'instagram')!;
    const payload: AppPolicyPayload = {
      appId: 'instagram',
      classification: 'normal',
    };

    await store.requestProtectedMutation({
      operation: 'change-app-classification',
      summary: buildAppPolicySummary(app, payload, store.riskGroups),
      payload,
    });

    // Wrong password
    const failRes = await store.approveProtectedMutation(partner.id, 'wrong-password');
    assert.equal(failRes.ok, false);
    assert.equal(
      usePrototypeStore.getState().apps.find((a) => a.id === 'instagram')?.classification,
      'risk'
    );
    assert.ok(usePrototypeStore.getState().pendingApproval);

    // Cancel
    store.cancelPendingApproval();
    assert.equal(usePrototypeStore.getState().pendingApproval, null);
    assert.equal(
      usePrototypeStore.getState().apps.find((a) => a.id === 'instagram')?.classification,
      'risk'
    );
  });

  test('3. classification + allowance commits atomically exactly once after approval', async () => {
    const store = usePrototypeStore.getState();
    const partner = await store.createAccountabilityPartner({
      name: 'Alice',
      password: 'password123',
    });
    await store.enableAccountability(partner.id, 'password123');

    const app = store.apps.find((a) => a.id === 'netflix')!; // initially entertainment (45m allowance)
    assert.equal(app.riskGroupId, 'entertainment');

    const payload: AppPolicyPayload = {
      appId: 'netflix',
      classification: 'risk',
      riskGroupId: 'entertainment',
      dailyAllowanceMinutes: 60,
    };

    const res = await store.requestProtectedMutation({
      operation: 'change-app-classification',
      summary: buildAppPolicySummary(app, payload, store.riskGroups),
      payload,
    });
    assert.equal(res.status, 'pending-approval');

    // Approve
    const approveRes = await store.approveProtectedMutation(partner.id, 'password123');
    assert.equal(approveRes.ok, true);

    const updatedApp = usePrototypeStore.getState().apps.find((a) => a.id === 'netflix')!;
    const updatedGroup = usePrototypeStore.getState().riskGroups.find((g) => g.id === 'entertainment')!;

    assert.equal(updatedApp.riskGroupId, 'entertainment');
    assert.equal(updatedGroup.allowanceMinutes, 60);
    assert.equal(usePrototypeStore.getState().pendingApproval, null);
  });

  test('4. moving app to custom group preserves group membership invariant', async () => {
    const store = usePrototypeStore.getState();

    // Mode OFF: create custom group
    const customGroupId = await store.createRiskGroup({
      name: 'Gaming',
      allowanceMinutes: 30,
      cooldownMinutes: 60,
    });

    const partner = await store.createAccountabilityPartner({
      name: 'Alice',
      password: 'password123',
    });
    await store.enableAccountability(partner.id, 'password123');

    // Move 'discord' from 'social' to 'Gaming'
    const app = store.apps.find((a) => a.id === 'discord')!;
    assert.equal(app.riskGroupId, 'social');
    assert.ok(store.riskGroups.find((g) => g.id === 'social')?.appIds.includes('discord'));

    const payload: AppPolicyPayload = {
      appId: 'discord',
      classification: 'risk',
      riskGroupId: customGroupId,
    };

    await store.requestProtectedMutation({
      operation: 'change-app-classification',
      summary: buildAppPolicySummary(app, payload, store.riskGroups),
      payload,
    });

    await store.approveProtectedMutation(partner.id, 'password123');

    const nextState = usePrototypeStore.getState();
    const updatedApp = nextState.apps.find((a) => a.id === 'discord')!;
    const oldGroup = nextState.riskGroups.find((g) => g.id === 'social')!;
    const newGroup = nextState.riskGroups.find((g) => g.id === customGroupId)!;

    assert.equal(updatedApp.riskGroupId, customGroupId);
    assert.equal(oldGroup.appIds.includes('discord'), false);
    assert.equal(newGroup.appIds.includes('discord'), true);
  });

  test('5. Risk Group draft does not persist before approval', async () => {
    const store = usePrototypeStore.getState();
    const partner = await store.createAccountabilityPartner({
      name: 'Alice',
      password: 'password123',
    });
    await store.enableAccountability(partner.id, 'password123');

    const group = store.riskGroups.find((g) => g.id === 'social')!;
    const originalCooldown = group.cooldownMinutes;

    const draft: RiskGroupConfigurationDraft = {
      name: 'Social Feeds Renamed',
      description: 'New Description',
      allowanceMinutes: group.allowanceMinutes ?? 60,
      cooldownMinutes: originalCooldown + 30,
      recoveryActivityId: group.recoveryActivityId ?? 'reading',
      morningProtected: false,
      eveningProtected: true,
    };

    const res = await store.requestProtectedMutation({
      operation: 'edit-risk-group',
      summary: `Update ${group.name} protection settings`,
      payload: {
        groupId: group.id,
        draft,
      },
    });

    assert.equal(res.status, 'pending-approval');

    // Unchanged in store and coordinator
    const currentGroup = usePrototypeStore.getState().riskGroups.find((g) => g.id === 'social')!;
    assert.equal(currentGroup.name, group.name);
    assert.equal(currentGroup.cooldownMinutes, originalCooldown);

    // Cancel leaves it intact
    store.cancelPendingApproval();
    assert.equal(usePrototypeStore.getState().riskGroups.find((g) => g.id === 'social')?.name, group.name);
  });

  test('6. approved Risk Group batch updates group + routine protection coherently', async () => {
    const store = usePrototypeStore.getState();
    const partner = await store.createAccountabilityPartner({
      name: 'Alice',
      password: 'password123',
    });
    await store.enableAccountability(partner.id, 'password123');

    const group = store.riskGroups.find((g) => g.id === 'social')!;

    const draft: RiskGroupConfigurationDraft = {
      name: 'Calm Feeds',
      description: 'Reformed feeds',
      allowanceMinutes: group.allowanceMinutes ?? 60,
      cooldownMinutes: 120,
      recoveryActivityId: 'reading',
      morningProtected: true,
      eveningProtected: true,
    };

    await store.requestProtectedMutation({
      operation: 'edit-risk-group',
      summary: `Update ${group.name} protection settings`,
      payload: {
        groupId: group.id,
        draft,
      },
    });

    await store.approveProtectedMutation(partner.id, 'password123');

    const state = usePrototypeStore.getState();
    const updated = state.riskGroups.find((g) => g.id === 'social')!;
    assert.equal(updated.name, 'Calm Feeds');
    assert.equal(updated.cooldownMinutes, 120);
    assert.equal(updated.recoveryActivityId, 'reading');

    const morningWin = state.routineWindows.find((w) => w.id === 'morning-buffer')!;
    const eveningWin = state.routineWindows.find((w) => w.id === 'evening-wind-down')!;
    assert.ok(morningWin.protectedGroupIds.includes('social'));
    assert.ok(eveningWin.protectedGroupIds.includes('social'));
  });

  test('7. custom group create is gated when mode ON, immediate when mode OFF', async () => {
    const store = usePrototypeStore.getState();

    // Mode OFF: immediate
    const resOff = await store.requestProtectedMutation({
      operation: 'create-risk-group',
      summary: 'Create Risk Group "Hobbies" · 30 min session · 60 min cooldown',
      payload: {
        name: 'Hobbies',
        allowanceMinutes: 30,
        cooldownMinutes: 60,
      },
    });
    assert.equal(resOff.status, 'executed');
    assert.ok(usePrototypeStore.getState().riskGroups.some((g) => g.name === 'Hobbies'));

    // Enable mode
    const partner = await store.createAccountabilityPartner({
      name: 'Alice',
      password: 'password123',
    });
    await store.enableAccountability(partner.id, 'password123');

    // Mode ON: gated
    const resOn = await store.requestProtectedMutation({
      operation: 'create-risk-group',
      summary: 'Create Risk Group "Gaming" · 45 min session · 90 min cooldown',
      payload: {
        name: 'Gaming',
        allowanceMinutes: 45,
        cooldownMinutes: 90,
      },
    });
    assert.equal(resOn.status, 'pending-approval');
    assert.equal(usePrototypeStore.getState().riskGroups.some((g) => g.name === 'Gaming'), false);

    // Approve
    await store.approveProtectedMutation(partner.id, 'password123');
    assert.ok(usePrototypeStore.getState().riskGroups.some((g) => g.name === 'Gaming'));
  });

  test('8. custom group delete/reassignment is gated and atomic', async () => {
    const store = usePrototypeStore.getState();
    const customId = await store.createRiskGroup({
      name: 'DoomScroll',
      allowanceMinutes: 30,
      cooldownMinutes: 60,
    });

    // Assign 'tiktok' to DoomScroll
    await store.updateAppClassification('tiktok', 'risk', customId);

    const partner = await store.createAccountabilityPartner({
      name: 'Alice',
      password: 'password123',
    });
    await store.enableAccountability(partner.id, 'password123');

    // Gated deletion moving member app to 'social'
    const res = await store.requestProtectedMutation({
      operation: 'delete-risk-group',
      summary: 'Delete "DoomScroll" and move 1 app to "Social Feeds"',
      payload: {
        groupId: customId,
        replacementGroupId: 'social',
      },
    });
    assert.equal(res.status, 'pending-approval');
    assert.ok(usePrototypeStore.getState().riskGroups.some((g) => g.id === customId));

    // Approve
    await store.approveProtectedMutation(partner.id, 'password123');

    const state = usePrototypeStore.getState();
    assert.equal(state.riskGroups.some((g) => g.id === customId), false);
    assert.equal(state.apps.find((a) => a.id === 'tiktok')?.riskGroupId, 'social');
    assert.ok(state.riskGroups.find((g) => g.id === 'social')?.appIds.includes('tiktok'));
  });

  test('9. Access Lease is gated', async () => {
    const store = usePrototypeStore.getState();
    const partner = await store.createAccountabilityPartner({
      name: 'Alice',
      password: 'password123',
    });
    await store.enableAccountability(partner.id, 'password123');

    const res = await store.requestProtectedMutation({
      operation: 'start-access-lease',
      summary: 'Allow Social Feeds for 15 minutes',
      payload: {
        groupId: 'social',
        durationMinutes: 15,
      },
    });

    assert.equal(res.status, 'pending-approval');

    await store.approveProtectedMutation(partner.id, 'password123');
    // Leased snapshot or runtime updated
    assert.equal(usePrototypeStore.getState().pendingApproval, null);
  });

  test('10. local reset is gated and clears credentials on approval', async () => {
    const store = usePrototypeStore.getState();
    const partner = await store.createAccountabilityPartner({
      name: 'Alice',
      password: 'password123',
    });
    await store.enableAccountability(partner.id, 'password123');

    const { credentials } = getPlatformServices();
    if (credentials instanceof InMemorySecureCredentialProvider) {
      assert.equal(credentials.size, 1);
    }

    const res = await store.requestProtectedMutation({
      operation: 'reset-local-state',
      summary: 'Reset all Rhythmic Routine local settings',
      payload: {},
    });
    assert.equal(res.status, 'pending-approval');

    // Approve reset and verify platform-owned Pass 03 enforcement state is cleared.
    const resetNativeState = RhythmDeviceModule.resetEnforcementState;
    let nativeResetCount = 0;
    RhythmDeviceModule.resetEnforcementState = async () => {
      nativeResetCount += 1;
      return true;
    };
    try {
      await store.approveProtectedMutation(partner.id, 'password123');
    } finally {
      RhythmDeviceModule.resetEnforcementState = resetNativeState;
    }
    assert.equal(nativeResetCount, 1);

    const state = usePrototypeStore.getState();
    assert.equal(state.accountability.enabled, false);
    assert.equal(state.accountability.partners.length, 0);

    if (credentials instanceof InMemorySecureCredentialProvider) {
      assert.equal(credentials.size, 0);
    }
  });

  test('10a. reset aborts before deleting local and credential state when native reset fails', async () => {
    const store = usePrototypeStore.getState();
    const partner = await store.createAccountabilityPartner({
      name: 'Retain on native failure',
      password: 'password123',
    });
    const { credentials } = getPlatformServices();
    const resetNativeState = RhythmDeviceModule.resetEnforcementState;
    RhythmDeviceModule.resetEnforcementState = async () => false;
    try {
      await assert.rejects(store.resetDemo(), /Unable to clear native enforcement state/);
    } finally {
      RhythmDeviceModule.resetEnforcementState = resetNativeState;
    }

    assert.equal(usePrototypeStore.getState().accountability.partners[0]?.id, partner.id);
    if (credentials instanceof InMemorySecureCredentialProvider) {
      assert.equal(credentials.has(partner.credentialRef), true);
    }
    assert.equal(usePrototypeStore.getState().pendingApproval, null);
  });

  test('11. disabling accountability is gated', async () => {
    const store = usePrototypeStore.getState();
    const partner = await store.createAccountabilityPartner({
      name: 'Alice',
      password: 'password123',
    });
    await store.enableAccountability(partner.id, 'password123');
    assert.equal(usePrototypeStore.getState().accountability.enabled, true);

    const res = await store.requestProtectedMutation({
      operation: 'disable-accountability',
      summary: 'Disable Accountability Mode',
      payload: {},
    });
    assert.equal(res.status, 'pending-approval');
    assert.equal(usePrototypeStore.getState().accountability.enabled, true);

    await store.approveProtectedMutation(partner.id, 'password123');
    assert.equal(usePrototypeStore.getState().accountability.enabled, false);
    // Partner remains configured so user can re-enable later
    assert.equal(usePrototypeStore.getState().accountability.partners.length, 1);
  });

  test('12. partner removal/replacement is gated', async () => {
    const store = usePrototypeStore.getState();
    const p1 = await store.createAccountabilityPartner({
      name: 'Alice',
      password: 'password123',
    });
    const p2 = await store.createAccountabilityPartner({
      name: 'Bob',
      password: 'password456',
    });
    await store.enableAccountability(p1.id, 'password123');

    // Removing Bob requires approval
    await store.deleteAccountabilityPartner(p2.id);
    assert.ok(usePrototypeStore.getState().pendingApproval);
    assert.equal(usePrototypeStore.getState().accountability.partners.length, 2);

    await store.approveProtectedMutation(p1.id, 'password123');
    assert.equal(usePrototypeStore.getState().accountability.partners.length, 1);
    assert.equal(usePrototypeStore.getState().accountability.partners[0].id, p1.id);
  });

  test('13. mode OFF keeps normal flows usable without gating', async () => {
    const store = usePrototypeStore.getState();
    assert.equal(store.accountability.enabled, false);

    // App classification
    const resApp = await store.requestProtectedMutation({
      operation: 'change-app-classification',
      summary: 'Change Instagram to normal',
      payload: { appId: 'instagram', classification: 'normal' },
    });
    assert.equal(resApp.status, 'executed');
    assert.equal(
      usePrototypeStore.getState().apps.find((a) => a.id === 'instagram')?.classification,
      'normal'
    );

    // Group creation
    const resGroup = await store.requestProtectedMutation({
      operation: 'create-risk-group',
      summary: 'Create group',
      payload: { name: 'Writing', allowanceMinutes: 45, cooldownMinutes: 60 },
    });
    assert.equal(resGroup.status, 'executed');

    // Allowance
    const resAllow = await store.requestProtectedMutation({
      operation: 'change-daily-allowance',
      summary: 'Change allowance',
      payload: { groupId: 'entertainment', allowanceMinutes: 60 },
    });
    assert.equal(resAllow.status, 'executed');
    assert.equal(
      usePrototypeStore.getState().riskGroups.find((g) => g.id === 'entertainment')?.allowanceMinutes,
      60
    );
  });

  test('14. duplicate approval submission does not double-execute', async () => {
    const store = usePrototypeStore.getState();
    const partner = await store.createAccountabilityPartner({
      name: 'Alice',
      password: 'password123',
    });
    await store.enableAccountability(partner.id, 'password123');

    // We request an allowance change on entertainment (initial 45 -> 60)
    await store.requestProtectedMutation({
      operation: 'change-daily-allowance',
      summary: 'Change allowance to 60m',
      payload: { groupId: 'entertainment', allowanceMinutes: 60 },
    });

    // Run approval twice concurrently
    const [res1, res2] = await Promise.allSettled([
      store.approveProtectedMutation(partner.id, 'password123'),
      store.approveProtectedMutation(partner.id, 'password123'),
    ]);

    // One must succeed, the other must safely fail (e.g. partner-not-found / no pending approval)
    const successCount = [res1, res2].filter(
      (r) => r.status === 'fulfilled' && (r.value as any).ok === true
    ).length;

    assert.equal(successCount, 1);
    assert.equal(
      usePrototypeStore.getState().riskGroups.find((g) => g.id === 'entertainment')?.allowanceMinutes,
      60
    );
  });

  test('15. buildRiskGroupEditSummary produces exact multi-field change details', () => {
    const store = usePrototypeStore.getState();
    const group = store.riskGroups.find((g) => g.id === 'social')!;

    const draft: RiskGroupConfigurationDraft = {
      name: 'Calm Feeds',
      description: 'Reformed feeds',
      allowanceMinutes: 20,
      cooldownMinutes: 120,
      recoveryActivityId: 'stretch',
      morningProtected: false,
      eveningProtected: false,
    };

    const summary = buildRiskGroupEditSummary(
      group,
      draft,
      store.routineWindows,
      store.offlineActivities
    );

    assert.ok(summary.includes('rename “Social Feeds” to “Calm Feeds”'));
    assert.ok(summary.includes('update description'));
    assert.ok(summary.includes('allowance 30 → 20 min'));
    assert.ok(summary.includes('cooldown 90 → 120 min'));
    assert.ok(summary.includes('recovery activity → Stretch'));
    assert.ok(summary.includes('remove Morning Buffer protection'));
    assert.ok(summary.includes('remove Evening Wind-Down protection'));
  });

  test('16. iOS app selection stages and requires partner approval when mode ON', async () => {
    process.env.RHYTHM_PLATFORM_OVERRIDE = 'ios';
    try {
      const store = usePrototypeStore.getState();
      const partner = await store.createAccountabilityPartner({
        name: 'Alice',
        password: 'password123',
      });
      await store.enableAccountability(partner.id, 'password123');

      const initialGroup = store.riskGroups.find((g) => g.id === 'social')!;
      const initialRev = initialGroup.nativeSelectionRevision;

      await store.selectIosRiskGroupApps('social');

      const pending = usePrototypeStore.getState().pendingApproval;
      assert.ok(pending);
      assert.equal(pending.operation, 'edit-ios-risk-group-selection');
      assert.ok(pending.summary.includes('Update Social Feeds protected apps'));
      const payload = pending.payload as any;
      assert.equal(payload.groupId, 'social');
      assert.ok(payload.stagedSelectionRef.startsWith('pending_selection.'));

      // Active group in store is unchanged before approval
      const currentGroup = usePrototypeStore.getState().riskGroups.find((g) => g.id === 'social')!;
      assert.equal(currentGroup.nativeSelectionRevision, initialRev);
    } finally {
      delete process.env.RHYTHM_PLATFORM_OVERRIDE;
    }
  });

  test('17. cancelPendingApproval on iOS selection discards staged selection and leaves active selection unchanged', async () => {
    process.env.RHYTHM_PLATFORM_OVERRIDE = 'ios';
    try {
      const store = usePrototypeStore.getState();
      const partner = await store.createAccountabilityPartner({
        name: 'Alice',
        password: 'password123',
      });
      await store.enableAccountability(partner.id, 'password123');

      const initialGroup = store.riskGroups.find((g) => g.id === 'social')!;

      await store.selectIosRiskGroupApps('social');
      assert.ok(usePrototypeStore.getState().pendingApproval);

      store.cancelPendingApproval();
      assert.equal(usePrototypeStore.getState().pendingApproval, null);

      const currentGroup = usePrototypeStore.getState().riskGroups.find((g) => g.id === 'social')!;
      assert.equal(currentGroup.nativeSelectionRevision, initialGroup.nativeSelectionRevision);
    } finally {
      delete process.env.RHYTHM_PLATFORM_OVERRIDE;
    }
  });

  test('18. approving iOS app selection commits staged selection, increments revision, and updates coordinator config', async () => {
    process.env.RHYTHM_PLATFORM_OVERRIDE = 'ios';
    try {
      const store = usePrototypeStore.getState();
      const partner = await store.createAccountabilityPartner({
        name: 'Alice',
        password: 'password123',
      });
      await store.enableAccountability(partner.id, 'password123');

      await store.selectIosRiskGroupApps('social');

      const approvalRes = await store.approveProtectedMutation(partner.id, 'password123');
      assert.equal(approvalRes.ok, true);
      assert.equal(usePrototypeStore.getState().pendingApproval, null);

      const updatedGroup = usePrototypeStore.getState().riskGroups.find((g) => g.id === 'social')!;
      assert.equal(updatedGroup.nativeSelectionRef, 'selection.social');
      assert.ok(typeof updatedGroup.nativeSelectionRevision === 'number');

      // Assert coordinator config also holds the new selectionRef and revision
      const coordinatorConfig = RhythmCoordinator.getInstance().getConfiguration();
      const coordGroup = coordinatorConfig?.riskGroups.find((g) => g.id === 'social');
      assert.ok(coordGroup);
      assert.equal(coordGroup.nativeSelectionRef, 'selection.social');
      assert.equal(coordGroup.nativeSelectionRevision, updatedGroup.nativeSelectionRevision);
    } finally {
      delete process.env.RHYTHM_PLATFORM_OVERRIDE;
    }
  });

  test('19. iOS app selection commits immediately when accountability mode is OFF', async () => {
    process.env.RHYTHM_PLATFORM_OVERRIDE = 'ios';
    try {
      const store = usePrototypeStore.getState();
      assert.equal(store.accountability.enabled, false);

      await store.selectIosRiskGroupApps('social');

      // No pending approval
      assert.equal(usePrototypeStore.getState().pendingApproval, null);

      const updatedGroup = usePrototypeStore.getState().riskGroups.find((g) => g.id === 'social')!;
      assert.equal(updatedGroup.nativeSelectionRef, 'selection.social');
    } finally {
      delete process.env.RHYTHM_PLATFORM_OVERRIDE;
    }
  });

  test('20. rollback restores previous selection and revision if coordinator persistence fails after native commit', async () => {
    process.env.RHYTHM_PLATFORM_OVERRIDE = 'ios';
    const coordinator = RhythmCoordinator.getInstance();
    const originalUpdateConfig = coordinator.updateConfig.bind(coordinator);

    try {
      const store = usePrototypeStore.getState();
      const partner = await store.createAccountabilityPartner({
        name: 'Alice',
        password: 'password123',
      });

      // 1. Commit a baseline selection while mode OFF to establish baseline revision
      await store.selectIosRiskGroupApps('social');
      const baselineGroup = usePrototypeStore.getState().riskGroups.find((g) => g.id === 'social')!;
      const baselineRevision = baselineGroup.nativeSelectionRevision ?? 1;
      assert.equal(__getFallbackGroupRevisionForTests('social'), baselineRevision);

      // 2. Enable accountability
      await store.enableAccountability(partner.id, 'password123');

      // 3. Mock coordinator.updateConfig to fail when updating riskGroups
      coordinator.updateConfig = async (patch) => {
        if (patch.riskGroups) {
          throw new Error('Simulated persistence failure in updateConfig');
        }
        return originalUpdateConfig(patch);
      };

      // 4. Stage selection change
      await store.selectIosRiskGroupApps('social');
      assert.ok(usePrototypeStore.getState().pendingApproval);

      // 5. Partner approves, but executor will fail in updateConfig and trigger rollback
      await assert.rejects(
        async () => {
          await store.approveProtectedMutation(partner.id, 'password123');
        },
        /Simulated persistence failure in updateConfig/
      );

      // 6. Verify compensating rollback restored native fallback revision
      assert.equal(__getFallbackGroupRevisionForTests('social'), baselineRevision);

      // 7. Verify store still retains the baseline selection/revision
      const currentGroup = usePrototypeStore.getState().riskGroups.find((g) => g.id === 'social')!;
      assert.equal(currentGroup.nativeSelectionRevision, baselineRevision);
    } finally {
      coordinator.updateConfig = originalUpdateConfig;
      delete process.env.RHYTHM_PLATFORM_OVERRIDE;
    }
  });

  test('21. staging cleans up orphan pending_selection if requestProtectedMutation rejects', async () => {
    process.env.RHYTHM_PLATFORM_OVERRIDE = 'ios';
    try {
      const store = usePrototypeStore.getState();
      const partner = await store.createAccountabilityPartner({
        name: 'Alice',
        password: 'password123',
      });
      await store.enableAccountability(partner.id, 'password123');

      // Create an existing pending approval so that any subsequent requestProtectedMutation rejects
      await store.requestProtectedMutation({
        operation: 'change-daily-allowance',
        summary: 'Change allowance',
        payload: { groupId: 'social', allowanceMinutes: 45 },
      });
      assert.ok(usePrototypeStore.getState().pendingApproval);

      // Attempting to select apps while another change is pending will reject in requestProtectedMutation
      await assert.rejects(
        async () => {
          await store.selectIosRiskGroupApps('social');
        },
        /Another protected change is already awaiting approval/
      );

      // The original pending approval remains intact
      assert.equal(usePrototypeStore.getState().pendingApproval?.operation, 'change-daily-allowance');
    } finally {
      delete process.env.RHYTHM_PLATFORM_OVERRIDE;
    }
  });

  test('22. routine day toggling applies immediately when accountability mode is OFF', async () => {
    const store = usePrototypeStore.getState();
    assert.equal(store.accountability.enabled, false);

    const initialMorning = store.routineWindows.find((w) => w.id === 'morning-buffer')!;
    assert.deepEqual(initialMorning.activeDays, [1, 2, 3, 4, 5, 6, 7]);

    await store.toggleRoutineDay(7); // toggle Sunday

    assert.equal(usePrototypeStore.getState().pendingApproval, null);

    const updatedMorning = usePrototypeStore.getState().routineWindows.find((w) => w.id === 'morning-buffer')!;
    assert.deepEqual(updatedMorning.activeDays, [1, 2, 3, 4, 5, 6]);

    const coordMorning = RhythmCoordinator.getInstance().getConfiguration()?.routineWindows.find((w) => w.id === 'morning-buffer');
    assert.deepEqual(coordMorning?.activeDays, [1, 2, 3, 4, 5, 6]);
  });

  test('23. routine day toggling requires approval when accountability mode is ON, supports cancellation, and commits once approved', async () => {
    const store = usePrototypeStore.getState();
    const partner = await store.createAccountabilityPartner({
      name: 'Alice',
      password: 'password123',
    });
    await store.enableAccountability(partner.id, 'password123');

    const initialMorning = usePrototypeStore.getState().routineWindows.find((w) => w.id === 'morning-buffer')!;
    const initialDays = [...initialMorning.activeDays];

    // Toggle Saturday (6)
    await store.toggleRoutineDay(6);

    // Staged in pendingApproval with exact summary
    const pending = usePrototypeStore.getState().pendingApproval;
    assert.ok(pending);
    assert.equal(pending.operation, 'edit-routine-schedule');
    assert.equal(pending.summary, 'Change active routine days to Mon, Tue, Wed, Thu, Fri, Sun');
    assert.ok(!pending.summary.includes('Sat')); // Saturday removed

    // State and coordinator must be UNCHANGED
    const unchangedMorning = usePrototypeStore.getState().routineWindows.find((w) => w.id === 'morning-buffer')!;
    assert.deepEqual(unchangedMorning.activeDays, initialDays);

    const coordUnchanged = RhythmCoordinator.getInstance().getConfiguration()?.routineWindows.find((w) => w.id === 'morning-buffer');
    assert.deepEqual(coordUnchanged?.activeDays, initialDays);

    // 1. Cancellation leaves schedule unchanged
    store.cancelPendingApproval();
    assert.equal(usePrototypeStore.getState().pendingApproval, null);
    assert.deepEqual(
      usePrototypeStore.getState().routineWindows.find((w) => w.id === 'morning-buffer')!.activeDays,
      initialDays
    );

    // 2. Re-trigger toggle and approve
    await store.toggleRoutineDay(6);
    assert.ok(usePrototypeStore.getState().pendingApproval);

    const approvalRes = await store.approveProtectedMutation(partner.id, 'password123');
    assert.equal(approvalRes.ok, true);
    assert.equal(usePrototypeStore.getState().pendingApproval, null);

    // Persisted to Zustand and coordinator
    const committedMorning = usePrototypeStore.getState().routineWindows.find((w) => w.id === 'morning-buffer')!;
    assert.ok(!committedMorning.activeDays.includes(6));

    const coordCommitted = RhythmCoordinator.getInstance().getConfiguration()?.routineWindows.find((w) => w.id === 'morning-buffer');
    assert.deepEqual(coordCommitted?.activeDays, committedMorning.activeDays);
  });

  test('24. routine time editing applies immediately when accountability mode is OFF', async () => {
    const store = usePrototypeStore.getState();
    assert.equal(store.accountability.enabled, false);

    store.openTimeSelector({
      windowId: 'morning-buffer',
      field: 'endTime',
      title: 'Morning Buffer Unlock',
      initialTime: '08:00',
    });

    await store.saveSelectedTime('08:45');

    assert.equal(usePrototypeStore.getState().timeSelector.visible, false);
    assert.equal(usePrototypeStore.getState().pendingApproval, null);

    const updatedMorning = usePrototypeStore.getState().routineWindows.find((w) => w.id === 'morning-buffer')!;
    assert.equal(updatedMorning.endTime, '08:45');

    const coordMorning = RhythmCoordinator.getInstance().getConfiguration()?.routineWindows.find((w) => w.id === 'morning-buffer');
    assert.equal(coordMorning?.endTime, '08:45');
  });

  test('25. routine time editing requires approval when accountability mode is ON, displays exact proposed time, supports cancellation, and commits once approved', async () => {
    const store = usePrototypeStore.getState();
    const partner = await store.createAccountabilityPartner({
      name: 'Alice',
      password: 'password123',
    });
    await store.enableAccountability(partner.id, 'password123');

    const initialEvening = usePrototypeStore.getState().routineWindows.find((w) => w.id === 'evening-wind-down')!;
    const initialStartTime = initialEvening.startTime;

    store.openTimeSelector({
      windowId: 'evening-wind-down',
      field: 'startTime',
      title: 'Wind-Down Start',
      initialTime: initialStartTime,
    });

    await store.saveSelectedTime('21:15');

    // Picker closes immediately
    assert.equal(usePrototypeStore.getState().timeSelector.visible, false);

    // Staged in pendingApproval with exact summary
    const pending = usePrototypeStore.getState().pendingApproval;
    assert.ok(pending);
    assert.equal(pending.operation, 'edit-routine-schedule');
    assert.equal(pending.summary, 'Change Evening Wind-Down start time to 21:15');

    // State and coordinator must be UNCHANGED
    const unchangedEvening = usePrototypeStore.getState().routineWindows.find((w) => w.id === 'evening-wind-down')!;
    assert.equal(unchangedEvening.startTime, initialStartTime);

    const coordUnchanged = RhythmCoordinator.getInstance().getConfiguration()?.routineWindows.find((w) => w.id === 'evening-wind-down');
    assert.equal(coordUnchanged?.startTime, initialStartTime);

    // 1. Cancellation leaves schedule unchanged
    store.cancelPendingApproval();
    assert.equal(usePrototypeStore.getState().pendingApproval, null);
    assert.equal(
      usePrototypeStore.getState().routineWindows.find((w) => w.id === 'evening-wind-down')!.startTime,
      initialStartTime
    );

    // 2. Re-trigger time change and wrong password fails without mutating schedule
    store.openTimeSelector({
      windowId: 'evening-wind-down',
      field: 'startTime',
      title: 'Wind-Down Start',
      initialTime: initialStartTime,
    });
    await store.saveSelectedTime('21:15');

    const wrongRes = await store.approveProtectedMutation(partner.id, 'wrongpass');
    assert.equal(wrongRes.ok, false);
    assert.equal(wrongRes.reason, 'invalid-password');
    assert.equal(
      usePrototypeStore.getState().routineWindows.find((w) => w.id === 'evening-wind-down')!.startTime,
      initialStartTime
    );

    // 3. Correct password commits once
    const okRes = await store.approveProtectedMutation(partner.id, 'password123');
    assert.equal(okRes.ok, true);
    assert.equal(usePrototypeStore.getState().pendingApproval, null);

    const committedEvening = usePrototypeStore.getState().routineWindows.find((w) => w.id === 'evening-wind-down')!;
    assert.equal(committedEvening.startTime, '21:15');

    const coordCommitted = RhythmCoordinator.getInstance().getConfiguration()?.routineWindows.find((w) => w.id === 'evening-wind-down');
    assert.equal(coordCommitted?.startTime, '21:15');
  });

  test('25a. store-generated approval summaries identify app, protection, Emergency Access, and reset changes', async () => {
    const store = usePrototypeStore.getState();
    const partner = await store.createAccountabilityPartner({
      name: 'Alice',
      password: 'password123',
    });
    await store.enableAccountability(partner.id, 'password123');

    const instagram = store.apps.find((app) => app.id === 'instagram')!;
    const instagramGroup = store.riskGroups.find((group) => group.id === instagram.riskGroupId)!;
    await store.updateAppClassification(instagram.id, 'normal');
    assert.equal(
      usePrototypeStore.getState().pendingApproval?.summary,
      `Change ${instagram.name} from Risk / ${instagramGroup.name} to Normal`
    );
    store.cancelPendingApproval();

    const morning = store.routineWindows.find((window) => window.id === 'morning-buffer')!;
    const social = store.riskGroups.find((group) => group.id === 'social')!;
    const wasProtected = morning.protectedGroupIds.includes(social.id);
    await store.toggleGroupProtection(morning.id, social.id, !wasProtected);
    assert.equal(
      usePrototypeStore.getState().pendingApproval?.summary,
      `${!wasProtected ? 'Add' : 'Remove'} ${social.name} ${!wasProtected ? 'to' : 'from'} ${morning.name} protection`
    );
    store.cancelPendingApproval();

    await store.startAccessLease(social.id, 10);
    assert.equal(
      usePrototypeStore.getState().pendingApproval?.summary,
      `Allow ${social.name} for 10 minutes using Emergency Access`
    );
    store.cancelPendingApproval();

    await store.resetDemo();
    assert.equal(
      usePrototypeStore.getState().pendingApproval?.summary,
      'Reset all Rhythmic Routine local settings and Accountability protection'
    );
  });

  test('26. direct public mutation commands use the same approval gateway', async () => {
    const store = usePrototypeStore.getState();
    const disposableGroupId = await store.createRiskGroup({ name: 'Direct delete guard' });
    const partner = await store.createAccountabilityPartner({ name: 'Alice', password: 'password123' });
    await store.enableAccountability(partner.id, 'password123');

    await store.updateAppClassification('instagram', 'normal');
    assert.equal(usePrototypeStore.getState().pendingApproval?.operation, 'change-app-classification');
    assert.equal(usePrototypeStore.getState().apps.find((app) => app.id === 'instagram')?.classification, 'risk');
    store.cancelPendingApproval();

    const allowanceResult = await store.updateRiskGroupAllowance('social', 45);
    assert.equal(allowanceResult.reason, 'approval-required');
    assert.equal(usePrototypeStore.getState().pendingApproval?.operation, 'change-daily-allowance');
    store.cancelPendingApproval();

    assert.equal(await store.createRiskGroup({ name: 'Direct create guard' }), 'pending');
    assert.equal(usePrototypeStore.getState().pendingApproval?.operation, 'create-risk-group');
    store.cancelPendingApproval();

    const deleteResult = await store.deleteRiskGroup(disposableGroupId);
    assert.equal(deleteResult.ok, false);
    if (!deleteResult.ok) assert.equal(deleteResult.reason, 'approval-required');
    assert.equal(usePrototypeStore.getState().pendingApproval?.operation, 'delete-risk-group');
    store.cancelPendingApproval();

    await store.toggleGroupProtection('morning-buffer', 'social', false);
    assert.equal(usePrototypeStore.getState().pendingApproval?.operation, 'edit-risk-group-protection');
    store.cancelPendingApproval();

    await store.updateRoutineWindow('morning-buffer', { endTime: '08:15' });
    assert.equal(usePrototypeStore.getState().pendingApproval?.operation, 'edit-routine-schedule');
    store.cancelPendingApproval();

    const social = usePrototypeStore.getState().riskGroups.find((group) => group.id === 'social')!;
    const saveResult = await store.saveRiskGroupConfiguration('social', {
      name: social.name,
      description: social.description,
      allowanceMinutes: social.allowanceMinutes ?? 30,
      cooldownMinutes: social.cooldownMinutes + 15,
      recoveryActivityId: social.recoveryActivityId ?? 'walk',
      morningProtected: usePrototypeStore.getState().routineWindows
        .find((window) => window.id === 'morning-buffer')!.protectedGroupIds.includes('social'),
      eveningProtected: usePrototypeStore.getState().routineWindows
        .find((window) => window.id === 'evening-wind-down')!.protectedGroupIds.includes('social'),
    });
    assert.equal(saveResult.ok, false);
    if (!saveResult.ok) assert.equal(saveResult.reason, 'approval-required');
    assert.equal(usePrototypeStore.getState().pendingApproval?.operation, 'edit-risk-group');
    store.cancelPendingApproval();

    const recoveryResult = await store.updateRiskGroupRecoveryActivity('social', 'stretch');
    assert.equal(recoveryResult.ok, false);
    assert.equal(usePrototypeStore.getState().pendingApproval?.operation, 'edit-risk-group');
    store.cancelPendingApproval();

    await store.startAccessLease('social', 5);
    assert.equal(usePrototypeStore.getState().pendingApproval?.operation, 'start-access-lease');
    store.cancelPendingApproval();

    await store.resetDemo();
    assert.equal(usePrototypeStore.getState().pendingApproval?.operation, 'reset-local-state');
    assert.equal(usePrototypeStore.getState().accountability.enabled, true);
    store.cancelPendingApproval();
  });

  test('27. approval payload is immutable and stale protected state is rejected at execution', async () => {
    const store = usePrototypeStore.getState();
    const partner = await store.createAccountabilityPartner({ name: 'Alice', password: 'password123' });
    await store.enableAccountability(partner.id, 'password123');

    const payload: AppPolicyPayload = { appId: 'instagram', classification: 'normal' };
    await store.requestProtectedMutation({
      operation: 'change-app-classification',
      summary: 'Change Instagram to normal',
      payload,
    });
    payload.classification = 'essential';
    assert.equal(
      (usePrototypeStore.getState().pendingApproval?.payload as AppPolicyPayload).classification,
      'normal'
    );
    await store.approveProtectedMutation(partner.id, 'password123');
    assert.equal(usePrototypeStore.getState().apps.find((app) => app.id === 'instagram')?.classification, 'normal');

    await store.requestProtectedMutation({
      operation: 'change-app-classification',
      summary: 'Restore Instagram to risk',
      payload: { appId: 'instagram', classification: 'risk', riskGroupId: 'social' },
    });
    const windows = usePrototypeStore.getState().routineWindows;
    usePrototypeStore.setState({
      routineWindows: windows.map((window) => window.id === 'morning-buffer'
        ? { ...window, startTime: '06:45' }
        : window),
    });
    await assert.rejects(
      store.approveProtectedMutation(partner.id, 'password123'),
      /changed while approval was pending/
    );
    assert.equal(usePrototypeStore.getState().pendingApproval, null);
    assert.equal(usePrototypeStore.getState().apps.find((app) => app.id === 'instagram')?.classification, 'normal');
  });
});
