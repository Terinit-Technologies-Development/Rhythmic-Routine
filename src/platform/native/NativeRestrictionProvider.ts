import {
  NativeAccessLeasePolicy,
  RestrictionCapability,
  RestrictionLeaseResult,
  RestrictionProvider,
  RestrictionResult,
} from '../RestrictionProvider';
import RhythmDeviceModule from '../../../modules/rhythm-device';

function getPlatformOS(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Platform } = require('react-native');
    return Platform?.OS || 'web';
  } catch {
    return 'web';
  }
}

export class NativeRestrictionProvider implements RestrictionProvider {
  private activeRestrictedApps: Set<string> = new Set();

  constructor(private readonly device: typeof RhythmDeviceModule = RhythmDeviceModule) {}

  async applyRestrictions(appIds: string[]): Promise<RestrictionResult> {
    try {
      const nativeApplied = await RhythmDeviceModule.applyShieldRestrictions(appIds);
      if (nativeApplied === true) {
        for (const id of appIds) {
          this.activeRestrictedApps.add(id);
        }
        return {
          status: 'applied',
          appIds,
        };
      }
    } catch {
      // Platform restriction boundary
    }

    return {
      status: 'unsupported',
      appIds,
      reason: 'Physical app shielding requires active platform authorization and token binding.',
    };
  }

  async clearRestrictions(appIds: string[]): Promise<RestrictionResult> {
    try {
      const nativeCleared = await RhythmDeviceModule.clearShieldRestrictions(appIds);
      if (nativeCleared === true) {
        for (const id of appIds) {
          this.activeRestrictedApps.delete(id);
        }
        return {
          status: 'applied',
          appIds,
        };
      }
    } catch {
      // Platform restriction boundary
    }

    return {
      status: 'unsupported',
      appIds,
    };
  }

  async startAccessLease(lease: NativeAccessLeasePolicy): Promise<RestrictionLeaseResult> {
    if (typeof this.device.startAccessLease !== 'function') {
      return { status: 'unsupported', groupId: lease.groupId, reason: 'native-lease-method-unavailable' };
    }
    try {
      const accepted = await this.device.startAccessLease(
        lease.groupId,
        lease.appIds,
        lease.endsAt
      );
      return accepted === true
        ? { status: 'applied', groupId: lease.groupId }
        : { status: 'failed', groupId: lease.groupId, reason: 'native-lease-start-not-persisted' };
    } catch (error) {
      return {
        status: 'failed',
        groupId: lease.groupId,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async endAccessLease(groupId: string): Promise<RestrictionLeaseResult> {
    if (typeof this.device.endAccessLease !== 'function') {
      return { status: 'unsupported', groupId, reason: 'native-lease-method-unavailable' };
    }
    try {
      const accepted = await this.device.endAccessLease(groupId);
      return accepted === true
        ? { status: 'applied', groupId }
        : { status: 'failed', groupId, reason: 'native-lease-end-not-persisted' };
    } catch (error) {
      return {
        status: 'failed',
        groupId,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async getActiveRestrictedApps(): Promise<string[]> {
    return Array.from(this.activeRestrictedApps);
  }

  async getCapability(): Promise<RestrictionCapability> {
    const platformOS = getPlatformOS();
    try {
      const perms = await RhythmDeviceModule.checkPermissions();

      if (platformOS === 'ios') {
        const hasAuth = perms.familyControlsStatus === 'approved';
        const hasSelection = perms.hasSelection === true;
        const isEnforced = hasAuth && hasSelection && perms.hasRestrictionPermission === true;

        let reason = 'iOS Screen Time & ManagedSettings shielding active';
        if (!hasAuth) {
          reason = 'iOS Screen Time requires Apple Family Controls authorization and provisioning';
        } else if (!hasSelection) {
          reason = 'Family Controls approved; app selection needed';
        }

        return {
          status: isEnforced ? 'enforced' : 'foundation-only',
          mode: 'system-activity-threshold',
          supportsRoutineWindows: true,
          supportsGroupCooldowns: true,
          supportsContinuousSessionGap: false,
          supportsEmergencyOverride: true,
          reason,
        };
      }

      // Android: enforcement capability requires BOTH the real native module
      // and the Accessibility enforcement service.
      const moduleDiagnostics = await RhythmDeviceModule.getNativeModuleDiagnostics();
      const isEnforced = moduleDiagnostics.available && perms.hasRestrictionPermission === true;
      return {
        status: isEnforced ? 'enforced' : 'foundation-only',
        mode: 'continuous-session',
        supportsRoutineWindows: true,
        supportsGroupCooldowns: true,
        supportsContinuousSessionGap: true,
        supportsEmergencyOverride: true,
        reason: isEnforced
          ? 'Android Rhythm accessibility intervention service active'
          : 'Android requires enabling Rhythm accessibility intervention in System Settings',
      };
    } catch {
      return {
        status: 'foundation-only',
        mode: platformOS === 'ios' ? 'system-activity-threshold' : 'continuous-session',
        supportsRoutineWindows: true,
        supportsGroupCooldowns: true,
        supportsContinuousSessionGap: platformOS === 'android',
        supportsEmergencyOverride: true,
        reason: 'Native module unavailable or uninitialized',
      };
    }
  }
}
