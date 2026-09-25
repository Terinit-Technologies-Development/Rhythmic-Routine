import { getLocalDateKey } from './allowance';

export interface ReadingAttentionPolicy {
  readonly freeCooldownCount: number;
  readonly baselineActiveSeconds: number;
  readonly baselineQualifiedPages: number;
  readonly incrementalActiveSeconds: number;
  readonly incrementalQualifiedPages: number;
}

export const DEFAULT_READING_ATTENTION_POLICY: ReadingAttentionPolicy = Object.freeze({
  freeCooldownCount: 2,
  baselineActiveSeconds: 60 * 60,
  baselineQualifiedPages: 36,
  incrementalActiveSeconds: 30 * 60,
  incrementalQualifiedPages: 11,
});

export interface ReadingRequirement {
  activeSeconds: number;
  qualifiedPages: number;
}

export interface DailyAttentionExchangeState {
  dateKey: string;
  cooldownsTriggered: number;
  highestRequiredActiveSeconds: number;
  highestRequiredQualifiedPages: number;
  updatedAt: number;
}

export interface ActiveReadingGate {
  groupId: string;
  attentionDateKey: string;
  dailyCooldownOrdinal: number;
  createdAt: number;
  cooldownEndsAt: number;
  requiredReadingSeconds: number;
  requiredQualifiedPages: number;
}

export interface ReadingEvidenceAvailability {
  dateKey: string;
  providerAvailable: boolean;
  protocolCompatible: boolean;
  verifiedActiveSeconds: number;
  qualifiedPages: number;
}

export type AttentionGatePhase =
  | 'none'
  | 'cooldown-active'
  | 'reading-required'
  | 'reader-unavailable'
  | 'reader-incompatible'
  | 'satisfied';

export interface AttentionGateStatus {
  groupId: string;
  phase: AttentionGatePhase;
  ordinal?: number;
  requiredReadingSeconds: number;
  requiredQualifiedPages: number;
  verifiedReadingSeconds: number;
  qualifiedPages: number;
  remainingReadingSeconds: number;
  remainingQualifiedPages: number;
  cooldownEndsAt?: number;
}

