import type { RoutineWindow } from '../../types/domain';
import {
  DEFAULT_MEDITATION_REQUIRED_SECONDS,
  MEDITATION_PROTOCOL_VERSION,
  isVerifiedMeditationCompletion,
  type MeditationSessionEvidence,
} from './meditationEvidence';
import { getIsoWeekday, parseClockTimeToMinutes } from './routine';

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
  /**
   * Epoch ms of the ORIGINAL eligible Morning Buffer end boundary. Never
   * re-minted on retry/restart/double-tap.
   */
  createdAt?: number;
  /** Exactly the Attention Day that owns this obligation. */
  sourceRhythmicDayId?: string;
  /** Explicit kind so a cooldown session can never satisfy the morning. */
  sessionKind?: 'MORNING_REQUIRED';
  /** Morning is never cooldown-bound. Present as null for a self-describing tuple. */
  sourceCooldownId?: null;
  /** Optional and stable; absent means the obligation does not expire by time. */
  expiresAtEpochMs?: number;
  satisfiedAt?: number;
}

export const MORNING_SESSION_KIND = 'MORNING_REQUIRED' as const;

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
  requiredQualifiedSeconds: number = MORNING_REQUIRED_SECONDS,
  createdAt?: number
): MorningMeditationRequirement {
  return {
    attentionDayId,
    sessionId: morningMeditationSessionId(attentionDayId),
    requiredQualifiedSeconds,
    sourceRhythmicDayId: attentionDayId,
    sessionKind: MORNING_SESSION_KIND,
    sourceCooldownId: null,
    ...(createdAt !== undefined && Number.isFinite(createdAt) ? { createdAt } : {}),
  };
}

/**
 * MM-2 eligibility: an obligation may exist only when a usable, enabled
 * Morning Buffer window is active on the civil day the boundary falls on.
 * Empty/disabled/inactive/malformed windows create no morning obligation.
 */
export function isMorningWindowEligibleForAttentionDay(
  schedule: RoutineWindow[],
  attentionDayStartedAt: number
): boolean {
  const window = schedule.find((item) => item.type === 'morning-buffer');
  if (!window || window.enabled === false) return false;
  const start = parseClockTimeToMinutes(window.startTime);
  const end = parseClockTimeToMinutes(window.endTime);
  if (start === null || end === null || start === end) return false;
  const activeDays = Array.isArray(window.activeDays) ? window.activeDays : [];
  if (activeDays.length === 0) return false;
  // Opening-day semantics: a cross-midnight window (23:00 -> 00:30) belongs to
  // the civil day it OPENED on, not the day its end boundary falls on. Use
  // civil-date construction (noon) so DST/offset changes cannot shift the day.
  const boundary = new Date(attentionDayStartedAt);
  const openingDate = start > end
    ? new Date(
        boundary.getFullYear(),
        boundary.getMonth(),
        boundary.getDate() - 1,
        12,
        0,
        0,
        0
      )
    : boundary;
  return activeDays.includes(getIsoWeekday(openingDate));
}

/** Parsed Attention Day identity ordering (never a raw lexical comparison). */
interface AttentionDayOrderKey {
  dateKey: string;
  minutes: number | null;
}

function parseAttentionDayOrderKey(attentionDayId: string): AttentionDayOrderKey | null {
  const withClock = /^ad-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})$/.exec(attentionDayId);
  if (withClock) {
    return {
      dateKey: `${withClock[1]}${withClock[2]}${withClock[3]}`,
      minutes: Number(withClock[4]) * 60 + Number(withClock[5]),
    };
  }
  const dateOnly = /^ad-(\d{4})-(\d{2})-(\d{2})$/.exec(attentionDayId);
  if (dateOnly) {
    return { dateKey: `${dateOnly[1]}${dateOnly[2]}${dateOnly[3]}`, minutes: null };
  }
  return null;
}

/**
 * Chronological comparison of Attention Day ids. Ids with incompatible
 * formats are compared by their parsed civil date, never by raw string order.
 */
