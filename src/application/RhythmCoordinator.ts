import { getPlatformServices } from '../platform/PlatformServices';
import { RhythmEngine } from '../domain/rhythm/RhythmEngine';
import {
  RhythmConfiguration,
  RhythmEvent,
  RhythmRuntime,
} from '../domain/rhythm/types';
import { bootstrapRhythm } from './bootstrapRhythm';
import { reconcileRhythm } from './reconcileRhythm';

type RuntimeListener = (runtime: RhythmRuntime) => void;

export class RhythmCoordinator {
  private static instance: RhythmCoordinator | null = null;
  private engine: RhythmEngine | null = null;
  private config: RhythmConfiguration | null = null;
  private listeners: Set<RuntimeListener> = new Set();
  private unsubscribeActivity?: () => void;
  private isInitialized = false;

  public static getInstance(): RhythmCoordinator {
    if (!RhythmCoordinator.instance) {
      RhythmCoordinator.instance = new RhythmCoordinator();
    }
    return RhythmCoordinator.instance;
  }

  /**
   * Initializes the coordinator and bootstraps the Rhythm Engine.
   */
  public async initialize(): Promise<RhythmRuntime> {
    if (this.isInitialized && this.engine) {
      return this.engine.getRuntime();
    }

    const { engine, config } = await bootstrapRhythm();
    this.engine = engine;
    this.config = config;
    this.isInitialized = true;

    // Subscribe to platform usage activity events
    const { usage } = getPlatformServices();
    if (usage.onActivityEvent) {
      this.unsubscribeActivity = usage.onActivityEvent((event) => {
        this.dispatch(
          event.state === 'foreground'
            ? {
                type: 'APP_FOREGROUND',
                appId: event.appId,
                timestamp: event.timestamp,
              }
            : {
                type: 'APP_BACKGROUND',
                appId: event.appId,
                timestamp: event.timestamp,
              }
        );
      });
    }

    this.notifyListeners();
    return this.engine.getRuntime();
  }

  /**
   * Dispatches an event into the engine and executes resulting effects.
   */
  public async dispatch(event: RhythmEvent): Promise<RhythmRuntime> {
    if (!this.engine || !this.config) {
      await this.initialize();
    }
    if (!this.engine || !this.config) {
      throw new Error('Rhythm Engine failed to initialize');
    }

    const { restrictions, storage } = getPlatformServices();
    const effects = this.engine.dispatch(event);

    for (const effect of effects) {
      switch (effect.type) {
        case 'APPLY_RESTRICTIONS':
          await restrictions.applyRestrictions(effect.appIds);
          break;
        case 'CLEAR_RESTRICTIONS':
          await restrictions.clearRestrictions(effect.appIds);
          break;
        case 'RECORD_HISTORY':
          await storage.appendHistoryEvent(effect.event);
          break;
      }
    }

    // Persist runtime state
    const now = 'timestamp' in event ? event.timestamp : Date.now();
    await storage.saveRuntime(this.engine.toPersistedRuntime(now));

    this.notifyListeners();
    return this.engine.getRuntime();
  }

  /**
   * Reconciles current state (clock time, active routines, cooldown expiry).
   */
  public async reconcile(now: number = Date.now()): Promise<RhythmRuntime> {
    if (!this.engine || !this.config) {
      return this.initialize();
    }
    await reconcileRhythm(this.engine, this.config, now);
    this.notifyListeners();
    return this.engine.getRuntime();
  }

  /**
   * Updates configuration and persists preferences.
   */
  public async updateConfig(nextConfig: Partial<RhythmConfiguration>): Promise<void> {
    if (!this.config || !this.engine) {
      await this.initialize();
    }
    if (!this.config || !this.engine) return;

    this.config = {
      ...this.config,
      ...nextConfig,
    };

    const { storage } = getPlatformServices();
    const appClassifications = this.config.apps.reduce<Record<string, { classification: string; riskGroupId?: string }>>((acc, app) => {
      acc[app.id] = {
        classification: app.classification,
        riskGroupId: app.riskGroupId,
      };
      return acc;
    }, {});

    await storage.savePreferences({
      routineWindows: this.config.routineWindows,
      riskGroups: this.config.riskGroups,
      appClassifications,
      sessionResetGapMs: this.config.sessionResetGapMs ?? 5 * 60 * 1000,
      onboardingCompleted: true,
    });

    this.engine.updateConfiguration(this.config);
    await this.reconcile(Date.now());
  }

  /**
   * Subscribes to runtime engine changes.
   */
  public subscribe(listener: RuntimeListener): () => void {
    this.listeners.add(listener);
    if (this.engine) {
      listener(this.engine.getRuntime());
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getRuntime(): RhythmRuntime | null {
    return this.engine ? this.engine.getRuntime() : null;
  }

  public getEngine(): RhythmEngine | null {
    return this.engine;
  }

  private notifyListeners(): void {
    if (!this.engine) return;
    const runtime = this.engine.getRuntime();
    for (const listener of this.listeners) {
      listener(runtime);
    }
  }

  public destroy(): void {
    if (this.unsubscribeActivity) {
      this.unsubscribeActivity();
    }
    this.listeners.clear();
    this.isInitialized = false;
    this.engine = null;
    this.config = null;
  }
}
