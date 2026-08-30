import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateDailySummary, getLocalDateKey } from '../aggregateDaily';
import { aggregateWeeklySummary } from '../aggregateWeekly';
import { LocalInsightsRepository } from '../LocalInsightsRepository';
import { MockStorageProvider } from '../../../platform/storage/MockStorageProvider';
import { RhythmHistoryEvent } from '../../rhythm/types';
import { RoutineWindow } from '../../../types/domain';

const mockWindows: RoutineWindow[] = [
  {
    id: 'morning-buffer',
    name: 'Morning Buffer',
    type: 'morning-buffer',
    startTime: '06:30',
    endTime: '08:00',
    activeDays: [1, 2, 3, 4, 5, 6, 7],
    protectedGroupIds: ['social'],
    enabled: true,
    tagline: 'Ease into day',
    description: 'Mornings',
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
    tagline: 'Ease out of day',
    description: 'Evenings',
  },
];

test('Insights Regression — >100 history events retained without truncation', async () => {
  const storage = new MockStorageProvider();

  // Append 250 events
  for (let i = 0; i < 250; i++) {
    await storage.appendHistoryEvent({
      type: 'cooldown-started',
      groupId: 'social',
      timestamp: Date.now() - (250 - i) * 60000,
    });
  }

  const events = await storage.getHistoryEvents(1000);
  assert.equal(events.length, 250, 'Storage must retain all 250 events without a 100-event cap');
});

test('Insights Regression — Protection interval union avoids double-counting concurrent group protections', () => {
  const dateKey = '2026-08-31';
  const t0 = new Date('2026-08-31T10:00:00').getTime();

  // Social protected: 10:00 - 11:00 (60m)
  // Entertainment protected: 10:30 - 11:30 (60m)
  // Combined clock time should be 90m (10:00 - 11:30), NOT 120m!
  const events: RhythmHistoryEvent[] = [
    { type: 'group-protection-started', groupId: 'social', timestamp: t0 },
    { type: 'group-protection-started', groupId: 'entertainment', timestamp: t0 + 30 * 60000 },
    { type: 'group-protection-ended', groupId: 'social', timestamp: t0 + 60 * 60000 },
    { type: 'group-protection-ended', groupId: 'entertainment', timestamp: t0 + 90 * 60000 },
  ];

  const summary = aggregateDailySummary(events, dateKey, mockWindows);
  assert.equal(summary.observedProtectedMinutes, 90, 'Concurrent protection must merge to 90 minutes');
});

test('Insights Regression — Cross-midnight cooldown interval correctly split across days', () => {
  // Cooldown from 2026-08-31 23:45 to 2026-09-01 00:45 (60 minutes total)
  // Day 1 (Aug 31): 23:45 to 24:00 = 15m
  // Day 2 (Sep 01): 00:00 to 00:45 = 45m
  const start = new Date('2026-08-31T23:45:00').getTime();
  const end = new Date('2026-09-01T00:45:00').getTime();

  const events: RhythmHistoryEvent[] = [
    { type: 'cooldown-started', groupId: 'social', timestamp: start },
    { type: 'cooldown-ended', groupId: 'social', timestamp: end },
  ];

  const day1 = aggregateDailySummary(events, '2026-08-31', []);
  const day2 = aggregateDailySummary(events, '2026-09-01', []);

  assert.equal(day1.cooldownMinutesByGroup['social'], 15, 'Day 1 receives 15 minutes before midnight');
  assert.equal(day2.cooldownMinutesByGroup['social'], 45, 'Day 2 receives 45 minutes after midnight');
});

