import { RoutineWindow, RhythmState } from '../../types/domain';
import { ActiveCooldown, ActiveRiskSession, getActiveCooldowns } from './types';

const CLOCK_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

/**
 * Strictly parses a persisted local clock time ("HH:MM", 00:00-23:59).
 * Returns null for missing/malformed values so restriction evaluation leaves
 * the window inactive instead of inventing an all-day window. An invalid time
 * must never create a lock.
 */
export function parseClockTimeToMinutes(timeStr: string | undefined | null): number | null {
  if (typeof timeStr !== 'string') return null;
  const value = timeStr.trim();
  if (!CLOCK_TIME_PATTERN.test(value)) return null;
  const [hours, minutes] = value.split(':');
  return Number(hours) * 60 + Number(minutes);
}

/**
 * Converts "HH:MM" string to minutes since midnight (0 - 1439).
 *
 * Retains the historical lenient fallback for non-domain inputs. Restriction
 * window evaluation uses `parseClockTimeToMinutes` and rejects malformed
 * persisted values.
 */
export function parseTimeToMinutes(timeStr: string): number {
  const parsed = parseClockTimeToMinutes(timeStr);
  if (parsed !== null) return parsed;
  if (!timeStr) return 0;
  const parts = timeStr.split(':');
  const hours = Number(parts[0]) || 0;
  const minutes = Number(parts[1]) || 0;
  return hours * 60 + minutes;
}

/**
 * Normalizes JS Date.getDay() (0 = Sunday, 1 = Monday ... 6 = Saturday)
 * to 1-based Monday-first weekday (1 = Mon, 2 = Tue, ..., 7 = Sun).
 */
export function getIsoWeekday(date: Date): number {
  const day = date.getDay();
  return day === 0 ? 7 : day;
}

/** Empty or malformed persisted `activeDays` means "no active routine days". */
function getActiveDays(window: RoutineWindow): number[] {
  return Array.isArray(window.activeDays) ? window.activeDays : [];
}

/**
 * Determines whether a given time is inside a specific Routine Window,
 * supporting same-day, cross-midnight, enabled status, and active weekdays.
 */
export function isInsideWindow(now: Date, window: RoutineWindow): boolean {
  if (!window.enabled) return false;

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const currentWeekday = getIsoWeekday(now);

  const startMinutes = parseClockTimeToMinutes(window.startTime);
  const endMinutes = parseClockTimeToMinutes(window.endTime ?? '23:59');

  // Missing/malformed persisted times leave this window inactive so invalid
  // configuration cannot create an accidental all-day restriction. Empty
  // activeDays likewise means "no active days".
  if (startMinutes === null || endMinutes === null) return false;

  const activeDays = getActiveDays(window);
  const isCrossMidnight = startMinutes > endMinutes;

  if (!isCrossMidnight) {
    // Same-day window (e.g., 06:30 to 08:30)
    const inActiveDay = activeDays.includes(currentWeekday);
    if (!inActiveDay) return false;

    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  } else {
    // Cross-midnight window (e.g., 22:00 to 06:30)
    // Time is either after start on active day, or before end on next calendar day (which started on previous day)
    const isEveningPart = currentMinutes >= startMinutes;
    const isMorningPart = currentMinutes < endMinutes;

    if (isEveningPart) {
      return activeDays.includes(currentWeekday);
    }

    if (isMorningPart) {
      // Previous weekday initiated the window
      const prevWeekday = currentWeekday === 1 ? 7 : currentWeekday - 1;
      return activeDays.includes(prevWeekday);
    }

    return false;
  }
}

/**
 * Checks if current time is inside a routine window of the specified type.
 */
export function isInsideRoutineWindow(
  now: Date,
  windows: RoutineWindow[],
  type: RoutineWindow['type']
): boolean {
  const targetWindow = windows.find((w) => w.type === type);
  if (!targetWindow) return false;
  return isInsideWindow(now, targetWindow);
}

/**
 * Derives whether current time is inside the Overnight Protection gap:
 * Evening Wind-Down end → next Morning Buffer start.
 *
 * Rules:
 * - If Evening applies to the night AND Morning is enabled for the next morning: protect the gap.
 * - If either boundary is intentionally disabled, returns false (do not invent an indefinite lock).
 * - Handles cross-midnight progression, active weekdays, and Sunday→Monday transition.
 * - Does NOT overlap with active Evening Wind-Down or Morning Buffer windows.
 */
