import { DeviceApp, AppUsageSnapshot, GroupAllowanceSnapshot } from '../types/domain';

export type { GroupAllowanceSnapshot };

export type UsageActivityEvent = {
  appId: string;
  timestamp: number;
  state: 'foreground' | 'background';
};

export interface UsageProvider {
  /**
   * Retrieves list of installed applications on the device.
   */
  getInstalledApps(): Promise<DeviceApp[]>;

  /**
   * Retrieves live snapshot of app usage.
   */
  getCurrentUsage(): Promise<AppUsageSnapshot[]>;

  /**
   * Subscribes to normalized native activity events (foreground / background).
   */
  onActivityEvent?(callback: (event: UsageActivityEvent) => void): () => void;

  /**
   * Subscribes to foreground app change events.
   */
  onForegroundAppChange?(callback: (appId: string) => void): () => void;

  /**
   * Explicitly triggers an immediate bounded activity events refresh (e.g. on app resume)
   * to update TypeScript Risk Group session continuity without waiting for periodic timers.
   */
  refreshActivityEvents?(): Promise<void>;

  /**
   * Retrieves live daily usage snapshot from native ledger.
   */
  getGroupUsageSnapshot?(): Promise<GroupAllowanceSnapshot[]>;

  /**
   * Reconciles daily usage from native UsageEvents and returns updated snapshot.
   */
  reconcileGroupUsage?(): Promise<GroupAllowanceSnapshot[]>;

  /** Legacy display projection retained for Insights fixtures; native policy is group-owned. */
  getDailyUsageSnapshot?(): Promise<import('../types/domain').DailyUsageSnapshot>;
  reconcileDailyUsage?(): Promise<import('../types/domain').DailyUsageSnapshot>;

  /**
   * Queries activity events in the specified timestamp range [from, to].
   */
  queryActivityEvents?(from: number, to: number): Promise<UsageActivityEvent[]>;
}
