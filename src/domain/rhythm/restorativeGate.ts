import type { ReadingEvidenceAvailability, ReadingRequirement } from './attentionExchange';
import { isReadingRequirementSatisfied, isTrustedEvidenceForDate } from './attentionExchange';
import type { RecoverySessionInfo } from './recovery';
import {
  DEFAULT_MEDITATION_REQUIRED_SECONDS,
  isVerifiedMeditationCompletion,
  type MeditationSessionEvidence,
} from './meditationEvidence';

/**
 * Restorative Gate — the generalized post-v1.2 attention obligation.
 *
 * One gate represents ONE cooldown instance. Policy (owned by Routine):
 *
 *   ordinal 1-2 -> 'none'                  (90-minute separation only)
 *   ordinal 3   -> 'baseline-reading'      (daily Reader baseline 60m / 36p,
 *                                           Reader Daily Evidence V2 aggregate)
 *   ordinal 4+  -> 'restorative-choice'    (ONE discrete requirement:
 *                                           Reader 30m + 11p per bound session
 *                                           OR Meditation 30 qualified minutes)
 *   migrated v1.2 gates -> 'legacy-reading' (original numbers and semantics)
 *
 * Hard invariants:
 * - Cooldown and gate are independent:
 *   `canReenter = cooldownElapsed && gateSatisfiedOrAbsent`.
 * - Neither Reader nor Meditation ever shortens the 90-minute cooldown.
 * - One provider session can never satisfy two gates (session id binding).
 * - Reader and Meditation partial progress can never be combined (provider
 *   locks once meaningful progress exists).
 * - Meditation satisfies at most MAX substitutions per Attention Day.
 * - Provider errors never fail open.
 */

export type RestorativeRequirementKind =
  | 'none'
  | 'baseline-reading'
  | 'restorative-choice'
  | 'legacy-reading';

export type RestorativeProvider = 'reader' | 'meditation';

export type RestorativeGateStatus = 'pending-selection' | 'in-progress' | 'satisfied';

export interface ActiveRestorativeGate {
  gateId: string;
  groupId: string;
  attentionDayId: string;
  dailyCooldownOrdinal: number;
  createdAt: number;
  cooldownEndsAt: number;
  requirementKind: RestorativeRequirementKind;
  selectedProvider?: RestorativeProvider;
  providerSessionId?: string;
  status: RestorativeGateStatus;
  satisfiedAt?: number;
  /** Required for baseline / legacy migration (Reader evidence semantics). */
  requiredReadingSeconds?: number;
  requiredQualifiedPages?: number;
  /** Reader path of a restorative choice (per bound session). */
  requiredRestorativeReadingSeconds?: number;
  requiredRestorativeQualifiedPages?: number;
  /** Meditation path of a restorative choice (qualified monotonic seconds). */
  requiredMeditationSeconds?: number;
  /** Once true the gate is locked to selectedProvider for V1. */
  providerLocked?: boolean;
  /** Idempotency guard for the Attention Day meditation substitution. */
  meditationSubstitutionConsumed?: boolean;
  /**
   * LEGACY_READING only: the v1.2 local-date scoping. Legacy gates keep their
   * original day semantics ("natural completion/expiry") instead of the
   * Attention Day scoping.
   */
  attentionDateKey?: string;
}

export const RESTORATIVE_POLICY = Object.freeze({
  /** Meditation may satisfy at most this many cooldown gates per Attention Day. */
  maxMeditationSubstitutionsPerAttentionDay: 2,
  baselineReadingSeconds: 60 * 60,
  baselineQualifiedPages: 36,
  restorativeChoiceReadingSeconds: 30 * 60,
  restorativeChoiceQualifiedPages: 11,
  restorativeChoiceMeditationSeconds: DEFAULT_MEDITATION_REQUIRED_SECONDS,
});

