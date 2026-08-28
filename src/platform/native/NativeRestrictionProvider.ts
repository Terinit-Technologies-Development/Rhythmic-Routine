import { Platform } from 'react-native';
import {
  NativeAccessLeasePolicy,
  RestrictionCapability,
  RestrictionProvider,
  RestrictionResult,
} from '../RestrictionProvider';
import RhythmDeviceModule from '../../../modules/rhythm-device';

export class NativeRestrictionProvider implements RestrictionProvider {
  private activeRestrictedApps: Set<string> = new Set();

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

  async startAccessLease(lease: NativeAccessLeasePolicy): Promise<void> {
    try {
      await RhythmDeviceModule.startAccessLease(lease.groupId, lease.appIds, lease.endsAt);
    } catch {
      // Platform restriction boundary
    }
  }

  async endAccessLease(groupId: string): Promise<void> {
    try {
      await RhythmDeviceModule.endAccessLease(groupId);
    } catch {
      // Platform restriction boundary
    }
  }

  async getActiveRestrictedApps(): Promise<string[]> {
    return Array.from(this.activeRestrictedApps);
  }

  async getCapability(): Promise<RestrictionCapability> {
    try {
      const perms = await RhythmDeviceModule.checkPermissions();

      if (Platform.OS === 'ios') {
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

      // Android
      const isEnforced = perms.hasRestrictionPermission === true;
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
        mode: Platform.OS === 'ios' ? 'system-activity-threshold' : 'continuous-session',
        supportsRoutineWindows: true,
        supportsGroupCooldowns: true,
        supportsContinuousSessionGap: Platform.OS === 'android',
        supportsEmergencyOverride: true,
        reason: 'Native module unavailable or uninitialized',
      };
    }
  }
}
