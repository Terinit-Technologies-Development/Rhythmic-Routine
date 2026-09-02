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

export interface TimeInterval {
  start: number;
  end: number;
}

/**
 * Merges overlapping intervals into a sorted list of disjoint intervals.
 */
export function mergeIntervals(intervals: TimeInterval[]): TimeInterval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: TimeInterval[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const last = merged[merged.length - 1];

    if (current.start <= last.end) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push({ ...current });
    }
  }
  return merged;
}

/**
 * Pure function aggregating raw history events for a given local date into a DailyRhythmSummary.
 */
export function aggregateDailySummary(
  events: RhythmHistoryEvent[],
  dateKey: string,
  routineWindows: RoutineWindow[] = []
): DailyRhythmSummary {
  const [year, month, day] = dateKey.split('-').map(Number);
  const dayStart = new Date(year, (month || 1) - 1, day || 1, 0, 0, 0, 0).getTime();
  const dayEnd = new Date(year, (month || 1) - 1, day || 1, 23, 59, 59, 999).getTime();

  const riskUsageSecondsByGroup: Record<string, number> = {};
  const sessionCountByGroup: Record<string, number> = {};
  const cooldownCountByGroup: Record<string, number> = {};
  const cooldownMinutesByGroup: Record<string, number> = {};
  let accessLeaseCount = 0;
  let longestRiskSessionSeconds = 0;

  let firstRiskTimestamp: number | undefined;
  let finalRiskTimestamp: number | undefined;

  // Filter events that touch this day (or up to 24h prior for cross-midnight starts)
  const relevantEvents = events.filter((e) => e.timestamp >= dayStart - 24 * 60 * 60 * 1000 && e.timestamp <= dayEnd + 24 * 60 * 60 * 1000);
  relevantEvents.sort((a, b) => a.timestamp - b.timestamp);

  // 1. Process point events and risk sessions
  for (const event of relevantEvents) {
    const eventDateKey = getLocalDateKey(event.timestamp);

    switch (event.type) {
      case 'risk-session-started': {
        if (eventDateKey === dateKey) {
          sessionCountByGroup[event.groupId] = (sessionCountByGroup[event.groupId] || 0) + 1;
          if (!firstRiskTimestamp || event.timestamp < firstRiskTimestamp) {
            firstRiskTimestamp = event.timestamp;
          }
          if (!finalRiskTimestamp || event.timestamp > finalRiskTimestamp) {
            finalRiskTimestamp = event.timestamp;
          }
        }
        break;
      }

      case 'risk-session-ended': {
        if (eventDateKey === dateKey) {
          riskUsageSecondsByGroup[event.groupId] =
            (riskUsageSecondsByGroup[event.groupId] || 0) + event.durationSeconds;
          if (event.durationSeconds > longestRiskSessionSeconds) {
            longestRiskSessionSeconds = event.durationSeconds;
          }
          if (!finalRiskTimestamp || event.timestamp > finalRiskTimestamp) {
            finalRiskTimestamp = event.timestamp;
          }
        }
        break;
      }

      case 'cooldown-started': {
        if (eventDateKey === dateKey) {
          cooldownCountByGroup[event.groupId] = (cooldownCountByGroup[event.groupId] || 0) + 1;
        }
        break;
      }

      case 'access-lease-started': {
        if (eventDateKey === dateKey) {
          accessLeaseCount++;
        }
        break;
      }
    }
  }

  // 2. Compute cooldown minutes per group with cross-midnight splitting
  const cooldownStarts: Record<string, number> = {};
  for (const event of relevantEvents) {
    if (event.type === 'cooldown-started') {
      cooldownStarts[event.groupId] = event.timestamp;
    } else if (event.type === 'cooldown-ended') {
      const start = cooldownStarts[event.groupId];
      if (start !== undefined) {
        const clippedStart = Math.max(dayStart, start);
        const clippedEnd = Math.min(dayEnd, event.timestamp);
        if (clippedEnd > clippedStart) {
          const mins = Math.round((clippedEnd - clippedStart) / 60_000);
          cooldownMinutesByGroup[event.groupId] = (cooldownMinutesByGroup[event.groupId] || 0) + mins;
        }
        delete cooldownStarts[event.groupId];
      }
    }
  }

  // 3. Compute observed protected minutes from effective protection intervals
  // Canonical: if explicit 'group-protection-started' / 'group-protection-ended' events exist, use ONLY them!
  // Legacy fallback: if no explicit protection events are present, derive intervals from routine/cooldown events.
  // NOTE (Pass 03 Insights): Group protection events capture routine windows, cooldowns, and overnight
  // protection gaps. Daily allowance exhaustion is tracked per-app via 'daily-allowance-exhausted'.
  // Pass 03 Insights aggregation must combine group protection intervals with per-app daily allowance
  // exhaustion history rather than treating group-protection events alone as complete overnight or allowance data.
  const protectionStarts: Record<string, number> = {};
  const rawIntervals: TimeInterval[] = [];

  const hasExplicitProtectionEvents = relevantEvents.some(
    (e) => e.type === 'group-protection-started' || e.type === 'group-protection-ended'
  );

  if (hasExplicitProtectionEvents) {
    for (const event of relevantEvents) {
      if (event.type === 'group-protection-started') {
        protectionStarts[event.groupId] = event.timestamp;
      } else if (event.type === 'group-protection-ended') {
        const start = protectionStarts[event.groupId];
        if (start !== undefined) {
          rawIntervals.push({ start, end: event.timestamp });
          delete protectionStarts[event.groupId];
        }
      }
    }
  } else {
    // Legacy fallback using routine/cooldown events
    for (const event of relevantEvents) {
      if (event.type === 'cooldown-started') {
        protectionStarts[`cooldown-${event.groupId}`] = event.timestamp;
      } else if (event.type === 'cooldown-ended') {
        const start = protectionStarts[`cooldown-${event.groupId}`];
        if (start !== undefined) {
          rawIntervals.push({ start, end: event.timestamp });
          delete protectionStarts[`cooldown-${event.groupId}`];
        }
      } else if (event.type === 'routine-started') {
        protectionStarts[`routine-${event.windowId}`] = event.timestamp;
      } else if (event.type === 'routine-ended') {
        const start = protectionStarts[`routine-${event.windowId}`];
        if (start !== undefined) {
          rawIntervals.push({ start, end: event.timestamp });
          delete protectionStarts[`routine-${event.windowId}`];
        }
      }
    }
  }

  // Clip still-open intervals to dayEnd or current time
  const now = Date.now();
  for (const start of Object.values(protectionStarts)) {
    if (start < dayEnd) {
      rawIntervals.push({ start, end: Math.min(dayEnd, now) });
    }
  }

  // Merge overlapping intervals into disjoint intervals
  const disjointIntervals = mergeIntervals(rawIntervals);
  let observedProtectedMinutes = 0;

  for (const interval of disjointIntervals) {
    const s = Math.max(dayStart, interval.start);
    const e = Math.min(dayEnd, interval.end);
    if (e > s) {
      observedProtectedMinutes += Math.round((e - s) / 60_000);
    }
  }

  const dateObj = new Date(year, (month || 1) - 1, day || 1, 12, 0, 0);
  const scheduledRoutineMinutes = computeRoutineProtectedMinutes(dateObj, routineWindows);

  return {
    dateKey,
    scheduledRoutineMinutes,
    observedProtectedMinutes,
    riskUsageSecondsByGroup,
    sessionCountByGroup,
    cooldownCountByGroup,
    cooldownMinutesByGroup,
    accessLeaseCount,
    longestRiskSessionSeconds,
    firstRiskAppUseTime: firstRiskTimestamp ? formatLocalTime(firstRiskTimestamp) : undefined,
    finalRiskAppUseTime: finalRiskTimestamp ? formatLocalTime(finalRiskTimestamp) : undefined,
  };
}
