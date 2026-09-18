export type AppClassification =
  | 'essential'
  | 'normal'
  | 'risk'
  | 'unclassified';

export type RhythmState =
  | 'morning-buffer'
  | 'overnight-protected'
  | 'available'
  | 'risk-session'
  | 'cooldown'
  | 'evening-wind-down';

export const DEFAULT_DAILY_RISK_ALLOWANCE_MINUTES = 30;
export const DAILY_ALLOWANCE_STEP_MINUTES = 15;
export const MIN_DAILY_RISK_ALLOWANCE_MINUTES = 0;

/** v1.0.2: Risk Group owns the single shared allowance (minutes). Aliases kept in group terminology. */
export const DEFAULT_GROUP_ALLOWANCE_MINUTES = DEFAULT_DAILY_RISK_ALLOWANCE_MINUTES;
export const GROUP_ALLOWANCE_STEP_MINUTES = DAILY_ALLOWANCE_STEP_MINUTES;
export const MIN_GROUP_ALLOWANCE_MINUTES = MIN_DAILY_RISK_ALLOWANCE_MINUTES;
/** Default recovery activity for migrated/new groups without a selection (OfflineActivity catalog id). */
export const DEFAULT_RECOVERY_ACTIVITY_ID = 'walk';

/**
 * @deprecated v1.0.2: per-app allowance is removed from runtime ownership.
 * Retained for idempotent migration reads only. Do not write new values.
 * Exists ONLY for reading v1.0.1 persisted JSON during migration.
 */
export interface DailyRiskAllowancePolicy {
  allowanceMinutes: number;
  lastEditedDateKey?: string;
}

export interface DailyAppUsage {
  appId: string;
  dateKey: string;
  usedSeconds: number;
  activeSegmentStartedAt?: number;
  exhaustedAt?: number;
}

export interface DailyUsageAppSnapshot {
  packageName: string;
  usedSeconds: number;
  allowanceMinutes: number;
  remainingSeconds: number;
  exhausted: boolean;
  activeSegmentStartedAt?: number;
}

export interface DailyUsageSnapshot {
  dateKey: string;
  apps: DailyUsageAppSnapshot[];
  lastReconciledAt?: number;
}

export interface NativeSelectionReference {
  id: string;
  platform: 'ios';
  kind: 'applications' | 'categories' | 'mixed';
  itemCount?: number;
}

export interface DeviceApp {
  id: string;
  name: string;
  classification: AppClassification;
  riskGroupId?: string;
  /**
   * @deprecated v1.0.2: removed from runtime ownership. RiskGroup.allowanceMinutes
   * is the sole allowance policy. Retained as optional for idempotent migration
   * reads of persisted v1.0.1 state only; runtime code must not derive policy from it.
   * Exists ONLY for reading v1.0.1 persisted JSON during migration.
   */
  dailyRiskAllowance?: DailyRiskAllowancePolicy;
  iconName: string;
  iconColor: string;
  iconBg: string;
  defaultCategory: string;
  usageTodayMinutes: number;
  sessionMinutes: number;
}

export interface RiskGroup {
  id: string;
  name: string;
  description: string;
  iconName: string;
  iconColor: string;
  iconBg: string;
  appIds: string[];
  /**
   * v1.0.2: the single shared allowance for this group (minutes). Every member
   * app consumes the same pool. Optional during the v1.0.1→v1.0.2 transition so
   * legacy fixtures still compile; resolve at runtime via
   * resolveGroupAllowanceMinutes() — migration/bootstrap always materialize it.
   */
  allowanceMinutes?: number;
  /** v1.0.2: one successful allowance edit per group per local day. */
  lastAllowanceEditedDateKey?: string;
  /**
   * v1.0.2: recovery activity reference into the local OfflineActivity catalog.
   * Optional during transition; migration/bootstrap default it to 'walk'.
   */
  recoveryActivityId?: string;
  /**
   * @deprecated v1.0.2: legacy v1.0.1 threshold concept, consolidated into
   * allowanceMinutes. Retained as optional for migration reads and legacy
   * fixtures only; never treat as a second active policy.
   * Exists ONLY for reading v1.0.1 persisted JSON during migration.
   */
  sessionThresholdMinutes?: number; // e.g. 30
  cooldownMinutes: number;         // e.g. 90
  currentSessionMinutes: number;
  isBufferingToday?: boolean;
  nativeSelectionRef?: string;     // Reference to native iOS FamilyActivitySelection
  nativeSelectionCount?: number;   // Number of selections configured in FamilyActivitySelection
  nativeSelectionRevision?: number; // Monotonically increasing revision of the selection content
  /** v1.1.0: tracks whether the risk group is seeded (starter) or custom (user-created). */
  origin?: 'seeded' | 'custom';
}

