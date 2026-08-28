import { UsageActivityEvent, UsageProvider } from '../UsageProvider';
import { DeviceApp, AppUsageSnapshot } from '../../types/domain';
import { initialApps } from '../../data/mockData';

export class MockUsageProvider implements UsageProvider {
  private apps: DeviceApp[] = [...initialApps];
  private activityListeners: Set<(event: UsageActivityEvent) => void> = new Set();
  private foregroundListeners: ((appId: string) => void)[] = [];

  constructor(initialAppsList?: DeviceApp[]) {
    if (initialAppsList && initialAppsList.length > 0) {
      this.apps = [...initialAppsList];
    }
  }

  async getInstalledApps(): Promise<DeviceApp[]> {
    return Promise.resolve([...this.apps]);
  }

  async getCurrentUsage(): Promise<AppUsageSnapshot[]> {
    const now = Date.now();
    return Promise.resolve(
      this.apps.map((app) => ({
        appId: app.id,
        timestamp: now,
        durationMinutes: app.usageTodayMinutes,
        sessionActive: app.sessionMinutes > 0,
      }))
    );
  }

  onActivityEvent(callback: (event: UsageActivityEvent) => void): () => void {
    this.activityListeners.add(callback);
    return () => {
      this.activityListeners.delete(callback);
    };
  }

  onForegroundAppChange(callback: (appId: string) => void): () => void {
    this.foregroundListeners.push(callback);
    return () => {
      this.foregroundListeners = this.foregroundListeners.filter((l) => l !== callback);
    };
  }

  simulateAppOpen(appId: string) {
    this.foregroundListeners.forEach((listener) => listener(appId));
    const event: UsageActivityEvent = {
      appId,
      timestamp: Date.now(),
      state: 'foreground',
    };
    for (const listener of this.activityListeners) {
      listener(event);
    }
  }

  simulateAppBackground(appId: string) {
    const event: UsageActivityEvent = {
      appId,
      timestamp: Date.now(),
      state: 'background',
    };
    for (const listener of this.activityListeners) {
      listener(event);
    }
  }
}

export const mockUsageProvider = new MockUsageProvider();
