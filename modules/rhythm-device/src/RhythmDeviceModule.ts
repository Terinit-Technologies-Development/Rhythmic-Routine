import {
  CommitSelectionResult,
  IOSSelectionReference,
  MonitoringDiagnostics,
  MonitoringSyncResult,
  NativeAppInfo,
  NativeEnforcementDiagnostics,
  NativeGroupAllowanceSnapshot,
  NativePermissionStatus,
  NativeRiskGroupPolicyInput,
  NativeRoutineWindowInput,
  NativeRoutineScheduleInput,
  NativeCooldownPolicyInput,
  NativeReadingAttentionPolicyInput,
  NativeAttentionExchangeSnapshot,
  NativeUsageEvent,
  NativeRecoveryStatus,
  NativeDailyReadingEvidence,
  NativeMeditationAvailability,
  NativeMeditationSessionEvidence,
  NativeMeditationRecoveryRequestInput,
  NativeQaExhaustionResult,
  RhythmNativeModuleDiagnostics,
} from './RhythmDevice.types';

// Fallback behavior:
// - Web: demo/mock capability allowed
// - Native platforms without RhythmDevice (Expo Go / unlinked native environment):
//   native unavailable, permissions false, capability foundation-only
const isWeb =
  typeof window !== 'undefined' &&
  typeof (window as any).document !== 'undefined';

/** Web/demo may simulate native-policy success; a real device must not. */
const nativeFallbackSuccess = isWeb;

const fallbackGroupRevisions: Record<string, number> = {};
const fallbackRollbacks: Record<string, { previousRevision: number; hasSelection: boolean }> = {};

export function __resetFallbackRevisionsForTests(): void {
  for (const k of Object.keys(fallbackGroupRevisions)) {
    delete fallbackGroupRevisions[k];
  }
  for (const k of Object.keys(fallbackRollbacks)) {
    delete fallbackRollbacks[k];
  }
}

