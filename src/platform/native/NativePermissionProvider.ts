import { PermissionProvider, PermissionState } from '../PermissionProvider';
import RhythmDeviceModule from '../../../modules/rhythm-device';

export class NativePermissionProvider implements PermissionProvider {
  async getStatus(): Promise<PermissionState> {
    try {
      const nativeStatus = await RhythmDeviceModule.checkPermissions();
      const usageAccess = nativeStatus.hasUsagePermission ? 'granted' : 'denied';

      let restrictionAuthorization: PermissionState['restrictionAuthorization'] = 'unsupported';
      if (nativeStatus.familyControlsStatus === 'approved') {
        restrictionAuthorization = 'granted';
      } else if (nativeStatus.familyControlsStatus === 'denied') {
        restrictionAuthorization = 'denied';
      }

      return {
        usageAccess,
        restrictionAuthorization,
        restrictionCapability: 'foundation-only',
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
      await RhythmDeviceModule.requestFamilyControls();
    } catch {
      // Ignored
    }
  }
}
