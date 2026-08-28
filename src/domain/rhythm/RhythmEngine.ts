import {
  PersistedRuntime,
  RhythmConfiguration,
  RhythmEffect,
  RhythmEvent,
  RhythmRuntime,
} from './types';
import { processRhythmEvent } from './events';
import { restoreCooldown } from './cooldowns';
import { isInsideWindow } from './routine';
import { computeEffectiveRestrictions } from './restrictions';

/**
 * Pure TypeScript Rhythm Engine.
 * Decides runtime state transitions, continuous risk session tracking,
 * cooldown enforcement, and restriction effects.
 *
 * Does not import React, Zustand, SQLite, or OS APIs.
 */
export class RhythmEngine {
  private runtime: RhythmRuntime;
  private config: RhythmConfiguration;

  constructor(
    config: RhythmConfiguration,
    initialRuntime?: PersistedRuntime | null,
    now: number = Date.now()
  ) {
    this.config = config;

    const nowDate = new Date(now);
    const restoredCooldown = restoreCooldown(initialRuntime?.activeCooldown, now);
    const activeRoutineWindows = config.routineWindows.filter((w) => isInsideWindow(nowDate, w));
    const activeRoutineWindowIds = activeRoutineWindows.map((w) => w.id);

    const { appRestrictions } = computeEffectiveRestrictions(
      activeRoutineWindows,
      restoredCooldown,
      config.riskGroups,
      config.apps
    );

    this.runtime = {
      state: initialRuntime?.state || 'available',
      activeCooldown: restoredCooldown,
      activeSession: initialRuntime?.activeSession,
      activeRoutineWindowIds,
      activeRestrictions: appRestrictions,
    };

    // Run initial reconcile on instantiation
    this.reconcile(now);
  }

  /**
   * Updates configuration (e.g. user updated routine times or group thresholds).
   */
  public updateConfiguration(config: RhythmConfiguration): RhythmEffect[] {
    this.config = config;
    return this.reconcile(Date.now());
  }

  /**
   * Dispatches an event into the engine, updating state and returning resulting effects.
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
   * Reconciles current runtime state against the current clock time.
   */
  public reconcile(timestamp: number = Date.now()): RhythmEffect[] {
    return this.dispatch({
      type: 'RECONCILE',
      timestamp,
    });
  }

  /**
   * Retrieves the current pure runtime state.
   */
  public getRuntime(): RhythmRuntime {
    return { ...this.runtime };
  }

  /**
   * Retrieves currently restricted application IDs.
   */
  public getEffectiveRestrictedAppIds(): string[] {
    return this.runtime.activeRestrictions.map((r) => r.appId);
  }

  /**
   * Converts current runtime into serializable persisted format.
   */
  public toPersistedRuntime(now: number = Date.now()): PersistedRuntime {
    return {
      state: this.runtime.state,
      activeCooldown: this.runtime.activeCooldown,
      activeSession: this.runtime.activeSession,
      activeRoutineWindowIds: this.runtime.activeRoutineWindowIds,
      lastReconciledAt: now,
    };
  }
}
