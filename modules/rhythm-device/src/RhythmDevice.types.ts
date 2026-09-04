export interface NativePermissionStatus {
  hasUsagePermission: boolean;
  hasRestrictionPermission: boolean;
  familyControlsStatus: 'unknown' | 'approved' | 'denied' | 'revoked' | 'unsupported';
  hasSelection?: boolean;
  shieldingOperational?: boolean;
  monitoringOperational?: boolean;
  persistentMonitoringOperational?: boolean;
  expiryMonitoringOperational?: boolean;
  lastMonitoringError?: string;
}

export interface NativeUsageEvent {
  packageName: string;
  timestamp: number;
  eventType: 'foreground' | 'background' | 'unknown';
}

export interface NativeAppInfo {
  packageName: string;
  appName: string;
  category?: string;
  iconUri?: string;
}

/**
 * Opaque reference for iOS FamilyActivitySelection tokens without exposing plaintext bundle IDs.
 */
export interface IOSSelectionReference {
  localSelectionId: string;
  tokenCount: number;
  revision?: number;
  kind: 'applications' | 'categories' | 'mixed';
}

export interface MonitoringSyncResult {
  success: boolean;
  persistentActivityCount: number;
  totalActivityCount: number;
  errorCode?: string;
  errorMessage?: string;
}

export interface MonitoringDiagnostics {
  activityCount: number;
  activityNames: string[];
  monitoringOperational: boolean;
  persistentMonitoringOperational: boolean;
  expiryMonitoringOperational: boolean;
  configSignature: string;
  lastError: string;
}

export interface NativeRecoveryActivity {
  id: string;
  title: string;
  subtitle: string;
  iconEmoji: string;
  durationSuggestion?: string;
}

export interface NativeRiskGroupPolicyInput {
  groupId: string;
  groupName: string;
  packageNames: string[];
  allowanceMinutes: number;
  cooldownMinutes: number;
  recoveryActivity: NativeRecoveryActivity;
}

export interface NativeGroupAllowanceSnapshot {
  groupId: string;
  dateKey: string;
  usedSeconds: number;
  allowanceMinutes: number;
  remainingSeconds: number;
  exhausted: boolean;
  activePackageName?: string;
  activeSegmentStartedAt?: number;
  exhaustedAt?: number;
  cycleRevision: number;
}

export interface NativeCooldownPolicyInput {
  groupId: string;
  packageNames: string[];
  endsAt: number;
}

export interface NativeRoutineWindowInput {
  id: string;
  type?: 'morning-buffer' | 'evening-wind-down';
  startTime: string;
  endTime?: string;
  activeDays: number[];
  protectedPackages: string[];
  enabled: boolean;
}

export interface NativeRoutineScheduleInput {
  windows: NativeRoutineWindowInput[];
  allRiskPackages: string[];
}

export interface NativeEnforcementDiagnostics {
  serviceRunning: boolean;
  baseRestrictedPackageCount: number;
  activeLeaseCount: number;
  cooldownCount?: number;
  nearestCooldownExpiryAt?: number;
  routineWindowCount?: number;
  lastForegroundPackage?: string;
  lastInterventionPackage?: string;
  lastInterventionAt?: number;
  overlayVisible: boolean;
  activeGroupId?: string;
  activeGroupUsageStartedAt?: number;
  activeUsagePackage?: string;
  activeUsageStartedAt?: number;
  allowanceDeadlineAt?: number;
  nextRoutineBoundaryAt?: number;
  dailyUsageAppCount?: number;
  lastUsageReconciledAt?: number;
  lastUsageAccountedAt?: number;
}
