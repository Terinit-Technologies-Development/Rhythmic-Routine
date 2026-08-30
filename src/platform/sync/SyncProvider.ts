/**
 * SyncProvider interface for future optional encrypted backup / export.
 * In accordance with local-first architecture, default implementation is NoopSyncProvider.
 */
export interface SyncProvider {
  isEnabled(): boolean;
  syncNow(): Promise<void>;
  exportData(): Promise<string>;
  importData(jsonData: string): Promise<boolean>;
}

export class NoopSyncProvider implements SyncProvider {
  isEnabled(): boolean {
    return false;
  }

  async syncNow(): Promise<void> {
    // Local-first: no remote synchronization
  }

  async exportData(): Promise<string> {
    return JSON.stringify({ exportedAt: Date.now(), version: 1 });
  }

  async importData(_jsonData: string): Promise<boolean> {
    return true;
  }
}
