import {
  PersistedRuntime,
  RhythmHistoryEvent,
  RhythmPreferences,
} from '../domain/rhythm/types';
import { DailyRhythmSummary } from '../domain/insights/types';

/**
 * StorageProvider abstraction for local-first device persistence.
 * Strictly local SQLite / AsyncStorage — no cloud backend or remote sync.
 */
export interface StorageProvider {
  /**
   * Loads user preferences (routine windows, risk groups, classifications, etc.).
   */
  loadPreferences(): Promise<RhythmPreferences | null>;

  /**
   * Persists updated user preferences.
   */
  savePreferences(preferences: RhythmPreferences): Promise<void>;

  /**
   * Loads persisted runtime engine state (active cooldown, session, timestamps).
   */
  loadRuntime(): Promise<PersistedRuntime | null>;

  /**
   * Persists runtime engine state.
   */
  saveRuntime(runtime: PersistedRuntime): Promise<void>;

  /**
   * Appends an event to the local history log.
   */
  appendHistoryEvent(event: RhythmHistoryEvent): Promise<void>;

  /**
   * Retrieves recent history events.
   */
  getHistoryEvents(limit?: number): Promise<RhythmHistoryEvent[]>;

  /**
   * Retrieves history events with timestamp >= given timestamp.
   */
  getHistoryEventsSince?(timestamp: number): Promise<RhythmHistoryEvent[]>;

  /**
   * Deletes raw history events older than given timestamp.
   */
  deleteHistoryEventsBefore?(timestamp: number): Promise<void>;

  /**
   * Persists aggregated daily summary.
   */
  saveDailySummary?(summary: DailyRhythmSummary): Promise<void>;

  /**
   * Loads daily summary for a dateKey.
   */
  loadDailySummary?(dateKey: string): Promise<DailyRhythmSummary | null>;

  /**
   * Loads daily summaries between startDateKey and endDateKey (inclusive).
   */
  loadDailySummaries?(startDateKey: string, endDateKey: string): Promise<DailyRhythmSummary[]>;

  /**
   * Deletes daily summaries older than given dateKey.
   */
  deleteDailySummariesBefore?(dateKey: string): Promise<void>;

  /**
   * Clears all local data (for settings reset).
   */
  clearAll(): Promise<void>;
}
