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
  constructor(
    private readonly device: typeof RhythmDeviceModule = RhythmDeviceModule,
    private readonly platformOS: () => string = getPlatformOS
  ) {}

  async getStatus(): Promise<PermissionState> {
    try {
      const nativeStatus = await this.device.checkPermissions();
      const usageAccess = nativeStatus.hasUsagePermission ? 'granted' : 'denied';

      let restrictionAuthorization: PermissionState['restrictionAuthorization'] = 'unsupported';
      const os = this.platformOS();
      if (os === 'ios') {
        if (nativeStatus.familyControlsStatus === 'approved') {
          restrictionAuthorization = 'granted';
        } else if (nativeStatus.familyControlsStatus === 'denied') {
          restrictionAuthorization = 'denied';
        }
      } else if (os === 'android') {
        restrictionAuthorization = nativeStatus.hasRestrictionPermission ? 'granted' : 'denied';
      }

      // Capability truth requires BOTH the real native module and a positively
      // running Accessibility enforcement service. The enabled-setting bit can
      // remain true while the service is not bound/running.
      const moduleDiagnostics = await this.device.getNativeModuleDiagnostics();
      let serviceRunning = false;
      if (moduleDiagnostics.available && os === 'android') {
        try {
          const enforcement = await this.device.getEnforcementDiagnostics();
          serviceRunning = enforcement?.serviceRunning === true;
        } catch {
          serviceRunning = false;
        }
      }
      const nativeReady =
        moduleDiagnostics.available &&
        nativeStatus.hasRestrictionPermission &&
        (os !== 'android' || serviceRunning);

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
      await this.device.requestUsagePermission();
    } catch {
      // Ignored
    }
  }

  async requestRestrictionAccess(): Promise<void> {
    try {
      const os = this.platformOS();
      if (os === 'ios') {
        await this.device.requestFamilyControls();
      } else if (os === 'android') {
        await this.device.requestRestrictionPermission();
      }
    } catch {
      // Ignored
    }
  }
}
