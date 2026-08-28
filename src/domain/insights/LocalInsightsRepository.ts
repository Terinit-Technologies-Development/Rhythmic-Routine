import { StorageProvider } from '../../platform/StorageProvider';
import { RoutineWindow } from '../../types/domain';
import { aggregateDailySummary, getLocalDateKey } from './aggregateDaily';
import { aggregateWeeklySummary } from './aggregateWeekly';
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

    const todayKey = getLocalDateKey();

    // Check persistent storage for past completed days
    if (dateKey < todayKey && this.storage.loadDailySummary) {
      const persisted = await this.storage.loadDailySummary(dateKey);
      if (persisted) {
        this.summariesCache.set(dateKey, persisted);
        return persisted;
      }
    }

    const events = await this.storage.getHistoryEvents(5000);
    const summary = aggregateDailySummary(events, dateKey, this.routineWindows);
    this.summariesCache.set(dateKey, summary);

    if (dateKey < todayKey && this.storage.saveDailySummary) {
      await this.storage.saveDailySummary(summary);
    }

    return summary;
  }

  async getRecentDailySummaries(days: number = 7): Promise<DailyRhythmSummary[]> {
    const todayKey = getLocalDateKey();
    const now = Date.now();
    const startDateKey = getLocalDateKey(now - (days - 1) * 24 * 60 * 60 * 1000);

    // Try loading persisted daily summaries from storage
    const persistedList = this.storage.loadDailySummaries
      ? await this.storage.loadDailySummaries(startDateKey, todayKey)
      : [];
    const persistedMap = new Map<string, DailyRhythmSummary>();
    for (const s of persistedList) {
      persistedMap.set(s.dateKey, s);
    }

    const events = await this.storage.getHistoryEvents(5000);
    const summaries: DailyRhythmSummary[] = [];

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now - i * 24 * 60 * 60 * 1000);
      const dateKey = getLocalDateKey(d);

      // If it's a past completed day and we have a persisted summary, use it
      if (dateKey < todayKey && persistedMap.has(dateKey)) {
        const summary = persistedMap.get(dateKey)!;
        summaries.push(summary);
        this.summariesCache.set(dateKey, summary);
        continue;
      }

      // Otherwise compute from raw events
      const summary = aggregateDailySummary(events, dateKey, this.routineWindows);
      summaries.push(summary);
      this.summariesCache.set(dateKey, summary);

      // If it's a past day, persist the calculated summary
      if (dateKey < todayKey && this.storage.saveDailySummary) {
        await this.storage.saveDailySummary(summary);
      }
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
    if (this.storage.saveDailySummary) {
      await this.storage.saveDailySummary(summary);
    }
  }

  async compactHistory(rawRetentionDays: number = 14, summaryRetentionDays: number = 90): Promise<void> {
    const todayKey = getLocalDateKey();
    const events = await this.storage.getHistoryEvents(10000);

    // Group raw events by completed date and ensure each completed date has a persisted summary
    const completedDateKeys = new Set<string>();
    for (const event of events) {
      const dKey = getLocalDateKey(event.timestamp);
      if (dKey < todayKey) {
        completedDateKeys.add(dKey);
      }
    }

    for (const dKey of completedDateKeys) {
      const existing = this.storage.loadDailySummary ? await this.storage.loadDailySummary(dKey) : null;
      if (!existing) {
        const summary = aggregateDailySummary(events, dKey, this.routineWindows);
        if (this.storage.saveDailySummary) {
          await this.storage.saveDailySummary(summary);
        }
      }
    }

    // 14-day raw event pruning: delete events older than 14 days
    const rawCutoff = Date.now() - rawRetentionDays * 24 * 60 * 60 * 1000;
    if (this.storage.deleteHistoryEventsBefore) {
      await this.storage.deleteHistoryEventsBefore(rawCutoff);
    }

    // 90-day daily summary pruning: delete summaries older than 90 days
    const summaryCutoffKey = getLocalDateKey(Date.now() - summaryRetentionDays * 24 * 60 * 60 * 1000);
    if (this.storage.deleteDailySummariesBefore) {
      await this.storage.deleteDailySummariesBefore(summaryCutoffKey);
    }

    this.summariesCache.clear();
  }
}