/** The policy function: which requirement kind a cooldown ordinal carries. */
export function requirementKindForCooldownOrdinal(ordinal: number): RestorativeRequirementKind {
  const safe = Number.isFinite(ordinal) ? Math.max(0, Math.floor(ordinal)) : 0;
  if (safe <= 2) return 'none';
  if (safe === 3) return 'baseline-reading';
  return 'restorative-choice';
}

/** Reader requirement carried by a gate kind (legacy gates keep stored values). */
export function readingRequirementForKind(
  kind: RestorativeRequirementKind
): ReadingRequirement {
  switch (kind) {
    case 'baseline-reading':
      return {
        activeSeconds: RESTORATIVE_POLICY.baselineReadingSeconds,
        qualifiedPages: RESTORATIVE_POLICY.baselineQualifiedPages,
      };
    case 'restorative-choice':
      return {
        activeSeconds: RESTORATIVE_POLICY.restorativeChoiceReadingSeconds,
        qualifiedPages: RESTORATIVE_POLICY.restorativeChoiceQualifiedPages,
      };
    default:
      return { activeSeconds: 0, qualifiedPages: 0 };
  }
}

let gateIdCounter = 0;

/**
 * Opaque gate id for ad-hoc use. Engine-created gates use the deterministic
 * [deterministicGateId] instead so restarts and reconciliation never
 * regenerate identities.
 */
export function generateGateId(): string {
  gateIdCounter += 1;
  const random = Math.floor(Math.random() * 0xffffff)
    .toString(16)
    .padStart(6, '0');
  return `gate-${Date.now().toString(36)}-${gateIdCounter.toString(36)}-${random}`;
}

/**
 * Deterministic, stable gate id: one gate exists per (Attention Day, group,
 * cooldown ordinal), so this is idempotent across restarts and re-imports.
 */
export function deterministicGateId(input: {
  attentionDayId: string;
  groupId: string;
  dailyCooldownOrdinal: number;
}): string {
  return `gate-${input.attentionDayId}-${input.groupId}-o${input.dailyCooldownOrdinal}`;
}

/**
 * Creates the gate for a cooldown instance, or undefined when the ordinal
 * carries no restorative requirement (ordinals 1-2).
 */
export function createRestorativeGateForOrdinal(input: {
  groupId: string;
  attentionDayId: string;
  dailyCooldownOrdinal: number;
  createdAt: number;
  cooldownEndsAt: number;
  gateId?: string;
}): ActiveRestorativeGate | undefined {
  const kind = requirementKindForCooldownOrdinal(input.dailyCooldownOrdinal);
  if (kind === 'none') return undefined;
  const base: ActiveRestorativeGate = {
    gateId:
      input.gateId ??
      deterministicGateId({
        attentionDayId: input.attentionDayId,
        groupId: input.groupId,
        dailyCooldownOrdinal: input.dailyCooldownOrdinal,
      }),
    groupId: input.groupId,
    attentionDayId: input.attentionDayId,
    dailyCooldownOrdinal: input.dailyCooldownOrdinal,
    createdAt: input.createdAt,
    cooldownEndsAt: input.cooldownEndsAt,
    requirementKind: kind,
    status: 'in-progress',
    providerLocked: false,
    meditationSubstitutionConsumed: false,
  };
  if (kind === 'baseline-reading') {
    const requirement = readingRequirementForKind(kind);
    return {
      ...base,
      // Reader Daily Evidence V2 is the fixed authority for the baseline.
      selectedProvider: 'reader',
      providerLocked: true,
      requiredReadingSeconds: requirement.activeSeconds,
      requiredQualifiedPages: requirement.qualifiedPages,
    };
  }
  // restorative-choice: a discrete choice, no provider selected yet.
  return {
    ...base,
    status: 'pending-selection',
    requiredRestorativeReadingSeconds: RESTORATIVE_POLICY.restorativeChoiceReadingSeconds,
    requiredRestorativeQualifiedPages: RESTORATIVE_POLICY.restorativeChoiceQualifiedPages,
    requiredMeditationSeconds: RESTORATIVE_POLICY.restorativeChoiceMeditationSeconds,
  };
}

