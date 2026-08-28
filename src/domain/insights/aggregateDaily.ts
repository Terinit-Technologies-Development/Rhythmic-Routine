import { RoutineWindow } from '../../types/domain';
import { RhythmHistoryEvent } from '../rhythm/types';
import { DailyRhythmSummary } from './types';
import { getIsoWeekday, parseTimeToMinutes } from '../rhythm/routine';

/**
 * Formats a timestamp into a local date key (YYYY-MM-DD).
 */
export function getLocalDateKey(dateOrTimestamp: Date | number = Date.now()): string {
  const d = typeof dateOrTimestamp === 'number' ? new Date(dateOrTimestamp) : dateOrTimestamp;
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Formats a timestamp into a 24-hour time string (HH:MM).
 */
export function formatLocalTime(timestamp: number): string {
  const d = new Date(timestamp);
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  return `${hours}:${mins}`;
}

/**
 * Computes scheduled protected routine minutes for a specific local date across enabled routine windows.
 */
export function computeRoutineProtectedMinutes(
  date: Date,
  routineWindows: RoutineWindow[]
): number {
  const isoWeekday = getIsoWeekday(date);
  let totalMinutes = 0;

  for (const window of routineWindows) {
    if (!window.enabled || !window.activeDays.includes(isoWeekday)) continue;
    if (window.type === 'open-day') continue;

    const startMins = parseTimeToMinutes(window.startTime);
    const endMins = window.endTime ? parseTimeToMinutes(window.endTime) : 0;

    if (endMins >= startMins) {
      totalMinutes += endMins - startMins;
    } else {
      // Cross-midnight window (e.g. 21:30 -> 06:30 is 9 hours = 540 min)
      totalMinutes += (24 * 60 - startMins) + endMins;
    }
  }

  return totalMinutes;
}

/**
 * Pure function aggregating raw history events for a given local date into a DailyRhythmSummary.
 */
export function aggregateDailySummary(
  events: RhythmHistoryEvent[],
  dateKey: string,
  routineWindows: RoutineWindow[] = []
): DailyRhythmSummary {
  const riskUsageSecondsByGroup: Record<string, number> = {};
  const sessionCountByGroup: Record<string, number> = {};
  const cooldownCountByGroup: Record<string, number> = {};
  const cooldownMinutesByGroup: Record<string, number> = {};
  let accessLeaseCount = 0;
  let longestRiskSessionSeconds = 0;

  let firstRiskTimestamp: number | undefined;
  let finalRiskTimestamp: number | undefined;

  // Filter events belonging to the local date
  const dailyEvents = events.filter((e) => getLocalDateKey(e.timestamp) === dateKey);

  // Sort chronologically
  dailyEvents.sort((a, b) => a.timestamp - b.timestamp);

  // Track active cooldown starts to compute duration
  const activeCooldownStarts: Record<string, number> = {};

  for (const event of dailyEvents) {
    switch (event.type) {
      case 'risk-session-started': {
        sessionCountByGroup[event.groupId] = (sessionCountByGroup[event.groupId] || 0) + 1;
        if (!firstRiskTimestamp || event.timestamp < firstRiskTimestamp) {
          firstRiskTimestamp = event.timestamp;
        }
        if (!finalRiskTimestamp || event.timestamp > finalRiskTimestamp) {
          finalRiskTimestamp = event.timestamp;
        }
        break;
      }

      case 'risk-session-ended': {
        riskUsageSecondsByGroup[event.groupId] =
          (riskUsageSecondsByGroup[event.groupId] || 0) + event.durationSeconds;
        if (event.durationSeconds > longestRiskSessionSeconds) {
          longestRiskSessionSeconds = event.durationSeconds;
        }
        if (!finalRiskTimestamp || event.timestamp > finalRiskTimestamp) {
          finalRiskTimestamp = event.timestamp;
        }
        break;
      }

      case 'cooldown-started': {
        cooldownCountByGroup[event.groupId] = (cooldownCountByGroup[event.groupId] || 0) + 1;
        activeCooldownStarts[event.groupId] = event.timestamp;
        break;
      }

      case 'cooldown-ended': {
        const start = activeCooldownStarts[event.groupId];
        const durationMins = start
          ? Math.max(1, Math.round((event.timestamp - start) / 60_000))
          : 60; // Default fallback if start was on previous boundary
        cooldownMinutesByGroup[event.groupId] =
          (cooldownMinutesByGroup[event.groupId] || 0) + durationMins;
        delete activeCooldownStarts[event.groupId];
        break;
      }

      case 'access-lease-started': {
        accessLeaseCount++;
        break;
      }
    }
  }

  // Parse local date from dateKey
  const [year, month, day] = dateKey.split('-').map(Number);
  const dateObj = new Date(year, (month || 1) - 1, day || 1, 12, 0, 0);
  const routineProtectedMinutes = computeRoutineProtectedMinutes(dateObj, routineWindows);

  return {
    dateKey,
    riskUsageSecondsByGroup,
    sessionCountByGroup,
    cooldownCountByGroup,
    cooldownMinutesByGroup,
    routineProtectedMinutes,
    accessLeaseCount,
    longestRiskSessionSeconds,
    firstRiskAppUseTime: firstRiskTimestamp ? formatLocalTime(firstRiskTimestamp) : undefined,
    finalRiskAppUseTime: finalRiskTimestamp ? formatLocalTime(finalRiskTimestamp) : undefined,
  };
}
