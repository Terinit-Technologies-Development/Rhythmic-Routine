import { AppUsageSnapshot, DeviceApp, DailyUsageSnapshot } from '../../types/domain';
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

  async getDailyUsageSnapshot(): Promise<DailyUsageSnapshot> {
    try {
      const snapshot = await RhythmDeviceModule.getDailyUsageSnapshot();
      return snapshot;
    } catch {
      return {
        dateKey: new Date().toISOString().slice(0, 10),
        apps: [],
      };
    }
  }

  async reconcileDailyUsage(): Promise<DailyUsageSnapshot> {
    try {
      const snapshot = await RhythmDeviceModule.reconcileDailyUsage();
      return snapshot;
    } catch {
      return this.getDailyUsageSnapshot();
    }
  }

  async queryActivityEvents(from: number, to: number): Promise<UsageActivityEvent[]> {
    try {
      const raw = await RhythmDeviceModule.queryUsageEvents(from, to);
      return raw
        .filter((e) => e.eventType === 'foreground' || e.eventType === 'background')
        .map((e) => ({
          appId: e.packageName,
          timestamp: e.timestamp,
          state: e.eventType as 'foreground' | 'background',
        }))
        .sort((a, b) => a.timestamp - b.timestamp);
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

  /**
   * Explicitly triggers an immediate bounded activity events refresh (e.g. on app resume)
   * to update TypeScript Risk Group session continuity without waiting for periodic timers.
   */
  public async refreshActivityEvents(): Promise<void> {
    await this.refreshUsageEvents();
  }

  private ensureObservationStarted(): void {
    if (this.pollingTimer) return;

    // Immediately query on observation start to feed active state
    this.refreshUsageEvents().catch(() => {});

    // Bounded 60-second query to preserve Risk Group continuous session
    // and inactive-gap tracking in the TypeScript domain engine.
    // NOTE: Daily allowance enforcement is handled natively and event-driven by
    // RhythmEnforcementService (Accessibility TYPE_WINDOW_STATE_CHANGED + exact Handler deadline).
    // This 60s query strictly maintains Risk Group session transitions without heavy battery drain.
    this.pollingTimer = setInterval(async () => {
      await this.refreshUsageEvents();
    }, 60000);

    if (this.pollingTimer && typeof (this.pollingTimer as any).unref === 'function') {
      (this.pollingTimer as any).unref();
    }
  }

  private stopObservation(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = undefined;
    }
  }
}