/**
 * Migrates a persisted v1.2 ActiveReadingGate into the new model.
 * Original numbers and evidence semantics are preserved exactly — an active
 * 5400s / 47p obligation must remain 5400s / 47p until it naturally resolves.
 *
 * The gate id is DETERMINISTIC (`legacy-gate-<groupId>`): v1.2 held at most
 * one gate per group, and deterministic ids keep the migration idempotent
 * across repeated initialization.
 */
export function migrateLegacyReadingGate(input: {
  groupId: string;
  attentionDateKey: string;
  dailyCooldownOrdinal: number;
  createdAt: number;
  cooldownEndsAt: number;
  requiredReadingSeconds: number;
  requiredQualifiedPages: number;
  attentionDayId?: string;
  gateId?: string;
}): ActiveRestorativeGate {
  return {
    gateId: input.gateId ?? `legacy-gate-${input.groupId}`,
    groupId: input.groupId,
    attentionDayId: input.attentionDayId ?? `ad-${input.attentionDateKey}`,
    attentionDateKey: input.attentionDateKey,
    dailyCooldownOrdinal: input.dailyCooldownOrdinal,
    createdAt: input.createdAt,
    cooldownEndsAt: input.cooldownEndsAt,
    requirementKind: 'legacy-reading',
    selectedProvider: 'reader',
    providerLocked: true,
    status: 'in-progress',
    requiredReadingSeconds: input.requiredReadingSeconds,
    requiredQualifiedPages: input.requiredQualifiedPages,
    meditationSubstitutionConsumed: false,
  };
}

/**
 * Selects the provider for a restorative-choice gate.
 * Allowed before meaningful progress; afterwards the gate is locked for V1.
 */
export function selectGateProvider(
  gate: ActiveRestorativeGate,
  provider: RestorativeProvider,
  options: { meditationAllowed?: boolean } = {}
): ActiveRestorativeGate {
  if (gate.status === 'satisfied') return gate;
  if (gate.requirementKind !== 'restorative-choice') return gate;
  if (gate.providerLocked) return gate;
  if (provider === 'meditation' && options.meditationAllowed === false) return gate;
  return {
    ...gate,
    selectedProvider: provider,
    status: 'in-progress',
  };
}

/** Locks the gate to its selected provider once meaningful progress exists. */
export function lockGateProvider(gate: ActiveRestorativeGate): ActiveRestorativeGate {
  if (!gate.selectedProvider || gate.providerLocked) return gate;
  return { ...gate, providerLocked: true };
}

export type RestorativeGatePhase =
  | 'none'
  | 'separation-only'
  | 'pending-selection'
  | 'baseline-reading-required'
  | 'reader-in-progress'
  | 'meditation-in-progress'
  | 'reader-unavailable'
  | 'reader-incompatible'
  | 'meditation-unavailable'
  | 'meditation-incompatible'
  | 'restorative-complete-cooldown-active'
  | 'cooldown-complete-restorative-remains'
  | 'complete';

export interface RestorativeGateEvaluation {
  /** undefined => gate is stale (different Attention Day) and must be dropped. */
  gate: ActiveRestorativeGate | undefined;
  phase: RestorativeGatePhase;
  /** True exactly when THIS evaluation consumed a meditation substitution. */
  substitutionConsumed: boolean;
}

export function isMeditationPathAllowed(
  substitutionsUsed: number,
  policy: { maxMeditationSubstitutionsPerAttentionDay: number } = RESTORATIVE_POLICY
): boolean {
  return (
    substitutionsUsed < policy.maxMeditationSubstitutionsPerAttentionDay
  );
}

/**
 * Reader Daily Evidence V2 is aggregated per CALENDAR day, while gates live in
 * an Attention Day (which spans the Morning-Buffer boundary). Baseline/legacy
 * gates therefore accept trusted evidence for either the gate's creation date
 * key or the evaluation date key — preserving v1.2 semantics exactly for
 * same-day gates while honoring the Attention Day across the boundary.
 */
