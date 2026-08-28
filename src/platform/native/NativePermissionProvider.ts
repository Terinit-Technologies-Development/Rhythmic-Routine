import { PermissionProvider, PermissionState } from '../PermissionProvider';
import RhythmDeviceModule from '../../../modules/rhythm-device';

export class NativePermissionProvider implements PermissionProvider {
  async getStatus(): Promise<PermissionState> {
    try {
      const nativeStatus = await RhythmDeviceModule.checkPermissions();
      return {
        usageAccess: nativeStatus.hasUsagePermission ? 'granted' : 'denied',
        restrictionAccess: nativeStatus.hasRestrictionPermission
          ? 'granted'
          : nativeStatus.familyControlsStatus === 'unsupported'
          ? 'unsupported'
          : 'denied',
      };
    } catch {
      return {
        usageAccess: 'unknown',
        restrictionAccess: 'unknown',
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
