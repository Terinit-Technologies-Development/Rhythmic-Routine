import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateDailySummary,
  getLocalDateKey,
} from '../aggregateDaily';
import { aggregateWeeklySummary } from '../aggregateWeekly';
import { compactDailySummaries, compactRawEvents } from '../compaction';
import { formatMinutesToHumanReadable } from '../metrics';
import { RhythmHistoryEvent } from '../../rhythm/types';
import { RoutineWindow } from '../../../types/domain';
import { DailyRhythmSummary } from '../types';

const mockRoutineWindows: RoutineWindow[] = [
  {
    id: 'morning-buffer',
    name: 'Morning Buffer',
    type: 'morning-buffer',
    startTime: '06:30',
    endTime: '08:00',
    activeDays: [1, 2, 3, 4, 5, 6, 7],
    protectedGroupIds: ['social', 'entertainment'],
    enabled: true,
    tagline: 'Ease into your day',
    description: 'Protected morning',
  },
  {
    id: 'evening-wind-down',
    name: 'Evening Wind-Down',
    type: 'evening-wind-down',
    startTime: '21:30',
    endTime: '23:30',
    activeDays: [1, 2, 3, 4, 5, 6, 7],
    protectedGroupIds: ['social', 'entertainment'],
    enabled: true,
    tagline: 'Disconnect before bed',
    description: 'Protected evening',
  },
];

test('Insights — Daily Aggregation computes usage, sessions, cooldowns and access leases', () => {
  const dateKey = '2026-08-31';
  const t0 = new Date('2026-08-31T09:00:00').getTime();

  const events: RhythmHistoryEvent[] = [
    { type: 'routine-started', windowId: 'morning-buffer', timestamp: new Date('2026-08-31T06:30:00').getTime() },
    { type: 'routine-ended', windowId: 'morning-buffer', timestamp: new Date('2026-08-31T08:00:00').getTime() },
    { type: 'risk-session-started', groupId: 'social', appId: 'com.twitter.android', timestamp: t0 },
    { type: 'risk-session-ended', groupId: 'social', durationSeconds: 1800, timestamp: t0 + 1800 * 1000 },
    { type: 'cooldown-started', groupId: 'social', timestamp: t0 + 1800 * 1000 },
    { type: 'access-lease-started', groupId: 'social', reason: 'emergency', timestamp: t0 + 2000 * 1000 },
    { type: 'access-lease-ended', groupId: 'social', timestamp: t0 + 2300 * 1000 },
    { type: 'cooldown-ended', groupId: 'social', timestamp: t0 + 5400 * 1000 },
  ];

  const summary = aggregateDailySummary(events, dateKey, mockRoutineWindows);

  assert.equal(summary.dateKey, dateKey);
  assert.equal(summary.riskUsageSecondsByGroup['social'], 1800);
  assert.equal(summary.sessionCountByGroup['social'], 1);
  assert.equal(summary.cooldownCountByGroup['social'], 1);
  assert.equal(summary.cooldownMinutesByGroup['social'], 60); // 3600s = 60m
  assert.equal(summary.accessLeaseCount, 1);
  assert.equal(summary.longestRiskSessionSeconds, 1800);
  assert.equal(summary.routineProtectedMinutes, 90 + 120); // 90m morning + 120m evening = 210m
  assert.ok(summary.firstRiskAppUseTime);
  assert.ok(summary.finalRiskAppUseTime);
});

test('Insights — Empty History returns clean empty summary', () => {
  const dateKey = '2026-08-31';
  const summary = aggregateDailySummary([], dateKey, mockRoutineWindows);

  assert.equal(summary.dateKey, dateKey);
  assert.equal(Object.keys(summary.riskUsageSecondsByGroup).length, 0);
  assert.equal(Object.keys(summary.sessionCountByGroup).length, 0);
  assert.equal(Object.keys(summary.cooldownCountByGroup).length, 0);
  assert.equal(summary.accessLeaseCount, 0);
  assert.equal(summary.longestRiskSessionSeconds, 0);
  assert.equal(summary.firstRiskAppUseTime, undefined);
});

test('Insights — Weekly Rollup aggregates 7-day trend, consistency, and group breakdown', () => {
  const summaries: DailyRhythmSummary[] = [
    {
      dateKey: '2026-08-25',
      riskUsageSecondsByGroup: { social: 1200 },
      sessionCountByGroup: { social: 1 },
      cooldownCountByGroup: { social: 1 },
      cooldownMinutesByGroup: { social: 60 },
      routineProtectedMinutes: 210,
      accessLeaseCount: 0,
      longestRiskSessionSeconds: 1200,
    },
    {
      dateKey: '2026-08-26',
      riskUsageSecondsByGroup: { social: 1800, entertainment: 2400 },
      sessionCountByGroup: { social: 1, entertainment: 1 },
      cooldownCountByGroup: { social: 1, entertainment: 1 },
      cooldownMinutesByGroup: { social: 60, entertainment: 90 },
      routineProtectedMinutes: 210,
      accessLeaseCount: 1,
      longestRiskSessionSeconds: 2400,
    },
  ];

  const weekly = aggregateWeeklySummary(summaries, '2026-08-31');

  assert.equal(weekly.dailyTrend.length, 7);
  assert.ok(weekly.hasData);
  assert.equal(weekly.totalCooldownCount, 3);
  assert.equal(weekly.groupUsageMinutes['social'], 20 + 30); // 1200s + 1800s = 50m
  assert.equal(weekly.groupUsageMinutes['entertainment'], 40); // 2400s = 40m
  assert.ok(weekly.routineConsistencyScore > 0);
});

test('Insights — Compaction purges raw events > 14 days and summaries > 90 days', () => {
  const now = new Date('2026-08-31T12:00:00').getTime();
  const dayMs = 24 * 60 * 60 * 1000;

  const rawEvents: RhythmHistoryEvent[] = [
    { type: 'cooldown-started', groupId: 'social', timestamp: now - 5 * dayMs }, // 5 days ago -> keep
    { type: 'cooldown-started', groupId: 'social', timestamp: now - 20 * dayMs }, // 20 days ago -> purge
  ];

  const compactedRaw = compactRawEvents(rawEvents, 14, now);
  assert.equal(compactedRaw.length, 1);
  assert.equal(compactedRaw[0].timestamp, now - 5 * dayMs);

  const summaries = [
    { dateKey: getLocalDateKey(now - 30 * dayMs), riskUsageSecondsByGroup: {}, sessionCountByGroup: {}, cooldownCountByGroup: {}, cooldownMinutesByGroup: {}, routineProtectedMinutes: 0, accessLeaseCount: 0, longestRiskSessionSeconds: 0 },
    { dateKey: getLocalDateKey(now - 100 * dayMs), riskUsageSecondsByGroup: {}, sessionCountByGroup: {}, cooldownCountByGroup: {}, cooldownMinutesByGroup: {}, routineProtectedMinutes: 0, accessLeaseCount: 0, longestRiskSessionSeconds: 0 },
  ];

  const compactedSummaries = compactDailySummaries(summaries, 90, now);
  assert.equal(compactedSummaries.length, 1);
});

test('Insights — Metric formatting handles hours and minutes cleanly', () => {
  assert.equal(formatMinutesToHumanReadable(0), '0m');
  assert.equal(formatMinutesToHumanReadable(45), '45m');
  assert.equal(formatMinutesToHumanReadable(60), '1h');
  assert.equal(formatMinutesToHumanReadable(135), '2h 15m');
});
