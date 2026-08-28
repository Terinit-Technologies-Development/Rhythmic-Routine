import {
  PersistedRuntime,
  RhythmHistoryEvent,
  RhythmPreferences,
} from '../../domain/rhythm/types';
import { StorageProvider } from '../StorageProvider';

const PREFERENCES_KEY = 'rhythmic_routine_preferences_v1';
const RUNTIME_KEY = 'rhythmic_routine_runtime_v1';
const HISTORY_KEY = 'rhythmic_routine_history_v1';

export class LocalStorageProvider implements StorageProvider {
  private memoryFallback: Map<string, string> = new Map();

  private getItem(key: string): string | null {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage.getItem(key);
      }
    } catch {
      // Fallback if localStorage is inaccessible
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
      // Fallback if localStorage is inaccessible
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
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async saveRuntime(runtime: PersistedRuntime): Promise<void> {
    this.setItem(RUNTIME_KEY, JSON.stringify(runtime));
  }

  async appendHistoryEvent(event: RhythmHistoryEvent): Promise<void> {
    const events = await this.getHistoryEvents(100);
    events.push(event);
    this.setItem(HISTORY_KEY, JSON.stringify(events.slice(-100)));
  }

  async getHistoryEvents(limit: number = 50): Promise<RhythmHistoryEvent[]> {
    const raw = this.getItem(HISTORY_KEY);
    if (!raw) return [];
    try {
      const parsed: RhythmHistoryEvent[] = JSON.parse(raw);
      return parsed.slice(-limit);
    } catch {
      return [];
    }
  }

  async clearAll(): Promise<void> {
    this.removeItem(PREFERENCES_KEY);
    this.removeItem(RUNTIME_KEY);
    this.removeItem(HISTORY_KEY);
    this.memoryFallback.clear();
  }
}
