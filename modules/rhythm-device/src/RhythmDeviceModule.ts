import {
  IOSSelectionReference,
  MonitoringDiagnostics,
  MonitoringSyncResult,
  NativeAppInfo,
  NativeDailyAllowancePolicyInput,
  NativeDailyUsageSnapshot,
  NativeEnforcementDiagnostics,
  NativePermissionStatus,
  NativeUsageEvent,
} from './RhythmDevice.types';

// Fallback behavior:
// - Web: demo/mock capability allowed
// - Native platforms without RhythmDevice (Expo Go / unlinked native environment):
//   native unavailable, permissions false, capability foundation-only
const isWeb =
  typeof window !== 'undefined' &&
  typeof (window as any).document !== 'undefined';

export const FallbackModule = {
  checkPermissions: async (): Promise<NativePermissionStatus> => ({
    hasUsagePermission: isWeb,
    hasRestrictionPermission: isWeb,
    familyControlsStatus: 'unsupported',
    hasSelection: false,
    shieldingOperational: false,
    monitoringOperational: false,
    persistentMonitoringOperational: false,
    expiryMonitoringOperational: false,
  }),
  requestUsagePermission: async (): Promise<void> => {},
  requestRestrictionPermission: async (): Promise<void> => {},
  requestFamilyControls: async (): Promise<string> => 'unsupported',
  showFamilyActivityPicker: async (groupId: string): Promise<IOSSelectionReference> => ({
    localSelectionId: `selection.${groupId}`,
    tokenCount: isWeb ? 1 : 0,
    revision: 1,
    kind: 'mixed',
  }),
  hasGroupSelection: async (_groupId: string): Promise<boolean> => false,
  clearGroupSelection: async (_groupId: string): Promise<{ success: boolean; revision: number }> => ({
    success: true,
    revision: 1,
  }),
  revokeAuthorization: async (): Promise<void> => {},
  getInstalledApps: async (): Promise<NativeAppInfo[]> => [],
  queryUsageEvents: async (_startTime: number, _endTime: number): Promise<NativeUsageEvent[]> => [],
  setBaseRestrictions: async (_packageNames: string[]): Promise<boolean> => false,
  setDailyAllowancePolicies: async (_policies: NativeDailyAllowancePolicyInput[]): Promise<boolean> => true,
  getDailyUsageSnapshot: async (): Promise<NativeDailyUsageSnapshot> => ({
    dateKey: '',
    apps: [],
  }),
  reconcileDailyUsage: async (): Promise<NativeDailyUsageSnapshot> => ({
    dateKey: '',
    apps: [],
  }),
  getEnforcementDiagnostics: async (): Promise<NativeEnforcementDiagnostics> => ({
    serviceRunning: false,
    baseRestrictedPackageCount: 0,
    activeLeaseCount: 0,
    overlayVisible: false,
  }),
  applyShieldRestrictions: async (_packageNames: string[]): Promise<boolean> => false,
  clearShieldRestrictions: async (_packageNames: string[]): Promise<boolean> => false,
  startAccessLease: async (_groupId: string, _packageNames: string[], _endsAt: number): Promise<boolean> => isWeb,
  endAccessLease: async (_groupId: string): Promise<boolean> => isWeb,
  setSharedRhythmState: async (_stateJson: string): Promise<boolean> => true,
  getSharedRhythmState: async (): Promise<string | null> => null,
  synchronizeMonitoringConfiguration: async (
    _stateJson: string,
    _signature: string
  ): Promise<MonitoringSyncResult> => ({
    success: isWeb,
    persistentActivityCount: isWeb ? 3 : 0,
    totalActivityCount: isWeb ? 3 : 0,
  }),
  getMonitoringDiagnostics: async (): Promise<MonitoringDiagnostics> => ({
    activityCount: isWeb ? 3 : 0,
    activityNames: isWeb ? ['routine|morning-buffer|daily', 'routine|evening-wind-down|daily', 'risk.daily'] : [],
    monitoringOperational: isWeb,
    persistentMonitoringOperational: isWeb,
    expiryMonitoringOperational: isWeb,
    configSignature: isWeb ? 'fallback' : '',
    lastError: isWeb ? '' : 'Native module unavailable',
  }),
};

let nativeModuleAvailable = false;
let NativeModule: typeof FallbackModule = FallbackModule;

try {
  // Try loading Expo NativeModulesProxy if available
  const { requireNativeModule } = require('expo-modules-core');
  const mod = requireNativeModule('RhythmDevice');
  if (mod) {
    nativeModuleAvailable = true;
    NativeModule = {
      ...FallbackModule,
      ...mod,
    };
  }
} catch {
  // Use fallback
}

export const isRhythmNativeModuleAvailable = nativeModuleAvailable;
export default NativeModule;

