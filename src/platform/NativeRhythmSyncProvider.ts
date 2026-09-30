import { RhythmConfiguration, RhythmRuntime } from '../domain/rhythm/types';
import RhythmDeviceModule from '../../modules/rhythm-device';
import { NativeAttentionExchangeSnapshot } from '../../modules/rhythm-device/src/RhythmDevice.types';
import { offlineActivities } from '../data/mockData';
import { DEFAULT_READING_ATTENTION_POLICY } from '../domain/rhythm/attentionExchange';
import { OFFICIAL_COMPANION_PACKAGES } from '../domain/rhythm/restrictions';
import { getLocalDateKey } from '../domain/rhythm/allowance';
import {
  requirementKindForCooldownOrdinal,
  RESTORATIVE_POLICY,
} from '../domain/rhythm/restorativeGate';

/**
 * Kind + requirement numbers for one projected cooldown (Pass 5A model):
 * CD3 carries the baseline; CD4+ carries the discrete restorative choice
 * (Reader 1800/11 OR Meditation 1800) — never cumulative numbers.
 */
function cooldownRequirementProjection(cooldown: {
  dailyCooldownOrdinal?: number;
  requirementKind?: string;
  restorativeReadingSeconds?: number;
  restorativeReadingPages?: number;
  requiredMeditationSeconds?: number;
}) {
  const kind =
    cooldown.requirementKind ??
    (cooldown.dailyCooldownOrdinal
      ? requirementKindForCooldownOrdinal(cooldown.dailyCooldownOrdinal)
      : 'none');
  const restorative = kind === 'restorative-choice';
  return {
    requirementKind: kind,
    restorativeReadingSeconds:
      cooldown.restorativeReadingSeconds ??
      (restorative ? RESTORATIVE_POLICY.restorativeChoiceReadingSeconds : 0),
    restorativeReadingPages:
      cooldown.restorativeReadingPages ??
      (restorative ? RESTORATIVE_POLICY.restorativeChoiceQualifiedPages : 0),
    requiredMeditationSeconds:
      cooldown.requiredMeditationSeconds ??
      (restorative ? RESTORATIVE_POLICY.restorativeChoiceMeditationSeconds : 0),
  };
}

/** Ordered native-projection stages; the first failure aborts and is recorded. */
export type NativeSyncStage =
  | 'module'
  | 'attention-policy'
  | 'attention-state'
  | 'base-restrictions'
  | 'risk-policies'
  | 'cooldowns'
  | 'routine-schedule';

/** Evidence of one native-projection attempt. Never silent. */
export interface NativeSyncDiagnostics {
  success: boolean;
  failedStage?: NativeSyncStage;
  error?: string;
  updatedAt: number;
}

/**
 * Deep-removes keys whose value is `undefined` or `null`. The Expo bridge's
 * Kotlin map conversion rejects nullable values inside nested maps, and a
 * rejected conversion aborts the entire projection chain before later policy
 * stages can run. Native optional fields use omission as their absent value.
 */
export function sanitizeForNative<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForNative(item)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item === undefined || item === null) continue;
      out[key] = sanitizeForNative(item);
    }
    return out as unknown as T;
  }
  return value;
}

/** A native write is only real when the native side confirmed persistence. */
export function requireNativeSave(
  stage: NativeSyncStage,
  method: string,
  saved: unknown
): void {
  if (saved !== true) {
    throw new Error(`${method} returned ${String(saved)} (native save not confirmed)`);
  }
}

export interface IOSNativeGroupPolicy {
  groupId: string;
  selectionRef?: string;
  /** Legacy iOS projection field; Android uses allowanceMinutes only. */
  sessionThresholdMinutes?: number;
  /** v1.0.2: shared group allowance (sole policy owner). */
  allowanceMinutes?: number;
  cooldownMinutes: number;
  recoveryActivityId?: string;
}

/** Native group policy carries all background-safe enforcement context. */
export interface NativeRecoveryActivity {
  id: string;
  title: string;
  subtitle: string;
  iconEmoji: string;
  durationSuggestion?: string;
}

export interface NativeRiskGroupPolicy {
  groupId: string;
  groupName: string;
  packageNames: string[];
  allowanceMinutes: number;
  cooldownMinutes: number;
  recoveryActivity: NativeRecoveryActivity;
}

