import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createUniqueGroupId,
  formatSecondsToHHMMSS,
  getEditableTimeField,
  getOpenDayRange,
  getProtectedWindowIdsForGroup,
  getRestrictableAppIds,
  getRiskGroup,
  getRoutineTargetTime,
  getRoutineWindow,
} from '../selectors';
import { DeviceApp, RiskGroup, RoutineWindow } from '../../types/domain';

describe('Domain Selectors & Pure Helpers', () => {
  const mockWindows: RoutineWindow[] = [
    {
      id: 'morning-buffer',
      name: 'Morning Buffer',
      type: 'morning-buffer',
      startTime: '06:30',
      endTime: '08:30',
      activeDays: [1, 2, 3, 4, 5, 6, 7],
      protectedGroupIds: ['social'],
      enabled: true,
      tagline: 'Social apps unlock at',
      description: 'Morning buffer protection',
    },
    {
      id: 'evening-wind-down',
      name: 'Evening Wind-Down',
      type: 'evening-wind-down',
      startTime: '22:00',
      endTime: '23:30',
      activeDays: [1, 2, 3, 4, 5, 6, 7],
      protectedGroupIds: ['social', 'entertainment'],
      enabled: true,
      tagline: 'Wind down and protect your rest.',
      description: 'Evening wind down protection',
    },
  ];

  const mockGroups: RiskGroup[] = [
    {
      id: 'social',
      name: 'Social Feeds',
      description: 'Social scroll apps',
      iconName: 'message-square',
      iconColor: '#235D43',
      iconBg: '#E8EFE5',
      appIds: ['x', 'instagram', 'phone'],
      sessionThresholdMinutes: 45,
      cooldownMinutes: 90,
      currentSessionMinutes: 18,
    },
    {
      id: 'entertainment',
      name: 'Entertainment',
      description: 'Streaming apps',
      iconName: 'film',
      iconColor: '#B27D2B',
      iconBg: '#FBF3E2',
      appIds: ['youtube'],
      sessionThresholdMinutes: 60,
      cooldownMinutes: 60,
      currentSessionMinutes: 0,
    },
  ];

  const mockApps: DeviceApp[] = [
    {
      id: 'phone',
      name: 'Phone',
      classification: 'essential',
      iconName: 'phone',
      iconColor: '#2E7D32',
      iconBg: '#E8F5E9',
      defaultCategory: 'Communication',
      usageTodayMinutes: 10,
      sessionMinutes: 2,
    },
    {
      id: 'spotify',
      name: 'Spotify',
      classification: 'normal',
      iconName: 'music',
      iconColor: '#1DB954',
      iconBg: '#E8F8EE',
      defaultCategory: 'Music',
      usageTodayMinutes: 45,
      sessionMinutes: 15,
    },
    {
      id: 'instagram',
      name: 'Instagram',
      classification: 'risk',
      riskGroupId: 'social',
      iconName: 'camera',
      iconColor: '#E1306C',
      iconBg: '#FCE8EF',
      defaultCategory: 'Social',
      usageTodayMinutes: 30,
      sessionMinutes: 18,
    },
    {
      id: 'x',
      name: 'X',
      classification: 'risk',
      riskGroupId: 'social',
      iconName: 'x',
      iconColor: '#000000',
      iconBg: '#EEEEEE',
      defaultCategory: 'Social',
      usageTodayMinutes: 25,
      sessionMinutes: 12,
    },
  ];

  test('getRoutineWindow finds window by type', () => {
    const morning = getRoutineWindow(mockWindows, 'morning-buffer');
    assert.ok(morning);
    assert.equal(morning?.startTime, '06:30');
    assert.equal(morning?.endTime, '08:30');

    const missing = getRoutineWindow(mockWindows, 'open-day');
    assert.equal(missing, undefined);
  });

  test('getOpenDayRange derives start and end from adjacent boundaries', () => {
    const range = getOpenDayRange(mockWindows);
    assert.deepEqual(range, {
      start: '08:30',
      end: '22:00',
    });

    const fallbackRange = getOpenDayRange([]);
    assert.deepEqual(fallbackRange, {
      start: '08:00',
      end: '21:30',
    });
  });

  test('getRiskGroup finds group by id', () => {
    const social = getRiskGroup(mockGroups, 'social');
    assert.ok(social);
    assert.equal(social?.name, 'Social Feeds');
    assert.equal(social?.sessionThresholdMinutes, 45);
  });

  test('getEditableTimeField returns endTime for morning-buffer and startTime for wind-down', () => {
    const morning = mockWindows[0];
    const evening = mockWindows[1];

    assert.equal(getEditableTimeField(morning), 'endTime');
    assert.equal(getEditableTimeField(evening), 'startTime');
  });

  test('getRoutineTargetTime retrieves user-facing target time', () => {
    const morning = mockWindows[0];
    const evening = mockWindows[1];

    assert.equal(getRoutineTargetTime(morning), '08:30');
    assert.equal(getRoutineTargetTime(evening), '22:00');
  });

  test('getProtectedWindowIdsForGroup derives canonical window IDs protecting a group', () => {
    const socialWindows = getProtectedWindowIdsForGroup(mockWindows, 'social');
    assert.deepEqual(socialWindows, ['morning-buffer', 'evening-wind-down']);

    const entertainmentWindows = getProtectedWindowIdsForGroup(mockWindows, 'entertainment');
    assert.deepEqual(entertainmentWindows, ['evening-wind-down']);

    const gamingWindows = getProtectedWindowIdsForGroup(mockWindows, 'gaming');
    assert.deepEqual(gamingWindows, []);
  });

  test('getRestrictableAppIds enforces Essential-App safety invariant', () => {
    const candidateIds = ['phone', 'spotify', 'instagram', 'x'];
    const restrictable = getRestrictableAppIds(candidateIds, mockApps);

    assert.deepEqual(restrictable, ['instagram', 'x']);
    assert.equal(restrictable.includes('phone'), false);
    assert.equal(restrictable.includes('spotify'), false);
  });

  test('createUniqueGroupId generates clean and unique slugs', () => {
    const existing = ['social', 'entertainment', 'news-feeds'];

    assert.equal(createUniqueGroupId('Gaming', existing), 'gaming');
    assert.equal(createUniqueGroupId('News Feeds', existing), 'news-feeds-2');
    assert.equal(createUniqueGroupId('Social', existing), 'social-2');
    assert.equal(createUniqueGroupId('   ', existing), 'group');
  });

  test('formatSecondsToHHMMSS formats time accurately', () => {
    assert.equal(formatSecondsToHHMMSS(0), '00:00:00');
    assert.equal(formatSecondsToHHMMSS(59), '00:00:59');
    assert.equal(formatSecondsToHHMMSS(60), '00:01:00');
    assert.equal(formatSecondsToHHMMSS(3600), '01:00:00');
    assert.equal(formatSecondsToHHMMSS(4704), '01:18:24'); // 1h 18m 24s
  });
});
