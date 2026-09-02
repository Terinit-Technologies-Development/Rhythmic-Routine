import { AppUsageSnapshot, DeviceApp } from '../../types/domain';
import { UsageActivityEvent, UsageProvider } from '../UsageProvider';
import RhythmDeviceModule from '../../../modules/rhythm-device';
import { initialApps } from '../../data/mockData';

export class NativeUsageProvider implements UsageProvider {
  private activityListeners: Set<(event: UsageActivityEvent) => void> = new Set();
  private pollingTimer?: NodeJS.Timeout;
  private lastQueryTime: number = Date.now() - 60000;
  private lastProcessedTimestamp: number = 0;
  private processedEventSignatures: Set<string> = new Set();

  async getInstalledApps(): Promise<DeviceApp[]> {
    try {
      const nativeApps = await RhythmDeviceModule.getInstalledApps();
      if (nativeApps && nativeApps.length > 0) {
        return nativeApps.map((app) => ({
          id: app.packageName,
          name: app.appName,
          classification: 'unclassified',
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

  /**
   * Internal helper to process incoming native usage events with deduplication.
   */
  public processRawUsageEvents(events: { packageName: string; timestamp: number; eventType: string }[]): UsageActivityEvent[] {
    const emitted: UsageActivityEvent[] = [];

    // Sort by timestamp
    const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);

    for (const e of sorted) {
      if (e.eventType !== 'foreground' && e.eventType !== 'background') continue;

      const signature = `${e.packageName}:${e.eventType}:${Math.floor(e.timestamp)}`;

      // Deduplicate events already processed at interval boundaries
      if (this.processedEventSignatures.has(signature)) continue;
      if (e.timestamp < this.lastProcessedTimestamp) continue;

      this.processedEventSignatures.add(signature);
      if (this.processedEventSignatures.size > 200) {
        // Keep signature set bounded
        const firstKey = this.processedEventSignatures.values().next().value;
        if (firstKey) this.processedEventSignatures.delete(firstKey);
      }

      this.lastProcessedTimestamp = Math.max(this.lastProcessedTimestamp, e.timestamp);

      const normalizedEvent: UsageActivityEvent = {
        appId: e.packageName,
        timestamp: e.timestamp,
        state: e.eventType,
      };

      emitted.push(normalizedEvent);

      for (const listener of this.activityListeners) {
        listener(normalizedEvent);
      }
    }

    return emitted;
  }

  /**
   * Refreshes usage events on-demand (e.g. on app resume or UI focus)
   * without running a permanent battery-draining background polling loop.
   */
  public async refreshUsageEvents(): Promise<UsageActivityEvent[]> {
    const now = Date.now();
    try {
      const events = await RhythmDeviceModule.queryUsageEvents(this.lastQueryTime, now);
      this.lastQueryTime = now;
      return this.processRawUsageEvents(events);
    } catch {
      return [];
    }
  }

  private ensureObservationStarted(): void {
    // Permanent 15-second UsageStats polling removed per Pass 02 architecture.
    // In Android V1.0.1, the native RhythmEnforcementService observes Accessibility
    // TYPE_WINDOW_STATE_CHANGED, maintains an authoritative daily usage ledger,
    // and schedules exact allowance deadlines. UsageStats is queried boundedly
    // for on-demand reconciliation during app resume and recovery, eliminating battery drain.
  }

  private stopObservation(): void {
    // No permanent timer to clear
  }
}
