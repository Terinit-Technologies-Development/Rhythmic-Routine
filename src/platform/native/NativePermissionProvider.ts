import { Platform } from 'react-native';
import { PermissionProvider, PermissionState } from '../PermissionProvider';
import RhythmDeviceModule from '../../../modules/rhythm-device';

export class NativePermissionProvider implements PermissionProvider {
  async getStatus(): Promise<PermissionState> {
    try {
      const nativeStatus = await RhythmDeviceModule.checkPermissions();
      const usageAccess = nativeStatus.hasUsagePermission ? 'granted' : 'denied';

      let restrictionAuthorization: PermissionState['restrictionAuthorization'] = 'unsupported';
      if (Platform.OS === 'ios') {
        if (nativeStatus.familyControlsStatus === 'approved') {
          restrictionAuthorization = 'granted';
        } else if (nativeStatus.familyControlsStatus === 'denied') {
          restrictionAuthorization = 'denied';
        }
      } else if (Platform.OS === 'android') {
        restrictionAuthorization = nativeStatus.hasRestrictionPermission ? 'granted' : 'denied';
      }

      return {
        usageAccess,
        restrictionAuthorization,
        restrictionCapability: nativeStatus.hasRestrictionPermission ? 'enforced' : 'foundation-only',
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
      if (Platform.OS === 'ios') {
        await RhythmDeviceModule.requestFamilyControls();
      } else if (Platform.OS === 'android') {
        await RhythmDeviceModule.requestRestrictionPermission();
      }
    } catch {
      // Ignored
    }
  }
}
