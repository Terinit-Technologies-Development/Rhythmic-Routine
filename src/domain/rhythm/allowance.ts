import {
  DAILY_ALLOWANCE_STEP_MINUTES,
  DEFAULT_DAILY_RISK_ALLOWANCE_MINUTES,
  DEFAULT_RECOVERY_ACTIVITY_ID,
  DailyAppUsage,
  DailyRiskAllowancePolicy,
  DeviceApp,
  GroupAllowanceSnapshot,
  GroupAllowanceUsage,
  MIN_DAILY_RISK_ALLOWANCE_MINUTES,
  RiskGroup,
} from '../../types/domain';

export {
  DAILY_ALLOWANCE_STEP_MINUTES,
  DEFAULT_DAILY_RISK_ALLOWANCE_MINUTES,
  MIN_DAILY_RISK_ALLOWANCE_MINUTES,
  DEFAULT_RECOVERY_ACTIVITY_ID,
};

/**
 * Formats a Date or timestamp into a canonical local date key (YYYY-MM-DD).
 */
export function getLocalDateKey(dateOrTimestamp: Date | number = Date.now()): string {
  const d = typeof dateOrTimestamp === 'number' ? new Date(dateOrTimestamp) : dateOrTimestamp;
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export interface AllowanceEditResult {
  allowed: boolean;
  nextMinutes: number;
  consumesDailyEdit?: boolean;
  reason?:
    | 'app-not-found'
    | 'not-risk-app'
    | 'already-edited-today'
    | 'increase-too-large'
    | 'invalid-step'
    | 'below-minimum';
}

/**
 * v1.0.2: resolves the single shared allowance for a Risk Group.
 * Precedence: allowanceMinutes (active policy) → legacy sessionThresholdMinutes
 * (migration/fixture compat) → 30-minute default. Invalid/negative values fall
 * through to the next source; never derives from per-app policies.
 */
export function resolveGroupAllowanceMinutes(group: Pick<RiskGroup, 'allowanceMinutes' | 'sessionThresholdMinutes'>): number {
  if (Number.isFinite(group.allowanceMinutes) && (group.allowanceMinutes as number) >= 0) {
    return group.allowanceMinutes as number;
  }
  if (
    Number.isFinite(group.sessionThresholdMinutes) &&
    (group.sessionThresholdMinutes as number) >= 0
  ) {
    return group.sessionThresholdMinutes as number;
  }
  return DEFAULT_DAILY_RISK_ALLOWANCE_MINUTES;
}

/**
 * v1.0.2: resolves the recovery activity id for a Risk Group (defaults to 'walk').
 */
export function resolveGroupRecoveryActivityId(
  group: Pick<RiskGroup, 'recoveryActivityId'>
): string {
  return group.recoveryActivityId ?? DEFAULT_RECOVERY_ACTIVITY_ID;
}

export interface GroupAllowanceEditResult {
  ok: boolean;
  nextMinutes: number;
  consumesDailyEdit?: boolean;
  reason?:
    | 'increase-too-large'
    | 'invalid-step'
    | 'below-minimum'
    | 'already-edited-today';
}

/**
 * v1.0.2: validates a proposed Risk Group allowance modification.
 * Rules (anti-backdoor semantics moved from app to group):
 * - must be >= 0
 * - must be a multiple of 15
 * - equal to current: ok, does not consume the daily edit guard
 * - second successful same-day edit: rejected ('already-edited-today')
 * - increase > current + 15: rejected ('increase-too-large')
 * - any valid 15-minute decrement (incl. 0): allowed, consumes the guard
 */
export function validateGroupAllowanceEdit(args: {
  currentMinutes: number;
  requestedMinutes: number;
  lastEditedDateKey?: string;
  todayDateKey: string;
}): GroupAllowanceEditResult {
  const { currentMinutes, requestedMinutes, lastEditedDateKey, todayDateKey } = args;

  if (requestedMinutes < MIN_DAILY_RISK_ALLOWANCE_MINUTES) {
    return { ok: false, nextMinutes: currentMinutes, reason: 'below-minimum' };
  }

  if (requestedMinutes % DAILY_ALLOWANCE_STEP_MINUTES !== 0) {
    return { ok: false, nextMinutes: currentMinutes, reason: 'invalid-step' };
  }

  if (requestedMinutes === currentMinutes) {
    return { ok: true, nextMinutes: currentMinutes, consumesDailyEdit: false };
  }

  if (lastEditedDateKey === todayDateKey) {
    return { ok: false, nextMinutes: currentMinutes, reason: 'already-edited-today' };
  }

  if (requestedMinutes > currentMinutes + DAILY_ALLOWANCE_STEP_MINUTES) {
    return { ok: false, nextMinutes: currentMinutes, reason: 'increase-too-large' };
  }

  return { ok: true, nextMinutes: requestedMinutes, consumesDailyEdit: true };
}

/**
 * v1.0.2: determines whether a Risk Group has exhausted its shared allowance.
 * A 0-minute allowance is exhausted immediately. Usage from every member app
 * counts against the same pool via the group's usage record.
 */
export function isGroupAllowanceExhausted(
  group: Pick<RiskGroup, 'allowanceMinutes' | 'sessionThresholdMinutes'>,
  usage: Pick<GroupAllowanceUsage, 'usedSeconds' | 'dateKey' | 'activeSegmentStartedAt'> | undefined,
  nowOrDateKey: number | string = Date.now()
): boolean {
  const allowanceMinutes = resolveGroupAllowanceMinutes(group);
  if (allowanceMinutes <= 0) return true;
  if (!usage) return false;

  const dateKey =
    typeof nowOrDateKey === 'string' ? nowOrDateKey : getLocalDateKey(nowOrDateKey);
  if (usage.dateKey !== dateKey) return false;

  let totalSeconds = usage.usedSeconds;
  if (
    usage.activeSegmentStartedAt &&
    typeof nowOrDateKey === 'number' &&
    nowOrDateKey > usage.activeSegmentStartedAt
  ) {
    totalSeconds += Math.floor((nowOrDateKey - usage.activeSegmentStartedAt) / 1000);
  }

  return totalSeconds >= allowanceMinutes * 60;
}

/**
 * v1.0.2: reconciles local-day rollover for per-group allowance ledgers.
 * - preserves policy/edit-guard state (stored on RiskGroup, untouched here)
 * - resets usedSeconds for the new date, clears exhaustedAt, bumps nothing
 * - splits any active segment crossing midnight at 00:00 (single source of
 *   elapsed time: activeSegmentStartedAt; committed usedSeconds reset to 0)
 */
export function rolloverGroupAllowanceUsage(
  currentUsage: Record<string, GroupAllowanceUsage> = {},
  nowMs: number = Date.now()
): Record<string, GroupAllowanceUsage> {
  const currentDateKey = getLocalDateKey(nowMs);
  const nextUsage: Record<string, GroupAllowanceUsage> = {};

  const todayStart = new Date(nowMs);
  todayStart.setHours(0, 0, 0, 0);
  const todayStartMs = todayStart.getTime();

  for (const [groupId, usage] of Object.entries(currentUsage)) {
    if (usage.dateKey === currentDateKey) {
      nextUsage[groupId] = { ...usage };
    } else if (usage.activeSegmentStartedAt) {
      nextUsage[groupId] = {
        groupId,
        dateKey: currentDateKey,
        usedSeconds: 0,
        activeSegmentStartedAt: Math.max(todayStartMs, usage.activeSegmentStartedAt),
        activePackageName: usage.activePackageName,
        exhaustedAt: undefined,
        cycleRevision: usage.cycleRevision,
      };
    } else {
      nextUsage[groupId] = {
        groupId,
        dateKey: currentDateKey,
        usedSeconds: 0,
        activeSegmentStartedAt: undefined,
        activePackageName: undefined,
        exhaustedAt: undefined,
        cycleRevision: usage.cycleRevision,
      };
    }
  }

  return nextUsage;
}

/**
 * v1.0.2: builds a point-in-time snapshot of a group's allowance cycle.
 */
export function getGroupAllowanceSnapshot(
  group: RiskGroup,
  usage: GroupAllowanceUsage | undefined,
  nowOrDateKey: number | string = Date.now(),
  cooldownEndsAt?: number
): GroupAllowanceSnapshot {
  const dateKey =
    typeof nowOrDateKey === 'string' ? nowOrDateKey : getLocalDateKey(nowOrDateKey);
  const allowanceMinutes = resolveGroupAllowanceMinutes(group);
  let usedSeconds = 0;
  if (usage && usage.dateKey === dateKey) {
    usedSeconds = usage.usedSeconds;
    if (
      usage.activeSegmentStartedAt &&
      typeof nowOrDateKey === 'number' &&
      nowOrDateKey > usage.activeSegmentStartedAt
    ) {
      usedSeconds += Math.floor((nowOrDateKey - usage.activeSegmentStartedAt) / 1000);
    }
  }
  const remainingSeconds = Math.max(0, allowanceMinutes * 60 - usedSeconds);
  return {
    groupId: group.id,
    dateKey,
    usedSeconds,
    allowanceMinutes,
    remainingSeconds,
    exhausted: allowanceMinutes <= 0 || usedSeconds >= allowanceMinutes * 60,
    cooldownEndsAt,
  };
}

/**
 * @deprecated v1.0.2: per-app allowance ownership removed. Group-level
 * validateGroupAllowanceEdit() is the active policy; this function is retained
 * for legacy callers/tests only.
 * Rules:
 * - App must be a Risk app (non-risk rejected as 'not-risk-app')
 * - Proposed must be >= MIN_DAILY_RISK_ALLOWANCE_MINUTES (0)
 * - Proposed must be a multiple of DAILY_ALLOWANCE_STEP_MINUTES (15)
 * - Proposed === current: no-op, allowed, does not consume daily edit
 * - Second same-day edit: rejected ('already-edited-today')
 * - Proposed > current + 15: rejected ('increase-too-large')
 * - Reduction down to 0: allowed in any 15-minute unit, consumes daily edit
 * - Increase by +15: allowed, consumes daily edit
 */
export function validateDailyAllowanceEdit(
  currentPolicy: DailyRiskAllowancePolicy | undefined,
  proposedMinutes: number,
  nowOrDateKey: Date | number | string = Date.now(),
  appOrClassification?: DeviceApp | DeviceApp['classification']
): AllowanceEditResult {
  const currentMinutes =
    currentPolicy?.allowanceMinutes ?? DEFAULT_DAILY_RISK_ALLOWANCE_MINUTES;

  if (appOrClassification) {
    const classification =
      typeof appOrClassification === 'string'
        ? appOrClassification
        : appOrClassification.classification;
    if (classification !== 'risk') {
      return {
        allowed: false,
        nextMinutes: currentMinutes,
        consumesDailyEdit: false,
        reason: 'not-risk-app',
      };
    }
  }

  const todayDateKey =
    typeof nowOrDateKey === 'string' ? nowOrDateKey : getLocalDateKey(nowOrDateKey);

  if (proposedMinutes < MIN_DAILY_RISK_ALLOWANCE_MINUTES) {
    return {
      allowed: false,
      nextMinutes: currentMinutes,
      consumesDailyEdit: false,
      reason: 'below-minimum',
    };
  }

  if (proposedMinutes % DAILY_ALLOWANCE_STEP_MINUTES !== 0) {
    return {
      allowed: false,
      nextMinutes: currentMinutes,
      consumesDailyEdit: false,
      reason: 'invalid-step',
    };
  }

  if (proposedMinutes === currentMinutes) {
    return {
      allowed: true,
      nextMinutes: currentMinutes,
      consumesDailyEdit: false,
    };
  }

  if (currentPolicy?.lastEditedDateKey === todayDateKey) {
    return {
      allowed: false,
      nextMinutes: currentMinutes,
      consumesDailyEdit: false,
      reason: 'already-edited-today',
    };
  }

  if (proposedMinutes > currentMinutes + DAILY_ALLOWANCE_STEP_MINUTES) {
    return {
      allowed: false,
      nextMinutes: currentMinutes,
      consumesDailyEdit: false,
      reason: 'increase-too-large',
    };
  }

  return {
    allowed: true,
    nextMinutes: proposedMinutes,
    consumesDailyEdit: true,
  };
}

/**
 * @deprecated v1.0.2: per-app exhaustion is superseded by group allowance
 * (isGroupAllowanceExhausted). Retained for legacy restriction evaluation only.
 */
export function isDailyAllowanceExhausted(
  app: DeviceApp,
  dailyAppUsage: Record<string, DailyAppUsage> | undefined,
  nowOrDateKey: number | string = Date.now()
): boolean {
  if (app.classification !== 'risk') return false;

  const allowanceMinutes =
    app.dailyRiskAllowance?.allowanceMinutes ?? DEFAULT_DAILY_RISK_ALLOWANCE_MINUTES;

  // 0-minute allowance is exhausted immediately
  if (allowanceMinutes <= 0) return true;

  const dateKey =
    typeof nowOrDateKey === 'string' ? nowOrDateKey : getLocalDateKey(nowOrDateKey);
  const usage = dailyAppUsage?.[app.id];
  if (!usage || usage.dateKey !== dateKey) return false;

  let totalSeconds = usage.usedSeconds;
  if (
    usage.activeSegmentStartedAt &&
    typeof nowOrDateKey === 'number' &&
    nowOrDateKey > usage.activeSegmentStartedAt
  ) {
    totalSeconds += Math.floor((nowOrDateKey - usage.activeSegmentStartedAt) / 1000);
  }

  return totalSeconds >= allowanceMinutes * 60;
}

/**
 * @deprecated v1.0.2: per-app ledger rollover. Use rolloverGroupAllowanceUsage()
 * for the active group ledger. Retained for legacy runtime compat.
 * When the date changes:
 * - preserves allowanceMinutes (stored on DeviceApp)
 * - preserves lastEditedDateKey history (stored on DeviceApp)
 * - resets usedSeconds for the new date
 * - clears exhaustedAt
 * - splits any active app segment crossing midnight
 */
export function rolloverDailyAppUsage(
  currentUsage: Record<string, DailyAppUsage> = {},
  nowMs: number = Date.now()
): Record<string, DailyAppUsage> {
  const currentDateKey = getLocalDateKey(nowMs);
  const nextUsage: Record<string, DailyAppUsage> = {};

  const todayStart = new Date(nowMs);
  todayStart.setHours(0, 0, 0, 0);
  const todayStartMs = todayStart.getTime();

  for (const [appId, usage] of Object.entries(currentUsage)) {
    if (usage.dateKey === currentDateKey) {
      nextUsage[appId] = { ...usage };
    } else {
      if (usage.activeSegmentStartedAt) {
        const segStart = Math.max(todayStartMs, usage.activeSegmentStartedAt);
        // Invariant: An active segment crossing midnight must have one source of elapsed time,
        // never both committed usedSeconds and an overlapping activeSegmentStartedAt.
        nextUsage[appId] = {
          appId,
          dateKey: currentDateKey,
          usedSeconds: 0,
          activeSegmentStartedAt: segStart,
          exhaustedAt: undefined,
        };
      } else {
        nextUsage[appId] = {
          appId,
          dateKey: currentDateKey,
          usedSeconds: 0,
          activeSegmentStartedAt: undefined,
          exhaustedAt: undefined,
        };
      }
    }
  }

  return nextUsage;
}