export interface IOSNativeRoutinePolicy {
  windowId: string;
  startTime: string;
  endTime?: string;
  activeDays: number[];
  protectedGroupIds: string[];
  enabled: boolean;
}

export interface IOSSharedRhythmSnapshot {
  schemaVersion: 1;
  groups: IOSNativeGroupPolicy[];
  routines: IOSNativeRoutinePolicy[];
  activeCooldownEndsAt: Record<string, number>;
  activeAccessLeaseEndsAt: Record<string, number>;
  activeRoutineReasons: Record<string, string[]>;
  updatedAt: number;
}

export interface NativeRhythmSyncProvider {
  sync(runtime: RhythmRuntime, config: RhythmConfiguration): Promise<void>;
  getSnapshot?(): Promise<IOSSharedRhythmSnapshot | null>;
  getAndroidSnapshot?(): Promise<NativeAttentionExchangeSnapshot | null>;
  /** Evidence of the last native projection attempt (never silent). */
  getLastSyncDiagnostics?(): NativeSyncDiagnostics;
  /** Forces the next sync to re-project every native policy payload. */
  forceReproject?(): void;
}

export class NoopNativeRhythmSyncProvider implements NativeRhythmSyncProvider {
  private lastSyncDiagnostics: NativeSyncDiagnostics = { success: true, updatedAt: 0 };

  async sync(_runtime: RhythmRuntime, _config: RhythmConfiguration): Promise<void> {
    // No-op for web/mock environments
    this.lastSyncDiagnostics = { success: true, updatedAt: Date.now() };
  }

  async getSnapshot(): Promise<IOSSharedRhythmSnapshot | null> {
    return null;
  }

  async getAndroidSnapshot(): Promise<NativeAttentionExchangeSnapshot | null> {
    return null;
  }

  getLastSyncDiagnostics(): NativeSyncDiagnostics {
    return { ...this.lastSyncDiagnostics };
  }

  forceReproject(): void {
    // Nothing to re-project in a no-op environment.
  }
}

function getPlatformOS(): string {
  if (process.env.RHYTHM_PLATFORM_OVERRIDE) {
    return process.env.RHYTHM_PLATFORM_OVERRIDE;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Platform } = require('react-native');
    return Platform?.OS || 'web';
  } catch {
    return 'web';
  }
}

export function computeMonitoringConfigSignature(config: RhythmConfiguration): string {
  const payload = {
    riskGroups: config.riskGroups.map((group) => ({
      id: group.id,
      nativeSelectionRef: group.nativeSelectionRef,
      nativeSelectionRevision: group.nativeSelectionRevision,
      sessionThresholdMinutes: group.sessionThresholdMinutes,
      allowanceMinutes: group.allowanceMinutes,
      cooldownMinutes: group.cooldownMinutes,
      recoveryActivityId: group.recoveryActivityId,
    })),
    routines: config.routineWindows.map((routine) => ({
      id: routine.id,
      startTime: routine.startTime,
      endTime: routine.endTime,
      activeDays: [...routine.activeDays].sort(),
      protectedGroupIds: [...routine.protectedGroupIds].sort(),
      enabled: routine.enabled,
    })),
  };
  return JSON.stringify(payload);
}

export class PlatformNativeRhythmSyncProvider implements NativeRhythmSyncProvider {
  private lastSnapshot?: IOSSharedRhythmSnapshot;
  private lastConfigSignature?: string;
  private lastAndroidBaseRestrictionsSignature?: string;
  private lastAndroidRiskPoliciesSignature?: string;
  private lastAndroidRoutineScheduleSignature?: string;
  private lastAndroidCooldownsSignature?: string;
  private lastAndroidAttentionPolicySignature?: string;
  private lastAndroidAttentionStateSignature?: string;
  private syncStage: NativeSyncStage | undefined;
  private lastSyncDiagnostics: NativeSyncDiagnostics = { success: true, updatedAt: 0 };
  private lastProjectionCheckAt = 0;

  private static readonly PROJECTION_CHECK_INTERVAL_MS = 30_000;

