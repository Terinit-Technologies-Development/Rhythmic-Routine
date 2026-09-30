import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { RoutineWindow } from '../../../types/domain';
import { resolveAttentionDay, attentionDayIdForBoundary, isSameAttentionDay } from '../attentionDay';
import {
  createDailyAttentionExchangeState,
  consumeMeditationSubstitution,
  reconcileAttentionExchangeForAttentionDay,
} from '../attentionExchange';

/**
 * Pass 3 — Attention Day boundary tests (spec 7-9, 51).
 *
 * Morning Buffer ends 07:30:
 *   23:59 -> old Attention Day
 *   00:01 -> old Attention Day  (no midnight loophole)
 *   07:29 -> old Attention Day
 *   07:30 -> NEW Attention Day
 * and the meditation substitution count resets ONLY at the 07:30 transition.
 */

const morningBuffer: RoutineWindow = {
  id: 'morning-buffer',
  name: 'Morning Buffer',
  type: 'morning-buffer',
  startTime: '06:30',
  endTime: '07:30',
  activeDays: [1, 2, 3, 4, 5, 6, 7],
  protectedGroupIds: [],
  enabled: true,
  tagline: '',
  description: '',
};

const schedule: RoutineWindow[] = [morningBuffer];

function localTime(year: number, month: number, day: number, hour: number, minute = 0): number {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

describe('Pass 3 — Attention Day boundary algorithm (spec 51)', () => {
  test('23:59 and 00:01 stay in the old Attention Day', () => {
    const evening = resolveAttentionDay(localTime(2026, 9, 27, 23, 59), schedule);
    const afterMidnight = resolveAttentionDay(localTime(2026, 9, 28, 0, 1), schedule);
    assert.equal(evening.id, afterMidnight.id);
    assert.equal(evening.id, 'ad-20260927-0730');
  });

  test('07:29 is the old day and 07:30 opens the new day', () => {
    const beforeBoundary = resolveAttentionDay(localTime(2026, 9, 28, 7, 29), schedule);
    const atBoundary = resolveAttentionDay(localTime(2026, 9, 28, 7, 30), schedule);
    assert.equal(beforeBoundary.id, 'ad-20260927-0730');
    assert.equal(atBoundary.id, 'ad-20260928-0730');
    assert.notEqual(beforeBoundary.id, atBoundary.id);
  });

  test('an Attention Day spans 07:30 to the next 07:30', () => {
    const day = resolveAttentionDay(localTime(2026, 9, 27, 12), schedule);
    assert.equal(day.startedAt, localTime(2026, 9, 27, 7, 30));
    assert.equal(day.nextBoundaryAt, localTime(2026, 9, 28, 7, 30));
  });

  test('substitution count resets only at the 07:30 transition, never at midnight', () => {
    const evening = resolveAttentionDay(localTime(2026, 9, 27, 23, 50), schedule);
    let state = createDailyAttentionExchangeState('2026-09-27', localTime(2026, 9, 27, 23, 50), evening.id);
    state = consumeMeditationSubstitution(state, localTime(2026, 9, 27, 23, 50));
    state = consumeMeditationSubstitution(state, localTime(2026, 9, 27, 23, 55));
    assert.equal(state.meditationSubstitutionsUsed, 2);

    // 00:01 — same Attention Day: the counter must NOT reset (no midnight loophole).
    const afterMidnight = resolveAttentionDay(localTime(2026, 9, 28, 0, 1), schedule);
    const carried = reconcileAttentionExchangeForAttentionDay(
      state,
      afterMidnight.id,
      localTime(2026, 9, 28, 0, 1)
    );
    assert.equal(carried.meditationSubstitutionsUsed, 2);
    assert.equal(carried.cooldownsTriggered, state.cooldownsTriggered);

    // 07:30 — the new Attention Day resets the substitution counter.
    const nextMorning = resolveAttentionDay(localTime(2026, 9, 28, 7, 30), schedule);
    const reset = reconcileAttentionExchangeForAttentionDay(
      carried,
      nextMorning.id,
      localTime(2026, 9, 28, 7, 30)
    );
    assert.equal(reset.meditationSubstitutionsUsed, 0);
    assert.equal(reset.cooldownsTriggered, 0);
    assert.equal(reset.attentionDayId, nextMorning.id);
  });

  test('state without an Attention Day id adopts it without losing counters', () => {
    const legacy = {
      ...createDailyAttentionExchangeState('2026-09-27', localTime(2026, 9, 27, 12)),
      cooldownsTriggered: 3,
    };
    delete (legacy as Record<string, unknown>).attentionDayId;
    const adopted = reconcileAttentionExchangeForAttentionDay(
      legacy,
      'ad-20260927-0730',
      localTime(2026, 9, 27, 12)
    );
    assert.equal(adopted.cooldownsTriggered, 3);
    assert.equal(adopted.attentionDayId, 'ad-20260927-0730');
  });

  test('without a usable Morning Buffer the fallback is the local calendar day', () => {
    const noBuffer = resolveAttentionDay(localTime(2026, 9, 27, 23, 59), []);
    const nextDay = resolveAttentionDay(localTime(2026, 9, 28, 0, 1), []);
    assert.equal(noBuffer.id, 'ad-2026-09-27');
    assert.equal(nextDay.id, 'ad-2026-09-28');
    assert.notEqual(noBuffer.id, nextDay.id);

    const disabled: RoutineWindow[] = [{ ...morningBuffer, enabled: false }];
    const fallback = resolveAttentionDay(localTime(2026, 9, 27, 23, 59), disabled);
    assert.equal(fallback.id, 'ad-2026-09-27');

    const malformed: RoutineWindow[] = [{ ...morningBuffer, endTime: 'not-a-time' }];
    const malformedFallback = resolveAttentionDay(localTime(2026, 9, 27, 23, 59), malformed);
    assert.equal(malformedFallback.id, 'ad-2026-09-27');
  });

  test('ids are opaque, stable, and chronological', () => {
    assert.equal(attentionDayIdForBoundary(localTime(2026, 9, 27, 7, 30)), 'ad-20260927-0730');
    assert.ok('ad-20260927-0730' < 'ad-20260928-0730');
    assert.equal(
      isSameAttentionDay('ad-20260927-0730', localTime(2026, 9, 28, 7, 29), schedule),
      true
    );
    assert.equal(
      isSameAttentionDay('ad-20260927-0730', localTime(2026, 9, 28, 7, 30), schedule),
      false
    );
  });

  test('incomplete active days fall back deterministically', () => {
    const weekdaysOnly: RoutineWindow[] = [
      { ...morningBuffer, activeDays: [1, 2, 3, 4, 5] }, // Mon-Fri
    ];
    // Sunday 27 Sep 2026 -> most recent active boundary is Friday 25th 07:30.
    const sunday = resolveAttentionDay(localTime(2026, 9, 27, 12), weekdaysOnly);
    assert.equal(sunday.id, 'ad-20260925-0730');
    assert.equal(sunday.nextBoundaryAt, localTime(2026, 9, 28, 7, 30));
  });
});
