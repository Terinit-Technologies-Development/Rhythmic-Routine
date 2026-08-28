import { StorageProvider } from '../../platform/StorageProvider';
import { RoutineWindow } from '../../types/domain';
import { aggregateDailySummary, getLocalDateKey } from './aggregateDaily';
import { aggregateWeeklySummary } from './aggregateWeekly';
import { compactDailySummaries, compactRawEvents } from './compaction';
import { DailyRhythmSummary, InsightsRepository, WeeklyRhythmSummary } from './types';

export class LocalInsightsRepository implements InsightsRepository {
  private storage: StorageProvider;
  private routineWindows: RoutineWindow[];
  private summariesCache: Map<string, DailyRhythmSummary> = new Map();

  constructor(storage: StorageProvider, routineWindows: RoutineWindow[] = []) {
    this.storage = storage;
    this.routineWindows = routineWindows;
  }

  public updateRoutineWindows(windows: RoutineWindow[]): void {
    this.routineWindows = [...windows];
  }

  async getDailySummary(dateKey: string): Promise<DailyRhythmSummary | null> {
    if (this.summariesCache.has(dateKey)) {
      return this.summariesCache.get(dateKey)!;
    }

    const events = await this.storage.getHistoryEvents(1000);
    const summary = aggregateDailySummary(events, dateKey, this.routineWindows);
    this.summariesCache.set(dateKey, summary);
    return summary;
  }

  async getRecentDailySummaries(days: number = 7): Promise<DailyRhythmSummary[]> {
    const events = await this.storage.getHistoryEvents(2000);
    const summaries: DailyRhythmSummary[] = [];
    const now = Date.now();

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now - i * 24 * 60 * 60 * 1000);
      const dateKey = getLocalDateKey(d);
      const summary = aggregateDailySummary(events, dateKey, this.routineWindows);
      summaries.push(summary);
      this.summariesCache.set(dateKey, summary);
    }

    return summaries;
  }

  async getWeeklySummary(endDateKey?: string): Promise<WeeklyRhythmSummary> {
    const targetEndKey = endDateKey || getLocalDateKey();
    const recentSummaries = await this.getRecentDailySummaries(7);
    return aggregateWeeklySummary(recentSummaries, targetEndKey);
  }

  async saveDailySummary(summary: DailyRhythmSummary): Promise<void> {
    this.summariesCache.set(summary.dateKey, summary);
  }

  async compactHistory(rawRetentionDays: number = 14, summaryRetentionDays: number = 90): Promise<void> {
    const events = await this.storage.getHistoryEvents(5000);
    compactRawEvents(events, rawRetentionDays);

    const summaries = Array.from(this.summariesCache.values());
    const compactedSummaries = compactDailySummaries(summaries, summaryRetentionDays);

    this.summariesCache.clear();
    for (const s of compactedSummaries) {
      this.summariesCache.set(s.dateKey, s);
    }
  }
}
