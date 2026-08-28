import Storage from 'expo-sqlite/kv-store';
import {
  PersistedRuntime,
  RhythmHistoryEvent,
  RhythmPreferences,
  normalizePersistedRuntime,
} from '../../domain/rhythm/types';
import { StorageProvider } from '../StorageProvider';

const PREFERENCES_KEY = 'rhythmic_routine_preferences_v1';
const RUNTIME_KEY = 'rhythmic_routine_runtime_v1';
const HISTORY_KEY = 'rhythmic_routine_history_v1';

export class NativeStorageProvider implements StorageProvider {
  async loadPreferences(): Promise<RhythmPreferences | null> {
    try {
      const raw = await Storage.getItem(PREFERENCES_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (err) {
      console.warn('[NativeStorageProvider] Failed to load preferences:', err);
      return null;
    }
  }

  async savePreferences(preferences: RhythmPreferences): Promise<void> {
    try {
      await Storage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
    } catch (err) {
      console.warn('[NativeStorageProvider] Failed to save preferences:', err);
      throw err;
    }
  }

  async loadRuntime(): Promise<PersistedRuntime | null> {
    try {
      const raw = await Storage.getItem(RUNTIME_KEY);
      if (!raw) return null;
      return normalizePersistedRuntime(JSON.parse(raw));
    } catch (err) {
      console.warn('[NativeStorageProvider] Failed to load runtime:', err);
      return null;
    }
  }

  async saveRuntime(runtime: PersistedRuntime): Promise<void> {
    try {
      await Storage.setItem(RUNTIME_KEY, JSON.stringify(runtime));
    } catch (err) {
      console.warn('[NativeStorageProvider] Failed to save runtime:', err);
      throw err;
    }
  }

  async appendHistoryEvent(event: RhythmHistoryEvent): Promise<void> {
    try {
      const events = await this.getHistoryEvents(100);
      events.push(event);
      await Storage.setItem(HISTORY_KEY, JSON.stringify(events.slice(-100)));
    } catch (err) {
      console.warn('[NativeStorageProvider] Failed to append history:', err);
    }
  }

  async getHistoryEvents(limit: number = 50): Promise<RhythmHistoryEvent[]> {
    try {
      const raw = await Storage.getItem(HISTORY_KEY);
      if (!raw) return [];
      const parsed: RhythmHistoryEvent[] = JSON.parse(raw);
      return parsed.slice(-limit);
    } catch (err) {
      console.warn('[NativeStorageProvider] Failed to read history:', err);
      return [];
    }
  }

  async clearAll(): Promise<void> {
    try {
      await Storage.removeItem(PREFERENCES_KEY);
      await Storage.removeItem(RUNTIME_KEY);
      await Storage.removeItem(HISTORY_KEY);
    } catch (err) {
      console.warn('[NativeStorageProvider] Failed to clear storage:', err);
    }
  }
}