export function isInsideOvernightProtection(
  now: Date,
  windows: RoutineWindow[]
): boolean {
  const evening = windows.find((w) => w.type === 'evening-wind-down');
  const morning = windows.find((w) => w.type === 'morning-buffer');

  if (!evening || !evening.enabled || !morning || !morning.enabled) {
    return false;
  }

  // If currently inside either active routine window, it's not the overnight gap
  if (isInsideWindow(now, evening) || isInsideWindow(now, morning)) {
    return false;
  }

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const currentWeekday = getIsoWeekday(now); // 1 = Mon ... 7 = Sun

  const eveningStartMinutes = parseClockTimeToMinutes(evening.startTime);
  const eveningEndMinutes = parseClockTimeToMinutes(evening.endTime ?? '23:59');
  const morningStartMinutes = parseClockTimeToMinutes(morning.startTime);

  if (
    eveningStartMinutes === null ||
    eveningEndMinutes === null ||
    morningStartMinutes === null
  ) {
    return false;
  }

  const eveningIsCrossMidnight = eveningStartMinutes > eveningEndMinutes;
  const eveningDays = getActiveDays(evening);
  const morningDays = getActiveDays(morning);

  // Case 1: Post-midnight morning portion (00:00 up to Morning Buffer start)
  if (currentMinutes < morningStartMinutes) {
    const prevWeekday = currentWeekday === 1 ? 7 : currentWeekday - 1;
    const eveningAppliedLastNight = eveningDays.includes(prevWeekday);
    const morningAppliesToday = morningDays.includes(currentWeekday);

    if (!eveningAppliedLastNight || !morningAppliesToday) {
      return false;
    }

    if (eveningIsCrossMidnight) {
      // Evening extended past midnight: overnight is from eveningEndMinutes to morningStartMinutes
      return currentMinutes >= eveningEndMinutes;
    } else {
      // Evening ended before midnight: overnight is from 00:00 to morningStartMinutes
      return true;
    }
  }

  // Case 2: Pre-midnight evening portion (Evening Wind-Down end up to 23:59)
  if (!eveningIsCrossMidnight && currentMinutes >= eveningEndMinutes) {
    const nextWeekday = currentWeekday === 7 ? 1 : currentWeekday + 1;
    const eveningAppliesTonight = eveningDays.includes(currentWeekday);
    const morningAppliesTomorrow = morningDays.includes(nextWeekday);

    if (!eveningAppliesTonight || !morningAppliesTomorrow) {
      return false;
    }

    return true;
  }

  return false;
}

/**
 * Determines whether the current time is inside Open Day:
 * Morning Buffer end <= now < Evening Wind-Down start.
 */
export function isInsideOpenDay(
  now: Date,
  windows: RoutineWindow[]
): boolean {
  if (isInsideRoutineWindow(now, windows, 'morning-buffer')) return false;
  if (isInsideRoutineWindow(now, windows, 'evening-wind-down')) return false;
  if (isInsideOvernightProtection(now, windows)) return false;

  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const morning = windows.find((w) => w.type === 'morning-buffer');
  const evening = windows.find((w) => w.type === 'evening-wind-down');

  const parsedMorningEnd = morning?.endTime
    ? parseClockTimeToMinutes(morning.endTime)
    : 8 * 60;
  const startMinutes = morning?.enabled ? parsedMorningEnd ?? 8 * 60 : 0;

  const parsedEveningStart = evening
    ? parseClockTimeToMinutes(evening.startTime)
    : 21 * 60 + 30;
  const endMinutes = evening?.enabled ? parsedEveningStart ?? 21 * 60 + 30 : 1440;

  return currentMinutes >= startMinutes && currentMinutes < endMinutes;
}

/**
 * Finds all active routine window IDs for a given timestamp.
 */
export function getActiveRoutineWindowIds(
  now: Date,
  windows: RoutineWindow[]
): string[] {
  return windows.filter((w) => isInsideWindow(now, w)).map((w) => w.id);
}

/**
 * Resolves the effective high-level RhythmState from actual time and active sessions/cooldowns.
 * Priority:
 * 1. Evening Wind-Down
 * 2. Overnight Protected
 * 3. Morning Buffer
 * 4. Cooldown (if any active cooldown exists)
 * 5. Active Risk Session
 * 6. Available
 */
export function resolveRhythmState(
  now: Date,
  windows: RoutineWindow[],
  cooldowns?: Record<string, ActiveCooldown> | ActiveCooldown,
  session?: ActiveRiskSession
): RhythmState {
  if (isInsideRoutineWindow(now, windows, 'evening-wind-down')) {
    return 'evening-wind-down';
  }

  if (isInsideOvernightProtection(now, windows)) {
    return 'overnight-protected';
  }

  if (isInsideRoutineWindow(now, windows, 'morning-buffer')) {
    return 'morning-buffer';
  }

  const nowMs = now.getTime();
  const hasActiveCooldown = cooldowns && 'groupId' in cooldowns
    ? (cooldowns as ActiveCooldown).endsAt > nowMs
    : cooldowns
    ? getActiveCooldowns(cooldowns as Record<string, ActiveCooldown>, nowMs).length > 0
    : false;

  if (hasActiveCooldown) {
    return 'cooldown';
  }

  if (session) {
    return 'risk-session';
  }

  return 'available';
}