  /** Evidence of the last native projection attempt (never silent). */
  getLastSyncDiagnostics(): NativeSyncDiagnostics {
    return { ...this.lastSyncDiagnostics };
  }

  /** Forces the next sync to re-project every native policy payload. */
  forceReproject(): void {
    this.lastAndroidBaseRestrictionsSignature = undefined;
    this.lastAndroidRiskPoliciesSignature = undefined;
    this.lastAndroidRoutineScheduleSignature = undefined;
    this.lastAndroidCooldownsSignature = undefined;
    this.lastAndroidAttentionPolicySignature = undefined;
    this.lastAndroidAttentionStateSignature = undefined;
    this.lastProjectionCheckAt = 0;
  }

  /**
   * Projection-consistency invariant (self-healing): when JS holds Risk packages
   * but native reports none, the native policy is out of sync — re-project the
   * full payload instead of trusting a stale signature cache. Bounded by a
   * cheap read at most once per PROJECTION_CHECK_INTERVAL_MS.
   */
  private async reprojectOnNativePolicyMismatch(
    riskPolicies: NativeRiskGroupPolicy[]
  ): Promise<void> {
    const expected = new Set(riskPolicies.flatMap((policy) => policy.packageNames)).size;
    if (expected === 0) return;
    const now = Date.now();
    if (now - this.lastProjectionCheckAt < PlatformNativeRhythmSyncProvider.PROJECTION_CHECK_INTERVAL_MS) return;
    this.lastProjectionCheckAt = now;
    try {
      const diagnostics = await RhythmDeviceModule.getEnforcementDiagnostics();
      // Only a real native module reports meaningful counts; a fallback shim has
      // nothing to heal.
      if (diagnostics?.nativeModuleAvailable !== true) return;
      const nativeCount = diagnostics.riskPackageCount;
      if (typeof nativeCount === 'number' && nativeCount !== expected) {
        this.forceReproject();
      }
    } catch {
      // Advisory only; the write that follows still verifies its own result.
    }
  }

