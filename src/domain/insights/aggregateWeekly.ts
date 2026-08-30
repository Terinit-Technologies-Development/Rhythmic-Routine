import { DailyRhythmSummary, DailyTrendSummaryPoint, WeeklyRhythmSummary } from './types';
import { getLocalDateKey } from './aggregateDaily';

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Pure function aggregating recent DailyRhythmSummary objects into a 7-day WeeklyRhythmSummary.
 */
export function aggregateWeeklySummary(
  summaries: DailyRhythmSummary[],
  endDateKey: string = getLocalDateKey()
): WeeklyRhythmSummary {
  // Map summaries by dateKey
  const summaryMap = new Map<string, DailyRhythmSummary>();
  for (const s of summaries) {
    summaryMap.set(s.dateKey, s);
  }

  // Generate 7-day dates leading up to endDateKey
  const [endYear, endMonth, endDay] = endDateKey.split('-').map(Number);
  const endDate = new Date(endYear, (endMonth || 1) - 1, endDay || 1, 12, 0, 0);

  const dailyTrend: DailyTrendSummaryPoint[] = [];
  const groupUsageMinutes: Record<string, number> = {};

  let totalProtectedMinutes = 0;
  let scheduledRoutineMinutes = 0;
  let totalRiskUsageSeconds = 0;
  let totalRiskSessions = 0;
  let totalCooldownCount = 0;
  let daysWithProtectedTime = 0;
  let hasAnyData = false;

  for (let i = 6; i >= 0; i--) {
    const current = new Date(endDate.getTime() - i * 24 * 60 * 60 * 1000);
    const dateKey = getLocalDateKey(current);
    const dayLabel = WEEKDAY_NAMES[current.getDay()];

    const summary = summaryMap.get(dateKey);

    let dayRiskSeconds = 0;
    let dayObservedProtectedMins = 0;

    if (summary) {
      dayObservedProtectedMins = summary.observedProtectedMinutes;
      scheduledRoutineMinutes += summary.scheduledRoutineMinutes;

      // Aggregate risk usage
      for (const [groupId, seconds] of Object.entries(summary.riskUsageSecondsByGroup)) {
        dayRiskSeconds += seconds;
        const mins = Math.round(seconds / 60);
        groupUsageMinutes[groupId] = (groupUsageMinutes[groupId] || 0) + mins;
      }

      // Aggregate cooldown count
      for (const count of Object.values(summary.cooldownCountByGroup)) {
        totalCooldownCount += count;
      }

      // Aggregate sessions
      for (const count of Object.values(summary.sessionCountByGroup)) {
        totalRiskSessions += count;
      }

      if (
        Object.keys(summary.sessionCountByGroup).length > 0 ||
        Object.keys(summary.cooldownCountByGroup).length > 0 ||
        summary.observedProtectedMinutes > 0
      ) {
        hasAnyData = true;
      }
    }

    totalProtectedMinutes += dayObservedProtectedMins;
    totalRiskUsageSeconds += dayRiskSeconds;

    if (dayObservedProtectedMins > 0) {
      daysWithProtectedTime++;
    }

    dailyTrend.push({
      day: dayLabel,
      dateKey,
      protectedMinutes: dayObservedProtectedMins,
      riskMinutes: Math.round(dayRiskSeconds / 60),
    });
  }

  const totalRiskUsageMinutes = Math.round(totalRiskUsageSeconds / 60);
  const averageRiskSessionMinutes =
    totalRiskSessions > 0 ? Math.round(totalRiskUsageMinutes / totalRiskSessions) : 0;

  // Routine consistency score: % of past 7 days where observed protection occurred
  const routineConsistencyScore = Math.round((daysWithProtectedTime / 7) * 100);
  const startDateKey = dailyTrend[0]?.dateKey ?? endDateKey;

  return {
    startDateKey,
    endDateKey,
    totalProtectedMinutes: hasAnyData ? totalProtectedMinutes : 0,
    scheduledRoutineMinutes,
    totalRiskUsageMinutes,
    averageRiskSessionMinutes,
    totalCooldownCount,
    routineConsistencyScore: hasAnyData ? routineConsistencyScore : 0,
    groupUsageMinutes,
    dailyTrend,
    hasData: hasAnyData,
  };
}