export function isValidLocalDateKey(dateKey: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return false;
  const parsed = new Date(`${dateKey}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === dateKey;
}

export function requirementForCooldownOrdinal(
  ordinal: number,
  policy: ReadingAttentionPolicy = DEFAULT_READING_ATTENTION_POLICY
): ReadingRequirement {
  const safeOrdinal = Number.isFinite(ordinal) ? Math.max(0, Math.floor(ordinal)) : 0;
  if (safeOrdinal <= policy.freeCooldownCount) {
    return { activeSeconds: 0, qualifiedPages: 0 };
  }

  const increments = safeOrdinal - (policy.freeCooldownCount + 1);
  return {
    activeSeconds:
      policy.baselineActiveSeconds + increments * policy.incrementalActiveSeconds,
    qualifiedPages:
      policy.baselineQualifiedPages + increments * policy.incrementalQualifiedPages,
  };
}

export function createDailyAttentionExchangeState(
  dateKey: string,
  updatedAt: number
): DailyAttentionExchangeState {
  return {
    dateKey,
    cooldownsTriggered: 0,
    highestRequiredActiveSeconds: 0,
    highestRequiredQualifiedPages: 0,
    updatedAt,
  };
}

export function reconcileAttentionExchangeDate(
  state: DailyAttentionExchangeState,
  now: number
): DailyAttentionExchangeState {
  const dateKey = getLocalDateKey(now);
  if (state.dateKey !== dateKey) {
    return createDailyAttentionExchangeState(dateKey, now);
  }
  return {
    dateKey,
    cooldownsTriggered: nonNegativeInteger(state.cooldownsTriggered),
    highestRequiredActiveSeconds: nonNegativeInteger(state.highestRequiredActiveSeconds),
    highestRequiredQualifiedPages: nonNegativeInteger(state.highestRequiredQualifiedPages),
    updatedAt: Number.isFinite(state.updatedAt) ? state.updatedAt : now,
  };
}

/**
 * Upgrade initializer for persisted pre-v1.2 state. Legacy cooldowns created
 * today count toward the global free-cycle allowance, but receive no retroactive gate.
 */
export function migrateDailyAttentionExchange(
  activeCooldowns: Record<string, CooldownAttentionSnapshot> = {},
  now: number,
  activeReadingGates: Record<string, ActiveReadingGate> = {}
): DailyAttentionExchangeState {
  const dateKey = getLocalDateKey(now);
  const state = createDailyAttentionExchangeState(dateKey, now);
  let highestKnownOrdinal = 0;
  let observedLegacyCooldowns = 0;

  for (const cooldown of Object.values(activeCooldowns)) {
    if (
      cooldown.attentionDateKey === dateKey &&
      isPositiveInteger(cooldown.dailyCooldownOrdinal)
    ) {
      highestKnownOrdinal = Math.max(highestKnownOrdinal, cooldown.dailyCooldownOrdinal);
      state.highestRequiredActiveSeconds = Math.max(
        state.highestRequiredActiveSeconds,
        nonNegativeInteger(cooldown.requiredReadingSeconds)
      );
      state.highestRequiredQualifiedPages = Math.max(
        state.highestRequiredQualifiedPages,
        nonNegativeInteger(cooldown.requiredQualifiedPages)
      );
    } else if (getLocalDateKey(cooldown.startedAt) === dateKey) {
      observedLegacyCooldowns += 1;
    }
  }

  for (const gate of Object.values(activeReadingGates)) {
    if (gate.attentionDateKey !== dateKey) continue;
    highestKnownOrdinal = Math.max(highestKnownOrdinal, nonNegativeInteger(gate.dailyCooldownOrdinal));
    state.highestRequiredActiveSeconds = Math.max(
      state.highestRequiredActiveSeconds,
      nonNegativeInteger(gate.requiredReadingSeconds)
    );
    state.highestRequiredQualifiedPages = Math.max(
      state.highestRequiredQualifiedPages,
      nonNegativeInteger(gate.requiredQualifiedPages)
    );
  }

  state.cooldownsTriggered = highestKnownOrdinal + observedLegacyCooldowns;
  return state;
}

export interface CooldownAttentionSnapshot {
  groupId: string;
  startedAt: number;
  endsAt: number;
  dailyCooldownOrdinal?: number;
  attentionDateKey?: string;
  requiredReadingSeconds?: number;
  requiredQualifiedPages?: number;
}

export function allocateCooldownRequirement(
  state: DailyAttentionExchangeState,
  now: number,
  policy: ReadingAttentionPolicy = DEFAULT_READING_ATTENTION_POLICY
): {
  nextState: DailyAttentionExchangeState;
  ordinal: number;
  requirement: ReadingRequirement;
} {
  const reconciled = reconcileAttentionExchangeDate(state, now);
  const ordinal = reconciled.cooldownsTriggered + 1;
  const requirement = requirementForCooldownOrdinal(ordinal, policy);
  return {
    nextState: {
      ...reconciled,
      cooldownsTriggered: ordinal,
      highestRequiredActiveSeconds: Math.max(
        reconciled.highestRequiredActiveSeconds,
        requirement.activeSeconds
      ),
      highestRequiredQualifiedPages: Math.max(
        reconciled.highestRequiredQualifiedPages,
        requirement.qualifiedPages
      ),
      updatedAt: now,
    },
    ordinal,
    requirement,
  };
}

export function isReadingRequirementSatisfied(
  evidence: Pick<ReadingEvidenceAvailability, 'verifiedActiveSeconds' | 'qualifiedPages'>,
  requirement: ReadingRequirement
): boolean {
  return (
    evidence.verifiedActiveSeconds >= requirement.activeSeconds &&
    evidence.qualifiedPages >= requirement.qualifiedPages
  );
}

export function remainingReadingRequirement(
  evidence: Pick<ReadingEvidenceAvailability, 'verifiedActiveSeconds' | 'qualifiedPages'>,
  requirement: ReadingRequirement
): ReadingRequirement {
  return {
    activeSeconds: Math.max(0, requirement.activeSeconds - evidence.verifiedActiveSeconds),
    qualifiedPages: Math.max(0, requirement.qualifiedPages - evidence.qualifiedPages),
  };
}

export function isTrustedEvidenceForDate(
  evidence: ReadingEvidenceAvailability | undefined,
  dateKey: string
): evidence is ReadingEvidenceAvailability {
  return Boolean(
    evidence &&
      evidence.dateKey === dateKey &&
      evidence.providerAvailable &&
      evidence.protocolCompatible &&
      Number.isFinite(evidence.verifiedActiveSeconds) &&
      evidence.verifiedActiveSeconds >= 0 &&
      Number.isFinite(evidence.qualifiedPages) &&
      Number.isInteger(evidence.qualifiedPages) &&
      evidence.qualifiedPages >= 0
  );
}

export function reconcileReadingGate(input: {
  gate: ActiveReadingGate;
  evidence?: ReadingEvidenceAvailability;
  now: number;
  currentDateKey: string;
}): ActiveReadingGate | undefined {
  const { gate, evidence, now, currentDateKey } = input;
  if (gate.attentionDateKey !== currentDateKey) return undefined;
  if (gate.cooldownEndsAt > now) return { ...gate };
  if (!isTrustedEvidenceForDate(evidence, currentDateKey)) return { ...gate };

  const requirement: ReadingRequirement = {
    activeSeconds: gate.requiredReadingSeconds,
    qualifiedPages: gate.requiredQualifiedPages,
  };
  return isReadingRequirementSatisfied(evidence, requirement) ? undefined : { ...gate };
}

export function deriveAttentionGateStatus(input: {
  groupId?: string;
  gate?: ActiveReadingGate;
  cooldown?: CooldownAttentionSnapshot;
  evidence?: ReadingEvidenceAvailability;
  now: number;
  currentDateKey: string;
}): AttentionGateStatus {
  const cooldown = input.cooldown;
  const gate = input.gate ?? (cooldown &&
    cooldown.attentionDateKey === input.currentDateKey &&
    (cooldown.requiredReadingSeconds ?? 0) + (cooldown.requiredQualifiedPages ?? 0) > 0
    ? {
        groupId: cooldown.groupId,
        attentionDateKey: cooldown.attentionDateKey,
        dailyCooldownOrdinal: cooldown.dailyCooldownOrdinal ?? 0,
        createdAt: cooldown.startedAt,
        cooldownEndsAt: cooldown.endsAt,
        requiredReadingSeconds: cooldown.requiredReadingSeconds ?? 0,
        requiredQualifiedPages: cooldown.requiredQualifiedPages ?? 0,
      }
    : undefined);
  const groupId = gate?.groupId ?? cooldown?.groupId ?? input.groupId ?? '';
  if (!gate || gate.attentionDateKey !== input.currentDateKey) {
    if (cooldown && cooldown.endsAt > input.now) {
      const currentDateCooldown = cooldown.attentionDateKey === input.currentDateKey;
      const requiredReadingSeconds = currentDateCooldown ? cooldown.requiredReadingSeconds ?? 0 : 0;
      const requiredQualifiedPages = currentDateCooldown ? cooldown.requiredQualifiedPages ?? 0 : 0;
      const trustedEvidence = isTrustedEvidenceForDate(input.evidence, input.currentDateKey)
        ? input.evidence
        : undefined;
      const values = {
        verifiedActiveSeconds: trustedEvidence?.verifiedActiveSeconds ?? 0,
        qualifiedPages: trustedEvidence?.qualifiedPages ?? 0,
      };
      const remaining = remainingReadingRequirement(values, {
        activeSeconds: requiredReadingSeconds,
        qualifiedPages: requiredQualifiedPages,
      });
      return {
        groupId,
        phase: 'cooldown-active',
        ...(currentDateCooldown && cooldown.dailyCooldownOrdinal !== undefined
          ? { ordinal: cooldown.dailyCooldownOrdinal }
          : {}),
        requiredReadingSeconds,
        requiredQualifiedPages,
        verifiedReadingSeconds: values.verifiedActiveSeconds,
        qualifiedPages: values.qualifiedPages,
        remainingReadingSeconds: remaining.activeSeconds,
        remainingQualifiedPages: remaining.qualifiedPages,
        cooldownEndsAt: cooldown.endsAt,
      };
    }
    return emptyAttentionGateStatus(groupId);
  }

  const trustedEvidence = isTrustedEvidenceForDate(input.evidence, input.currentDateKey)
    ? input.evidence
    : undefined;
  const values = {
    verifiedActiveSeconds: trustedEvidence?.verifiedActiveSeconds ?? 0,
    qualifiedPages: trustedEvidence?.qualifiedPages ?? 0,
  };
  const requirement = {
    activeSeconds: gate.requiredReadingSeconds,
    qualifiedPages: gate.requiredQualifiedPages,
  };
  const remaining = remainingReadingRequirement(values, requirement);

  let phase: AttentionGatePhase;
  if (gate.cooldownEndsAt > input.now) {
    phase = 'cooldown-active';
  } else if (!input.evidence?.providerAvailable) {
    phase = 'reader-unavailable';
  } else if (!input.evidence.protocolCompatible) {
    phase = 'reader-incompatible';
  } else if (!trustedEvidence) {
    phase = 'reader-incompatible';
  } else if (isReadingRequirementSatisfied(values, requirement)) {
    phase = 'satisfied';
  } else {
    phase = 'reading-required';
  }

  return {
    groupId,
    phase,
    ordinal: gate.dailyCooldownOrdinal,
    requiredReadingSeconds: gate.requiredReadingSeconds,
    requiredQualifiedPages: gate.requiredQualifiedPages,
    verifiedReadingSeconds: values.verifiedActiveSeconds,
    qualifiedPages: values.qualifiedPages,
    remainingReadingSeconds: remaining.activeSeconds,
    remainingQualifiedPages: remaining.qualifiedPages,
    cooldownEndsAt: gate.cooldownEndsAt,
  };
}

function emptyAttentionGateStatus(groupId: string): AttentionGateStatus {
  return {
    groupId,
    phase: 'none',
    requiredReadingSeconds: 0,
    requiredQualifiedPages: 0,
    verifiedReadingSeconds: 0,
    qualifiedPages: 0,
    remainingReadingSeconds: 0,
    remainingQualifiedPages: 0,
  };
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}
