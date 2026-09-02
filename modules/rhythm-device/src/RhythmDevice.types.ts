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

export interface NativeDailyAppSnapshot {
  packageName: string;
  usedSeconds: number;
  allowanceMinutes: number;
  remainingSeconds: number;
  exhausted: boolean;
  activeSegmentStartedAt?: number;
}

export interface NativeDailyUsageSnapshot {
  dateKey: string;
  apps: NativeDailyAppSnapshot[];
  lastReconciledAt?: number;
}

export interface NativeDailyAllowancePolicyInput {
  packageName: string;
  allowanceMinutes: number;
}

export interface NativeRoutineWindowInput {
  id: string;
  startTime: string;
  endTime?: string;
  activeDays: number[];
  protectedPackages: string[];
  enabled: boolean;
}

export interface NativeEnforcementDiagnostics {
  serviceRunning: boolean;
  baseRestrictedPackageCount: number;
  activeLeaseCount: number;
  routineWindowCount?: number;
  lastForegroundPackage?: string;
  lastInterventionPackage?: string;
  lastInterventionAt?: number;
  overlayVisible: boolean;
  activeUsagePackage?: string;
  activeUsageStartedAt?: number;
  allowanceDeadlineAt?: number;
  nextRoutineBoundaryAt?: number;
  dailyUsageAppCount?: number;
  lastUsageReconciledAt?: number;
  lastUsageAccountedAt?: number;
}
