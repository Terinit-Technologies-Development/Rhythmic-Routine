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

/** One durable, verified cooldown-Meditation completion. */
export interface MeditationCompletionEntry {
  gateId: string;
  groupId: string;
  providerSessionId: string;
  attentionDayId: string;
  completedAt: number;
}

export interface DailyAttentionExchangeState {
  /** @deprecated Local calendar date key. Kept for native/Reader compatibility. */
  dateKey: string;
  cooldownsTriggered: number;
  /** @deprecated v1.2 cumulative projection; kept for native persistence compat. */
  highestRequiredActiveSeconds: number;
  /** @deprecated v1.2 cumulative projection; kept for native persistence compat. */
  highestRequiredQualifiedPages: number;
  updatedAt: number;
  /**
   * Pass 3: the behavioral-day identity (Morning-Buffer-boundary day). Gates,
   * cooldowns, and the meditation substitution counter reset ONLY at this
   * boundary — never at midnight.
  */
  attentionDayId?: string;
  /**
   * Persisted close boundary for the active Attention Day. This freezes the
   * current cycle when the schedule is edited and survives midnight/restart.
   */
  attentionDayNextBoundaryAt?: number;
  /**
   * Pass 3: cooldown Meditation substitutions consumed in this Attention Day.
   * Capped (2/day). Morning/Evening/Standalone meditation never consume it.
   * Kept as a projection of [meditationCompletions] for older native/UI readers.
   */
  meditationSubstitutionsUsed?: number;
  /**
   * Durable, append-only per-Attention-Day completion ledger. One entry per
   * verified cooldown gate/provider session; a gate can never contribute twice
   * and a morning session is never recorded here. Survives restart, re-import
   * and day rollover (old entries are retained for Insights history).
   */
  meditationCompletions?: MeditationCompletionEntry[];
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

  // Pass 3 policy: cooldown 3 is the daily Reader baseline and every later
  // cooldown carries ONE discrete restorative requirement. The v1.2 cumulative
  // escalation (60/36, 90/47, 120/58, ...) is obsolete after cooldown 3.
  if (safeOrdinal === policy.freeCooldownCount + 1) {
    return {
      activeSeconds: policy.baselineActiveSeconds,
      qualifiedPages: policy.baselineQualifiedPages,
    };
  }
  return {
    activeSeconds: policy.incrementalActiveSeconds,
    qualifiedPages: policy.incrementalQualifiedPages,
  };
}

/**
 * The obsolete v1.2 cumulative escalation. Kept ONLY so migration and legacy
 * gate audits can reproduce historical requirements (e.g. an active
 * 5400s/47p gate). Never use this for new cooldowns.
 */
export function legacyReadingRequirementForCooldownOrdinal(
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
  updatedAt: number,
  attentionDayId?: string,
  attentionDayNextBoundaryAt?: number
): DailyAttentionExchangeState {
  return {
    dateKey,
    cooldownsTriggered: 0,
    highestRequiredActiveSeconds: 0,
    highestRequiredQualifiedPages: 0,
    updatedAt,
    meditationSubstitutionsUsed: 0,
    meditationCompletions: [],
    ...(attentionDayId ? { attentionDayId } : {}),
    ...(Number.isFinite(attentionDayNextBoundaryAt)
      ? { attentionDayNextBoundaryAt }
      : {}),
  };
}

export function reconcileAttentionExchangeDate(
  state: DailyAttentionExchangeState,
  now: number
): DailyAttentionExchangeState {
  const dateKey = getLocalDateKey(now);
  if (state.dateKey !== dateKey) {
    const sameAttentionDay =
      typeof state.attentionDayId === 'string' &&
      (!Number.isFinite(state.attentionDayNextBoundaryAt) ||
        state.attentionDayNextBoundaryAt! > now);
    if (!sameAttentionDay) {
      const next = createDailyAttentionExchangeState(dateKey, now, state.attentionDayId);
      return carryCompletionLedgerIntoNewDay(next, state);
    }
    // `dateKey` remains calendar-day scoped for Reader compatibility. Cooldown
    // ordinals and substitutions are Attention-Day scoped and must carry over
    // midnight when a Morning Buffer is active.
    return {
      dateKey,
      cooldownsTriggered: nonNegativeInteger(state.cooldownsTriggered),
      highestRequiredActiveSeconds: nonNegativeInteger(state.highestRequiredActiveSeconds),
      highestRequiredQualifiedPages: nonNegativeInteger(state.highestRequiredQualifiedPages),
      updatedAt: now,
      meditationSubstitutionsUsed: resolveMeditationSubstitutionsUsed(state, state.attentionDayId),
      ...(state.meditationCompletions !== undefined
        ? { meditationCompletions: normalizeMeditationCompletions(state.meditationCompletions) }
        : {}),
      ...(state.attentionDayId ? { attentionDayId: state.attentionDayId } : {}),
      ...(Number.isFinite(state.attentionDayNextBoundaryAt)
        ? { attentionDayNextBoundaryAt: state.attentionDayNextBoundaryAt }
        : {}),
    };
  }
  return {
    dateKey,
    cooldownsTriggered: nonNegativeInteger(state.cooldownsTriggered),
    highestRequiredActiveSeconds: nonNegativeInteger(state.highestRequiredActiveSeconds),
    highestRequiredQualifiedPages: nonNegativeInteger(state.highestRequiredQualifiedPages),
    updatedAt: Number.isFinite(state.updatedAt) ? state.updatedAt : now,
    meditationSubstitutionsUsed: resolveMeditationSubstitutionsUsed(state, state.attentionDayId),
    ...(state.meditationCompletions !== undefined
      ? { meditationCompletions: normalizeMeditationCompletions(state.meditationCompletions) }
      : {}),
    ...(state.attentionDayId ? { attentionDayId: state.attentionDayId } : {}),
    ...(Number.isFinite(state.attentionDayNextBoundaryAt)
      ? { attentionDayNextBoundaryAt: state.attentionDayNextBoundaryAt }
      : {}),
  };
}

