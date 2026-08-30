export type InsightSource =
  | 'android-observed'
  | 'ios-device-activity'
  | 'local-engine'
  | 'demo';

export type InsightConfidence = 'exact' | 'system-derived' | 'estimated';

export interface InsightMetric<T> {
  value: T;
  source: InsightSource;
  confidence: InsightConfidence;
}

export interface DailyRhythmSummary {
  dateKey: string; // YYYY-MM-DD local wall-clock date
  scheduledRoutineMinutes: number;
  observedProtectedMinutes: number;
  riskUsageSecondsByGroup: Record<string, number>;
  sessionCountByGroup: Record<string, number>;
  cooldownCountByGroup: Record<string, number>;
  cooldownMinutesByGroup: Record<string, number>;
  accessLeaseCount: number;
  longestRiskSessionSeconds: number;
  firstRiskAppUseTime?: string;
  finalRiskAppUseTime?: string;
}

export interface DailyTrendSummaryPoint {
  day: string; // e.g. "Mon"
  dateKey: string; // "2026-08-31"
  protectedMinutes: number;
  riskMinutes: number;
}

export interface WeeklyRhythmSummary {
  startDateKey: string;
  endDateKey: string;
  totalProtectedMinutes: number;
  scheduledRoutineMinutes: number;
  totalRiskUsageMinutes: number;
  averageRiskSessionMinutes: number;
  totalCooldownCount: number;
  routineConsistencyScore: number; // 0 - 100%
  groupUsageMinutes: Record<string, number>;
  dailyTrend: DailyTrendSummaryPoint[];
  hasData: boolean;
}

export interface InsightsRepository {
  getDailySummary(dateKey: string): Promise<DailyRhythmSummary | null>;
  getRecentDailySummaries(days: number): Promise<DailyRhythmSummary[]>;
  getWeeklySummary(endDateKey?: string): Promise<WeeklyRhythmSummary>;
  saveDailySummary(summary: DailyRhythmSummary): Promise<void>;
  compactHistory(rawEventRetentionDays?: number, summaryRetentionDays?: number): Promise<void>;
}
