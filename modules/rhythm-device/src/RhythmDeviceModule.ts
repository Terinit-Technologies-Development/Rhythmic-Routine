import { IOSSelectionReference, NativeAppInfo, NativePermissionStatus, NativeUsageEvent } from './RhythmDevice.types';

// Mock/fallback when native binary is not linked (web / simulator without native build)
const FallbackModule = {
  checkPermissions: async (): Promise<NativePermissionStatus> => ({
    hasUsagePermission: true,
    hasRestrictionPermission: true,
    familyControlsStatus: 'unsupported',
    hasSelection: false,
    shieldingOperational: false,
    monitoringOperational: false,
  }),
  requestUsagePermission: async (): Promise<void> => {},
  requestRestrictionPermission: async (): Promise<void> => {},
  requestFamilyControls: async (): Promise<string> => 'unsupported',
  showFamilyActivityPicker: async (groupId: string): Promise<IOSSelectionReference> => ({
    localSelectionId: `selection.${groupId}`,
    tokenCount: 1,
    kind: 'mixed',
  }),
  hasGroupSelection: async (_groupId: string): Promise<boolean> => false,
  clearGroupSelection: async (_groupId: string): Promise<boolean> => true,
  revokeAuthorization: async (): Promise<void> => {},
  getInstalledApps: async (): Promise<NativeAppInfo[]> => [],
  queryUsageEvents: async (_startTime: number, _endTime: number): Promise<NativeUsageEvent[]> => [],
  setBaseRestrictions: async (_packageNames: string[]): Promise<boolean> => false,
  applyShieldRestrictions: async (_packageNames: string[]): Promise<boolean> => false,
  clearShieldRestrictions: async (_packageNames: string[]): Promise<boolean> => false,
  startAccessLease: async (_groupId: string, _packageNames: string[], _endsAt: number): Promise<boolean> => true,
  endAccessLease: async (_groupId: string): Promise<boolean> => true,
  setSharedRhythmState: async (_stateJson: string): Promise<boolean> => true,
  getSharedRhythmState: async (): Promise<string | null> => null,
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
