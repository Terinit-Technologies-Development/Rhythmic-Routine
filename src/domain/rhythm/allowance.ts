import {
  DAILY_ALLOWANCE_STEP_MINUTES,
  DEFAULT_DAILY_RISK_ALLOWANCE_MINUTES,
  DailyAppUsage,
  DailyRiskAllowancePolicy,
  DeviceApp,
  MIN_DAILY_RISK_ALLOWANCE_MINUTES,
} from '../../types/domain';

export {
  DAILY_ALLOWANCE_STEP_MINUTES,
  DEFAULT_DAILY_RISK_ALLOWANCE_MINUTES,
  MIN_DAILY_RISK_ALLOWANCE_MINUTES,
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
 * Validates a proposed daily allowance modification.
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
 * Determines whether a Risk app has exhausted its daily allowance for the active day.
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
 * Reconciles day rollover for runtime dailyAppUsage.
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
