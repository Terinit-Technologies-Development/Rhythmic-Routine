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
  sessionThresholdMinutes: number; // e.g. 30
  cooldownMinutes: number;         // e.g. 90
  currentSessionMinutes: number;
  isBufferingToday?: boolean;
  nativeSelectionRef?: string;     // Reference to native iOS FamilyActivitySelection
  nativeSelectionCount?: number;   // Number of selections configured in FamilyActivitySelection
  nativeSelectionRevision?: number; // Monotonically increasing revision of the selection content
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
