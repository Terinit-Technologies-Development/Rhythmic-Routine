import { AppUsageSnapshot, DeviceApp } from '../../types/domain';
import { UsageActivityEvent, UsageProvider } from '../UsageProvider';
import RhythmDeviceModule from '../../../modules/rhythm-device';
import { initialApps } from '../../data/mockData';

export class NativeUsageProvider implements UsageProvider {
  private activityListeners: Set<(event: UsageActivityEvent) => void> = new Set();
  private pollingTimer?: NodeJS.Timeout;
  private lastQueryTime: number = Date.now() - 60000;

  async getInstalledApps(): Promise<DeviceApp[]> {
    try {
      const nativeApps = await RhythmDeviceModule.getInstalledApps();
      if (nativeApps && nativeApps.length > 0) {
        return nativeApps.map((app) => ({
          id: app.packageName,
          name: app.appName,
          classification: 'normal',
          iconName: 'smartphone',
          iconColor: '#235D43',
          iconBg: '#E8EFE5',
          defaultCategory: app.category || 'App',
          usageTodayMinutes: 0,
          sessionMinutes: 0,
        }));
      }
    } catch {
      // Fallback
    }
    return initialApps;
  }

  async getCurrentUsage(): Promise<AppUsageSnapshot[]> {
    const now = Date.now();
    try {
      const events = await RhythmDeviceModule.queryUsageEvents(now - 3600000, now);
      return events.map((e) => ({
        appId: e.packageName,
        timestamp: e.timestamp,
        durationMinutes: 0,
        sessionActive: e.eventType === 'foreground',
      }));
    } catch {
      return [];
    }
  }

  onActivityEvent(callback: (event: UsageActivityEvent) => void): () => void {
    this.activityListeners.add(callback);
    this.ensureObservationStarted();

    return () => {
      this.activityListeners.delete(callback);
      if (this.activityListeners.size === 0) {
        this.stopObservation();
      }
    };
  }

  onForegroundAppChange(callback: (appId: string) => void): () => void {
    return this.onActivityEvent((event) => {
      if (event.state === 'foreground') {
        callback(event.appId);
      }
    });
  }

  private ensureObservationStarted(): void {
    if (this.pollingTimer) return;

    // Bounded, low-frequency 15-second background query (battery discipline)
    this.pollingTimer = setInterval(async () => {
      const now = Date.now();
      try {
        const events = await RhythmDeviceModule.queryUsageEvents(this.lastQueryTime, now);
        this.lastQueryTime = now;

        for (const e of events) {
          if (e.eventType === 'foreground' || e.eventType === 'background') {
            const normalizedEvent: UsageActivityEvent = {
              appId: e.packageName,
              timestamp: e.timestamp,
              state: e.eventType,
            };
            for (const listener of this.activityListeners) {
              listener(normalizedEvent);
            }
          }
        }
      } catch {
        // Ignored
      }
    }, 15000);
  }

  private stopObservation(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = undefined;
    }
  }
}
