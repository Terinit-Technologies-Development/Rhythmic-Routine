import {
  PersistedRuntime,
  RhythmHistoryEvent,
  RhythmPreferences,
} from '../../domain/rhythm/types';
import { StorageProvider } from '../StorageProvider';

export class MockStorageProvider implements StorageProvider {
  private preferences: RhythmPreferences | null = null;
  private runtime: PersistedRuntime | null = null;
  private history: RhythmHistoryEvent[] = [];

  constructor(
    initialPreferences?: RhythmPreferences | null,
    initialRuntime?: PersistedRuntime | null
  ) {
    this.preferences = initialPreferences || null;
    this.runtime = initialRuntime || null;
  }

  async loadPreferences(): Promise<RhythmPreferences | null> {
    return this.preferences ? { ...this.preferences } : null;
  }

  async savePreferences(preferences: RhythmPreferences): Promise<void> {
    this.preferences = { ...preferences };
  }

  async loadRuntime(): Promise<PersistedRuntime | null> {
    return this.runtime ? { ...this.runtime } : null;
  }

  async saveRuntime(runtime: PersistedRuntime): Promise<void> {
    this.runtime = { ...runtime };
  }

  async appendHistoryEvent(event: RhythmHistoryEvent): Promise<void> {
    this.history.push({ ...event });
  }

  async getHistoryEvents(limit: number = 50): Promise<RhythmHistoryEvent[]> {
    return this.history.slice(-limit);
  }

  async clearAll(): Promise<void> {
    this.preferences = null;
    this.runtime = null;
    this.history = [];
  }
}
