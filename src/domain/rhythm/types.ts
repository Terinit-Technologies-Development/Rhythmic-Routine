import {
  AccessLease,
  AccountabilitySettings,
  AppClassification,
  DailyAppUsage,
  DailyRiskAllowancePolicy,
  DeviceApp,
  EMERGENCY_ACCESS_MINUTES,
  GroupAllowanceUsage,
  RhythmState,
  RiskGroup,
  RoutineWindow,
} from '../../types/domain';
import {
  migrateDailyAttentionExchange,
  isValidLocalDateKey,
  type ActiveReadingGate,
  type DailyAttentionExchangeState,
} from './attentionExchange';
import type { ReadingEvidenceSnapshot } from './readingEvidence';

export {
  AccessLease,
  AccountabilitySettings,
  EMERGENCY_ACCESS_MINUTES,
  DailyAppUsage,
  DailyRiskAllowancePolicy,
  GroupAllowanceUsage,
};

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
  dailyCooldownOrdinal?: number;
  attentionDateKey?: string;
  requiredReadingSeconds?: number;
  requiredQualifiedPages?: number;
  recoverySessionId?: string;
  recoveryRequired?: boolean;
  cycleNumber?: number;
}

export type RestrictionReasonType =
  | 'routine'
  | 'routine-morning'
  | 'routine-evening'
  | 'routine-overnight'
  | 'daily-allowance'
  | 'cooldown'
  | 'reading-quota';

export interface RestrictionReason {
  type: RestrictionReasonType;
  sourceId: string; // RoutineWindow ID, RiskGroup ID, or App ID
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
  /** @deprecated v1.0.2: legacy per-app ledger. Group ledger (groupAllowanceUsage) is authoritative. */
  dailyAppUsage?: Record<string, DailyAppUsage>;
  /** v1.0.2: one shared allowance ledger per Risk Group. */
  groupAllowanceUsage?: Record<string, GroupAllowanceUsage>;
  /** v1.2 daily global ordinal and highest productive-attention requirement. */
  dailyAttentionExchange?: DailyAttentionExchangeState;
  /** v1.2 reading obligations survive expiration of their cooldown timer. */
  activeReadingGates?: Record<string, ActiveReadingGate>;
  /** Cached Reader Protocol V2 projection; Reader remains the evidence authority. */
  readingEvidence?: ReadingEvidenceSnapshot;
}

export interface PersistedRuntime {
  state: RhythmState;
  activeCooldowns: Record<string, ActiveCooldown>;
  activeAccessLeases?: Record<string, AccessLease>;
  activeSession?: ActiveRiskSession;
  activeRoutineWindowIds: string[];
  /** @deprecated v1.0.2: legacy per-app ledger (migration clears stale exhaustion). */
  dailyAppUsage?: Record<string, DailyAppUsage>;
  /** v1.0.2: per-group allowance ledgers. */
  groupAllowanceUsage?: Record<string, GroupAllowanceUsage>;
  /** v1.2 daily global ordinal and highest productive-attention requirement. */
  dailyAttentionExchange?: DailyAttentionExchangeState;
  /** v1.2 reading obligations survive expiration of their cooldown timer. */
  activeReadingGates?: Record<string, ActiveReadingGate>;
  /** Cached Reader Protocol V2 projection; always refresh from Reader when available. */
  readingEvidence?: ReadingEvidenceSnapshot;
  lastReconciledAt: number;
}

export interface RhythmConfiguration {
  routineWindows: RoutineWindow[];
  riskGroups: RiskGroup[];
  apps: DeviceApp[];
  sessionResetGapMs?: number;
  accountability?: AccountabilitySettings;
}