export function __getFallbackGroupRevisionForTests(groupId: string): number {
  return fallbackGroupRevisions[groupId] ?? 0;
}

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
  getNativeModuleDiagnostics: async (): Promise<RhythmNativeModuleDiagnostics> =>
    getRhythmNativeModuleDiagnostics(),
  requestUsagePermission: async (): Promise<void> => {},
  requestRestrictionPermission: async (): Promise<void> => {},
  requestFamilyControls: async (): Promise<string> => 'unsupported',
  showFamilyActivityPicker: async (groupId: string): Promise<IOSSelectionReference> => ({
    localSelectionId: `selection.${groupId}`,
    tokenCount: isWeb ? 1 : 0,
    revision: 1,
    kind: 'mixed',
  }),
  stageFamilyActivityPicker: async (
    _groupId: string
  ): Promise<{ stagedSelectionRef: string; tokenCount: number }> => ({
    stagedSelectionRef: `pending_selection.${Date.now()}`,
    tokenCount: isWeb ? 1 : 0,
  }),
  commitStagedFamilyActivitySelection: async (
    groupId: string,
    _stagedSelectionRef: string
  ): Promise<CommitSelectionResult> => {
    const prevRev = fallbackGroupRevisions[groupId] ?? 0;
    const nextRev = prevRev + 1;
    fallbackGroupRevisions[groupId] = nextRev;
    const rollbackRef = `rollback_selection.${Date.now()}`;
    fallbackRollbacks[rollbackRef] = {
      previousRevision: prevRev,
      hasSelection: prevRev > 0,
    };
    return {
      success: true,
      revision: nextRev,
      localSelectionId: `selection.${groupId}`,
      rollbackRef,
      previousRevision: prevRev,
    };
  },
  rollbackCommittedFamilyActivitySelection: async (
    groupId: string,
    rollbackRef: string,
    previousRevision: number
  ): Promise<boolean> => {
    fallbackGroupRevisions[groupId] = previousRevision;
    delete fallbackRollbacks[rollbackRef];
    return true;
  },
  discardStagedFamilyActivitySelection: async (_stagedSelectionRef: string): Promise<boolean> => true,
  hasGroupSelection: async (groupId: string): Promise<boolean> => (fallbackGroupRevisions[groupId] ?? 0) > 0,
  clearGroupSelection: async (groupId: string): Promise<{ success: boolean; revision: number }> => {
    delete fallbackGroupRevisions[groupId];
    return {
      success: true,
      revision: 1,
    };
  },
  revokeAuthorization: async (): Promise<void> => {},
  getInstalledApps: async (): Promise<NativeAppInfo[]> => [],
  queryUsageEvents: async (_startTime: number, _endTime: number): Promise<NativeUsageEvent[]> => [],
  setBaseRestrictions: async (_packageNames: string[]): Promise<boolean> => isWeb,
  // Native policy writes must NEVER report success from the fallback shim:
  // only the web/demo environment may simulate success. A real device without
  // the RhythmDevice module gets an honest `false` so callers fail closed.
  setRiskGroupPolicies: async (_policies: NativeRiskGroupPolicyInput[]): Promise<boolean> => nativeFallbackSuccess,
  getGroupUsageSnapshot: async (): Promise<NativeGroupAllowanceSnapshot[]> => [],
  getGroupAllowanceSnapshot: async (): Promise<NativeGroupAllowanceSnapshot[]> => [],
  reconcileGroupUsage: async (): Promise<NativeGroupAllowanceSnapshot[]> => [],
  setRoutineSchedule: async (_schedule: NativeRoutineWindowInput[] | NativeRoutineScheduleInput): Promise<boolean> => nativeFallbackSuccess,
  setCooldownPolicies: async (_policies: NativeCooldownPolicyInput[]): Promise<boolean> => nativeFallbackSuccess,
  setAttentionExchangePolicy: async (_policy: NativeReadingAttentionPolicyInput): Promise<boolean> => nativeFallbackSuccess,
  setAttentionExchangeState: async (_snapshot: Record<string, unknown>): Promise<boolean> => nativeFallbackSuccess,
  getAttentionExchangeSnapshot: async (): Promise<NativeAttentionExchangeSnapshot | null> => null,
  reconcileAttentionExchange: async (): Promise<boolean> => false,
  getEnforcementDiagnostics: async (): Promise<NativeEnforcementDiagnostics> => ({
    serviceRunning: false,
    baseRestrictedPackageCount: 0,
    activeLeaseCount: 0,
    overlayVisible: false,
    nativeModuleAvailable: false,
    riskPolicyCount: 0,
    riskPackageCount: 0,
    routineRiskPackageCount: 0,
    riskPackageSample: [],
  }),
  applyShieldRestrictions: async (_packageNames: string[]): Promise<boolean> => false,
  clearShieldRestrictions: async (_packageNames: string[]): Promise<boolean> => false,
  startAccessLease: async (_groupId: string, _packageNames: string[], _endsAt: number): Promise<boolean> => isWeb,
  endAccessLease: async (_groupId: string): Promise<boolean> => isWeb,
  resetEnforcementState: async (): Promise<boolean> => true,
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
  isReaderAvailable: async (): Promise<boolean> => false,
  startRecoverySession: async (
    _sessionId: string,
    _requiredSeconds: number,
    _requiredPages: number,
    _createdAt: number,
    _expiresAt: number
  ): Promise<boolean> => false,
  queryRecoveryStatus: async (_sessionId: string): Promise<NativeRecoveryStatus | null> => null,
  queryDailyReadingEvidence: async (dateKey: string): Promise<NativeDailyReadingEvidence> => ({
    providerAvailable: false,
    protocolCompatible: false,
    dateKey,
    verifiedActiveSeconds: 0,
    qualifiedPages: 0,
    updatedAtEpochMs: 0,
  }),
  openRhythmicReader: async (): Promise<boolean> => false,
  isMeditationAvailable: async (): Promise<NativeMeditationAvailability> => 'unavailable',
  startMeditationRecoverySession: async (
    _request: NativeMeditationRecoveryRequestInput
  ): Promise<boolean> => false,
  queryMeditationStatus: async (
    _sessionId: string
  ): Promise<NativeMeditationSessionEvidence | null> => null,
  seedGroupAllowanceExhaustionForQa: async (
    _groupId: string,
    _packageName: string
  ): Promise<NativeQaExhaustionResult> => ({ enabled: false, error: 'native-module-unavailable' }),
};

let nativeModuleAvailable = false;
let nativeModuleLoadError: string | undefined;
let NativeModule: typeof FallbackModule = FallbackModule;

try {
  // Try loading Expo NativeModulesProxy if available
  const { requireNativeModule } = require('expo-modules-core');
  const mod = requireNativeModule('RhythmDevice');
  if (!mod) {
    throw new Error('RhythmDevice native module returned null');
  }
  nativeModuleAvailable = true;
  NativeModule = {
    ...FallbackModule,
    ...mod,
  };
} catch (error) {
  nativeModuleLoadError = error instanceof Error ? error.message : String(error);
}

/**
 * Explicit source-of-truth diagnostic: did JS reach the real native module?
 * QA surfaces must show `AVAILABLE` before enforcement can ever be READY.
 */
export function getRhythmNativeModuleDiagnostics(): RhythmNativeModuleDiagnostics {
  return {
    available: nativeModuleAvailable,
    source: nativeModuleAvailable ? 'native' : 'fallback',
    ...(nativeModuleLoadError ? { loadError: nativeModuleLoadError } : {}),
  };
}

const loadedNativeEnforcementDiagnostics = NativeModule.getEnforcementDiagnostics;
NativeModule = {
  ...NativeModule,
  getEnforcementDiagnostics: async () => {
    const base = await loadedNativeEnforcementDiagnostics();
    return { ...base, nativeModuleAvailable: nativeModuleAvailable };
  },
};

export const isRhythmNativeModuleAvailable = nativeModuleAvailable;
export default NativeModule;
