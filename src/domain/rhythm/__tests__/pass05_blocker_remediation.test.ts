import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  PlatformNativeRhythmSyncProvider,
  requireNativeSave,
  sanitizeForNative,
} from '../../../platform/NativeRhythmSyncProvider';
import { NativePermissionProvider } from '../../../platform/native/NativePermissionProvider';
import RhythmDeviceModule from '../../../../modules/rhythm-device';
import { RhythmCoordinator } from '../../../application/RhythmCoordinator';
import { configurePlatformServices } from '../../../platform/PlatformServices';
import { MockStorageProvider } from '../../../platform/storage/MockStorageProvider';
import { MockPermissionProvider } from '../../../platform/permissions/MockPermissionProvider';
import { MockRestrictionProvider } from '../../../platform/mock/MockRestrictionProvider';
import { MockUsageProvider } from '../../../platform/mock/MockUsageProvider';
import { processRhythmEvent } from '../events';
import { resolveAttentionDay } from '../attentionDay';
import { createDailyAttentionExchangeState } from '../attentionExchange';
import { getLocalDateKey } from '../allowance';
import type {
  ActiveRestorativeGate,
} from '../restorativeGate';
import type { RhythmConfiguration, RhythmEvent, RhythmRuntime } from '../types';

/**
 * Pass 5 — Native Enforcement Blocker Remediation regressions.
 *
 * Covers the remediation contract:
 *  - fallback shims never fake native policy writes (on a real device)
 *  - payloads cross the Expo bridge without undefined-valued keys
 *  - every native write is verified and stage-failure evidence is recorded
 *  - capability truth requires BOTH the native module and Accessibility
 *  - Risk classification projects to native policy without an app restart
 *  - a native projection mismatch is detected and re-projected (self-healing)
 *  - production-equivalent cooldown imports allocate ordinals 1/2/3 and the
 *    ordinal-3 baseline gate (3600 s / 36 pages)
 */