export function isAttentionDayAtOrAfter(
  attentionDayId: string,
  floorAttentionDayId: string
): boolean {
  if (attentionDayId === floorAttentionDayId) return true;
  const current = parseAttentionDayOrderKey(attentionDayId);
  const floor = parseAttentionDayOrderKey(floorAttentionDayId);
  if (!current || !floor) return false;
  if (current.dateKey !== floor.dateKey) return current.dateKey > floor.dateKey;
  if (current.minutes === null || floor.minutes === null) {
    // Same civil day in different formats: this is the same migration day.
    return false;
  }
  return current.minutes >= floor.minutes;
}

export function isAttentionDayStrictlyAfter(
  attentionDayId: string,
  migrationAttentionDayId: string
): boolean {
  if (attentionDayId === migrationAttentionDayId) return false;
  const current = parseAttentionDayOrderKey(attentionDayId);
  const migration = parseAttentionDayOrderKey(migrationAttentionDayId);
  if (!current || !migration) return false;
  if (current.dateKey !== migration.dateKey) return current.dateKey > migration.dateKey;
  if (current.minutes === null || migration.minutes === null) return false;
  return current.minutes > migration.minutes;
}

/** Local epoch ms for a well-formed `ad-...` boundary identity, else null. */
export function attentionDayStartedAtFromId(attentionDayId: string): number | null {
  const key = parseAttentionDayOrderKey(attentionDayId);
  if (!key) return null;
  const year = Number(key.dateKey.slice(0, 4));
  const month = Number(key.dateKey.slice(4, 6)) - 1;
  const day = Number(key.dateKey.slice(6, 8));
  const minutes = key.minutes ?? 0;
  const date = new Date(year, month, day, Math.floor(minutes / 60), minutes % 60, 0, 0);
  return Number.isFinite(date.getTime()) ? date.getTime() : null;
}

export type MorningMigrationCohort = 'fresh' | 'upgraded';

/**
 * Persists the rollout floor exactly once. Fresh installs enforce from their
 * own Attention Day; existing users enforce only from the next day so an
 * update never causes a surprise mid-day lockdown.
 */
export function createMorningMigrationState(
  migratedAt: number,
  currentAttentionDayId: string,
  cohort: MorningMigrationCohort
): MorningMeditationMigrationState {
  return cohort === 'fresh'
    ? {
        migratedAt,
        migrationAttentionDayId: currentAttentionDayId,
        enforceableFromAttentionDayId: currentAttentionDayId,
      }
    : {
        migratedAt,
        migrationAttentionDayId: currentAttentionDayId,
      };
}

/** True only for the exact bound session and owning-day identity metadata. */
export function isMorningEvidenceForRequirement(
  requirement: MorningMeditationRequirement,
  evidence?: MeditationSessionEvidence | null
): boolean {
  return Boolean(
    evidence &&
      evidence.sessionId === requirement.sessionId &&
      evidence.protocolVersion === MEDITATION_PROTOCOL_VERSION &&
      evidence.sessionKind === MORNING_SESSION_KIND &&
      evidence.sourceRhythmicDayId === requirement.attentionDayId &&
      evidence.sourceCooldownId === null
  );
}

/** True only for the exact MORNING_REQUIRED binding and owning day. */
export function isVerifiedMorningMeditationCompletion(input: {
  requirement?: MorningMeditationRequirement;
  evidence?: MeditationSessionEvidence | null;
}): boolean {
  const { requirement, evidence } = input;
  if (!requirement || !evidence) return false;
  if (!isMorningEvidenceForRequirement(requirement, evidence)) return false;
  return isVerifiedMeditationCompletion({
    evidence,
    sessionId: requirement.sessionId,
    requiredQualifiedSeconds: requirement.requiredQualifiedSeconds,
  });
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
  const { requirement } = input;
  if (!requirement) return true;
  if (requirement.satisfiedAt !== undefined) return true;
  return isVerifiedMorningMeditationCompletion(input);
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
    return isAttentionDayAtOrAfter(attentionDayId, migration.enforceableFromAttentionDayId);
  }
  // Never compare incompatible Attention Day formats lexically. An upgraded
  // install enforces from the first day strictly after the migration day.
  return isAttentionDayStrictlyAfter(attentionDayId, migration.migrationAttentionDayId);
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
