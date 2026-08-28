import {
  PersistedRuntime,
  RhythmHistoryEvent,
  RhythmPreferences,
  normalizePersistedRuntime,
} from '../../domain/rhythm/types';
import { DailyRhythmSummary } from '../../domain/insights/types';
import { StorageProvider } from '../StorageProvider';

const PREFERENCES_KEY = 'rhythmic_routine_preferences_v1';
const RUNTIME_KEY = 'rhythmic_routine_runtime_v1';
const HISTORY_KEY = 'rhythmic_routine_history_v1';
const DAILY_SUMMARIES_KEY = 'rhythmic_routine_daily_summaries_v1';

export class WebStorageProvider implements StorageProvider {
  private memoryFallback: Map<string, string> = new Map();

  private getItem(key: string): string | null {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage.getItem(key);
      }
    } catch {
      // Fallback
    }
    return this.memoryFallback.get(key) || null;
  }

  private setItem(key: string, value: string): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(key, value);
        return;
      }
    } catch {
      // Fallback
    }
    this.memoryFallback.set(key, value);
  }

  private removeItem(key: string): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(key);
      }
    } catch {
      // Fallback
    }
    this.memoryFallback.delete(key);
  }

  async loadPreferences(): Promise<RhythmPreferences | null> {
    const raw = this.getItem(PREFERENCES_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async savePreferences(preferences: RhythmPreferences): Promise<void> {
    this.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  }

  async loadRuntime(): Promise<PersistedRuntime | null> {
    const raw = this.getItem(RUNTIME_KEY);
    if (!raw) return null;
    try {
      return normalizePersistedRuntime(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  async saveRuntime(runtime: PersistedRuntime): Promise<void> {
    this.setItem(RUNTIME_KEY, JSON.stringify(runtime));
  }

  async appendHistoryEvent(event: RhythmHistoryEvent): Promise<void> {
    const events = await this.getHistoryEvents(5000);
    events.push(event);
    this.setItem(HISTORY_KEY, JSON.stringify(events));
  }

  async getHistoryEvents(limit: number = 2000): Promise<RhythmHistoryEvent[]> {
    const raw = this.getItem(HISTORY_KEY);
    if (!raw) return [];
    try {
      const parsed: RhythmHistoryEvent[] = JSON.parse(raw);
      return parsed.slice(-limit);
    } catch {
      return [];
    }
  }

  async getHistoryEventsSince(timestamp: number): Promise<RhythmHistoryEvent[]> {
    const events = await this.getHistoryEvents(10000);
    return events.filter((e) => e.timestamp >= timestamp);
  }

  async deleteHistoryEventsBefore(timestamp: number): Promise<void> {
    const events = await this.getHistoryEvents(10000);
    const retained = events.filter((e) => e.timestamp >= timestamp);
    this.setItem(HISTORY_KEY, JSON.stringify(retained));
  }

  private loadSummariesMap(): Record<string, DailyRhythmSummary> {
    const raw = this.getItem(DAILY_SUMMARIES_KEY);
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  async saveDailySummary(summary: DailyRhythmSummary): Promise<void> {
    const map = this.loadSummariesMap();
    map[summary.dateKey] = summary;
    this.setItem(DAILY_SUMMARIES_KEY, JSON.stringify(map));
  }

  async loadDailySummary(dateKey: string): Promise<DailyRhythmSummary | null> {
    const map = this.loadSummariesMap();
    return map[dateKey] || null;
  }

  async loadDailySummaries(startDateKey: string, endDateKey: string): Promise<DailyRhythmSummary[]> {
    const map = this.loadSummariesMap();
    const result: DailyRhythmSummary[] = [];
    for (const [key, summary] of Object.entries(map)) {
      if (key >= startDateKey && key <= endDateKey) {
        result.push(summary);
      }
    }
    return result.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  }

  async deleteDailySummariesBefore(dateKey: string): Promise<void> {
    const map = this.loadSummariesMap();
    const filtered: Record<string, DailyRhythmSummary> = {};
    for (const [key, summary] of Object.entries(map)) {
      if (key >= dateKey) {
        filtered[key] = summary;
      }
    }
    this.setItem(DAILY_SUMMARIES_KEY, JSON.stringify(filtered));
  }

  async clearAll(): Promise<void> {
    this.removeItem(PREFERENCES_KEY);
    this.removeItem(RUNTIME_KEY);
    this.removeItem(HISTORY_KEY);
    this.removeItem(DAILY_SUMMARIES_KEY);
    this.memoryFallback.clear();
  }
}