/**
 * Pass 3 daily reconciliation: counters reset ONLY at the Attention Day
 * boundary (Morning Buffer end), never at midnight. State that predates the
 * Attention Day (no id yet) adopts the current day WITHOUT losing counters;
 * only a real day change resets them. The compat `dateKey` still follows the
 * local calendar day for Reader/legacy consumers.
 */
export function reconcileAttentionExchangeForAttentionDay(
  state: DailyAttentionExchangeState,
  attentionDayId: string,
  now: number
): DailyAttentionExchangeState {
  const dateKey = getLocalDateKey(now);
  if (state.attentionDayId === attentionDayId || state.attentionDayId === undefined) {
    return {
      dateKey,
      cooldownsTriggered: nonNegativeInteger(state.cooldownsTriggered),
      highestRequiredActiveSeconds: nonNegativeInteger(state.highestRequiredActiveSeconds),
      highestRequiredQualifiedPages: nonNegativeInteger(state.highestRequiredQualifiedPages),
      updatedAt: Number.isFinite(state.updatedAt) ? state.updatedAt : now,
      meditationSubstitutionsUsed: resolveMeditationSubstitutionsUsed(state, attentionDayId),
      ...(state.meditationCompletions !== undefined
        ? { meditationCompletions: normalizeMeditationCompletions(state.meditationCompletions) }
        : {}),
      attentionDayId,
      ...(Number.isFinite(state.attentionDayNextBoundaryAt)
        ? { attentionDayNextBoundaryAt: state.attentionDayNextBoundaryAt }
        : {}),
    };
  }
  const next = createDailyAttentionExchangeState(dateKey, now, attentionDayId);
  return carryCompletionLedgerIntoNewDay(next, state);
}

/**
 * New Attention Days reset the numeric counter but keep the additive owning-day
 * completion history needed by PD-2 late completion/cap checks. Legacy states
 * without a ledger keep their exact previous shape.
 */
function carryCompletionLedgerIntoNewDay(
  next: DailyAttentionExchangeState,
  previous: DailyAttentionExchangeState
): DailyAttentionExchangeState {
  if (previous.meditationCompletions === undefined) {
    const { meditationCompletions: _ignored, ...rest } = next;
    void _ignored;
    return rest;
  }
  return {
    ...next,
    meditationCompletions: normalizeMeditationCompletions(previous.meditationCompletions),
  };
}

/**
 * Consumes one cooldown-Meditation substitution. Idempotency is enforced by
 * callers through gate state (substitution is consumed exactly once per gate);
 * this helper only enforces the Attention Day cap. Prefer
 * [recordMeditationCompletion], which also appends the durable ledger entry.
 */
export function consumeMeditationSubstitution(
  state: DailyAttentionExchangeState,
  now: number,
  maxSubstitutions: number = 2
): DailyAttentionExchangeState {
  const used = resolveMeditationSubstitutionsUsed(state, state.attentionDayId);
  if (used >= maxSubstitutions) return state;
  return {
    ...state,
    meditationSubstitutionsUsed: used + 1,
    updatedAt: now,
  };
}

/** Completions recorded for one Attention Day (never cross-day). */
export function meditationCompletionsForAttentionDay(
  state: DailyAttentionExchangeState,
  attentionDayId: string | undefined
): MeditationCompletionEntry[] {
  if (!attentionDayId) return [];
  return normalizeMeditationCompletions(state.meditationCompletions).filter(
    (entry) => entry.attentionDayId === attentionDayId
  );
}

/**
 * The authoritative substitution count for an Attention Day. The ledger wins;
 * the numeric projection is retained only as an upgrade fallback so an
 * existing v1.2 count is never reset early.
 */
export function resolveMeditationSubstitutionsUsed(
  state: DailyAttentionExchangeState,
  attentionDayId: string | undefined
): number {
  const ledgerCount = meditationCompletionsForAttentionDay(state, attentionDayId).length;
  const sameDay =
    state.attentionDayId === undefined || state.attentionDayId === attentionDayId;
  return Math.max(ledgerCount, sameDay ? nonNegativeInteger(state.meditationSubstitutionsUsed) : 0);
}

