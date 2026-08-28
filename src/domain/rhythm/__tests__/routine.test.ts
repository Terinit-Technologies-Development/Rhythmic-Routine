import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { RoutineWindow } from '../../../types/domain';
import {
  isInsideWindow,
  isInsideRoutineWindow,
  resolveRhythmState,
  parseTimeToMinutes,
  getIsoWeekday,
} from '../routine';
import { ActiveCooldown, ActiveRiskSession } from '../types';

describe('Rhythm Engine — Routine Resolution', () => {
  const windows: RoutineWindow[] = [
    {
      id: 'morning-buffer',
      name: 'Morning Buffer',
      type: 'morning-buffer',
      startTime: '06:30',
      endTime: '08:30',
      activeDays: [1, 2, 3, 4, 5], // Mon - Fri
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
      endTime: '06:30', // Cross-midnight window!
      activeDays: [1, 2, 3, 4, 5, 6, 7],
      protectedGroupIds: ['social', 'entertainment'],
      enabled: true,
      tagline: 'Wind down and protect rest',
      description: 'Evening wind-down protection',
    },
  ];

  test('parseTimeToMinutes parses standard and boundary times', () => {
    assert.equal(parseTimeToMinutes('00:00'), 0);
    assert.equal(parseTimeToMinutes('06:30'), 390);
    assert.equal(parseTimeToMinutes('22:00'), 1320);
    assert.equal(parseTimeToMinutes('23:59'), 1439);
  });

  test('getIsoWeekday correctly maps JS Sunday (0) to ISO 7', () => {
    const sunday = new Date('2026-08-30T10:00:00'); // Sunday
    assert.equal(getIsoWeekday(sunday), 7);

    const monday = new Date('2026-08-31T10:00:00'); // Monday
    assert.equal(getIsoWeekday(monday), 1);
  });

  test('Morning Buffer same-day window resolution and inactive weekend days', () => {
    const mondayMorning = new Date('2026-08-31T07:15:00'); // Mon 7:15 AM
    assert.equal(isInsideRoutineWindow(mondayMorning, windows, 'morning-buffer'), true);

    const mondayAfternoon = new Date('2026-08-31T09:00:00'); // Mon 9:00 AM
    assert.equal(isInsideRoutineWindow(mondayAfternoon, windows, 'morning-buffer'), false);

    const saturdayMorning = new Date('2026-08-29T07:15:00'); // Sat 7:15 AM (inactive day)
    assert.equal(isInsideRoutineWindow(saturdayMorning, windows, 'morning-buffer'), false);
  });

  test('Cross-midnight Evening Wind-Down window resolution', () => {
    // 11:30 PM same evening
    const lateEvening = new Date('2026-08-31T23:30:00');
    assert.equal(isInsideRoutineWindow(lateEvening, windows, 'evening-wind-down'), true);

    // 02:00 AM next morning (post-midnight)
    const earlyMorning = new Date('2026-09-01T02:00:00');
    assert.equal(isInsideRoutineWindow(earlyMorning, windows, 'evening-wind-down'), true);

    // 06:29 AM next morning (just before end)
    const justBeforeEnd = new Date('2026-09-01T06:29:00');
    assert.equal(isInsideRoutineWindow(justBeforeEnd, windows, 'evening-wind-down'), true);

    // 06:31 AM next morning (after end)
    const justAfterEnd = new Date('2026-09-01T06:31:00');
    assert.equal(isInsideRoutineWindow(justAfterEnd, windows, 'evening-wind-down'), false);
  });

  test('Disabled routine window is never active', () => {
    const disabledWindows: RoutineWindow[] = [
      {
        ...windows[0],
        enabled: false,
      },
    ];
    const mondayMorning = new Date('2026-08-31T07:15:00');
    assert.equal(isInsideWindow(mondayMorning, disabledWindows[0]), false);
  });

  test('State priority: Evening Wind-Down > Morning Buffer > Cooldown > Risk Session > Available', () => {
    const windDownTime = new Date('2026-08-31T23:00:00');
    const morningTime = new Date('2026-08-31T07:00:00');
    const openDayTime = new Date('2026-08-31T14:00:00');

    const mockCooldown: ActiveCooldown = {
      groupId: 'social',
      startedAt: openDayTime.getTime() - 60000,
      endsAt: openDayTime.getTime() + 60000,
    };

    const mockSession: ActiveRiskSession = {
      groupId: 'social',
      startedAt: openDayTime.getTime() - 30000,
      lastActivityAt: openDayTime.getTime(),
      accumulatedSeconds: 300,
    };

    // Evening Wind-Down overrides everything
    assert.equal(
      resolveRhythmState(windDownTime, windows, mockCooldown, mockSession),
      'evening-wind-down'
    );

    // Morning Buffer overrides cooldown/session
    assert.equal(
      resolveRhythmState(morningTime, windows, mockCooldown, mockSession),
      'morning-buffer'
    );

    // Outside routine windows, Cooldown overrides Risk Session
    assert.equal(
      resolveRhythmState(openDayTime, windows, mockCooldown, mockSession),
      'cooldown'
    );

    // Without Cooldown, active Risk Session gives 'risk-session'
    assert.equal(
      resolveRhythmState(openDayTime, windows, undefined, mockSession),
      'risk-session'
    );

    // Without anything active, gives 'available'
    assert.equal(
      resolveRhythmState(openDayTime, windows, undefined, undefined),
      'available'
    );
  });
});
