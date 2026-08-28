import { RoutineWindow, RhythmState } from '../../types/domain';
import { ActiveCooldown, ActiveRiskSession } from './types';

/**
 * Converts "HH:MM" string to minutes since midnight (0 - 1439).
 */
export function parseTimeToMinutes(timeStr: string): number {
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

/**
 * Determines whether a given time is inside a specific Routine Window,
 * supporting same-day, cross-midnight, enabled status, and active weekdays.
 */
export function isInsideWindow(now: Date, window: RoutineWindow): boolean {
  if (!window.enabled) return false;

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const currentWeekday = getIsoWeekday(now);

  const startMinutes = parseTimeToMinutes(window.startTime);
  const endMinutes = parseTimeToMinutes(window.endTime || '23:59');

  const isCrossMidnight = startMinutes > endMinutes;

  if (!isCrossMidnight) {
    // Same-day window (e.g., 06:30 to 08:30)
    const inActiveDay = window.activeDays.includes(currentWeekday);
    if (!inActiveDay) return false;

    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  } else {
    // Cross-midnight window (e.g., 22:00 to 06:30)
    // Time is either after start on active day, or before end on next calendar day (which started on previous day)
    const isEveningPart = currentMinutes >= startMinutes;
    const isMorningPart = currentMinutes < endMinutes;

    if (isEveningPart) {
      return window.activeDays.includes(currentWeekday);
    }

    if (isMorningPart) {
      // Previous weekday initiated the window
      const prevWeekday = currentWeekday === 1 ? 7 : currentWeekday - 1;
      return window.activeDays.includes(prevWeekday);
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
 * 2. Morning Buffer
 * 3. Cooldown
 * 4. Active Risk Session
 * 5. Available
 */
export function resolveRhythmState(
  now: Date,
  windows: RoutineWindow[],
  cooldown?: ActiveCooldown,
  session?: ActiveRiskSession
): RhythmState {
  if (isInsideRoutineWindow(now, windows, 'evening-wind-down')) {
    return 'evening-wind-down';
  }

  if (isInsideRoutineWindow(now, windows, 'morning-buffer')) {
    return 'morning-buffer';
  }

  if (cooldown && cooldown.endsAt > now.getTime()) {
    return 'cooldown';
  }

  if (session) {
    return 'risk-session';
  }

  return 'available';
}