/**
 * Appends one verified cooldown-Meditation completion. Idempotent by gateId, so
 * repeated provider returns, retries, re-imports and restarts never count the
 * same gate twice. The cap is enforced against the durable ledger.
 */
export function recordMeditationCompletion(
  state: DailyAttentionExchangeState,
  entry: MeditationCompletionEntry,
  now: number,
  maxSubstitutions: number = 2
): DailyAttentionExchangeState {
  const completions = normalizeMeditationCompletions(state.meditationCompletions);
  if (completions.some((item) => item.gateId === entry.gateId)) return state;
  const sameAsCurrentDay =
    state.attentionDayId === undefined || state.attentionDayId === entry.attentionDayId;
  const entryDayUsed = Math.max(
    meditationCompletionsForAttentionDay(state, entry.attentionDayId).length,
    sameAsCurrentDay ? nonNegativeInteger(state.meditationSubstitutionsUsed) : 0
  );
  if (entryDayUsed >= maxSubstitutions) return state;
  const currentDayUsed = resolveMeditationSubstitutionsUsed(state, state.attentionDayId);
  return {
    ...state,
    meditationCompletions: [...completions, { ...entry }],
    // A late completion is charged to its ORIGINAL Attention Day through the
    // ledger. Only a completion in the current day advances the current-day
    // numeric projection; an old-day completion must not debit the new day.
    meditationSubstitutionsUsed: sameAsCurrentDay
      ? currentDayUsed + 1
      : currentDayUsed,
    updatedAt: now,
  };
}

/** Drops malformed persisted ledger rows; never invents completions. */
export function normalizeMeditationCompletions(
  value: unknown
): MeditationCompletionEntry[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: MeditationCompletionEntry[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Partial<MeditationCompletionEntry>;
    if (
      typeof entry.gateId !== 'string' ||
      entry.gateId.length === 0 ||
      typeof entry.groupId !== 'string' ||
      entry.groupId.length === 0 ||
      typeof entry.providerSessionId !== 'string' ||
      typeof entry.attentionDayId !== 'string' ||
      entry.attentionDayId.length === 0 ||
      typeof entry.completedAt !== 'number' ||
      !Number.isFinite(entry.completedAt) ||
      seen.has(entry.gateId)
    ) {
      continue;
    }
    seen.add(entry.gateId);
    result.push({
      gateId: entry.gateId,
      groupId: entry.groupId,
      providerSessionId: entry.providerSessionId,
      attentionDayId: entry.attentionDayId,
      completedAt: entry.completedAt as number,
    });
  }
  return result;
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

/**
 * Reader V2 evidence is calendar-day scoped. A carried CD3 gate may be
 * satisfied by trusted evidence for the current local date OR its own creation
 * date — never by pooling the two aggregates and never by an Attention-Day
 * sum (FR-08/POL-03, PD-2 SC-7/SC-8).
 */
function trustedReadingEvidenceForGate(
  evidence: ReadingEvidenceAvailability | undefined,
  currentDateKey: string,
  gateDateKey: string
): ReadingEvidenceAvailability | undefined {
  if (!evidence) return undefined;
  if (evidence.dateKey === currentDateKey && isTrustedEvidenceForDate(evidence, currentDateKey)) {
    return evidence;
  }
  if (
    gateDateKey !== currentDateKey &&
    evidence.dateKey === gateDateKey &&
    isTrustedEvidenceForDate(evidence, gateDateKey)
  ) {
    return evidence;
  }
  return undefined;
}

export function reconcileReadingGate(input: {
  gate: ActiveReadingGate;
  evidence?: ReadingEvidenceAvailability;
  now: number;
  currentDateKey: string;
}): ActiveReadingGate | undefined {
  const { gate, evidence, now, currentDateKey } = input;
  // PD-2: an unfinished gate is carried across calendar/Attention-Day
  // boundaries. Only verified completion removes it; a missing, failed or
  // stale projection never does.
  if (gate.cooldownEndsAt > now) return { ...gate };
  const trusted = trustedReadingEvidenceForGate(
    evidence,
    currentDateKey,
    gate.attentionDateKey
  );
  if (!trusted) return { ...gate };

  const requirement: ReadingRequirement = {
    activeSeconds: gate.requiredReadingSeconds,
    qualifiedPages: gate.requiredQualifiedPages,
  };
  return isReadingRequirementSatisfied(trusted, requirement) ? undefined : { ...gate };
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
  if (!gate) {
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

  // PD-2: a gate created on an earlier calendar day remains the same
  // obligation. Current-day OR creation-day V2 evidence may satisfy it; the
  // two daily aggregates are never merged.
  const trustedEvidence = trustedReadingEvidenceForGate(
    input.evidence,
    input.currentDateKey,
    gate.attentionDateKey
  );
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
