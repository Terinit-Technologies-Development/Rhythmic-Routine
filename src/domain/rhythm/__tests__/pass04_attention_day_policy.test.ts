import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { RoutineWindow } from '../../../types/domain';
import {
  attentionDayIdForBoundary,
  isSameAttentionDay,
  resolveAttentionDay,
  resolveAttentionDayClock,
} from '../attentionDay';
import { isInsideWindow, isInsideOvernightProtection } from '../routine';

// Deterministic DST coverage: the Attention Day resolver is defined in local
// civil time, so pin this test file (Node runs test files in isolation) to a
// zone with 23h/25h civil days.
const originalTimeZone = process.env.TZ;
process.env.TZ = 'America/New_York';

/**
 * SW-2026-005 A1 — Attention Day policy regressions.
 *
 * Owner-approved boundary (29 Oct 2026): the configured Morning Buffer END
 * clock applies on every civil day, even when the restriction window is
 * inactive or disabled. Missing/malformed clocks fall back to local civil
 * midnight and are reported actionably. Calendar construction (not fixed 24h)
 * handles DST and offset changes.
 */

after(() => {
  if (originalTimeZone === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = originalTimeZone;
  }
});

const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];

function morningBuffer(overrides: Partial<RoutineWindow> = {}): RoutineWindow {
  return {
    id: 'morning-buffer',
    name: 'Morning Buffer',
    type: 'morning-buffer',
    startTime: '06:30',
    endTime: '07:30',
    activeDays: ALL_DAYS,
    protectedGroupIds: [],
    enabled: true,
    tagline: '',
    description: '',
    ...overrides,
  };
}

function localTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0
): number {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

describe('Attention Day — inactive days keep their own daily clock boundary', () => {
  const weekdaysOnly = [morningBuffer({ activeDays: [1, 2, 3, 4, 5] })];

  test('Friday, Saturday, Sunday and Monday each open at the configured clock', () => {
    const friday = resolveAttentionDay(localTime(2026, 9, 25, 12), weekdaysOnly);
    const saturday = resolveAttentionDay(localTime(2026, 9, 26, 12), weekdaysOnly);
    const sunday = resolveAttentionDay(localTime(2026, 9, 27, 12), weekdaysOnly);
    const monday = resolveAttentionDay(localTime(2026, 9, 28, 12), weekdaysOnly);

    assert.equal(friday.id, 'ad-20260925-0730');
    assert.equal(saturday.id, 'ad-20260926-0730');
    assert.equal(sunday.id, 'ad-20260927-0730');
    assert.equal(monday.id, 'ad-20260928-0730');

    // The old defect stretched Friday 07:30 through the inactive weekend to
    // Monday. Every day now has a distinct boundary.
    assert.equal(new Set([friday.id, saturday.id, sunday.id, monday.id]).size, 4);
    assert.equal(friday.nextBoundaryAt, localTime(2026, 9, 26, 7, 30));
    assert.notEqual(friday.nextBoundaryAt, localTime(2026, 9, 28, 7, 30));
  });

  test('midnight does not reset a 07:30 Attention Day, including over the weekend', () => {
    const fridayLate = resolveAttentionDay(localTime(2026, 9, 25, 23, 59), weekdaysOnly);
    const saturdayEarly = resolveAttentionDay(localTime(2026, 9, 26, 0, 1), weekdaysOnly);
    const saturdayBeforeClock = resolveAttentionDay(localTime(2026, 9, 26, 7, 29), weekdaysOnly);
    const saturdayAtClock = resolveAttentionDay(localTime(2026, 9, 26, 7, 30), weekdaysOnly);

    assert.equal(fridayLate.id, 'ad-20260925-0730');
    assert.equal(saturdayEarly.id, fridayLate.id);
    assert.equal(saturdayBeforeClock.id, fridayLate.id);
    assert.equal(saturdayAtClock.id, 'ad-20260926-0730');
    assert.equal(saturdayAtClock.startedAt, localTime(2026, 9, 26, 7, 30));
    assert.equal(saturdayAtClock.nextBoundaryAt, localTime(2026, 9, 27, 7, 30));
  });

  test('Sunday to Monday transition uses Monday civil date, not an elapsed 24h step', () => {
    const sundayLate = resolveAttentionDay(localTime(2026, 9, 27, 23, 59), weekdaysOnly);
    const mondayEarly = resolveAttentionDay(localTime(2026, 9, 28, 0, 1), weekdaysOnly);
    const mondayAtClock = resolveAttentionDay(localTime(2026, 9, 28, 7, 30), weekdaysOnly);

    assert.equal(sundayLate.id, 'ad-20260927-0730');
    assert.equal(mondayEarly.id, sundayLate.id);
    assert.equal(mondayAtClock.id, 'ad-20260928-0730');
    assert.equal(mondayAtClock.startedAt, localTime(2026, 9, 28, 7, 30));
  });

  test('empty activeDays still configures the accounting clock while the window is inactive', () => {
    const noActiveDays = [morningBuffer({ activeDays: [] })];
    const day = resolveAttentionDay(localTime(2026, 9, 28, 12), noActiveDays);
    assert.equal(day.id, 'ad-20260928-0730');

    // Empty activeDays means "no active routine days", not "all days".
    assert.equal(
      isInsideWindow(new Date(localTime(2026, 9, 28, 7, 0)), noActiveDays[0]),
      false
    );
  });

  test('a disabled Morning Buffer no longer disables the accounting boundary', () => {
    const disabled = [morningBuffer({ enabled: false })];
    const day = resolveAttentionDay(localTime(2026, 9, 26, 12), disabled);
    assert.equal(day.id, 'ad-20260926-0730');
    assert.equal(
      isInsideWindow(new Date(localTime(2026, 9, 26, 7, 0)), disabled[0]),
      false
    );
  });

  test('startedAt <= now < nextBoundaryAt across ordinary days', () => {
    const schedule = [morningBuffer({ activeDays: [1, 2, 3, 4, 5] })];
    const samples = [
      localTime(2026, 9, 25, 7, 29),
      localTime(2026, 9, 25, 7, 30),
      localTime(2026, 9, 26, 0, 0),
      localTime(2026, 9, 26, 7, 30),
      localTime(2026, 9, 27, 23, 59),
      localTime(2026, 9, 28, 0, 0),
      localTime(2026, 9, 28, 7, 30),
    ];

    for (const now of samples) {
      const day = resolveAttentionDay(now, schedule);
      assert.ok(day.startedAt <= now, `startedAt must be <= now for ${new Date(now)}`);
      assert.ok(day.nextBoundaryAt > now, `nextBoundaryAt must be > now for ${new Date(now)}`);
      assert.equal(day.id, attentionDayIdForBoundary(day.startedAt));
    }
  });
});

describe('Attention Day — DST civil-calendar construction', () => {
  test('spring-forward Attention Day spans 23 real hours', () => {
    // America/New_York: 2026-03-08 02:00 -> 03:00.
    const day = resolveAttentionDay(
      localTime(2026, 3, 7, 12),
      [morningBuffer()]
    );
    assert.equal(day.id, 'ad-20260307-0730');
    assert.equal(day.startedAt, localTime(2026, 3, 7, 7, 30));
    assert.equal(day.nextBoundaryAt, localTime(2026, 3, 8, 7, 30));
    assert.equal(day.nextBoundaryAt - day.startedAt, 23 * 60 * 60 * 1000);
  });

  test('fall-back Attention Day spans 25 real hours', () => {
    // America/New_York: 2026-11-01 02:00 -> 01:00.
    const day = resolveAttentionDay(
      localTime(2026, 10, 31, 12),
      [morningBuffer()]
    );
    assert.equal(day.id, 'ad-20261031-0730');
    assert.equal(day.startedAt, localTime(2026, 10, 31, 7, 30));
    assert.equal(day.nextBoundaryAt, localTime(2026, 11, 1, 7, 30));
    assert.equal(day.nextBoundaryAt - day.startedAt, 25 * 60 * 60 * 1000);
  });

  test('a spring-gap boundary clock normalizes forward exactly like Date', () => {
    // 02:30 does not exist on 2026-03-08 in New York: ECMAScript Date (and the
    // Kotlin mirror) resolve it to 03:30 EDT.
    const schedule = [morningBuffer({ endTime: '02:30' })];
    const day = resolveAttentionDay(localTime(2026, 3, 8, 12), schedule);
    const start = new Date(day.startedAt);

    assert.equal(start.getHours(), 3);
    assert.equal(start.getMinutes(), 30);
    assert.equal(start.getTimezoneOffset(), 240); // EDT

    const expected = new Date(2026, 2, 8, 2, 30, 0, 0).getTime();
    assert.equal(day.startedAt, expected);
    assert.equal(day.nextBoundaryAt - day.startedAt, 23 * 60 * 60 * 1000);
  });

  test('a fall-overlap boundary clock chooses the earlier instant exactly like Date', () => {
    // 01:30 occurs twice on 2026-11-01 in New York. ECMAScript Date chooses
    // the earlier (EDT) occurrence; the Kotlin mirror does the same.
    const schedule = [morningBuffer({ endTime: '01:30' })];
    const day = resolveAttentionDay(localTime(2026, 11, 1, 12), schedule);
    const start = new Date(day.startedAt);

    assert.equal(start.getHours(), 1);
    assert.equal(start.getMinutes(), 30);
    assert.equal(start.getTimezoneOffset(), 240); // earlier / EDT occurrence

    const expected = new Date(2026, 10, 1, 1, 30, 0, 0).getTime();
    assert.equal(day.startedAt, expected);

    // The following civil day's 01:30 is unambiguous standard time.
    assert.equal(new Date(day.nextBoundaryAt).getTimezoneOffset(), 300);
  });

  test('manual clock movement never invents a completion or skips a civil boundary', () => {
    const schedule = [morningBuffer()];
    const saturdayMorning = localTime(2026, 9, 26, 6, 0);
    const saturdayAfterClock = localTime(2026, 9, 26, 9, 0);

    const before = resolveAttentionDay(saturdayMorning, schedule);
    const after = resolveAttentionDay(saturdayAfterClock, schedule);

    assert.equal(before.id, 'ad-20260925-0730');
    assert.equal(after.id, 'ad-20260926-0730');
    assert.equal(after.startedAt, localTime(2026, 9, 26, 7, 30));

    // Resolving an older instant after a clock roll-back is deterministic and
    // does not mutate or advance the policy day.
    assert.deepEqual(resolveAttentionDay(saturdayMorning, schedule), before);
    assert.equal(
      isSameAttentionDay(before.id, saturdayMorning, schedule),
      true
    );
    assert.equal(
      isSameAttentionDay(before.id, saturdayAfterClock, schedule),
      false
    );
  });
});

describe('Attention Day — malformed configuration is actionable and recovered', () => {
  test('malformed morning endTime falls back to midnight and reports the window', () => {
    const malformed = [morningBuffer({ id: 'morning-primary', endTime: 'not-a-time' })];
    const day = resolveAttentionDay(localTime(2026, 9, 26, 23, 59), malformed);
    const clock = resolveAttentionDayClock(malformed);

    assert.equal(day.id, 'ad-2026-09-26');
    assert.equal(day.startedAt, localTime(2026, 9, 26, 0));
    assert.equal(day.nextBoundaryAt, localTime(2026, 9, 27, 0));
    assert.equal(clock.source, 'local-midnight');
    assert.equal(clock.minutesIntoDay, null);
    assert.ok(clock.issue);
    assert.match(clock.issue as string, /morning-primary/);
    assert.match(clock.issue as string, /malformed endTime "not-a-time"/);
    assert.match(clock.issue as string, /HH:MM/);
  });

  test('missing morning endTime falls back to midnight with an actionable issue', () => {
    const missingWindow = morningBuffer({ id: 'morning-no-end' });
    delete missingWindow.endTime;
    const missing = [missingWindow];
    const clock = resolveAttentionDayClock(missing);

    assert.equal(clock.source, 'local-midnight');
    assert.equal(clock.minutesIntoDay, null);
    assert.ok(clock.issue);
    assert.match(clock.issue as string, /no endTime/);
    assert.match(clock.issue as string, /HH:MM/);
  });

  test('the first usable configured clock wins and earlier malformed entries stay reported', () => {
    const schedule = [
      morningBuffer({ id: 'morning-broken', endTime: '25:99' }),
      morningBuffer({ id: 'morning-valid', endTime: '08:15' }),
    ];
    const clock = resolveAttentionDayClock(schedule);
    const day = resolveAttentionDay(localTime(2026, 9, 26, 9, 0), schedule);

    assert.equal(clock.source, 'morning-clock');
    assert.equal(clock.minutesIntoDay, 8 * 60 + 15);
    assert.ok(clock.issue);
    assert.match(clock.issue as string, /morning-broken/);
    assert.equal(day.id, 'ad-20260926-0815');
    assert.equal(day.startedAt, localTime(2026, 9, 26, 8, 15));
  });

  test('no Morning Buffer at all is a normal midnight fallback without an issue', () => {
    const clock = resolveAttentionDayClock([]);
    assert.equal(clock.source, 'local-midnight');
    assert.equal(clock.minutesIntoDay, null);
    assert.equal(clock.issue, null);
  });
});

describe('Restriction windows remain independent of the accounting clock', () => {
  test('inactive weekend Morning Buffer does not restrict and does not stretch the day', () => {
    const weekendInactive = morningBuffer({ activeDays: [1, 2, 3, 4, 5] });
    const saturdayBeforeClock = new Date(localTime(2026, 9, 26, 7, 0));
    const saturdayAtClock = new Date(localTime(2026, 9, 26, 7, 30));

    // Saturday 07:00 is still inside Friday's accounting day: the approved
    // 07:30 clock boundary has not arrived, and the inactive Saturday window
    // must not be interpreted as an early reset.
    assert.equal(isInsideWindow(saturdayBeforeClock, weekendInactive), false);
    const preBoundaryDay = resolveAttentionDay(saturdayBeforeClock.getTime(), [
      weekendInactive,
    ]);
    assert.equal(preBoundaryDay.id, 'ad-20260925-0730');
    assert.equal(preBoundaryDay.startedAt, localTime(2026, 9, 25, 7, 30));
    assert.equal(preBoundaryDay.nextBoundaryAt, localTime(2026, 9, 26, 7, 30));

    // The inactive window still restricts nothing after the accounting clock,
    // but ownership moves to Saturday's distinct Attention Day at 07:30.
    assert.equal(isInsideWindow(saturdayAtClock, weekendInactive), false);
    const postBoundaryDay = resolveAttentionDay(saturdayAtClock.getTime(), [
      weekendInactive,
    ]);
    assert.equal(postBoundaryDay.id, 'ad-20260926-0730');
    assert.notEqual(postBoundaryDay.id, preBoundaryDay.id);
    assert.equal(postBoundaryDay.startedAt, localTime(2026, 9, 26, 7, 30));
  });

  test('overnight protection is not invented when activeDays is empty', () => {
    const evening = morningBuffer({
      id: 'evening-wind-down',
      name: 'Evening Wind-Down',
      type: 'evening-wind-down',
      startTime: '22:00',
      endTime: '06:30',
      activeDays: [],
    });
    const morning = morningBuffer({ startTime: '06:30', activeDays: [] });

    assert.equal(
      isInsideOvernightProtection(new Date(localTime(2026, 9, 26, 2, 0)), [
        evening,
        morning,
      ]),
      false
    );
  });
});
