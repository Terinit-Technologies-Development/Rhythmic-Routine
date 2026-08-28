import {
  PersistedRuntime,
  RhythmHistoryEvent,
  RhythmPreferences,
} from '../domain/rhythm/types';

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
   * Appends an event to the local lightweight history log.
   */
  appendHistoryEvent(event: RhythmHistoryEvent): Promise<void>;

  /**
   * Retrieves recent history events for insights.
   */
  getHistoryEvents(limit?: number): Promise<RhythmHistoryEvent[]>;

  /**
   * Clears all local data (for settings reset).
   */
  clearAll(): Promise<void>;
}