describe('Pass 5 — Native Enforcement Blocker Remediation', () => {
  const originalMethods: Record<string, unknown> = {};
  const touched: string[] = [];

  function stub(method: string, value: unknown): void {
    if (!(method in originalMethods)) {
      originalMethods[method] = (RhythmDeviceModule as any)[method];
      touched.push(method);
    }
    (RhythmDeviceModule as any)[method] = value;
  }

  function stubHealthyNativeModule(): void {
    stub('getNativeModuleDiagnostics', async () => ({ available: true, source: 'native' }));
    stub('setAttentionExchangePolicy', async () => true);
    stub('setAttentionExchangeState', async () => true);
    stub('setBaseRestrictions', async () => true);
    stub('setRiskGroupPolicies', async () => true);
    stub('setCooldownPolicies', async () => true);
    stub('setRoutineSchedule', async () => true);
    stub('getEnforcementDiagnostics', async () => ({
      serviceRunning: true,
      baseRestrictedPackageCount: 0,
      activeLeaseCount: 0,
      overlayVisible: false,
      nativeModuleAvailable: true,
      riskPolicyCount: 1,
      riskPackageCount: 1,
      routineRiskPackageCount: 1,
      riskPackageSample: ['com.block.juggle'],
    }));
  }

  afterEach(() => {
    for (const method of touched) {
      (RhythmDeviceModule as any)[method] = originalMethods[method];
    }
    touched.length = 0;
    delete process.env.RHYTHM_PLATFORM_OVERRIDE;
    RhythmCoordinator.getInstance().destroy();
  });

  // ---------------------------------------------------------------------
  // 1. Bridge payload sanitation + write verification
  // ---------------------------------------------------------------------
  describe('1. Bridge payloads and write verification', () => {
    it('sanitizeForNative drops undefined-valued keys the bridge map conversion rejects', () => {
      const payload = {
        groupId: 'social',
        packageNames: ['com.block.juggle'],
        attentionDateKey: undefined,
        nested: { a: 1, b: undefined, list: [{ x: 1, y: undefined }] },
      };
      const clean = sanitizeForNative(payload) as any;
      assert.equal('attentionDateKey' in clean, false);
      assert.deepEqual(clean.packageNames, ['com.block.juggle']);
      assert.equal('b' in clean.nested, false);
      assert.equal('y' in clean.nested.list[0], false);
      assert.equal(clean.nested.a, 1);
    });

    it('requireNativeSave refuses anything but an explicit native confirmation', () => {
      assert.doesNotThrow(() => requireNativeSave('risk-policies', 'setRiskGroupPolicies', true));
      assert.throws(() => requireNativeSave('risk-policies', 'setRiskGroupPolicies', false), /setRiskGroupPolicies returned false/);
      assert.throws(() => requireNativeSave('risk-policies', 'setRiskGroupPolicies', undefined), /native save not confirmed/);
    });

    it('a failed native write is recorded as evidence with its failing stage', async () => {
      process.env.RHYTHM_PLATFORM_OVERRIDE = 'android';
      stubHealthyNativeModule();
      stub('setRiskGroupPolicies', async () => false);

      const provider = new PlatformNativeRhythmSyncProvider();
      const runtime: RhythmRuntime = {
        state: 'available',
        activeRoutineWindowIds: [],
        activeCooldowns: {},
        activeAccessLeases: {},
        activeRestrictions: [],
      };
      const config = buildConfig({ classification: 'risk' });

      await provider.sync(runtime, config);
      const diagnostics = provider.getLastSyncDiagnostics();
      assert.equal(diagnostics.success, false, 'Unconfirmed native write must not be reported as success');
      assert.equal(diagnostics.failedStage, 'risk-policies');
      assert.match(String(diagnostics.error), /setRiskGroupPolicies/);
      assert.ok(diagnostics.updatedAt > 0);
    });
  });

  // ---------------------------------------------------------------------
  // 2. Capability truth (native module AND Accessibility)
  // ---------------------------------------------------------------------
  describe('2. Capability truth requires module availability AND Accessibility', () => {
    it('module available + Accessibility recognised → enforced', async () => {
      process.env.RHYTHM_PLATFORM_OVERRIDE = 'android';
      stub('getNativeModuleDiagnostics', async () => ({ available: true, source: 'native' }));
      stub('checkPermissions', async () => ({
        hasUsagePermission: true,
        hasRestrictionPermission: true,
        familyControlsStatus: 'unsupported',
      }));

      const state = await new NativePermissionProvider().getStatus();
      assert.equal(state.usageAccess, 'granted');
      assert.equal(state.restrictionAuthorization, 'granted');
      assert.equal(state.restrictionCapability, 'enforced');
    });

    it('Accessibility enabled + native module unavailable → foundation-only', async () => {
      process.env.RHYTHM_PLATFORM_OVERRIDE = 'android';
      stub('getNativeModuleDiagnostics', async () => ({
        available: false,
        source: 'fallback',
        loadError: 'RhythmDevice native module returned null',
      }));
      stub('checkPermissions', async () => ({
        hasUsagePermission: true,
        hasRestrictionPermission: true,
        familyControlsStatus: 'unsupported',
      }));

      const state = await new NativePermissionProvider().getStatus();
      assert.equal(state.restrictionAuthorization, 'granted');
      assert.equal(
        state.restrictionCapability,
        'foundation-only',
        'An unavailable bridge must never be presented as enforcement capable'
      );
    });

    it('module available + Accessibility not recognised → foundation-only', async () => {
      process.env.RHYTHM_PLATFORM_OVERRIDE = 'android';
      stub('getNativeModuleDiagnostics', async () => ({ available: true, source: 'native' }));
      stub('checkPermissions', async () => ({
        hasUsagePermission: true,
        hasRestrictionPermission: false,
        familyControlsStatus: 'unsupported',
      }));

      const state = await new NativePermissionProvider().getStatus();
      assert.equal(state.restrictionAuthorization, 'denied');
      assert.equal(state.restrictionCapability, 'foundation-only');
    });
  });

  // ---------------------------------------------------------------------
  // 3. Projection: classification → native policy (no app restart)
  // ---------------------------------------------------------------------
  describe('3. Risk classification projects to native policy', () => {
    it('classification mutation flows to setRiskGroupPolicies without an app restart', async () => {
      process.env.RHYTHM_PLATFORM_OVERRIDE = 'android';
      stubHealthyNativeModule();
      const policiesReceived: any[] = [];
      stub('setRiskGroupPolicies', async (policies: any[]) => {
        policiesReceived.push(policies);
        return true;
      });

      const storage = new MockStorageProvider();
      const permissions = new MockPermissionProvider();
      const restrictions = new MockRestrictionProvider();
      const usage = new MockUsageProvider();
      const nativeRhythm = new PlatformNativeRhythmSyncProvider();
      configurePlatformServices({ storage, permissions, restrictions, usage, nativeRhythm });

      const coordinator = RhythmCoordinator.getInstance();
      coordinator.destroy();
      await coordinator.initialize();

      const baseGroups = coordinator.getConfiguration()?.riskGroups ?? [];
      const social = baseGroups.find((g) => g.id === 'social') ?? baseGroups[0];

      // Initial: com.block.juggle is NOT risk → outgoing policy must be empty.
      await coordinator.updateConfig({
        apps: [buildApp('com.block.juggle', 'normal')],
        riskGroups: [{ ...social, appIds: [] }],
      });

      // Mutation: com.block.juggle → risk / Social Feeds (exactly what
      // updateAppClassification commits through updateConfig).
      await coordinator.updateConfig({
        apps: [buildApp('com.block.juggle', 'risk', 'social')],
        riskGroups: [{ ...social, appIds: ['com.block.juggle'] }],
      });

      const outgoing = policiesReceived[policiesReceived.length - 1] ?? [];
      const socialPolicy = outgoing.find((p: any) => p.groupId === social.id);
      assert.ok(socialPolicy, 'Expected the mutated group policy to be projected');
      assert.deepEqual(socialPolicy.packageNames, ['com.block.juggle']);
      assert.ok(
        !policiesReceived[0]?.some((p: any) => p.packageNames?.includes('com.block.juggle')),
        'Pre-mutation sync must not project the package'
      );
    });

    it('projection mismatch is detected and re-projects (self-healing)', async () => {
      process.env.RHYTHM_PLATFORM_OVERRIDE = 'android';
      stubHealthyNativeModule();
      // Native has LOST its risk packages while JS still holds one.
      stub('getEnforcementDiagnostics', async () => ({
        serviceRunning: true,
        baseRestrictedPackageCount: 0,
        activeLeaseCount: 0,
        overlayVisible: false,
        nativeModuleAvailable: true,
        riskPolicyCount: 1,
        riskPackageCount: 0,
        routineRiskPackageCount: 0,
        riskPackageSample: [],
      }));
      let policyWrites = 0;
      stub('setRiskGroupPolicies', async () => {
        policyWrites += 1;
        return true;
      });

      const provider = new PlatformNativeRhythmSyncProvider();
      const runtime: RhythmRuntime = {
        state: 'available',
        activeRoutineWindowIds: [],
        activeCooldowns: {},
        activeAccessLeases: {},
        activeRestrictions: [],
      };
      const config = buildConfig({ classification: 'risk' });

      await provider.sync(runtime, config);
      assert.equal(policyWrites, 1, 'First sync projects the policy');

      // Identical payload + stale signature cache + mismatched native count →
      // the projection must be re-sent, not skipped.
      (provider as any).lastProjectionCheckAt = 0;
      await provider.sync(runtime, config);
      assert.equal(policyWrites, 2, 'A native projection mismatch must force re-projection');

      // Healthy native state + unchanged payload → no constant re-writes.
      stub('getEnforcementDiagnostics', async () => ({
        serviceRunning: true,
        baseRestrictedPackageCount: 0,
        activeLeaseCount: 0,
        overlayVisible: false,
        nativeModuleAvailable: true,
        riskPolicyCount: 1,
        riskPackageCount: 1,
        routineRiskPackageCount: 1,
        riskPackageSample: ['com.block.juggle'],
      }));
      (provider as any).lastProjectionCheckAt = 0;
      await provider.sync(runtime, config);
      assert.equal(policyWrites, 2, 'Healthy matching projection must not be re-written');
    });
  });

  // ---------------------------------------------------------------------
  // 4. Production-equivalent cooldown path: ordinals + CD3 gate
  // ---------------------------------------------------------------------
  describe('4. Production-equivalent cooldown imports allocate real ordinals and gates', () => {
    it('exhaustions 1→2→3 allocate ordinals 1, 2 and a 3600/36 baseline gate at ordinal 3', () => {
      const now = new Date(2026, 8, 29, 10, 0, 0).getTime();
      const today = getLocalDateKey(now);
      const config = buildConfig({ classification: 'risk' });
      const attentionDayId = resolveAttentionDay(now, config.routineWindows).id;

      let runtime: RhythmRuntime = {
        state: 'available',
        activeRoutineWindowIds: [],
        activeCooldowns: {},
        activeAccessLeases: {},
        activeRestrictions: [],
      };

      // The three production allocations arrive exactly as the native
      // production path (allowance exhaustion -> allocateCooldown) persists
      // them: ordinal, attention date key, and requirement numbers included.
      const allocations = [
        { groupId: 'qa-1', ordinal: 1, seconds: 0, pages: 0 },
        { groupId: 'qa-2', ordinal: 2, seconds: 0, pages: 0 },
        { groupId: 'qa-3', ordinal: 3, seconds: 3600, pages: 36 },
      ];

      for (const allocation of allocations) {
        runtime = processRhythmEvent(
          runtime,
          buildNativeAttentionImport(now, today, allocation),
          config
        ).nextRuntime;

        assert.equal(
          runtime.dailyAttentionExchange?.cooldownsTriggered,
          allocation.ordinal,
          `Trigger ${allocation.ordinal} must allocate daily ordinal ${allocation.ordinal}`
        );
        const cooldown = runtime.activeCooldowns?.[allocation.groupId];
        assert.equal(cooldown?.dailyCooldownOrdinal, allocation.ordinal);

        const gate = runtime.activeRestorativeGates?.[allocation.groupId] as
          | ActiveRestorativeGate
          | undefined;
        if (allocation.ordinal <= 2) {
          assert.equal(gate, undefined, `Ordinal ${allocation.ordinal} carries no restorative gate`);
        } else {
          assert.ok(gate, 'Ordinal 3 must derive the CD3 restorative gate');
          assert.equal(gate.requirementKind, 'baseline-reading');
          assert.equal(gate.requiredReadingSeconds, 3600);
          assert.equal(gate.requiredQualifiedPages, 36);
          assert.equal(
            gate.gateId,
            `gate-${attentionDayId}-${allocation.groupId}-o${allocation.ordinal}`,
            'Gate identity must be deterministic across imports'
          );
        }
      }

      // Idempotent re-import: identities and progress survive.
      const before = runtime.activeRestorativeGates?.['qa-3'] as ActiveRestorativeGate;
      runtime = processRhythmEvent(
        runtime,
        buildNativeAttentionImport(now, today, allocations[2]),
        config
      ).nextRuntime;
      const after = runtime.activeRestorativeGates?.['qa-3'] as ActiveRestorativeGate;
      assert.equal(after.gateId, before.gateId, 'Re-import must not regenerate gate identity');
      assert.equal(runtime.dailyAttentionExchange?.cooldownsTriggered, 3, 'Re-import must not allocate twice');
    });
  });
});