export interface RhythmPreferences {
  routineWindows: RoutineWindow[];
  riskGroups: RiskGroup[];
  appClassifications: Record<
    string,
    {
      classification: AppClassification;
      riskGroupId?: string;
      /** @deprecated v1.0.2: migration read only; never a policy source. */
      dailyRiskAllowance?: DailyRiskAllowancePolicy;
    }
  >;
  sessionResetGapMs: number;
  onboardingCompleted: boolean;
  accountability?: AccountabilitySettings;
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
  | { type: 'group-protection-started'; groupId: string; timestamp: number }
  | { type: 'group-protection-ended'; groupId: string; timestamp: number }
  | { type: 'group-allowance-edited'; groupId: string; previousMinutes: number; nextMinutes: number; timestamp: number }
  | { type: 'group-allowance-exhausted'; groupId: string; timestamp: number }
  | { type: 'group-recovery-activity-changed'; groupId: string; activityId: string; timestamp: number }
  | { type: 'daily-allowance-edited'; appId: string; previousMinutes: number; nextMinutes: number; timestamp: number }
  | { type: 'daily-allowance-exhausted'; appId: string; timestamp: number }
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
  | { type: 'UPDATE_DAILY_ALLOWANCE'; appId: string; allowanceMinutes: number; timestamp: number }
  | { type: 'UPDATE_GROUP_ALLOWANCE'; groupId: string; allowanceMinutes: number; timestamp: number }
  | { type: 'UPDATE_GROUP_RECOVERY_ACTIVITY'; groupId: string; activityId: string; timestamp: number }
  | { type: 'SYNC_DAILY_APP_USAGE'; dailyAppUsage: Record<string, DailyAppUsage>; timestamp: number }
  | { type: 'SYNC_GROUP_ALLOWANCE_USAGE'; groupAllowanceUsage: Record<string, GroupAllowanceUsage>; timestamp: number }
  | { type: 'SYNC_DAILY_READING_EVIDENCE'; evidence: ReadingEvidenceSnapshot; timestamp: number }
  | { type: 'RECONCILE'; timestamp: number }
  | { type: 'NATIVE_COOLDOWN_RESTORED'; groupId: string; endsAt: number; timestamp: number }
  | { type: 'NATIVE_ACCESS_LEASE_RESTORED'; groupId: string; endsAt: number; timestamp: number }
  | { type: 'RISK_GROUP_DELETED'; groupId: string; timestamp: number };

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
export function normalizePersistedRuntime(raw: any, now: number = Date.now()): PersistedRuntime | null {
  if (!raw || typeof raw !== 'object') return null;

  let activeCooldowns: Record<string, ActiveCooldown> = {};

  if (raw.activeCooldowns && typeof raw.activeCooldowns === 'object') {
    activeCooldowns = Object.fromEntries(
      Object.entries(raw.activeCooldowns)
        .filter(([, cooldown]) => cooldown && typeof cooldown === 'object')
        .map(([groupId, cooldown]) => [groupId, { ...(cooldown as ActiveCooldown) }])
    );
  } else if (raw.activeCooldown && typeof raw.activeCooldown === 'object' && raw.activeCooldown.groupId) {
    activeCooldowns[raw.activeCooldown.groupId] = { ...raw.activeCooldown };
  }

  let activeAccessLeases: Record<string, AccessLease> = {};
  if (raw.activeAccessLeases && typeof raw.activeAccessLeases === 'object') {
    activeAccessLeases = Object.fromEntries(
      Object.entries(raw.activeAccessLeases)
        .filter(([, lease]) => lease && typeof lease === 'object')
        .map(([groupId, lease]) => [groupId, { ...(lease as AccessLease) }])
    );
  }

  const res: PersistedRuntime = {
    state: raw.state || 'available',
    activeCooldowns,
    activeAccessLeases,
    activeRoutineWindowIds: Array.isArray(raw.activeRoutineWindowIds) ? [...raw.activeRoutineWindowIds] : [],
    lastReconciledAt: typeof raw.lastReconciledAt === 'number' ? raw.lastReconciledAt : now,
  };

  if (raw.dailyAttentionExchange && typeof raw.dailyAttentionExchange === 'object') {
    res.dailyAttentionExchange = { ...raw.dailyAttentionExchange };
  }

  if (raw.activeReadingGates && typeof raw.activeReadingGates === 'object') {
    res.activeReadingGates = Object.fromEntries(
      Object.entries(raw.activeReadingGates)
        .filter(([groupId, gate]) =>
          isValidPersistedGate(groupId, gate)
        )
        .map(([groupId, gate]) => [groupId, { ...(gate as ActiveReadingGate) }])
    ) as Record<string, ActiveReadingGate>;
  }

  if (isValidPersistedReadingEvidence(raw.readingEvidence)) {
    res.readingEvidence = { ...raw.readingEvidence };
  }

  res.dailyAttentionExchange = raw.dailyAttentionExchange &&
    typeof raw.dailyAttentionExchange === 'object' &&
    isValidLocalDateKey(raw.dailyAttentionExchange.dateKey) &&
    Number.isFinite(raw.dailyAttentionExchange.cooldownsTriggered)
    ? {
        dateKey: raw.dailyAttentionExchange.dateKey,
        cooldownsTriggered: Math.max(0, Math.floor(raw.dailyAttentionExchange.cooldownsTriggered)),
        highestRequiredActiveSeconds: finiteNonNegativeInteger(raw.dailyAttentionExchange.highestRequiredActiveSeconds),
        highestRequiredQualifiedPages: finiteNonNegativeInteger(raw.dailyAttentionExchange.highestRequiredQualifiedPages),
        updatedAt: Number.isFinite(raw.dailyAttentionExchange.updatedAt) ? raw.dailyAttentionExchange.updatedAt : now,
      }
    : migrateDailyAttentionExchange(activeCooldowns, now, res.activeReadingGates);

  if (raw.dailyAppUsage && typeof raw.dailyAppUsage === 'object') {
    res.dailyAppUsage = cloneObjectValues(raw.dailyAppUsage);
  }

  if (raw.groupAllowanceUsage && typeof raw.groupAllowanceUsage === 'object') {
    res.groupAllowanceUsage = cloneObjectValues(raw.groupAllowanceUsage);
  }

  if (raw.activeSession) {
    res.activeSession = { ...raw.activeSession };
  }

  return res;
}

function isValidPersistedGate(groupId: string, value: unknown): value is ActiveReadingGate {
  if (!value || typeof value !== 'object') return false;
  const gate = value as Partial<ActiveReadingGate>;
  return gate.groupId === groupId &&
    typeof gate.attentionDateKey === 'string' && isValidLocalDateKey(gate.attentionDateKey) &&
    Number.isInteger(gate.dailyCooldownOrdinal) && (gate.dailyCooldownOrdinal ?? 0) > 0 &&
    isFiniteNonNegativeNumber(gate.createdAt) &&
    isFiniteNonNegativeNumber(gate.cooldownEndsAt) &&
    isFiniteNonNegativeNumber(gate.requiredReadingSeconds) &&
    isFiniteNonNegativeNumber(gate.requiredQualifiedPages) &&
    Number.isInteger(gate.requiredReadingSeconds) &&
    Number.isInteger(gate.requiredQualifiedPages);
}

function isValidPersistedReadingEvidence(value: unknown): value is ReadingEvidenceSnapshot {
  if (!value || typeof value !== 'object') return false;
  const evidence = value as Partial<ReadingEvidenceSnapshot>;
  return typeof evidence.dateKey === 'string' && isValidLocalDateKey(evidence.dateKey) &&
    typeof evidence.providerAvailable === 'boolean' &&
    typeof evidence.protocolCompatible === 'boolean' &&
    isFiniteNonNegativeNumber(evidence.verifiedActiveSeconds) &&
    isFiniteNonNegativeNumber(evidence.qualifiedPages) &&
    Number.isInteger(evidence.qualifiedPages) &&
    isFiniteNonNegativeNumber(evidence.syncedAtEpochMs);
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function finiteNonNegativeInteger(value: unknown): number {
  return isFiniteNonNegativeNumber(value) ? Math.floor(value) : 0;
}

function cloneObjectValues<T extends object>(value: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item && typeof item === 'object')
      .map(([key, item]) => [key, { ...item }])
  );
}
