import { DeviceApp, AppUsageSnapshot } from '../types/domain';

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
}