export type RiskGroupOrigin = 'seeded' | 'custom';

export interface CreateRiskGroupInput {
  name: string;
  description?: string;
  allowanceMinutes?: number;
  cooldownMinutes?: number;
}

export interface RiskGroupConfigurationDraft {
  name: string;
  description: string;
  allowanceMinutes: number;
  cooldownMinutes: number;
  recoveryActivityId: string;
  morningProtected: boolean;
  eveningProtected: boolean;
}

export type SaveRiskGroupResult =
  | { ok: true; groupId: string }
  | {
      ok: false;
      groupId: string;
      reason:
        | 'group-not-found'
        | 'name-required'
        | 'already-edited-today'
        | 'increase-too-large'
        | 'invalid-step'
        | 'below-minimum'
        | 'persistence-failed'
        | 'unavailable';
    };

export type RiskGroupPatch = Partial<
  Pick<
    RiskGroup,
    'name' | 'description' | 'allowanceMinutes' | 'cooldownMinutes' | 'recoveryActivityId'
  >
>;

export type DeleteRiskGroupResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'group-not-found'
        | 'cannot-delete-seeded-group'
        | 'replacement-required'
        | 'invalid-replacement-group'
        | 'active-runtime';
    };

/**
 * v1.0.2: one runtime usage record per Risk Group (not per app).
 */
export interface GroupAllowanceUsage {
  groupId: string;
  dateKey: string;
  usedSeconds: number;
  activePackageName?: string;
  activeSegmentStartedAt?: number;
  exhaustedAt?: number;
  cycleRevision: number;
}

/**
 * v1.0.2: point-in-time view of a group's allowance cycle for UI/sync.
 */
export interface GroupAllowanceSnapshot {
  groupId: string;
  dateKey: string;
  usedSeconds: number;
  allowanceMinutes: number;
  remainingSeconds: number;
  exhausted: boolean;
  cooldownEndsAt?: number;
}

export interface RoutineWindow {
  id: string;
  name: string;
  type: 'morning-buffer' | 'open-day' | 'evening-wind-down' | 'custom';
  startTime: string; // e.g. "06:30"
  endTime?: string;  // e.g. "08:00"
  activeDays: number[]; // 1=Mon, 2=Tue, ..., 7=Sun
  protectedGroupIds: string[];
  enabled: boolean;
  tagline: string;
  description: string;
}

export interface AppUsageSnapshot {
  appId: string;
  timestamp: number;
  durationMinutes: number;
  sessionActive: boolean;
}

export interface OfflineActivity {
  id: string;
  title: string;
  subtitle: string;
  iconEmoji: string;
  category: 'grounding' | 'movement' | 'mind' | 'nature';
  durationSuggestion?: string;
}

export interface DailyTrendPoint {
  day: string;
  protectedMinutes: number;
  riskMinutes: number;
}

export interface InsightMetrics {
  protectedTimeTodayMinutes: number;
  protectedTimeWeeklyHours: number;
  averageRiskSessionMinutes: number;
  cooldownTriggersCount: number;
  firstRiskAppUseTime: string;
  finalRiskAppUseTime: string;
  weeklyTrend: DailyTrendPoint[];
}

export const EMERGENCY_ACCESS_MINUTES = 5;

export interface AccessLeasePolicy {
  defaultMinutes: number;
  minimumMinutes: number;
  nativeExpiryGuaranteed: boolean;
}

export function getPlatformAccessLeasePolicy(platform: string = 'default'): AccessLeasePolicy {
  if (platform === 'ios') {
    return {
      defaultMinutes: 15,
      minimumMinutes: 15,
      nativeExpiryGuaranteed: true,
    };
  }
  return {
    defaultMinutes: 5,
    minimumMinutes: 1,
    nativeExpiryGuaranteed: true,
  };
}

export interface AccessLease {
  id: string;
  groupId: string;
  startedAt: number;
  endsAt: number;
  reason: 'emergency' | 'intentional';
}
