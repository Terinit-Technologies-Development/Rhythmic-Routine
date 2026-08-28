import { getPlatformServices } from '../platform/PlatformServices';
import { RhythmEngine } from '../domain/rhythm/RhythmEngine';
import {
  EngineStatus,
  RhythmConfiguration,
  RhythmEffect,
  RhythmEvent,
  RhythmRuntime,
} from '../domain/rhythm/types';
import { bootstrapRhythm } from './bootstrapRhythm';
import { reconcileRhythm } from './reconcileRhythm';

type RuntimeListener = (runtime: RhythmRuntime) => void;

const ENGINE_RECONCILE_INTERVAL_MS = 15_000;

export class RhythmCoordinator {
  private static instance: RhythmCoordinator | null = null;
  private engine: RhythmEngine | null = null;
  private config: RhythmConfiguration | null = null;
  private status: EngineStatus = { health: 'ready', issues: [] };
  private listeners: Set<RuntimeListener> = new Set();
  private unsubscribeActivity?: () => void;
  private reconcileTimer?: ReturnType<typeof setInterval>;
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

    const { engine, config, status } = await bootstrapRhythm();
    this.engine = engine;
    this.config = config;
    this.status = status;
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
        ).catch(() => {});
      });
    }

    // Start bounded domain clock reconciliation for continuous foreground progress
    this.startReconciliationClock();

    await this.syncNativeState();
    this.notifyListeners();
    return this.engine.getRuntime();
  }

  /**
   * Centralized executor for engine effects.
   */
  private async executeEffects(effects: RhythmEffect[]): Promise<void> {
    const { restrictions, storage } = getPlatformServices();

    for (const effect of effects) {
      switch (effect.type) {
        case 'APPLY_RESTRICTIONS':
          await restrictions.applyRestrictions(effect.appIds);
          break;
        case 'CLEAR_RESTRICTIONS':
          await restrictions.clearRestrictions(effect.appIds);
          break;
        case 'START_ACCESS_LEASE': {
          const group = this.config?.riskGroups.find((item) => item.id === effect.groupId);
          if (group && restrictions.startAccessLease) {
            await restrictions.startAccessLease({
              groupId: effect.groupId,
              appIds: group.appIds,
              startsAt: Date.now(),
              endsAt: effect.endsAt,
            });
          }
          break;
        }
        case 'END_ACCESS_LEASE':
          await restrictions.endAccessLease?.(effect.groupId);
          break;
        case 'RECORD_HISTORY':
          await storage.appendHistoryEvent(effect.event);
          break;
      }
    }
  }

  /**
   * Synchronizes authoritative engine state to platform native layer.
   */
  private async syncNativeState(): Promise<void> {
    if (!this.engine || !this.config) return;
    try {
      await getPlatformServices().nativeRhythm.sync(
        this.engine.getRuntime(),
        this.config
      );
    } catch {
      // Platform sync boundary
    }
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

    const { storage } = getPlatformServices();
    const effects = this.engine.dispatch(event);

    await this.executeEffects(effects);

    // Persist runtime state
    const now = 'timestamp' in event ? event.timestamp : Date.now();
    await storage.saveRuntime(this.engine.toPersistedRuntime(now));

    await this.syncNativeState();

    this.notifyListeners();
    return this.engine.getRuntime();
  }

  /**
   * Imports background cooldowns and access leases created by native extensions while JS was suspended.
   */
  private async importNativeStateOnResume(now: number): Promise<void> {
    if (!this.engine || !this.config) {
      return;
    }

    const snapshot = await getPlatformServices().nativeRhythm.getSnapshot?.();
    if (!snapshot) return;

    for (const [groupId, endsAt] of Object.entries(snapshot.activeCooldownEndsAt ?? {})) {
      if (endsAt <= now) continue;

      const effects = this.engine.dispatch({
        type: 'NATIVE_COOLDOWN_RESTORED',
        groupId,
        endsAt,
        timestamp: now,
      });

      await this.executeEffects(effects);
    }

    for (const [groupId, endsAt] of Object.entries(snapshot.activeAccessLeaseEndsAt ?? {})) {
      if (endsAt <= now) continue;

      const effects = this.engine.dispatch({
        type: 'NATIVE_ACCESS_LEASE_RESTORED',
        groupId,
        endsAt,
        timestamp: now,
      });

      await this.executeEffects(effects);
    }
  }

  /**
   * Reconciles current state (clock time, active routines, cooldown expiry).
   */
  public async reconcile(
    now: number = Date.now(),
    options?: { syncNative?: boolean }
  ): Promise<RhythmRuntime> {
    if (!this.engine || !this.config) {
      return this.initialize();
    }
    await reconcileRhythm(this.engine, this.config, now);
    if (options?.syncNative !== false) {
      await this.syncNativeState();
    }
    this.notifyListeners();
    return this.engine.getRuntime();
  }

  /**
   * Complete resume lifecycle:
   * 1. Refresh permission state
   * 2. Import native state created while JS was suspended
   * 3. Reconcile wall clock
   * 4. Persist runtime
   * 5. Sync final authoritative state back outward
   */
  public async handleAppResume(): Promise<void> {
    if (!this.engine || !this.config) {
      await this.initialize();
      return;
    }

    const now = Date.now();
    const services = getPlatformServices();

    // 1. Refresh permission state
    await services.permissions.getStatus();

    // 2. Import native background changes before JS reconciliation
    await this.importNativeStateOnResume(now);

    // 3. Reconcile wall clock (skip internal sync to avoid duplicate native writes)
    await this.reconcile(now, { syncNative: false });

    // 4. Persist final JS runtime
    await services.storage.saveRuntime(this.engine.toPersistedRuntime(now));

    // 5. Sync final authoritative state back outward
    await this.syncNativeState();

    this.notifyListeners();
  }

  /**
   * Updates configuration, persists preferences, and executes restriction effects immediately.
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
    const appClassifications = this.config.apps.reduce<Record<string, { classification: any; riskGroupId?: string }>>((acc, app) => {
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

    // Execute effects emitted directly from updateConfiguration
    const effects = this.engine.updateConfiguration(this.config);
    await this.executeEffects(effects);

    await storage.saveRuntime(this.engine.toPersistedRuntime(Date.now()));
    await this.syncNativeState();
    this.notifyListeners();
  }

  /**
   * Starts bounded reconciliation clock for continuous foreground time progression.
   */
  private startReconciliationClock(): void {
    if (this.reconcileTimer) return;

    this.reconcileTimer = setInterval(() => {
      this.dispatch({
        type: 'CLOCK_TICK',
        timestamp: Date.now(),
      }).catch(() => {});
    }, ENGINE_RECONCILE_INTERVAL_MS);

    if (this.reconcileTimer && typeof (this.reconcileTimer as any).unref === 'function') {
      (this.reconcileTimer as any).unref();
    }
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

  public getConfiguration(): RhythmConfiguration | null {
    return this.config
      ? {
          routineWindows: [...this.config.routineWindows],
          riskGroups: [...this.config.riskGroups],
          apps: [...this.config.apps],
          sessionResetGapMs: this.config.sessionResetGapMs,
        }
      : null;
  }

  public getStatus(): EngineStatus {
    return {
      health: this.status.health,
      issues: [...this.status.issues],
    };
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
    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = undefined;
    }
    if (this.unsubscribeActivity) {
      this.unsubscribeActivity();
      this.unsubscribeActivity = undefined;
    }
    this.listeners.clear();
    this.isInitialized = false;
    this.engine = null;
    this.config = null;
  }
}
