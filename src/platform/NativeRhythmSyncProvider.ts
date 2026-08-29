import { RhythmConfiguration, RhythmRuntime } from '../domain/rhythm/types';
import { computeUnsuppressedBaseRestrictedAppIds } from '../domain/rhythm/nativePolicy';
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
            if (result && !result.success) {
              // Monitoring sync failure recorded in App Group
            }
          }
          this.lastConfigSignature = signature;
        }
      } else if (os === 'android') {
        const baseRestrictedPackageIds = computeUnsuppressedBaseRestrictedAppIds(
          runtime,
          config,
          Date.now()
        );
        await RhythmDeviceModule.setBaseRestrictions(baseRestrictedPackageIds);
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
