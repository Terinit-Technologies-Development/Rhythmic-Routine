import {
  DailyAppUsage,
  GroupAllowanceUsage,
  PersistedRuntime,
  RhythmConfiguration,
  RhythmEffect,
  RhythmEvent,
  RhythmRuntime,
  normalizePersistedRuntime,
} from './types';
import { processRhythmEvent } from './events';
import { restoreCooldowns } from './cooldowns';
import {
  createDailyAttentionExchangeState,
  deriveAttentionGateStatus,
  reconcileAttentionExchangeDate,
} from './attentionExchange';
import { getLocalDateKey } from './allowance';

export class RhythmEngine {
  private runtime: RhythmRuntime;
  private config: RhythmConfiguration;

  constructor(
    config: RhythmConfiguration,
    persistedState?: PersistedRuntime | null,
    now: number = Date.now()
  ) {
    this.config = { ...config };

    const normalized = normalizePersistedRuntime(persistedState, now);
    const todayKey = getLocalDateKey(now);

    if (normalized) {
      const restoredCooldowns = restoreCooldowns(normalized.activeCooldowns, now);
      const restoredLeases = normalized.activeAccessLeases ? { ...normalized.activeAccessLeases } : {};
      const restoredDailyUsage = normalized.dailyAppUsage ? { ...normalized.dailyAppUsage } : {};
      const restoredGroupUsage = normalized.groupAllowanceUsage ? { ...normalized.groupAllowanceUsage } : {};
      this.runtime = {
        state: normalized.state,
        activeSession: normalized.activeSession,
        activeCooldowns: restoredCooldowns,
        activeAccessLeases: restoredLeases,
        activeRoutineWindowIds: normalized.activeRoutineWindowIds,
        dailyAppUsage: restoredDailyUsage,
        groupAllowanceUsage: restoredGroupUsage,
        dailyAttentionExchange: reconcileAttentionExchangeDate(
          normalized.dailyAttentionExchange ?? createDailyAttentionExchangeState(todayKey, now),
          now
        ),
        activeReadingGates: Object.fromEntries(
          Object.entries(normalized.activeReadingGates ?? {})
            .filter(([, gate]) => gate.attentionDateKey === todayKey)
            .map(([groupId, gate]) => [groupId, { ...gate }])
        ),
        ...(normalized.readingEvidence?.dateKey === todayKey
          ? { readingEvidence: { ...normalized.readingEvidence } }
          : {}),
        activeRestrictions: [], // Start with empty baseline so initial reconciliation emits APPLY_RESTRICTIONS
      };
    } else {
      this.runtime = {
        state: 'available',
        activeCooldowns: {},
        activeAccessLeases: {},
        activeRoutineWindowIds: [],
        dailyAppUsage: {},
        groupAllowanceUsage: {},
        dailyAttentionExchange: createDailyAttentionExchangeState(todayKey, now),
        activeReadingGates: {},
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
      activeSession: this.runtime.activeSession ? { ...this.runtime.activeSession } : undefined,
      activeCooldowns: Object.fromEntries(
        Object.entries(this.runtime.activeCooldowns).map(([id, cooldown]) => [id, { ...cooldown }])
      ),
      activeAccessLeases: Object.fromEntries(
        Object.entries(this.runtime.activeAccessLeases).map(([id, lease]) => [id, { ...lease }])
      ),
      activeRoutineWindowIds: [...this.runtime.activeRoutineWindowIds],
      dailyAppUsage: this.runtime.dailyAppUsage
        ? Object.fromEntries(Object.entries(this.runtime.dailyAppUsage).map(([id, usage]) => [id, { ...usage }]))
        : {},
      groupAllowanceUsage: this.runtime.groupAllowanceUsage
        ? Object.fromEntries(Object.entries(this.runtime.groupAllowanceUsage).map(([id, usage]) => [id, { ...usage }]))
        : {},
      dailyAttentionExchange: this.runtime.dailyAttentionExchange
        ? { ...this.runtime.dailyAttentionExchange }
        : undefined,
      activeReadingGates: Object.fromEntries(
        Object.entries(this.runtime.activeReadingGates ?? {}).map(([id, gate]) => [id, { ...gate }])
      ),
      readingEvidence: this.runtime.readingEvidence ? { ...this.runtime.readingEvidence } : undefined,
      activeRestrictions: this.runtime.activeRestrictions.map((r) => ({
        appId: r.appId,
        reasons: [...r.reasons],
      })),
    };
  }

  public getDailyAppUsage(): Record<string, DailyAppUsage> {
    return this.runtime.dailyAppUsage ? { ...this.runtime.dailyAppUsage } : {};
  }

  public getGroupAllowanceUsage(): Record<string, GroupAllowanceUsage> {
    return this.runtime.groupAllowanceUsage
      ? Object.fromEntries(Object.entries(this.runtime.groupAllowanceUsage).map(([id, usage]) => [id, { ...usage }]))
      : {};
  }

  public getAttentionGateStatus(groupId: string, now: number = Date.now()) {
    return deriveAttentionGateStatus({
      groupId,
      gate: this.runtime.activeReadingGates?.[groupId],
      cooldown: this.runtime.activeCooldowns[groupId],
      evidence: this.runtime.readingEvidence,
      now,
      currentDateKey: getLocalDateKey(now),
    });
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
      activeCooldowns: Object.fromEntries(
        Object.entries(this.runtime.activeCooldowns).map(([id, cooldown]) => [id, { ...cooldown }])
      ),
      activeAccessLeases: Object.fromEntries(
        Object.entries(this.runtime.activeAccessLeases).map(([id, lease]) => [id, { ...lease }])
      ),
      activeRoutineWindowIds: [...this.runtime.activeRoutineWindowIds],
      lastReconciledAt: now,
      dailyAttentionExchange: this.runtime.dailyAttentionExchange
        ? { ...this.runtime.dailyAttentionExchange }
        : createDailyAttentionExchangeState(getLocalDateKey(now), now),
      activeReadingGates: Object.fromEntries(
        Object.entries(this.runtime.activeReadingGates ?? {}).map(([id, gate]) => [id, { ...gate }])
      ),
    };
    if (this.runtime.readingEvidence) {
      res.readingEvidence = { ...this.runtime.readingEvidence };
    }
    if (this.runtime.activeSession) {
      res.activeSession = { ...this.runtime.activeSession };
    }
    if (this.runtime.dailyAppUsage) {
      res.dailyAppUsage = Object.fromEntries(
        Object.entries(this.runtime.dailyAppUsage).map(([id, usage]) => [id, { ...usage }])
      );
    }
    if (this.runtime.groupAllowanceUsage) {
      res.groupAllowanceUsage = Object.fromEntries(
        Object.entries(this.runtime.groupAllowanceUsage).map(([id, usage]) => [id, { ...usage }])
      );
    }
    return res;
  }
}