  async sync(runtime: RhythmRuntime, config: RhythmConfiguration): Promise<void> {
    this.syncStage = undefined;
    try {
      const os = getPlatformOS();
      if (os === 'ios') {
        this.syncStage = 'module';
        const groups: IOSNativeGroupPolicy[] = config.riskGroups.map((g) => ({
          groupId: g.id,
          selectionRef: g.nativeSelectionRef,
           allowanceMinutes: g.allowanceMinutes ?? 30,
          cooldownMinutes: g.cooldownMinutes,
          recoveryActivityId: g.recoveryActivityId,
        }));

        const routines: IOSNativeRoutinePolicy[] = config.routineWindows.map((w) => ({
          windowId: w.id,
          startTime: w.startTime,
          endTime: w.endTime,
          activeDays: [...w.activeDays],
          protectedGroupIds: [...w.protectedGroupIds],
          enabled: w.enabled,
        }));

        const activeCooldownEndsAt: Record<string, number> = {};
        for (const [gid, cd] of Object.entries(runtime.activeCooldowns || {})) {
          if (cd.endsAt > Date.now()) {
            activeCooldownEndsAt[gid] = cd.endsAt;
          }
        }

        const activeAccessLeaseEndsAt: Record<string, number> = {};
        for (const [gid, lease] of Object.entries(runtime.activeAccessLeases || {})) {
          if (lease.endsAt > Date.now()) {
            activeAccessLeaseEndsAt[gid] = lease.endsAt;
          }
        }

        const activeRoutineReasons: Record<string, string[]> = {};
        for (const winId of runtime.activeRoutineWindowIds || []) {
          const win = config.routineWindows.find((w) => w.id === winId);
          if (win) {
            for (const gid of win.protectedGroupIds) {
              if (!activeRoutineReasons[gid]) {
                activeRoutineReasons[gid] = [];
              }
              activeRoutineReasons[gid].push(winId);
            }
          }
        }

        const snapshot: IOSSharedRhythmSnapshot = {
          schemaVersion: 1,
          groups,
          routines,
          activeCooldownEndsAt,
          activeAccessLeaseEndsAt,
          activeRoutineReasons,
          updatedAt: Date.now(),
        };

        this.lastSnapshot = snapshot;
        const snapshotJson = JSON.stringify(snapshot);

        // 1. Safe runtime state sync: updates App Group and nearest expiry without rebuilding persistent monitors
        await RhythmDeviceModule.setSharedRhythmState(snapshotJson);

        // 2. Reconfigure persistent DeviceActivity monitors ONLY when configuration signature changes
        const signature = computeMonitoringConfigSignature(config);
        if (this.lastConfigSignature !== signature) {
          if (RhythmDeviceModule.synchronizeMonitoringConfiguration) {
            const result = await RhythmDeviceModule.synchronizeMonitoringConfiguration(
              snapshotJson,
              signature
            );
            if (result && result.success) {
              this.lastConfigSignature = signature;
            }
          }
        }
      } else if (os === 'android') {
        // The bridge must be the REAL native module: on a device, fallback writes
        // fail — they must never silently simulate success.
        this.syncStage = 'module';
        const moduleDiagnostics = await RhythmDeviceModule.getNativeModuleDiagnostics();
        if (!moduleDiagnostics.available) {
          throw new Error(
            `RhythmDevice native module unavailable (${moduleDiagnostics.source}${moduleDiagnostics.loadError ? `: ${moduleDiagnostics.loadError}` : ''})`
          );
        }

        // Seed native defaults and an empty native store before any group-policy
        // update can cause the AccessibilityService to evaluate an exhausted ledger.
        this.syncStage = 'attention-policy';
        const attentionPolicy = sanitizeForNative({ ...DEFAULT_READING_ATTENTION_POLICY });
        const attentionPolicySignature = JSON.stringify(attentionPolicy);
        if (
          RhythmDeviceModule.setAttentionExchangePolicy &&
          this.lastAndroidAttentionPolicySignature !== attentionPolicySignature
        ) {
          const saved = await RhythmDeviceModule.setAttentionExchangePolicy(attentionPolicy);
          requireNativeSave('attention-policy', 'setAttentionExchangePolicy', saved);
          this.lastAndroidAttentionPolicySignature = attentionPolicySignature;
        }

        this.syncStage = 'attention-state';
        if (RhythmDeviceModule.setAttentionExchangeState) {
          const activeCooldowns = Object.entries(runtime.activeCooldowns || {})
            .filter(([, cooldown]) => cooldown.endsAt > Date.now())
            .map(([groupId, cooldown]) => {
              const group = config.riskGroups.find((item) => item.id === groupId);
              return {
                groupId,
                packageNames: (group?.appIds || [])
                  .filter((id) => config.apps.some((app) => app.id === id && app.classification === 'risk'))
                  .sort(),
                startedAt: cooldown.startedAt,
                endsAt: cooldown.endsAt,
                attentionDateKey: cooldown.attentionDateKey,
                dailyCooldownOrdinal: cooldown.dailyCooldownOrdinal,
                requiredReadingSeconds: cooldown.requiredReadingSeconds,
                requiredQualifiedPages: cooldown.requiredQualifiedPages,
                ...cooldownRequirementProjection(cooldown),
              };
            });
          const attentionState = sanitizeForNative({
            dailyAttentionExchange: runtime.dailyAttentionExchange ?? {
              dateKey: getLocalDateKey(),
              cooldownsTriggered: 0,
              highestRequiredActiveSeconds: 0,
              highestRequiredQualifiedPages: 0,
              updatedAt: Date.now(),
            },
            activeReadingGates: Object.values(runtime.activeReadingGates || {}),
            activeCooldowns,
            // Pass 3 — additive native enforcement data (v1.2 native code
            // ignores unknown keys):
            //   Attention Day, Restorative Gate presence/status, the Morning
            //   Meditation requirement, and the official companion allowlist.
            // Only policy data is shared — never private meditation history.
            attentionDay: runtime.dailyAttentionExchange?.attentionDayId
              ? {
                  id: runtime.dailyAttentionExchange.attentionDayId,
                  startedAt: 0,
                  nextBoundaryAt: 0,
                }
              : null,
            activeRestorativeGates: Object.values(runtime.activeRestorativeGates || {}).map(
              (gate) => ({
                gateId: gate.gateId,
                groupId: gate.groupId,
                attentionDayId: gate.attentionDayId,
                dailyCooldownOrdinal: gate.dailyCooldownOrdinal,
                createdAt: gate.createdAt,
                cooldownEndsAt: gate.cooldownEndsAt,
                requirementKind: gate.requirementKind,
                selectedProvider: gate.selectedProvider ?? null,
                providerSessionId: gate.providerSessionId ?? null,
                status: gate.status,
                requiredReadingSeconds: gate.requiredReadingSeconds ?? null,
                requiredQualifiedPages: gate.requiredQualifiedPages ?? null,
                requiredMeditationSeconds: gate.requiredMeditationSeconds ?? null,
                restorativeReadingSeconds: gate.requiredRestorativeReadingSeconds ?? null,
                restorativeReadingPages: gate.requiredRestorativeQualifiedPages ?? null,
              })
            ),
            morningMeditation: runtime.morningMeditation?.requirement
              ? {
                  attentionDayId: runtime.morningMeditation.requirement.attentionDayId,
                  sessionId: runtime.morningMeditation.requirement.sessionId,
                  requiredQualifiedSeconds:
                    runtime.morningMeditation.requirement.requiredQualifiedSeconds,
                  satisfied: Boolean(runtime.morningMeditation.requirement.satisfiedAt),
                }
              : null,
            officialCompanionPackages: [...OFFICIAL_COMPANION_PACKAGES],
          });
          const attentionStateSignature = JSON.stringify(attentionState);
          if (this.lastAndroidAttentionStateSignature !== attentionStateSignature) {
            const saved = await RhythmDeviceModule.setAttentionExchangeState(attentionState);
            requireNativeSave('attention-state', 'setAttentionExchangeState', saved);
            this.lastAndroidAttentionStateSignature = attentionStateSignature;
          }
        }

        // Clear opaque base restrictions so native solely evaluates routines, cooldowns, and allowances
        this.syncStage = 'base-restrictions';
        if (this.lastAndroidBaseRestrictionsSignature !== '[]') {
          const saved = await RhythmDeviceModule.setBaseRestrictions([]);
          requireNativeSave('base-restrictions', 'setBaseRestrictions', saved);
          this.lastAndroidBaseRestrictionsSignature = '[]';
        }

        // 1. Sync one shared policy per configured Risk Group.
        this.syncStage = 'risk-policies';
        if (RhythmDeviceModule.setRiskGroupPolicies) {
          const riskPolicies = sanitizeForNative(config.riskGroups.map((group) => {
            const activity = offlineActivities.find((item) => item.id === (group.recoveryActivityId ?? 'walk')) ?? offlineActivities.find((item) => item.id === 'walk');
            return {
            groupId: group.id,
            groupName: group.name,
            packageNames: group.appIds.filter((id) => config.apps.some((app) => app.id === id && app.classification === 'risk')).sort(),
            allowanceMinutes: group.allowanceMinutes ?? 30,
            cooldownMinutes: group.cooldownMinutes,
            recoveryActivity: {
              id: activity?.id ?? 'walk',
              title: activity?.title ?? 'Take a short walk',
              subtitle: activity?.subtitle ?? 'Fresh air. Clear mind.',
              iconEmoji: activity?.iconEmoji ?? 'walk',
              durationSuggestion: activity?.durationSuggestion,
            },
          };
          }).filter((policy) => policy.packageNames.length > 0)
            .sort((a, b) => a.groupId.localeCompare(b.groupId)));
          // Self-healing: a stale signature cache must never mask a native
          // projection that lost its packages.
          await this.reprojectOnNativePolicyMismatch(riskPolicies);
          const policySig = JSON.stringify(riskPolicies);
          if (this.lastAndroidRiskPoliciesSignature !== policySig) {
            const saved = await RhythmDeviceModule.setRiskGroupPolicies(riskPolicies);
            requireNativeSave('risk-policies', 'setRiskGroupPolicies', saved);
            this.lastAndroidRiskPoliciesSignature = policySig;
          }
        }

        // 2. Sync explicit active cooldown policies
        this.syncStage = 'cooldowns';
        if (RhythmDeviceModule.setCooldownPolicies) {
          const cooldownPolicies = sanitizeForNative(Object.entries(runtime.activeCooldowns || {})
            .filter(([, cd]) => cd.endsAt > Date.now())
            .map(([gid, cd]) => {
              const grp = config.riskGroups.find((g) => g.id === gid);
              return {
                groupId: gid,
                packageNames: (grp?.appIds || [])
                  .filter((id) => config.apps.some((app) => app.id === id && app.classification === 'risk'))
                  .sort(),
                startedAt: cd.startedAt,
                endsAt: cd.endsAt,
                attentionDateKey: cd.attentionDateKey,
                dailyCooldownOrdinal: cd.dailyCooldownOrdinal,
                requiredReadingSeconds: cd.requiredReadingSeconds,
                requiredQualifiedPages: cd.requiredQualifiedPages,
                ...cooldownRequirementProjection(cd),
              };
            })
            .filter((p) => p.packageNames.length > 0)
            .sort((a, b) => a.groupId.localeCompare(b.groupId)));

          const cdSig = JSON.stringify(cooldownPolicies);
          if (this.lastAndroidCooldownsSignature !== cdSig) {
            const saved = await RhythmDeviceModule.setCooldownPolicies(cooldownPolicies);
            requireNativeSave('cooldowns', 'setCooldownPolicies', saved);
            this.lastAndroidCooldownsSignature = cdSig;
          }
        }

        // 3. Sync native routine schedule with explicit window types and allRiskPackages
        this.syncStage = 'routine-schedule';
        if (RhythmDeviceModule.setRoutineSchedule) {
          const allRiskPackages = config.apps
            .filter((a) => a.classification === 'risk')
            .map((a) => a.id)
            .sort();

          const scheduleWindows = config.routineWindows
            .filter(
              (w): w is typeof w & { type: 'morning-buffer' | 'evening-wind-down' } =>
                w.type === 'morning-buffer' ||
                w.type === 'evening-wind-down'
            )
            .map((w) => {
              const protectedPackageNames = new Set<string>();
              for (const gid of w.protectedGroupIds) {
                const grp = config.riskGroups.find((g) => g.id === gid);
                if (grp) {
                  for (const pkg of grp.appIds) {
                    protectedPackageNames.add(pkg);
                  }
                }
              }

              return {
                id: w.id,
                type: w.type,
                startTime: w.startTime,
                endTime: w.endTime ?? '00:00',
                activeDays: [...w.activeDays].sort(),
                protectedPackages: Array.from(protectedPackageNames).sort(),
                enabled: w.enabled,
              };
            })
            .sort((a, b) => a.id.localeCompare(b.id));

          const scheduleInput = sanitizeForNative({
            windows: scheduleWindows,
            allRiskPackages,
          });
          const schedSig = JSON.stringify(scheduleInput);
          if (this.lastAndroidRoutineScheduleSignature !== schedSig) {
            const saved = await RhythmDeviceModule.setRoutineSchedule(scheduleInput);
            requireNativeSave('routine-schedule', 'setRoutineSchedule', saved);
            this.lastAndroidRoutineScheduleSignature = schedSig;
          }
        }
      }
      this.lastSyncDiagnostics = { success: true, updatedAt: Date.now() };
    } catch (error) {
      // Evidence, never silence: record exactly which stage failed and why.
      this.lastSyncDiagnostics = {
        success: false,
        ...(this.syncStage ? { failedStage: this.syncStage } : {}),
        error: error instanceof Error ? error.message : String(error),
        updatedAt: Date.now(),
      };
    }
  }

  async getSnapshot(): Promise<IOSSharedRhythmSnapshot | null> {
    const os = getPlatformOS();
    if (os === 'ios') {
      try {
        const raw = await RhythmDeviceModule.getSharedRhythmState();
        if (raw) {
          const parsed = JSON.parse(raw) as IOSSharedRhythmSnapshot;
          if (parsed && parsed.schemaVersion === 1) {
            this.lastSnapshot = parsed;
            return parsed;
          }
        }
      } catch {
        // Fall back to memory cache
      }
    }
    return this.lastSnapshot || null;
  }

  async getAndroidSnapshot(): Promise<NativeAttentionExchangeSnapshot | null> {
    if (getPlatformOS() !== 'android') return null;
    try {
      return await RhythmDeviceModule.getAttentionExchangeSnapshot();
    } catch {
      return null;
    }
  }
}
