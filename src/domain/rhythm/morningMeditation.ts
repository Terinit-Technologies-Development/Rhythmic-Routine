import {
  DEFAULT_MEDITATION_REQUIRED_SECONDS,
  isVerifiedMeditationCompletion,
  type MeditationSessionEvidence,
} from './meditationEvidence';

/**
 * Morning Meditation Required — the new post-Morning-Buffer state.
 *
 * Conceptual lifecycle (Routine-owned):
 *
 *   OVERNIGHT_PROTECTED -> MORNING_BUFFER -> MORNING_MEDITATION_REQUIRED -> AVAILABLE
 *
 * Once the Morning Buffer ends, the phone must NOT fully open simply because
 * the buffer elapsed: while the current Attention Day lacks a verified morning
 * completion the state remains MORNING_MEDITATION_REQUIRED and only Rhythmic
 * Meditation, Rhythmic Routine, and Essential apps stay reachable.
 *
 * Morning completion NEVER consumes a cooldown Meditation substitution.
 */

export type MorningMeditationState =
  | 'overnight-protected'
  | 'morning-buffer'
  | 'morning-meditation-required'
  | 'available';

export interface MorningMeditationRequirement {
  attentionDayId: string;
  /** Routine-authoritative, stable per Attention Day. */
  sessionId: string;
  requiredQualifiedSeconds: number;
  satisfiedAt?: number;
}

export const MORNING_REQUIRED_SECONDS = DEFAULT_MEDITATION_REQUIRED_SECONDS;

/**
 * Routine is authoritative for the paired Morning Meditation identity: the id
 * is deterministic per Attention Day, so app restarts and ordinary
 * reconciliation can never create duplicate obligations.
 */
export function morningMeditationSessionId(attentionDayId: string): string {
  return `morning-${attentionDayId}`;
}

export function createMorningMeditationRequirement(
  attentionDayId: string,
  requiredQualifiedSeconds: number = MORNING_REQUIRED_SECONDS
): MorningMeditationRequirement {
  return {
    attentionDayId,
    sessionId: morningMeditationSessionId(attentionDayId),
    requiredQualifiedSeconds,
  };
}

/**
 * Morning completion rule — same trust bar as cooldown meditation:
 * the EXACT bound MORNING_REQUIRED session for this Attention Day must be
 * COMPLETED with enough qualified monotonic time. Never inferred from launch,
 * ACTIVE state, or wall-clock duration.
 */
export function isMorningMeditationSatisfied(input: {
  requirement?: MorningMeditationRequirement;
  evidence?: MeditationSessionEvidence | null;
}): boolean {
  const { requirement, evidence } = input;
  if (!requirement) return true;
  return isVerifiedMeditationCompletion({
    evidence,
    sessionId: requirement.sessionId,
    requiredQualifiedSeconds: requirement.requiredQualifiedSeconds,
  });
}

export interface MorningStateInput {
  now: number;
  /** Inclusive overnight protection (evening end -> morning start). */
  insideOvernightProtection: boolean;
  /** Inside the Morning Buffer window right now. */
  insideMorningBuffer: boolean;
  /** The Morning Buffer window has already ended for the current Attention Day. */
  morningBufferElapsedForAttentionDay: boolean;
  requirement?: MorningMeditationRequirement;
  evidence?: MeditationSessionEvidence | null;
  /**
   * Migration gate: enforceable only from the first valid Morning Buffer ->
   * morning transition AFTER the Pass 3 migration ran (spec: no mid-day
   * lockdown for existing users).
   */
  enforceable: boolean;
}

/**
 * Resolves the morning lifecycle state. Fail-closed for the requirement but
 * migration-safe: before `enforceable`, an unmet morning requirement never
 * locks the phone.
 */
export function resolveMorningMeditationState(input: MorningStateInput): MorningMeditationState {
  if (input.insideOvernightProtection) return 'overnight-protected';
  if (input.insideMorningBuffer) return 'morning-buffer';
  if (!input.morningBufferElapsedForAttentionDay) return 'available';
  if (!input.enforceable) return 'available';
  const requirement = input.requirement;
  if (!requirement) return 'morning-meditation-required';
  if (isMorningMeditationSatisfied({ requirement, evidence: input.evidence })) return 'available';
  return 'morning-meditation-required';
}

/**
 * Migration state for the Morning rollout (spec: no mid-day lockdown for
 * existing v1.2 users). Enforcement begins at the first valid Morning Buffer
 * -> morning transition AFTER the migration ran:
 *
 * - upgraded installs: enforceable from the first Attention Day STRICTLY AFTER
 *   the migration's Attention Day (update at 14:00 never locks the current day)
 * - fresh installs: enforceable from the install's own Attention Day
 */
export interface MorningMeditationMigrationState {
  /** Epoch ms when the Pass 3 migration ran. */
  migratedAt: number;
  /** Attention Day that contained the migration. */
  migrationAttentionDayId: string;
  /** Explicit floor (fresh installs). Takes precedence when set. */
  enforceableFromAttentionDayId?: string;
}

export function isMorningEnforceableForAttentionDay(
  migration: MorningMeditationMigrationState | undefined,
  attentionDayId: string
): boolean {
  if (!migration) return false;
  if (migration.enforceableFromAttentionDayId) {
    return attentionDayId >= migration.enforceableFromAttentionDayId;
  }
  // Attention Day ids are chronological when compared lexicographically
  // ("ad-<yyyyMMdd>-<HHmm>"), so the next day's morning is the first enforceable one.
  return attentionDayId > migration.migrationAttentionDayId;
}

/** A reader-session-style view used by UI; kept here to avoid circular imports. */
export type MorningEvidenceView =
  | { kind: 'unavailable' }
  | { kind: 'pending'; requirement: MorningMeditationRequirement }
  | {
      kind: 'complete';
      requirement?: MorningMeditationRequirement;
      evidence?: MeditationSessionEvidence;
    };

export function deriveMorningEvidenceView(input: {
  requirement?: MorningMeditationRequirement;
  evidence?: MeditationSessionEvidence | null;
  providerUnavailable?: boolean;
}): MorningEvidenceView {
  const { requirement, evidence, providerUnavailable } = input;
  if (providerUnavailable) return { kind: 'unavailable' };
  if (!requirement) return { kind: 'complete' };
  if (isMorningMeditationSatisfied({ requirement, evidence })) {
    return { kind: 'complete', requirement, evidence: evidence ?? undefined };
  }
  return { kind: 'pending', requirement };
}
