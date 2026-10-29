import type { RoutineWindow } from '../../types/domain';
import { getLocalDateKey } from './allowance';

/**
 * Attention Day — the behavioral-day boundary for the Restorative policy.
 *
 * SW-2026-005 A1 / FR-01, FR-02 (owner-approved 29 Oct 2026):
 *
 * - The configured Morning Buffer END clock is the accounting boundary on
 *   EVERY civil day, including days where the Morning Buffer window itself is
 *   inactive (`activeDays` does not contain the weekday) or the window is
 *   disabled. An inactive/disabled window suppresses the restriction window,
 *   not the accounting boundary.
 * - The first Morning Buffer entry with a usable `HH:MM` end clock wins.
 *   Missing or malformed clocks fall back to LOCAL MIDNIGHT and are reported
 *   through `resolveAttentionDayClock()` so the caller can surface an
 *   actionable configuration warning.
 * - Boundaries are built from civil calendar dates (not fixed 24h elapsed
 *   time), so 23h/25h DST days and local offset changes resolve correctly.
 * - A usable boundary always satisfies `startedAt <= now < nextBoundaryAt`
 *   for normal finite epochs.
 *
 *   Morning clock 07:30:
 *   27 Sep 07:30 .. 28 Sep 07:29:59  = one Attention Day
 *   28 Sep 07:30                     = the next Attention Day begins
 *
 * This prevents "23:50 meditation substitution #2 / 00:01 counter resets"
 * while the person is still inside the same behavioral day, and prevents a
 * Friday boundary from stretching to Monday merely because weekend schedule
 * windows are inactive.
 */
export interface AttentionDay {
  /** Opaque, stable, deterministic (e.g. "ad-20260927-0730"). */
  id: string;
  /** Epoch ms of the boundary that opened this Attention Day. */
  startedAt: number;
  /** Epoch ms of the boundary that will close it. */
  nextBoundaryAt: number;
}

/**
 * Deterministic, side-effect-free description of how the accounting clock was
 * resolved. `issue` is user-actionable and never contains private data.
 */
export interface AttentionDayClockResolution {
  /** Minutes past local midnight, or null when the local-midnight fallback applies. */
  minutesIntoDay: number | null;
  source: 'morning-clock' | 'local-midnight';
  /** Actionable configuration warning, or null when the config is usable. */
  issue: string | null;
}

const CLOCK_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

/** The Attention Day id format: `ad-<yyyyMMdd>-<HHmm>` of the opening boundary. */
export function attentionDayIdForBoundary(boundaryAt: number): string {
  const date = new Date(boundaryAt);
  const yyyy = date.getFullYear().toString().padStart(4, '0');
  const mm = (date.getMonth() + 1).toString().padStart(2, '0');
  const dd = date.getDate().toString().padStart(2, '0');
  const hh = date.getHours().toString().padStart(2, '0');
  const min = date.getMinutes().toString().padStart(2, '0');
  return `ad-${yyyy}${mm}${dd}-${hh}${min}`;
}

function parseClockMinutes(value: string): number | null {
  if (!CLOCK_TIME_PATTERN.test(value.trim())) return null;
  const [hours, minutes] = value.trim().split(':');
  return Number(hours) * 60 + Number(minutes);
}

/**
 * Resolves the accounting clock independently of whether the Morning Buffer
 * restriction window is active today. The first usable configured clock wins;
 * malformed earlier entries are still reported.
 */
export function resolveAttentionDayClock(schedule: RoutineWindow[]): AttentionDayClockResolution {
  let issue: string | null = null;
  let sawMorningBuffer = false;

  for (const window of schedule) {
    if (window.type !== 'morning-buffer') continue;
    sawMorningBuffer = true;

    const raw = typeof window.endTime === 'string' ? window.endTime : '';
    if (raw.trim().length === 0) {
      issue ??= `Morning Buffer "${window.id}" has no endTime; expected HH:MM in 24-hour local time.`;
      continue;
    }

    const minutes = parseClockMinutes(raw);
    if (minutes === null) {
      issue ??= `Morning Buffer "${window.id}" has malformed endTime "${raw}"; expected HH:MM in 24-hour local time.`;
      continue;
    }

    return { minutesIntoDay: minutes, source: 'morning-clock', issue };
  }

  if (sawMorningBuffer && issue === null) {
    issue = 'No Morning Buffer endTime is configured; expected HH:MM in 24-hour local time.';
  }

  return { minutesIntoDay: null, source: 'local-midnight', issue };
}

interface CivilDate {
  year: number;
  month: number;
  day: number;
}

/**
 * Local civil date `dayOffset` calendar days from `epochMs`. Using Date's
 * civil constructor (not +24h) keeps the target date stable across DST and
 * offset changes. Noon avoids constructing an ambiguous/skipped midnight.
 */
function civilDateAfter(epochMs: number, dayOffset: number): CivilDate {
  const base = new Date(epochMs);
  const target = new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate() + dayOffset,
    12,
    0,
    0,
    0
  );
  return {
    year: target.getFullYear(),
    month: target.getMonth(),
    day: target.getDate(),
  };
}

/**
 * Local civil timestamp at `minutesIntoDay` on the date `dayOffset` days from
 * `epochMs`. The Date constructor is the ECMAScript civil-time authority:
 * spring-forward gaps normalize forward and fall-back overlaps choose the
 * earlier instant. Kotlin mirrors both behaviours explicitly.
 */
function boundaryAt(epochMs: number, dayOffset: number, minutesIntoDay: number): number {
  const date = civilDateAfter(epochMs, dayOffset);
  return new Date(
    date.year,
    date.month,
    date.day,
    Math.floor(minutesIntoDay / 60),
    minutesIntoDay % 60,
    0,
    0
  ).getTime();
}

/**
 * Resolves the Attention Day containing `now`.
 *
 * With a usable clock, the current day opens at today's clock if it has
 * already passed, otherwise at yesterday's clock; the next boundary is the
 * following civil day at the same clock. Without a usable clock, the local
 * calendar day (civil midnight to civil midnight) is the deterministic
 * fallback.
 */
export function resolveAttentionDay(now: number, schedule: RoutineWindow[]): AttentionDay {
  const clock = resolveAttentionDayClock(schedule);

  if (clock.minutesIntoDay !== null) {
    const minutes = clock.minutesIntoDay;
    const todayBoundary = boundaryAt(now, 0, minutes);
    const startedAt = todayBoundary <= now ? todayBoundary : boundaryAt(now, -1, minutes);
    return {
      id: attentionDayIdForBoundary(startedAt),
      startedAt,
      nextBoundaryAt: boundaryAt(startedAt, 1, minutes),
    };
  }

  // Fallback: local civil calendar day (documented, deterministic). In the
  // rare zone where civil midnight is skipped, the day starts at the first
  // representable instant after it; if that is still in the future the
  // previous civil day is the containing day.
  let startedAt = boundaryAt(now, 0, 0);
  if (startedAt > now) {
    startedAt = boundaryAt(now, -1, 0);
  }
  return {
    id: `ad-${getLocalDateKey(startedAt)}`,
    startedAt,
    nextBoundaryAt: boundaryAt(startedAt, 1, 0),
  };
}

/** True when `attentionDayId` is the day that contains `now` under `schedule`. */
export function isSameAttentionDay(
  attentionDayId: string,
  now: number,
  schedule: RoutineWindow[]
): boolean {
  return resolveAttentionDay(now, schedule).id === attentionDayId;
}
