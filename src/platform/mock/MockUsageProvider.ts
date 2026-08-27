import { UsageProvider } from '../UsageProvider';
import { DeviceApp, AppUsageSnapshot } from '../../types/domain';
import { initialApps } from '../../data/mockData';

export class MockUsageProvider implements UsageProvider {
  private apps: DeviceApp[] = [...initialApps];
  private listeners: ((appId: string) => void)[] = [];

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

  onForegroundAppChange(callback: (appId: string) => void): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== callback);
    };
  }

  simulateAppOpen(appId: string) {
    this.listeners.forEach((listener) => listener(appId));
  }
}

export const mockUsageProvider = new MockUsageProvider();