function isTrustedDailyEvidenceForKeys(
  evidence: ReadingEvidenceAvailability | undefined,
  acceptedDateKeys: string[]
): evidence is ReadingEvidenceAvailability {
  return Boolean(
    evidence && acceptedDateKeys.some((key) => isTrustedEvidenceForDate(evidence, key))
  );
}

/**
 * Evaluates one gate. Pure and fail-closed:
 * - stale Attention Day -> drop (returns undefined gate)
 * - satisfaction only from trusted evidence for the exact bound session
 * - provider lock prevents cross-provider progress combination
 * - a meditation substitution is consumed exactly once, only on verified
 *   completion that satisfies its bound gate
 */
export function evaluateRestorativeGate(input: {
  gate: ActiveRestorativeGate;
  now: number;
  attentionDayId: string;
  /** Local date at evaluation — legacy gates keep v1.2 day scoping. */
  currentDateKey: string;
  /** Local date keys whose Reader daily evidence may satisfy baseline/legacy. */
  acceptedEvidenceDateKeys: string[];
  readerDailyEvidence?: ReadingEvidenceAvailability;
  readerSessionEvidence?: RecoverySessionInfo | null;
  meditationEvidence?: MeditationSessionEvidence | null;
  meditationSubstitutionsUsed: number;
  policy?: { maxMeditationSubstitutionsPerAttentionDay: number };
}): RestorativeGateEvaluation {
  const {
    gate,
    now,
    attentionDayId,
    currentDateKey,
    acceptedEvidenceDateKeys,
    readerDailyEvidence,
    readerSessionEvidence,
    meditationEvidence,
    meditationSubstitutionsUsed,
    policy = RESTORATIVE_POLICY,
  } = input;

  // Staleness: legacy gates keep their v1.2 local-date scoping ("natural
  // completion/expiry"); new gates are scoped to their Attention Day.
  const stale = gate.requirementKind === 'legacy-reading'
    ? gate.attentionDateKey !== currentDateKey
    : gate.attentionDayId !== attentionDayId;
  if (stale) {
    return { gate: undefined, phase: 'none', substitutionConsumed: false };
  }
  if (gate.status === 'satisfied') {
    return {
      gate: { ...gate },
      phase: gate.cooldownEndsAt > now ? 'restorative-complete-cooldown-active' : 'complete',
      substitutionConsumed: false,
    };
  }

  switch (gate.requirementKind) {
    case 'legacy-reading':
    case 'baseline-reading': {
      // Aggregate daily Reader evidence (Reader Daily Evidence V2).
      const requirement: ReadingRequirement = {
        activeSeconds: gate.requiredReadingSeconds ?? 0,
        qualifiedPages: gate.requiredQualifiedPages ?? 0,
      };
      const trusted = isTrustedDailyEvidenceForKeys(
        readerDailyEvidence,
        acceptedEvidenceDateKeys
      )
        ? readerDailyEvidence
        : undefined;
      if (!trusted) {
        return {
          gate: { ...gate },
          phase: gate.cooldownEndsAt > now
            ? 'separation-only'
            : readerDailyEvidence && !readerDailyEvidence.providerAvailable
              ? 'reader-unavailable'
              : 'reader-incompatible',
          substitutionConsumed: false,
        };
      }
      const satisfied = isReadingRequirementSatisfied(trusted, requirement);
      if (satisfied) {
        return {
          gate: { ...gate, status: 'satisfied', satisfiedAt: gate.satisfiedAt ?? now },
          phase: gate.cooldownEndsAt > now ? 'restorative-complete-cooldown-active' : 'complete',
          substitutionConsumed: false,
        };
      }
      return {
        gate: {
          ...gate,
          status: 'in-progress',
          providerLocked: true,
          selectedProvider: 'reader',
        },
        phase: gate.cooldownEndsAt > now
          ? 'separation-only'
          : gate.requirementKind === 'baseline-reading'
            ? 'baseline-reading-required'
            : 'reader-in-progress',
        substitutionConsumed: false,
      };
    }

    case 'restorative-choice': {
      const provider = gate.selectedProvider;
      if (!provider) {
        return {
          gate: { ...gate },
          phase: gate.cooldownEndsAt > now ? 'separation-only' : 'pending-selection',
          substitutionConsumed: false,
        };
      }
      // Selecting a provider moves the gate out of pending-selection.
      const selected: ActiveRestorativeGate = gate.status === 'pending-selection'
        ? { ...gate, status: 'in-progress' }
        : { ...gate };

      if (provider === 'meditation') {
        if (!isMeditationPathAllowed(meditationSubstitutionsUsed, policy)) {
          // Cap exhausted: meditation can never satisfy this gate.
          return {
            gate: selected,
            phase: gate.cooldownEndsAt > now
              ? 'separation-only'
              : 'meditation-unavailable',
            substitutionConsumed: false,
          };
        }
        const verified = isVerifiedMeditationCompletion({
          evidence: meditationEvidence,
          sessionId: gate.providerSessionId ?? '',
          requiredQualifiedSeconds:
            gate.requiredMeditationSeconds ?? RESTORATIVE_POLICY.restorativeChoiceMeditationSeconds,
        });
        if (!verified) {
          // Meaningful progress (any credited qualified time) locks the provider.
          const hasProgress =
            typeof meditationEvidence?.completedQualifiedSeconds === 'number' &&
            meditationEvidence.completedQualifiedSeconds > 0;
          return {
            gate: hasProgress ? lockGateProvider(selected) : selected,
            phase: gate.cooldownEndsAt > now
              ? 'separation-only'
              : meditationEvidence
                ? 'meditation-in-progress'
                : 'meditation-unavailable',
            substitutionConsumed: false,
          };
        }
        return {
          gate: {
            ...lockGateProvider(selected),
            status: 'satisfied',
            satisfiedAt: gate.satisfiedAt ?? now,
            meditationSubstitutionConsumed: true,
          },
          phase: gate.cooldownEndsAt > now ? 'restorative-complete-cooldown-active' : 'complete',
          substitutionConsumed: !gate.meditationSubstitutionConsumed,
        };
      }

      // Reader path — per bound recovery session (never aggregate daily evidence).
      const sessionId = gate.providerSessionId ?? '';
      const boundSession =
        readerSessionEvidence && readerSessionEvidence.sessionId === sessionId
          ? readerSessionEvidence
          : null;
      const requiredSeconds =
        gate.requiredRestorativeReadingSeconds ??
        RESTORATIVE_POLICY.restorativeChoiceReadingSeconds;
      const requiredPages =
        gate.requiredRestorativeQualifiedPages ??
        RESTORATIVE_POLICY.restorativeChoiceQualifiedPages;
      const verified = Boolean(
        boundSession &&
          boundSession.protocolVersion === 1 &&
          boundSession.status === 'COMPLETE' &&
          boundSession.activeSeconds >= requiredSeconds &&
          boundSession.qualifiedPages >= requiredPages
      );
      if (verified) {
        return {
          gate: {
            ...lockGateProvider(selected),
            status: 'satisfied',
            satisfiedAt: gate.satisfiedAt ?? now,
          },
          phase: gate.cooldownEndsAt > now ? 'restorative-complete-cooldown-active' : 'complete',
          substitutionConsumed: false,
        };
      }
      const hasProgress = Boolean(
        boundSession && (boundSession.activeSeconds > 0 || boundSession.qualifiedPages > 0)
      );
      return {
        gate: hasProgress ? lockGateProvider(selected) : selected,
        phase: gate.cooldownEndsAt > now
          ? 'separation-only'
          : boundSession
            ? 'reader-in-progress'
            : 'reader-unavailable',
        substitutionConsumed: false,
      };
    }

    case 'none':
    default:
      return { gate: undefined, phase: 'none', substitutionConsumed: false };
  }
}

