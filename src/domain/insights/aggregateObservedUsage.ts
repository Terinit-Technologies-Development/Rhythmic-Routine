import { UsageActivityEvent } from '../../platform/UsageProvider';
import { formatLocalTime, getLocalDateKey } from './aggregateDaily';

export interface RiskAppGroupMapping {
  id: string;
  riskGroupId?: string;
}

export interface ObservedRiskUsageAggregation {
  secondsByApp: Record<string, number>;
  secondsByGroup: Record<string, number>;
  secondsByDate: Record<string, number>;
  firstRiskUseTime?: string;
  finalRiskUseTime?: string;
}

/**
 * Computes the timestamp for local midnight six days ago (start of 7-day local calendar window).
 * This represents today + previous 6 local calendar dates and remains correct across DST.
 */
export function getSevenDayWindowStart(now: number = Date.now()): number {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - 6);
  return start.getTime();
}

/**
 * Aggregates observed Android UsageStats events into foreground time by app, group, and date.
 * Splits intervals crossing local midnight into their respective local days.
 */
export function aggregateObservedRiskUsage(
  events: UsageActivityEvent[],
  riskApps: (string | RiskAppGroupMapping)[],
  from: number,
  to: number
): ObservedRiskUsageAggregation {
  const riskMap = new Map<string, string | undefined>();
  for (const item of riskApps) {
    if (typeof item === 'string') {
      riskMap.set(item, undefined);
    } else {
      riskMap.set(item.id, item.riskGroupId);
    }
  }

  const secondsByApp: Record<string, number> = {};
  const secondsByGroup: Record<string, number> = {};
  const secondsByDate: Record<string, number> = {};

  const todayKey = getLocalDateKey(to);
  let firstRiskTimestampToday: number | undefined;
  let finalRiskTimestampToday: number | undefined;

  // Filter for valid events targeting risk apps within [from, to] or before 'to'
  const validEvents = events
    .filter(
      (e) =>
        e &&
        typeof e.timestamp === 'number' &&
        !isNaN(e.timestamp) &&
        (e.state === 'foreground' || e.state === 'background') &&
        riskMap.has(e.appId)
    )
    .sort((a, b) => a.timestamp - b.timestamp);

  const activeStarts = new Map<string, number>();

  const commitSegment = (appId: string, rawStart: number, rawEnd: number) => {
    if (rawEnd <= rawStart) return;
    const start = Math.max(rawStart, from);
    const end = Math.min(rawEnd, to);
    if (end <= start) return;

    const totalSeconds = Math.round((end - start) / 1000);
    if (totalSeconds <= 0) return;

    // Attribute to app
    secondsByApp[appId] = (secondsByApp[appId] || 0) + totalSeconds;

    // Attribute to risk group
    const groupId = riskMap.get(appId);
    if (groupId) {
      secondsByGroup[groupId] = (secondsByGroup[groupId] || 0) + totalSeconds;
    }

    // Split across local midnights for secondsByDate
    let segStart = start;
    while (segStart < end) {
      const d = new Date(segStart);
      const nextMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0).getTime();
      const segEnd = Math.min(end, nextMidnight);
      const daySeconds = Math.round((segEnd - segStart) / 1000);
      const dateKey = getLocalDateKey(segStart);

      if (daySeconds > 0) {
        secondsByDate[dateKey] = (secondsByDate[dateKey] || 0) + daySeconds;
      }

      // Track today's first and final risk app use
      if (dateKey === todayKey) {
        if (!firstRiskTimestampToday || segStart < firstRiskTimestampToday) {
          firstRiskTimestampToday = segStart;
        }
        if (!finalRiskTimestampToday || segEnd > finalRiskTimestampToday) {
          finalRiskTimestampToday = segEnd;
        }
      }

      segStart = segEnd;
    }
  };

  for (const ev of validEvents) {
    if (ev.state === 'foreground') {
      // If not already active: start segment. If already active: preserve existing start.
      if (!activeStarts.has(ev.appId)) {
        activeStarts.set(ev.appId, ev.timestamp);
      }
    } else if (ev.state === 'background') {
      const start = activeStarts.get(ev.appId);
      if (start != null) {
        commitSegment(ev.appId, start, ev.timestamp);
        activeStarts.delete(ev.appId);
      }
    }
  }

  // If a Risk app remains foreground at query end: commit [start, queryEnd]
  for (const [appId, start] of activeStarts.entries()) {
    commitSegment(appId, start, to);
  }

  return {
    secondsByApp,
    secondsByGroup,
    secondsByDate,
    firstRiskUseTime: firstRiskTimestampToday ? formatLocalTime(firstRiskTimestampToday) : undefined,
    finalRiskUseTime: finalRiskTimestampToday ? formatLocalTime(finalRiskTimestampToday) : undefined,
  };
}
