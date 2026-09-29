/**
 * Truth about how the JS side reached the native layer. The device must report
 * `available: true` / `source: 'native'` before enforcement can ever be called
 * READY — a fallback shim must never be presented as enforcement capable.
 */
export interface RhythmNativeModuleDiagnostics {
  available: boolean;
  source: 'native' | 'fallback';
  /** Bounded load-failure reason for QA diagnostics (never a stack trace). */
  loadError?: string;
}

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

export interface StagedSelectionResult {
  stagedSelectionRef: string;
  tokenCount: number;
}

export interface CommitSelectionResult {
  success: boolean;
  revision: number;
  localSelectionId?: string;
  rollbackRef?: string;
  previousRevision?: number;
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
  cooldownEndsAt?: number;
  cycleRevision: number;
}

export interface NativeReadingAttentionPolicyInput {
  freeCooldownCount: number;
  baselineActiveSeconds: number;
  baselineQualifiedPages: number;
  incrementalActiveSeconds: number;
  incrementalQualifiedPages: number;
}

export interface NativeDailyAttentionExchangeState {
  dateKey: string;
  cooldownsTriggered: number;
  highestRequiredActiveSeconds: number;
  highestRequiredQualifiedPages: number;
  updatedAt: number;
}

export interface NativeReadingGateInput {
  groupId: string;
  attentionDateKey: string;
  dailyCooldownOrdinal: number;
  createdAt: number;
  cooldownEndsAt: number;
  requiredReadingSeconds: number;
  requiredQualifiedPages: number;
}

export interface NativeCooldownPolicyInput {
  groupId: string;
  packageNames: string[];
  startedAt?: number;
  endsAt: number;
  attentionDateKey?: string;
  dailyCooldownOrdinal?: number;
  requiredReadingSeconds?: number;
  requiredQualifiedPages?: number;
}

/**
 * Pass 3 — Restorative Gate projection (additive; v1.2 native code ignores it).
 * Only policy data is shared — never private meditation history.
 */
export interface NativeRestorativeGateInput {
  gateId: string;
  groupId: string;
  attentionDayId: string;
  dailyCooldownOrdinal: number;
  createdAt: number;
  cooldownEndsAt: number;
  requirementKind: 'none' | 'baseline-reading' | 'restorative-choice' | 'legacy-reading';
  selectedProvider: 'reader' | 'meditation' | null;
  providerSessionId: string | null;
  status: 'pending-selection' | 'in-progress' | 'satisfied';
  requiredReadingSeconds: number | null;
  requiredQualifiedPages: number | null;
  requiredMeditationSeconds: number | null;
}

export interface NativeAttentionDayInput {
  id: string;
  startedAt: number;
  nextBoundaryAt: number;
}

export interface NativeMorningMeditationInput {
  attentionDayId: string;
  sessionId: string;
  requiredQualifiedSeconds: number;
  satisfied: boolean;
}

export interface NativeAttentionExchangeSnapshot {
  attentionStateInitialized: boolean;
  dateKey: string;
  cooldownsTriggered: number;
  highestRequiredActiveSeconds: number;
  highestRequiredQualifiedPages: number;
  cooldowns: NativeCooldownPolicyInput[];
  readingGates: NativeReadingGateInput[];
  groupUsage: NativeGroupAllowanceSnapshot[];
  activeAccessLeases: { groupId: string; packageNames: string[]; endsAt: number }[];
  foregroundGroupId?: string;
  evidence?: NativeDailyReadingEvidence;
  updatedAt: number;
  /** Pass 3 fields (optional: older native builds omit them). */
  attentionDay?: NativeAttentionDayInput | null;
  activeRestorativeGates?: NativeRestorativeGateInput[];
  morningMeditation?: NativeMorningMeditationInput | null;
  officialCompanionPackages?: string[];
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
  nextMidnightRolloverAt?: number;
  dailyUsageAppCount?: number;
  lastUsageReconciledAt?: number;
  lastUsageAccountedAt?: number;
  attentionDateKey?: string;
  dailyCooldownOrdinal?: number;
  readingGateCount?: number;
  activeReadingGateGroupId?: string;
  activeReadingGateOrdinal?: number;
  activeReadingRequiredSeconds?: number;
  activeReadingRequiredPages?: number;
  readerProviderAvailable?: boolean;
  readerProtocolCompatible?: boolean;
  /** Whether the JS side reached this data through the real native module. */
  nativeModuleAvailable?: boolean;
  /** Native policy projection proof (blocker remediation). */
  riskPolicyCount?: number;
  riskPackageCount?: number;
  routineRiskPackageCount?: number;
  /** Bounded sample for QA builds; never the full installed-app inventory. */
  riskPackageSample?: string[];
}

/**
 * QA-only result of the production-equivalent allowance-exhaustion trigger.
 * The trigger seeds the usage ledger boundary and re-enters the production
 * transition; every policy outcome below is READ BACK from what production
 * allocated — never constructed by the hook itself.
 */
export interface NativeQaExhaustionResult {
  enabled: boolean;
  error?: string;
  groupId?: string;
  seededUsedMillis?: number;
  productionTransition?: string;
  cooldownCreated?: boolean;
  cooldownEndsAt?: number;
  dailyCooldownOrdinal?: number;
  attentionDateKey?: string;
  requiredReadingSeconds?: number;
  requiredQualifiedPages?: number;
  attentionCooldownsTriggered?: number;
}

export interface NativeRecoveryStatus {
  sessionId: string;
  protocolVersion: number;
  status: 'ACTIVE' | 'COMPLETE' | 'ABANDONED' | 'EXPIRED' | string;
  activeSeconds: number;
  qualifiedPages: number;
  completedAtEpochMs: number;
}

export interface NativeDailyReadingEvidence {
  providerAvailable: boolean;
  protocolCompatible: boolean;
  protocolVersion?: number;
  dateKey: string;
  verifiedActiveSeconds: number;
  qualifiedPages: number;
  updatedAtEpochMs: number;
}

export type NativeMeditationAvailability =
  | 'available'
  | 'not-installed'
  | 'untrusted-signature'
  | 'protocol-incompatible'
  | 'unavailable';

/** Durable session row returned by the Meditation status provider (protocol v1). */
export interface NativeMeditationSessionEvidence {
  sessionId: string;
  protocolVersion: number;
  status: 'PENDING' | 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED' | 'INVALID' | string;
  requiredQualifiedSeconds: number;
  completedQualifiedSeconds: number;
  completedAtEpochMs: number | null;
  lastUpdatedAtEpochMs: number | null;
}

/** Recovery request fields written into the Meditation Intent payload Bundle. */
export interface NativeMeditationRecoveryRequestInput {
  session_id: string;
  protocol_version: number;
  session_kind: 'MORNING_REQUIRED' | 'COOLDOWN_RESTORATIVE';
  required_qualified_seconds: number;
  created_at_epoch_ms: number;
  expires_at_epoch_ms?: number;
  source_cooldown_id?: string;
  source_risk_group_id?: string;
  source_rhythmic_day_id?: string;
}