// ------------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------------

function buildApp(
  id: string,
  classification: 'risk' | 'normal',
  riskGroupId?: string
): RhythmConfiguration['apps'][number] {
  return {
    id,
    name: id,
    classification,
    riskGroupId: classification === 'risk' ? riskGroupId : undefined,
    iconName: 'smartphone',
    iconColor: '#235D43',
    iconBg: '#E8EFE5',
    defaultCategory: 'App',
    usageTodayMinutes: 0,
    sessionMinutes: 0,
  };
}

function buildConfig(options: { classification: 'risk' | 'normal' }): RhythmConfiguration {
  const social = {
    id: 'social',
    name: 'Social Feeds',
    description: 'Social networking',
    iconName: 'message-square',
    iconColor: '#235D43',
    iconBg: '#E8EFE5',
    appIds: options.classification === 'risk' ? ['com.block.juggle'] : [],
    allowanceMinutes: 30,
    cooldownMinutes: 90,
    currentSessionMinutes: 0,
  };
  return {
    routineWindows: [],
    riskGroups: [social],
    apps: [
      buildApp(
        'com.block.juggle',
        options.classification,
        options.classification === 'risk' ? 'social' : undefined
      ),
    ],
    sessionResetGapMs: 300000,
  };
}

/**
 * One native-attention import exactly as the production exhaustion path
 * persists it (NativeAttentionExchangeLogic.allocateCooldown output).
 */