test('Insights Regression — Fresh install shows 0 observed protected time and hasData=false', () => {
  const dateKey = '2026-08-31';
  const summary = aggregateDailySummary([], dateKey, mockWindows);

  assert.equal(summary.observedProtectedMinutes, 0, 'Observed protected time must be 0 without events');
  assert.equal(summary.scheduledRoutineMinutes, 210, 'Scheduled routine time is kept as planned context');

  const weekly = aggregateWeeklySummary([summary], dateKey);
  assert.equal(weekly.hasData, false, 'Weekly summary hasData must be false on fresh install');
  assert.equal(weekly.totalProtectedMinutes, 0, 'Total protected minutes must be 0 on fresh install');
  assert.equal(weekly.routineConsistencyScore, 0, 'Routine consistency must be 0% on fresh install');
});

test('Insights Regression — Repository re-instantiation preserves persisted summaries across restarts', async () => {
  const storage = new MockStorageProvider();
  const repo1 = new LocalInsightsRepository(storage, mockWindows);

  const pastDateKey = '2026-08-20';
  const t0 = new Date('2026-08-20T10:00:00').getTime();

  await storage.appendHistoryEvent({
    type: 'risk-session-started',
    groupId: 'social',
    appId: 'com.twitter.android',
    timestamp: t0,
  });
  await storage.appendHistoryEvent({
    type: 'risk-session-ended',
    groupId: 'social',
    durationSeconds: 1200,
    timestamp: t0 + 1200 * 1000,
  });

  // Calculate and persist
  const summary1 = await repo1.getDailySummary(pastDateKey);
  assert.ok(summary1);
  assert.equal(summary1.riskUsageSecondsByGroup['social'], 1200);

  // Re-instantiate repository (simulating app restart)
  const repo2 = new LocalInsightsRepository(storage, mockWindows);
  const summary2 = await repo2.getDailySummary(pastDateKey);

  assert.ok(summary2, 'Summary must be loaded from persistent storage after restart');
  assert.equal(summary2.riskUsageSecondsByGroup['social'], 1200);
});

test('Insights Regression — Compaction prunes raw events > 14 days and daily summaries > 90 days', async () => {
  const storage = new MockStorageProvider();
  const repo = new LocalInsightsRepository(storage, mockWindows);
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  // Add 1 recent event (3 days old) and 1 old event (25 days old)
  await storage.appendHistoryEvent({
    type: 'cooldown-started',
    groupId: 'social',
    timestamp: now - 3 * dayMs,
  });
  await storage.appendHistoryEvent({
    type: 'cooldown-started',
    groupId: 'social',
    timestamp: now - 25 * dayMs,
  });

  // Add 1 recent summary (10 days old) and 1 old summary (100 days old)
  const recentDKey = getLocalDateKey(now - 10 * dayMs);
  const oldDKey = getLocalDateKey(now - 100 * dayMs);
  await storage.saveDailySummary!({
    dateKey: recentDKey,
    scheduledRoutineMinutes: 0,
    observedProtectedMinutes: 30,
    riskUsageSecondsByGroup: {},
    sessionCountByGroup: {},
    cooldownCountByGroup: {},
    cooldownMinutesByGroup: {},
    accessLeaseCount: 0,
    longestRiskSessionSeconds: 0,
  });
  await storage.saveDailySummary!({
    dateKey: oldDKey,
    scheduledRoutineMinutes: 0,
    observedProtectedMinutes: 30,
    riskUsageSecondsByGroup: {},
    sessionCountByGroup: {},
    cooldownCountByGroup: {},
    cooldownMinutesByGroup: {},
    accessLeaseCount: 0,
    longestRiskSessionSeconds: 0,
  });

  // Run compaction
  await repo.compactHistory(14, 90);

  // Verify raw events pruned
  const remainingEvents = await storage.getHistoryEvents(100);
  assert.equal(remainingEvents.length, 1, 'Only events <= 14 days retained');
  assert.equal(remainingEvents[0].timestamp, now - 3 * dayMs);

  // Verify daily summaries pruned
  const recentLoaded = await storage.loadDailySummary!(recentDKey);
  const oldLoaded = await storage.loadDailySummary!(oldDKey);
  assert.ok(recentLoaded, 'Summary within 90 days must be preserved');
  assert.equal(oldLoaded, null, 'Summary older than 90 days must be purged');
});
