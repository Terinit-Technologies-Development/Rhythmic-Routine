import { RhythmConfiguration, RhythmRuntime } from '../domain/rhythm/types';
import RhythmDeviceModule from '../../modules/rhythm-device';

export interface IOSNativeGroupPolicy {
  groupId: string;
  selectionRef?: string;
  sessionThresholdMinutes: number;
  cooldownMinutes: number;
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
}

export class NoopNativeRhythmSyncProvider implements NativeRhythmSyncProvider {
  async sync(_runtime: RhythmRuntime, _config: RhythmConfiguration): Promise<void> {
    // No-op for web/mock environments
  }

  async getSnapshot(): Promise<IOSSharedRhythmSnapshot | null> {
    return null;
  }
}

function getPlatformOS(): string {
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
      cooldownMinutes: group.cooldownMinutes,
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

  async sync(runtime: RhythmRuntime, config: RhythmConfiguration): Promise<void> {
    try {
      const os = getPlatformOS();
      if (os === 'ios') {
        const groups: IOSNativeGroupPolicy[] = config.riskGroups.map((g) => ({
          groupId: g.id,
          selectionRef: g.nativeSelectionRef,
          sessionThresholdMinutes: g.sessionThresholdMinutes,
          cooldownMinutes: g.cooldownMinutes,
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
        // Clear opaque base restrictions so native solely evaluates routines, cooldowns, and allowances
        if (this.lastAndroidBaseRestrictionsSignature !== '[]') {
          await RhythmDeviceModule.setBaseRestrictions([]);
          this.lastAndroidBaseRestrictionsSignature = '[]';
        }

        // 1. Sync daily allowance policies
        if (RhythmDeviceModule.setDailyAllowancePolicies) {
          const riskPolicies = config.apps
            .filter((app) => app.classification === 'risk')
            .map((app) => ({
              packageName: app.id,
              allowanceMinutes: app.dailyRiskAllowance?.allowanceMinutes ?? 30,
            }))
            .sort((a, b) => a.packageName.localeCompare(b.packageName));
          const policySig = JSON.stringify(riskPolicies);
          if (this.lastAndroidRiskPoliciesSignature !== policySig) {
            await RhythmDeviceModule.setDailyAllowancePolicies(riskPolicies);
            this.lastAndroidRiskPoliciesSignature = policySig;
          }
        }

        // 2. Sync explicit active cooldown policies
        if (RhythmDeviceModule.setCooldownPolicies) {
          const cooldownPolicies = Object.entries(runtime.activeCooldowns || {})
            .filter(([, cd]) => cd.endsAt > Date.now())
            .map(([gid, cd]) => {
              const grp = config.riskGroups.find((g) => g.id === gid);
              return {
                groupId: gid,
                packageNames: (grp?.appIds || []).slice().sort(),
                endsAt: cd.endsAt,
              };
            })
            .filter((p) => p.packageNames.length > 0)
            .sort((a, b) => a.groupId.localeCompare(b.groupId));

          const cdSig = JSON.stringify(cooldownPolicies);
          if (this.lastAndroidCooldownsSignature !== cdSig) {
            await RhythmDeviceModule.setCooldownPolicies(cooldownPolicies);
            this.lastAndroidCooldownsSignature = cdSig;
          }
        }

        // 3. Sync native routine schedule with explicit window types and allRiskPackages
        if (RhythmDeviceModule.setRoutineSchedule) {
          const allRiskPackages = config.apps
            .filter((a) => a.classification === 'risk')
            .map((a) => a.id)
            .sort();

          const scheduleWindows = config.routineWindows.map((w) => {
            const protectedPackageNames = new Set<string>();
            for (const gid of w.protectedGroupIds) {
              const grp = config.riskGroups.find((g) => g.id === gid);
              if (grp) {
                for (const pkg of grp.appIds) {
                  protectedPackageNames.add(pkg);
                }
              }
            }
            const routineType: 'morning-buffer' | 'evening-wind-down' =
              w.id.includes('morning') || w.name?.toLowerCase().includes('morning')
                ? 'morning-buffer'
                : 'evening-wind-down';

            return {
              id: w.id,
              type: routineType,
              startTime: w.startTime,
              endTime: w.endTime ?? '00:00',
              activeDays: [...w.activeDays].sort(),
              protectedPackages: Array.from(protectedPackageNames).sort(),
              enabled: w.enabled,
            };
          }).sort((a, b) => a.id.localeCompare(b.id));

          const scheduleInput = {
            windows: scheduleWindows,
            allRiskPackages,
          };
          const schedSig = JSON.stringify(scheduleInput);
          if (this.lastAndroidRoutineScheduleSignature !== schedSig) {
            await RhythmDeviceModule.setRoutineSchedule(scheduleInput);
            this.lastAndroidRoutineScheduleSignature = schedSig;
          }
        }
      }
    } catch {
      // Platform sync boundary
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
}
