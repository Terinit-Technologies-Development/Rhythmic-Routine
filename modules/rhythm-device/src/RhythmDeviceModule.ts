import { NativeAppInfo, NativePermissionStatus, NativeUsageEvent } from './RhythmDevice.types';

// Mock/fallback when native binary is not linked (web / simulator without native build)
const FallbackModule = {
  checkPermissions: async (): Promise<NativePermissionStatus> => ({
    hasUsagePermission: true,
    hasRestrictionPermission: true,
    familyControlsStatus: 'unsupported',
  }),
  requestUsagePermission: async (): Promise<void> => {},
  requestRestrictionPermission: async (): Promise<void> => {},
  requestFamilyControls: async (): Promise<string> => 'unsupported',
  revokeAuthorization: async (): Promise<void> => {},
  getInstalledApps: async (): Promise<NativeAppInfo[]> => [],
  queryUsageEvents: async (_startTime: number, _endTime: number): Promise<NativeUsageEvent[]> => [],
  applyShieldRestrictions: async (_packageNames: string[]): Promise<boolean> => false,
  clearShieldRestrictions: async (_packageNames: string[]): Promise<boolean> => false,
  setSharedRhythmState: async (_stateJson: string): Promise<boolean> => true,
};

let NativeModule: typeof FallbackModule = FallbackModule;

try {
  // Try loading Expo NativeModulesProxy if available
  const { requireNativeModule } = require('expo-modules-core');
  const mod = requireNativeModule('RhythmDevice');
  if (mod) {
    NativeModule = {
      ...FallbackModule,
      ...mod,
    };
  }
} catch {
  // Use fallback
}

export default NativeModule;
