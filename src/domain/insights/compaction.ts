import { RhythmHistoryEvent } from '../rhythm/types';
import { DailyRhythmSummary } from './types';
import { getLocalDateKey } from './aggregateDaily';

export const RAW_EVENT_RETENTION_DAYS = 14;
export const DAILY_SUMMARY_RETENTION_DAYS = 90;

/**
 * Pure compaction for raw events: retains only events within retention window.
 */
export function compactRawEvents(
  events: RhythmHistoryEvent[],
  retentionDays: number = RAW_EVENT_RETENTION_DAYS,
  now: number = Date.now()
): RhythmHistoryEvent[] {
  const cutoffTimestamp = now - retentionDays * 24 * 60 * 60 * 1000;
  return events.filter((e) => e.timestamp >= cutoffTimestamp);
}

/**
 * Pure compaction for daily summaries: retains only summaries within 90-day retention window.
 */
export function compactDailySummaries(
  summaries: DailyRhythmSummary[],
  retentionDays: number = DAILY_SUMMARY_RETENTION_DAYS,
  now: number = Date.now()
): DailyRhythmSummary[] {
  const cutoffDateKey = getLocalDateKey(now - retentionDays * 24 * 60 * 60 * 1000);
  return summaries.filter((s) => s.dateKey >= cutoffDateKey);
}