export interface RestorativeStatusView {
  groupId: string;
  gateId?: string;
  phase: RestorativeGatePhase;
  ordinal?: number;
  requirementKind: RestorativeRequirementKind;
  cooldownEndsAt?: number;
  cooldownRemainingSeconds: number;
  gateSatisfied: boolean;
  selectedProvider?: RestorativeProvider;
  meditationPathsRemaining: number;
}

/**
 * Status projection for the Routine UI (spec: never collapse these states):
 * separation only / daily reader baseline / choose a restorative path /
 * meditation in progress / reading in progress / restorative complete while
 * cooldown remains / cooldown complete while restorative remains / eligible.
 */
export function deriveRestorativeStatus(input: {
  groupId: string;
  gate?: ActiveRestorativeGate;
  cooldownEndsAt?: number;
  now: number;
  attentionDayId: string;
  currentDateKey: string;
  acceptedEvidenceDateKeys: string[];
  meditationSubstitutionsUsed: number;
  readerDailyEvidence?: ReadingEvidenceAvailability;
  readerSessionEvidence?: RecoverySessionInfo | null;
  meditationEvidence?: MeditationSessionEvidence | null;
  policy?: { maxMeditationSubstitutionsPerAttentionDay: number };
}): RestorativeStatusView {
  const { groupId, gate, cooldownEndsAt, now, meditationSubstitutionsUsed, policy = RESTORATIVE_POLICY } = input;
  const cooldownRemainingSeconds = cooldownEndsAt
    ? Math.max(0, Math.ceil((cooldownEndsAt - now) / 1000))
    : 0;
  const cooldownActive = cooldownRemainingSeconds > 0;
  const meditationPathsRemaining = Math.max(
    0,
    policy.maxMeditationSubstitutionsPerAttentionDay - meditationSubstitutionsUsed
  );
  const base: RestorativeStatusView = {
    groupId,
    phase: 'none',
    requirementKind: 'none',
    cooldownRemainingSeconds,
    gateSatisfied: true,
    meditationPathsRemaining,
    ...(cooldownEndsAt ? { cooldownEndsAt } : {}),
    ...(gate ? { gateId: gate.gateId, ordinal: gate.dailyCooldownOrdinal } : {}),
    ...(gate?.selectedProvider ? { selectedProvider: gate.selectedProvider } : {}),
  };

  const gateStale = gate
    ? gate.requirementKind === 'legacy-reading'
      ? gate.attentionDateKey !== input.currentDateKey
      : gate.attentionDayId !== input.attentionDayId
    : true;
  if (!gate || gateStale) {
    return { ...base, phase: cooldownActive ? 'separation-only' : 'complete' };
  }

  const evaluation = evaluateRestorativeGate({
    gate,
    now,
    attentionDayId: input.attentionDayId,
    currentDateKey: input.currentDateKey,
    acceptedEvidenceDateKeys: input.acceptedEvidenceDateKeys,
    readerDailyEvidence: input.readerDailyEvidence,
    readerSessionEvidence: input.readerSessionEvidence,
    meditationEvidence: input.meditationEvidence,
    meditationSubstitutionsUsed,
    policy,
  });
  const evaluated = evaluation.gate ?? gate;
  const gateSatisfied = evaluated.status === 'satisfied';

  let phase: RestorativeGatePhase;
  if (gateSatisfied && cooldownActive) {
    phase = 'restorative-complete-cooldown-active';
  } else if (gateSatisfied && !cooldownActive) {
    phase = 'complete';
  } else if (!gateSatisfied && !cooldownActive) {
    // Cooldown elapsed, gate still open: the gate state is what matters now.
    phase = evaluation.phase === 'separation-only'
      ? evaluated.status === 'pending-selection' || !evaluated.selectedProvider
        ? 'pending-selection'
        : 'cooldown-complete-restorative-remains'
      : evaluation.phase;
  } else {
    // Cooldown active, gate open: surface provider/selection progress.
    phase = evaluation.phase;
  }

  return {
    ...base,
    phase,
    requirementKind: gate.requirementKind,
    gateSatisfied,
  };
}
