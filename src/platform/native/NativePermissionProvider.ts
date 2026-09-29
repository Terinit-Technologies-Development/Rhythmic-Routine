import { PermissionProvider, PermissionState } from '../PermissionProvider';
import RhythmDeviceModule from '../../../modules/rhythm-device';

/** Lazy platform resolution keeps this provider importable in Node test runs. */
function getPlatformOS(): string {
  if (process.env.RHYTHM_PLATFORM_OVERRIDE) {
    return process.env.RHYTHM_PLATFORM_OVERRIDE;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Platform: RNPlatform } = require('react-native');
    return RNPlatform?.OS || 'web';
  } catch {
    return 'web';
  }
}

export class NativePermissionProvider implements PermissionProvider {
  async getStatus(): Promise<PermissionState> {
    try {
      const nativeStatus = await RhythmDeviceModule.checkPermissions();
      const usageAccess = nativeStatus.hasUsagePermission ? 'granted' : 'denied';

      let restrictionAuthorization: PermissionState['restrictionAuthorization'] = 'unsupported';
      const os = getPlatformOS();
      if (os === 'ios') {
        if (nativeStatus.familyControlsStatus === 'approved') {
          restrictionAuthorization = 'granted';
        } else if (nativeStatus.familyControlsStatus === 'denied') {
          restrictionAuthorization = 'denied';
        }
      } else if (os === 'android') {
        restrictionAuthorization = nativeStatus.hasRestrictionPermission ? 'granted' : 'denied';
      }

      // Capability truth requires BOTH the real native module and the
      // Accessibility enforcement service. An unavailable bridge must never be
      // presented as enforcement capable.
      const moduleDiagnostics = await RhythmDeviceModule.getNativeModuleDiagnostics();
      const nativeReady = moduleDiagnostics.available && nativeStatus.hasRestrictionPermission;

      return {
        usageAccess,
        restrictionAuthorization,
        restrictionCapability: nativeReady ? 'enforced' : 'foundation-only',
      };
    } catch {
      return {
        usageAccess: 'unknown',
        restrictionAuthorization: 'unknown',
        restrictionCapability: 'foundation-only',
      };
    }
  }

  async requestUsageAccess(): Promise<void> {
    try {
      await RhythmDeviceModule.requestUsagePermission();
    } catch {
      // Ignored
    }
  }

  async requestRestrictionAccess(): Promise<void> {
    try {
      const os = getPlatformOS();
      if (os === 'ios') {
        await RhythmDeviceModule.requestFamilyControls();
      } else if (os === 'android') {
        await RhythmDeviceModule.requestRestrictionPermission();
      }
    } catch {
      // Ignored
    }
  }
}