function buildNativeAttentionImport(
  now: number,
  today: string,
  allocation: { groupId: string; ordinal: number; seconds: number; pages: number }
): RhythmEvent {
  const endsAt = now + 90 * 60 * 1000;
  return {
    type: 'SYNC_NATIVE_ATTENTION_EXCHANGE',
    dailyAttentionExchange: {
      ...createDailyAttentionExchangeState(today, now),
      cooldownsTriggered: allocation.ordinal,
      highestRequiredActiveSeconds: allocation.seconds,
      highestRequiredQualifiedPages: allocation.pages,
    },
    activeReadingGates:
      allocation.seconds > 0 || allocation.pages > 0
        ? {
            [allocation.groupId]: {
              groupId: allocation.groupId,
              attentionDateKey: today,
              dailyCooldownOrdinal: allocation.ordinal,
              createdAt: now,
              cooldownEndsAt: endsAt,
              requiredReadingSeconds: allocation.seconds,
              requiredQualifiedPages: allocation.pages,
            },
          }
        : {},
    activeCooldowns: {
      [allocation.groupId]: {
        groupId: allocation.groupId,
        startedAt: now,
        endsAt,
        dailyCooldownOrdinal: allocation.ordinal,
        attentionDateKey: today,
        requiredReadingSeconds: allocation.seconds,
        requiredQualifiedPages: allocation.pages,
      },
    },
    activeAccessLeases: {},
    groupAllowanceUsage: {},
    timestamp: now,
  };
}
