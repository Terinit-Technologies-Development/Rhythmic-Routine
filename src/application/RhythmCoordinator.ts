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
import { DeviceApp, RiskGroup, DailyRiskAllowancePolicy } from '../types/domain';
import { reconcileRiskGroupMembership } from '../domain/rhythm/membershipReconciliation';
import {
  AllowanceEditResult,
  DEFAULT_DAILY_RISK_ALLOWANCE_MINUTES,
  getLocalDateKey,
  validateDailyAllowanceEdit,
} from '../domain/rhythm/allowance';

type RuntimeListener = (runtime: RhythmRuntime) => void;

const ENGINE_RECONCILE_INTERVAL_MS = 60_000;

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

    const { engine, config, status } = await bootstrapRhythm({
      deferRestrictionEffects: true,
    });
    this.engine = engine;
    this.config = config;
    this.status = status;
    this.isInitialized = true;

    const now = Date.now();

    // CRITICAL: Native import occurs before first outward native state write.
    await this.reconcilePlatformActivation(now, {
      importNativeState: true,
      finalSync: true,
    });

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

    // Reconcile Android native daily usage snapshot if available
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const RhythmDeviceModule = require('../../modules/rhythm-device').default;
      if (RhythmDeviceModule?.getDailyUsageSnapshot) {
        const usageSnapshot = await RhythmDeviceModule.getDailyUsageSnapshot();
        if (usageSnapshot?.apps?.length > 0) {
          const currentDailyUsage = { ...this.engine.getDailyAppUsage() };
          for (const app of usageSnapshot.apps) {
            currentDailyUsage[app.packageName] = {
              appId: app.packageName,
              dateKey: usageSnapshot.dateKey,
              usedSeconds: app.usedSeconds,
              activeSegmentStartedAt: app.activeSegmentStartedAt,
              exhaustedAt: app.exhausted ? now : undefined,
            };
          }
          const effects = this.engine.dispatch({
            type: 'SYNC_DAILY_APP_USAGE',
            dailyAppUsage: currentDailyUsage,
            timestamp: now,
          });
          await this.executeEffects(effects);
        }
      }
    } catch {
      // Native snapshot import boundary (non-fatal)
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
   * Unified platform activation algorithm for cold-start initialization and resume.
   * 1. Refreshes platform permissions.
   * 2. Imports native background state (cooldowns, leases) before any outward write.
   * 3. Reconciles pure TypeScript engine against current clock.
   * 4. Persists updated runtime state to local SQLite/KV storage.
   * 5. Syncs final authoritative state to native platform layers.
   */
  private async reconcilePlatformActivation(
    now: number,
    options: {
      importNativeState: boolean;
      finalSync: boolean;
    }
  ): Promise<void> {
    if (!this.engine || !this.config) {
      return;
    }

    const services = getPlatformServices();

    await services.permissions.getStatus();

    if (options.importNativeState) {
      await this.importNativeStateOnResume(now);
    }

    await this.reconcile(now, {
      syncNative: false,
    });

    const desiredIds = this.engine.getEffectiveRestrictedAppIds();
    if (desiredIds.length > 0) {
      try {
        await services.restrictions.applyRestrictions(desiredIds);
      } catch {
        // Platform restriction application failure
      }
    }

    await services.storage.saveRuntime(
      this.engine.toPersistedRuntime(now)
    );

    if (options.finalSync) {
      await this.syncNativeState();
    }
  }

  /**
   * Complete resume lifecycle:
   * Reconciles native background state into engine and synchronizes outward.
   */
  public async handleAppResume(): Promise<void> {
    if (!this.engine || !this.config) {
      await this.initialize();
      return;
    }

    // Explicitly trigger an immediate bounded activity events refresh to update
    // TypeScript Risk Group session continuity without waiting for the 60s periodic timer.
    const { usage } = getPlatformServices();
    if (usage.refreshActivityEvents) {
      try {
        await usage.refreshActivityEvents();
      } catch {
        // Platform usage refresh boundary
      }
    }

    await this.reconcilePlatformActivation(Date.now(), {
      importNativeState: true,
      finalSync: true,
    });

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
    const appClassifications = this.config.apps.reduce<Record<string, { classification: any; riskGroupId?: string; dailyRiskAllowance?: any }>>((acc, app) => {
      acc[app.id] = {
        classification: app.classification,
        riskGroupId: app.riskGroupId,
        dailyRiskAllowance: app.dailyRiskAllowance,
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

  public getConfig(): RhythmConfiguration | null {
    return this.config ? { ...this.config } : null;
  }

  /**
   * Validates and updates a Risk app's daily allowance.
   * Enforces:
   * - multiples of 15 min
   * - max +15 min per day
   * - reductions down to 0 allowed
   * - at most once per local day
   * - persists updated policy and emits history event
   */
  public async updateDailyRiskAllowance(
    appId: string,
    nextMinutes: number,
    nowMs: number = Date.now()
  ): Promise<AllowanceEditResult> {
    if (!this.config || !this.engine) {
      await this.initialize();
    }
    if (!this.config || !this.engine) {
      return {
        allowed: false,
        nextMinutes,
        consumesDailyEdit: false,
        reason: 'app-not-found',
      };
    }

    const app = this.config.apps.find((a) => a.id === appId);
    if (!app) {
      return {
        allowed: false,
        nextMinutes,
        consumesDailyEdit: false,
        reason: 'app-not-found',
      };
    }

    if (app.classification !== 'risk') {
      return {
        allowed: false,
        nextMinutes:
          app.dailyRiskAllowance?.allowanceMinutes ?? DEFAULT_DAILY_RISK_ALLOWANCE_MINUTES,
        consumesDailyEdit: false,
        reason: 'not-risk-app',
      };
    }

    const result = validateDailyAllowanceEdit(app.dailyRiskAllowance, nextMinutes, nowMs, app);
    if (!result.allowed) {
      return result;
    }

    if (!result.consumesDailyEdit) {
      return result;
    }

    const todayKey = getLocalDateKey(nowMs);
    const previousMinutes =
      app.dailyRiskAllowance?.allowanceMinutes ?? DEFAULT_DAILY_RISK_ALLOWANCE_MINUTES;

    const updatedPolicy: DailyRiskAllowancePolicy = {
      allowanceMinutes: result.nextMinutes,
      lastEditedDateKey: todayKey,
    };

    const updatedApps = this.config.apps.map((a) =>
      a.id === appId ? { ...a, dailyRiskAllowance: updatedPolicy } : a
    );

    const { storage } = getPlatformServices();
    await storage.appendHistoryEvent({
      type: 'daily-allowance-edited',
      appId,
      previousMinutes,
      nextMinutes: result.nextMinutes,
      timestamp: nowMs,
    });

    await this.updateConfig({ apps: updatedApps });
    return result;
  }

  /**
   * Refreshes installed launcher apps from platform usage provider,
   * merges existing classifications, defaults new packages to unclassified,
   * reconciles group membership, and updates configuration.
   */
  public async refreshInstalledApps(): Promise<{ apps: DeviceApp[]; riskGroups: RiskGroup[] }> {
    if (!this.config || !this.engine) {
      await this.initialize();
    }
    if (!this.config || !this.engine) {
      return { apps: [], riskGroups: [] };
    }

    const { usage } = getPlatformServices();
    const discoveredApps = await usage.getInstalledApps();
    if (!discoveredApps || discoveredApps.length === 0) {
      return { apps: this.config.apps, riskGroups: this.config.riskGroups };
    }

    const existingAppMap = new Map(this.config.apps.map((a) => [a.id, a]));
    const mergedApps: DeviceApp[] = discoveredApps.map((discovered) => {
      const existing = existingAppMap.get(discovered.id);
      if (existing) {
        return {
          ...discovered,
          classification: existing.classification,
          riskGroupId: existing.riskGroupId,
          dailyRiskAllowance: existing.dailyRiskAllowance,
        };
      }
      return {
        ...discovered,
        classification: 'unclassified',
        riskGroupId: undefined,
      };
    });

    const reconciledRiskGroups = reconcileRiskGroupMembership(mergedApps, this.config.riskGroups);

    await this.updateConfig({
      apps: mergedApps,
      riskGroups: reconciledRiskGroups,
    });

    return { apps: mergedApps, riskGroups: reconciledRiskGroups };
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
