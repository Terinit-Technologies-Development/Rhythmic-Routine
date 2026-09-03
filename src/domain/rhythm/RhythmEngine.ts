import {
  DailyAppUsage,
  PersistedRuntime,
  RhythmConfiguration,
  RhythmEffect,
  RhythmEvent,
  RhythmRuntime,
  normalizePersistedRuntime,
} from './types';
import { processRhythmEvent } from './events';
import { restoreCooldowns } from './cooldowns';

export class RhythmEngine {
  private runtime: RhythmRuntime;
  private config: RhythmConfiguration;

  constructor(
    config: RhythmConfiguration,
    persistedState?: PersistedRuntime | null,
    now: number = Date.now()
  ) {
    this.config = { ...config };

    const normalized = normalizePersistedRuntime(persistedState);

    if (normalized) {
      const restoredCooldowns = restoreCooldowns(normalized.activeCooldowns, now);
      const restoredLeases = normalized.activeAccessLeases ? { ...normalized.activeAccessLeases } : {};
      const restoredDailyUsage = normalized.dailyAppUsage ? { ...normalized.dailyAppUsage } : {};
      this.runtime = {
        state: normalized.state,
        activeSession: normalized.activeSession,
        activeCooldowns: restoredCooldowns,
        activeAccessLeases: restoredLeases,
        activeRoutineWindowIds: normalized.activeRoutineWindowIds,
        dailyAppUsage: restoredDailyUsage,
        activeRestrictions: [], // Start with empty baseline so initial reconciliation emits APPLY_RESTRICTIONS
      };
    } else {
      this.runtime = {
        state: 'available',
        activeCooldowns: {},
        activeAccessLeases: {},
        activeRoutineWindowIds: [],
        dailyAppUsage: {},
        activeRestrictions: [], // Start with empty baseline
      };
    }

    // Run initial reconciliation
    this.reconcile(now);
  }

  /**
   * Dispatches an event through the pure state reducer and returns resulting effects.
   */
  public dispatch(event: RhythmEvent): RhythmEffect[] {
    const { nextRuntime, effects } = processRhythmEvent(
      this.runtime,
      event,
      this.config
    );
    this.runtime = nextRuntime;
    return effects;
  }

  /**
   * Reconciles current state against current clock time.
   */
  public reconcile(now: number = Date.now()): RhythmEffect[] {
    return this.dispatch({
      type: 'RECONCILE',
      timestamp: now,
    });
  }

  /**
   * Updates configuration (e.g. after user edits) and returns the resulting restriction/state effects immediately.
   */
  public updateConfiguration(nextConfig: RhythmConfiguration, now: number = Date.now()): RhythmEffect[] {
    this.config = { ...nextConfig };

    // If an active session's app was reclassified to non-risk, finalize/clear active pointer safely
    if (this.runtime.activeSession) {
      const activeApp = this.config.apps.find((a) => a.id === this.runtime.activeSession?.activeAppId);
      if (!activeApp || activeApp.classification !== 'risk' || activeApp.riskGroupId !== this.runtime.activeSession.groupId) {
        this.runtime.activeSession = {
          ...this.runtime.activeSession,
          activeAppId: undefined,
        };
      }
    }

    return this.reconcile(now);
  }

  public getRuntime(): RhythmRuntime {
    return {
      ...this.runtime,
      activeCooldowns: { ...this.runtime.activeCooldowns },
      activeAccessLeases: { ...this.runtime.activeAccessLeases },
      activeRoutineWindowIds: [...this.runtime.activeRoutineWindowIds],
      dailyAppUsage: this.runtime.dailyAppUsage ? { ...this.runtime.dailyAppUsage } : {},
      activeRestrictions: this.runtime.activeRestrictions.map((r) => ({
        appId: r.appId,
        reasons: [...r.reasons],
      })),
    };
  }

  public getDailyAppUsage(): Record<string, DailyAppUsage> {
    return this.runtime.dailyAppUsage ? { ...this.runtime.dailyAppUsage } : {};
  }

  public getConfiguration(): RhythmConfiguration {
    return {
      routineWindows: [...this.config.routineWindows],
      riskGroups: [...this.config.riskGroups],
      apps: [...this.config.apps],
      sessionResetGapMs: this.config.sessionResetGapMs,
    };
  }

  public getEffectiveRestrictedAppIds(): string[] {
    return this.runtime.activeRestrictions.map((r) => r.appId);
  }

  public toPersistedRuntime(now: number = Date.now()): PersistedRuntime {
    const res: PersistedRuntime = {
      state: this.runtime.state,
      activeCooldowns: { ...this.runtime.activeCooldowns },
      activeAccessLeases: { ...this.runtime.activeAccessLeases },
      activeRoutineWindowIds: [...this.runtime.activeRoutineWindowIds],
      lastReconciledAt: now,
    };
    if (this.runtime.activeSession) {
      res.activeSession = { ...this.runtime.activeSession };
    }
    if (this.runtime.dailyAppUsage) {
      res.dailyAppUsage = { ...this.runtime.dailyAppUsage };
    }
    return res;
  }
}
