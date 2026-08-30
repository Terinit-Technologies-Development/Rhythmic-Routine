import Storage from 'expo-sqlite/kv-store';
import * as SQLite from 'expo-sqlite';
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

export class NativeStorageProvider implements StorageProvider {
  private dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

  private async getDb(): Promise<SQLite.SQLiteDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = (async () => {
        const db = await SQLite.openDatabaseAsync('rhythm.db');
        await db.execAsync(`
          CREATE TABLE IF NOT EXISTS rhythm_history (
            id TEXT PRIMARY KEY NOT NULL,
            event_type TEXT NOT NULL,
            group_id TEXT,
            timestamp INTEGER NOT NULL,
            payload_json TEXT NOT NULL
          );

          CREATE INDEX IF NOT EXISTS idx_rhythm_history_timestamp
          ON rhythm_history(timestamp);

          CREATE TABLE IF NOT EXISTS rhythm_daily_summary (
            date_key TEXT PRIMARY KEY NOT NULL,
            summary_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL
          );
        `);
        return db;
      })();
    }
    return this.dbPromise;
  }

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
      const db = await this.getDb();
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const groupId = 'groupId' in event ? (event as any).groupId : null;
      await db.runAsync(
        'INSERT INTO rhythm_history (id, event_type, group_id, timestamp, payload_json) VALUES (?, ?, ?, ?, ?)',
        [id, event.type, groupId, event.timestamp, JSON.stringify(event)]
      );
    } catch (err) {
      console.warn('[NativeStorageProvider] Failed to append history event:', err);
    }
  }

  async getHistoryEvents(limit: number = 2000): Promise<RhythmHistoryEvent[]> {
    try {
      const db = await this.getDb();
      const rows = await db.getAllAsync<{ payload_json: string }>(
        'SELECT payload_json FROM rhythm_history ORDER BY timestamp ASC LIMIT ?',
        [limit]
      );
      return rows.map((r) => JSON.parse(r.payload_json));
    } catch (err) {
      console.warn('[NativeStorageProvider] Failed to get history events:', err);
      return [];
    }
  }

  async getHistoryEventsSince(timestamp: number): Promise<RhythmHistoryEvent[]> {
    try {
      const db = await this.getDb();
      const rows = await db.getAllAsync<{ payload_json: string }>(
        'SELECT payload_json FROM rhythm_history WHERE timestamp >= ? ORDER BY timestamp ASC',
        [timestamp]
      );
      return rows.map((r) => JSON.parse(r.payload_json));
    } catch (err) {
      console.warn('[NativeStorageProvider] Failed to get history events since:', err);
      return [];
    }
  }

  async deleteHistoryEventsBefore(timestamp: number): Promise<void> {
    try {
      const db = await this.getDb();
      await db.runAsync('DELETE FROM rhythm_history WHERE timestamp < ?', [timestamp]);
    } catch (err) {
      console.warn('[NativeStorageProvider] Failed to delete history events before:', err);
    }
  }

  async saveDailySummary(summary: DailyRhythmSummary): Promise<void> {
    try {
      const db = await this.getDb();
      const now = Date.now();
      await db.runAsync(
        'INSERT OR REPLACE INTO rhythm_daily_summary (date_key, summary_json, updated_at) VALUES (?, ?, ?)',
        [summary.dateKey, JSON.stringify(summary), now]
      );
    } catch (err) {
      console.warn('[NativeStorageProvider] Failed to save daily summary:', err);
    }
  }

  async loadDailySummary(dateKey: string): Promise<DailyRhythmSummary | null> {
    try {
      const db = await this.getDb();
      const row = await db.getFirstAsync<{ summary_json: string }>(
        'SELECT summary_json FROM rhythm_daily_summary WHERE date_key = ?',
        [dateKey]
      );
      if (!row) return null;
      return JSON.parse(row.summary_json);
    } catch (err) {
      console.warn('[NativeStorageProvider] Failed to load daily summary:', err);
      return null;
    }
  }

  async loadDailySummaries(startDateKey: string, endDateKey: string): Promise<DailyRhythmSummary[]> {
    try {
      const db = await this.getDb();
      const rows = await db.getAllAsync<{ summary_json: string }>(
        'SELECT summary_json FROM rhythm_daily_summary WHERE date_key >= ? AND date_key <= ? ORDER BY date_key ASC',
        [startDateKey, endDateKey]
      );
      return rows.map((r) => JSON.parse(r.summary_json));
    } catch (err) {
      console.warn('[NativeStorageProvider] Failed to load daily summaries:', err);
      return [];
    }
  }

  async deleteDailySummariesBefore(dateKey: string): Promise<void> {
    try {
      const db = await this.getDb();
      await db.runAsync('DELETE FROM rhythm_daily_summary WHERE date_key < ?', [dateKey]);
    } catch (err) {
      console.warn('[NativeStorageProvider] Failed to delete daily summaries before:', err);
    }
  }

  async clearAll(): Promise<void> {
    try {
      await Storage.removeItem(PREFERENCES_KEY);
      await Storage.removeItem(RUNTIME_KEY);
      const db = await this.getDb();
      await db.execAsync(`
        DELETE FROM rhythm_history;
        DELETE FROM rhythm_daily_summary;
      `);
    } catch (err) {
      console.warn('[NativeStorageProvider] Failed to clear storage:', err);
    }
  }
}
