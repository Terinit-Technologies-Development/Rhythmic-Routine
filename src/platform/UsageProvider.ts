import { DeviceApp, AppUsageSnapshot } from '../types/domain';

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
   * Subscribes to foreground app change events.
   */
  onForegroundAppChange?(callback: (appId: string) => void): () => void;
}
