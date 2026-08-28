import {
  AccessLease,
  AppClassification,
  DeviceApp,
  EMERGENCY_ACCESS_MINUTES,
  RhythmState,
  RiskGroup,
  RoutineWindow,
} from '../../types/domain';

export { AccessLease, EMERGENCY_ACCESS_MINUTES };

export const SESSION_RESET_GAP_MS = 5 * 60 * 1000; // 5 minutes inactivity tolerance

export interface ActiveRiskSession {
  groupId: string;
  startedAt: number;
  lastActivityAt: number;
  accumulatedSeconds: number;
  activeAppId?: string; // App currently in foreground, if any
}

export interface ActiveCooldown {
  groupId: string;
  startedAt: number;
  endsAt: number;
}

export interface RestrictionReason {
  type: 'routine' | 'cooldown';
  sourceId: string; // RoutineWindow ID or RiskGroup ID
}

export interface AppRestriction {
  appId: string;
  reasons: RestrictionReason[];
}

export interface RhythmRuntime {
  state: RhythmState;
  activeSession?: ActiveRiskSession;
  activeCooldowns: Record<string, ActiveCooldown>; // Multi-group cooldown support
  activeAccessLeases: Record<string, AccessLease>; // Multi-group temporary override leases
  activeRoutineWindowIds: string[];
  activeRestrictions: AppRestriction[]; // Desired restrictions
}

export interface PersistedRuntime {
  state: RhythmState;
  activeCooldowns: Record<string, ActiveCooldown>;
  activeAccessLeases?: Record<string, AccessLease>;
  activeSession?: ActiveRiskSession;
  activeRoutineWindowIds: string[];
  lastReconciledAt: number;
}

export interface RhythmConfiguration {
  routineWindows: RoutineWindow[];
  riskGroups: RiskGroup[];
  apps: DeviceApp[];
  sessionResetGapMs?: number;
}

export interface RhythmPreferences {
  routineWindows: RoutineWindow[];
  riskGroups: RiskGroup[];
  appClassifications: Record<string, { classification: AppClassification; riskGroupId?: string }>;
  sessionResetGapMs: number;
  onboardingCompleted: boolean;
}

export type RhythmHistoryEvent =
  | { type: 'risk-session-started'; groupId: string; appId: string; timestamp: number }
  | { type: 'risk-session-ended'; groupId: string; durationSeconds: number; timestamp: number }
  | { type: 'cooldown-started'; groupId: string; timestamp: number }
  | { type: 'cooldown-ended'; groupId: string; timestamp: number }
  | { type: 'access-lease-started'; groupId: string; reason: 'emergency' | 'intentional'; timestamp: number }
  | { type: 'access-lease-ended'; groupId: string; timestamp: number }
  | { type: 'routine-started'; windowId: string; timestamp: number }
  | { type: 'routine-ended'; windowId: string; timestamp: number }
  | { type: 'emergency-bypass'; timestamp: number };

export type RhythmEvent =
  | { type: 'APP_FOREGROUND'; appId: string; timestamp: number }
  | { type: 'APP_BACKGROUND'; appId: string; timestamp: number }
  | { type: 'CLOCK_TICK'; timestamp: number }
  | { type: 'ROUTINE_STARTED'; windowId: string; timestamp: number }
  | { type: 'ROUTINE_ENDED'; windowId: string; timestamp: number }
  | { type: 'COOLDOWN_STARTED'; groupId: string; endsAt: number; timestamp: number }
  | { type: 'COOLDOWN_ENDED'; groupId: string; timestamp: number }
  | { type: 'START_ACCESS_LEASE'; groupId: string; durationMinutes?: number; reason?: 'emergency' | 'intentional'; timestamp: number }
  | { type: 'END_ACCESS_LEASE'; groupId: string; timestamp: number }
  | { type: 'RECONCILE'; timestamp: number };

export type RhythmEffect =
  | { type: 'APPLY_RESTRICTIONS'; appIds: string[] }
  | { type: 'CLEAR_RESTRICTIONS'; appIds: string[] }
  | { type: 'START_COOLDOWN'; groupId: string; endsAt: number }
  | { type: 'END_COOLDOWN'; groupId: string }
  | { type: 'START_ACCESS_LEASE'; groupId: string; endsAt: number }
  | { type: 'END_ACCESS_LEASE'; groupId: string }
  | { type: 'RECORD_HISTORY'; event: RhythmHistoryEvent };

export type EngineHealth = 'ready' | 'degraded' | 'unavailable';

export interface EngineStatus {
  health: EngineHealth;
  issues: string[];
}

/**
 * Returns all active (unexpired) cooldowns for a given timestamp.
 */
export function getActiveCooldowns(
  cooldowns: Record<string, ActiveCooldown> = {},
  now: number = Date.now()
): ActiveCooldown[] {
  return Object.values(cooldowns).filter((cooldown) => cooldown.endsAt > now);
}

/**
 * Returns all active (unexpired) access leases for a given timestamp.
 */
export function getActiveAccessLeases(
  leases: Record<string, AccessLease> = {},
  now: number = Date.now()
): AccessLease[] {
  return Object.values(leases).filter((lease) => lease.endsAt > now);
}

/**
 * Returns the primary (most recently started active) cooldown for UI display.
 */
export function getPrimaryCooldown(
  runtimeOrPersisted?: RhythmRuntime | PersistedRuntime | null,
  now: number = Date.now()
): ActiveCooldown | undefined {
  if (!runtimeOrPersisted?.activeCooldowns) return undefined;
  const active = getActiveCooldowns(runtimeOrPersisted.activeCooldowns, now);
  return active.sort((a, b) => b.startedAt - a.startedAt)[0];
}

/**
 * Normalizes legacy persisted objects to multi-cooldown and multi-lease map.
 */
export function normalizePersistedRuntime(raw: any): PersistedRuntime | null {
  if (!raw || typeof raw !== 'object') return null;

  let activeCooldowns: Record<string, ActiveCooldown> = {};

  if (raw.activeCooldowns && typeof raw.activeCooldowns === 'object') {
    activeCooldowns = { ...raw.activeCooldowns };
  } else if (raw.activeCooldown && typeof raw.activeCooldown === 'object' && raw.activeCooldown.groupId) {
    activeCooldowns[raw.activeCooldown.groupId] = raw.activeCooldown;
  }

  let activeAccessLeases: Record<string, AccessLease> = {};
  if (raw.activeAccessLeases && typeof raw.activeAccessLeases === 'object') {
    activeAccessLeases = { ...raw.activeAccessLeases };
  }

  const res: PersistedRuntime = {
    state: raw.state || 'available',
    activeCooldowns,
    activeAccessLeases,
    activeRoutineWindowIds: Array.isArray(raw.activeRoutineWindowIds) ? raw.activeRoutineWindowIds : [],
    lastReconciledAt: typeof raw.lastReconciledAt === 'number' ? raw.lastReconciledAt : Date.now(),
  };

  if (raw.activeSession) {
    res.activeSession = raw.activeSession;
  }

  return res;
}
