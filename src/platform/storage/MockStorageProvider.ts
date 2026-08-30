import {
  PersistedRuntime,
  RhythmHistoryEvent,
  RhythmPreferences,
  normalizePersistedRuntime,
} from '../../domain/rhythm/types';
import { DailyRhythmSummary } from '../../domain/insights/types';
import { StorageProvider } from '../StorageProvider';

export class MockStorageProvider implements StorageProvider {
  private preferences: RhythmPreferences | null = null;
  private runtime: PersistedRuntime | null = null;
  private history: RhythmHistoryEvent[] = [];
  private summaries: Map<string, DailyRhythmSummary> = new Map();

  constructor(
    initialPreferences?: RhythmPreferences | null,
    initialRuntime?: any | null
  ) {
    this.preferences = initialPreferences || null;
    this.runtime = initialRuntime ? normalizePersistedRuntime(initialRuntime) : null;
  }

  async loadPreferences(): Promise<RhythmPreferences | null> {
    return this.preferences ? { ...this.preferences } : null;
  }

  async savePreferences(preferences: RhythmPreferences): Promise<void> {
    this.preferences = { ...preferences };
  }

  async loadRuntime(): Promise<PersistedRuntime | null> {
    return this.runtime ? normalizePersistedRuntime(this.runtime) : null;
  }

  async saveRuntime(runtime: PersistedRuntime): Promise<void> {
    this.runtime = { ...runtime };
  }

  async appendHistoryEvent(event: RhythmHistoryEvent): Promise<void> {
    this.history.push({ ...event });
  }

  async getHistoryEvents(limit: number = 2000): Promise<RhythmHistoryEvent[]> {
    return this.history.slice(-limit);
  }

  async getHistoryEventsSince(timestamp: number): Promise<RhythmHistoryEvent[]> {
    return this.history.filter((e) => e.timestamp >= timestamp);
  }

  async deleteHistoryEventsBefore(timestamp: number): Promise<void> {
    this.history = this.history.filter((e) => e.timestamp >= timestamp);
  }

  async saveDailySummary(summary: DailyRhythmSummary): Promise<void> {
    this.summaries.set(summary.dateKey, { ...summary });
  }

  async loadDailySummary(dateKey: string): Promise<DailyRhythmSummary | null> {
    const summary = this.summaries.get(dateKey);
    return summary ? { ...summary } : null;
  }

  async loadDailySummaries(startDateKey: string, endDateKey: string): Promise<DailyRhythmSummary[]> {
    const result: DailyRhythmSummary[] = [];
    for (const [key, summary] of this.summaries.entries()) {
      if (key >= startDateKey && key <= endDateKey) {
        result.push({ ...summary });
      }
    }
    return result.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  }

  async deleteDailySummariesBefore(dateKey: string): Promise<void> {
    for (const key of Array.from(this.summaries.keys())) {
      if (key < dateKey) {
        this.summaries.delete(key);
      }
    }
  }

  async clearAll(): Promise<void> {
    this.preferences = null;
    this.runtime = null;
    this.history = [];
    this.summaries.clear();
  }
}
