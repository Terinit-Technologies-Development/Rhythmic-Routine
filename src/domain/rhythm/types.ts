import {
  DeviceApp,
  RiskGroup,
  RoutineWindow,
  RhythmState,
} from '../../types/domain';

/**
 * Event-driven inputs consumed by the Rhythm Engine.
 */
export type RhythmEvent =
  | {
      type: 'CLOCK_TICK';
      timestamp: number;
    }
  | {
      type: 'APP_FOREGROUND';
      appId: string;
      timestamp: number;
    }
  | {
      type: 'APP_BACKGROUND';
      appId: string;
      timestamp: number;
    }
  | {
      type: 'ROUTINE_STARTED';
      windowId: string;
      timestamp: number;
    }
  | {
      type: 'ROUTINE_ENDED';
      windowId: string;
      timestamp: number;
    }
  | {
      type: 'COOLDOWN_STARTED';
      groupId: string;
      endsAt: number;
    }
  | {
      type: 'COOLDOWN_ENDED';
      groupId: string;
      timestamp: number;
    }
  | {
      type: 'RECONCILE';
      timestamp: number;
    };

/**
 * Inactive gap allowance in ms before a continuous risk session is closed.
 * (5 minutes by default).
 */
export const SESSION_RESET_GAP_MS = 5 * 60 * 1000;

/**
 * Active continuous session for a specific Risk Group.
 */
export interface ActiveRiskSession {
  groupId: string;
  startedAt: number;
  lastActivityAt: number;
  accumulatedSeconds: number;
  activeAppId?: string;
}

/**
 * Active recovery cooldown for a specific Risk Group.
 */
export interface ActiveCooldown {
  groupId: string;
  startedAt: number;
  endsAt: number;
}

/**
 * Explicit reasons why an application is restricted.
 */
export type RestrictionReason =
  | {
      type: 'routine';
      windowId: string;
      groupId: string;
    }
  | {
      type: 'cooldown';
      groupId: string;
    };

/**
 * Pure runtime engine state.
 */
export interface RhythmRuntime {
  state: RhythmState;
  activeSession?: ActiveRiskSession;
  activeCooldown?: ActiveCooldown;
  activeRoutineWindowIds: string[];
  activeRestrictions: {
    appId: string;
    reasons: RestrictionReason[];
  }[];
}

/**
 * Effects emitted by the Rhythm Engine for platform providers to execute.
 */
export type RhythmEffect =
  | {
      type: 'APPLY_RESTRICTIONS';
      appIds: string[];
    }
  | {
      type: 'CLEAR_RESTRICTIONS';
      appIds: string[];
    }
  | {
      type: 'START_COOLDOWN';
      groupId: string;
      endsAt: number;
    }
  | {
      type: 'END_COOLDOWN';
      groupId: string;
    }
  | {
      type: 'RECORD_HISTORY';
      event: RhythmHistoryEvent;
    };

/**
 * Lightweight local events stored for history and future insights.
 */
export type RhythmHistoryEvent =
  | {
      type: 'risk-session-ended';
      groupId: string;
      durationSeconds: number;
      timestamp: number;
    }
  | {
      type: 'cooldown-started';
      groupId: string;
      timestamp: number;
    }
  | {
      type: 'cooldown-ended';
      groupId: string;
      timestamp: number;
    }
  | {
      type: 'routine-protected';
      windowId: string;
      minutes: number;
      timestamp: number;
    };

/**
 * Static configuration supplied to the engine.
 */
export interface RhythmConfiguration {
  routineWindows: RoutineWindow[];
  riskGroups: RiskGroup[];
  apps: DeviceApp[];
  sessionResetGapMs?: number;
}

/**
 * Persisted runtime state saved to local storage.
 */
export interface PersistedRuntime {
  state: RhythmState;
  activeCooldown?: ActiveCooldown;
  activeSession?: ActiveRiskSession;
  activeRoutineWindowIds: string[];
  lastReconciledAt: number;
}

/**
 * User preferences persisted locally.
 */
export interface RhythmPreferences {
  routineWindows: RoutineWindow[];
  riskGroups: RiskGroup[];
  appClassifications: Record<string, { classification: string; riskGroupId?: string }>;
  sessionResetGapMs: number;
  onboardingCompleted: boolean;
}
