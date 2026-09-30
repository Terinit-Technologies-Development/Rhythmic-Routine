import type { RoutineWindow } from '../../types/domain';
import { getLocalDateKey } from './allowance';
import { getIsoWeekday } from './routine';

/**
 * Attention Day — the behavioral-day boundary for the Restorative policy.
 *
 * The reset boundary is NOT midnight. An Attention Day opens when the Morning
 * Buffer ENDS and closes at the next Morning Buffer end:
 *
 *   Morning Buffer ends 07:30
 *   27 Sep 07:30 .. 28 Sep 07:29:59  = one Attention Day
 *   28 Sep 07:30                     = the next Attention Day begins
 *
 * This prevents "23:50 meditation substitution #2 / 00:01 counter resets"
 * while the person is still inside the same behavioral day.
 *
 * Fallback: when no usable Morning Buffer exists (disabled window, missing or
 * unparseable end time, or no active day in the lookback window) the Attention
 * Day falls back to the LOCAL CALENDAR DAY (midnight boundary). The fallback is
 * deterministic and documented in README/docs — day resolution is never
 * ambiguous.
 */
export interface AttentionDay {
  /** Opaque, stable, deterministic (e.g. "ad-20260927-0730"). */
  id: string;
  /** Epoch ms of the boundary that opened this Attention Day. */
  startedAt: number;
  /** Epoch ms of the boundary that will close it. */
  nextBoundaryAt: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const BOUNDARY_LOOKBACK_DAYS = 7;
const BOUNDARY_LOOKAHEAD_DAYS = 7;

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

function findMorningBuffer(schedule: RoutineWindow[]): RoutineWindow | undefined {
  return schedule.find(
    (window) =>
      window.type === 'morning-buffer' &&
      window.enabled !== false &&
      typeof window.endTime === 'string' &&
      window.endTime.length > 0
  );
}

function isBufferActiveOnDay(window: RoutineWindow, epochMs: number): boolean {
  if (!Array.isArray(window.activeDays) || window.activeDays.length === 0) return true;
  return window.activeDays.includes(getIsoWeekday(new Date(epochMs)));
}

function boundaryAt(base: number, minutesIntoDay: number): number {
  const date = new Date(base);
  date.setHours(0, 0, 0, 0);
  return date.getTime() + minutesIntoDay * 60 * 1000;
}

function parseBoundaryMinutes(value: string): number | null {
  const match = /^(?:[01]\d|2[0-3]):[0-5]\d$/.exec(value);
  return match ? Number(match[0].slice(0, 2)) * 60 + Number(match[0].slice(3, 5)) : null;
}

/**
 * Resolves the Attention Day containing `now`.
 *
 * Boundary algorithm:
 * 1. Use the Morning Buffer's END time (minutes past local midnight).
 * 2. Walk back up to 7 days for the most recent boundary whose day is active
 *    for the window; that boundary opens the Attention Day.
 * 3. The next boundary (walk forward up to 7 days) closes it.
 * 4. No usable window -> local calendar day fallback (midnight..midnight).
 */
export function resolveAttentionDay(now: number, schedule: RoutineWindow[]): AttentionDay {
  const buffer = findMorningBuffer(schedule);
  const minutes = buffer ? parseBoundaryMinutes(buffer.endTime as string) : null;

  if (buffer && minutes !== null && Number.isFinite(minutes)) {
    let startedAt: number | undefined;
    for (let back = 0; back <= BOUNDARY_LOOKBACK_DAYS; back += 1) {
      const candidate = boundaryAt(now - back * DAY_MS, minutes);
      if (candidate <= now && isBufferActiveOnDay(buffer, candidate)) {
        startedAt = candidate;
        break;
      }
    }

    if (startedAt !== undefined) {
      let nextBoundaryAt: number | undefined;
      for (let forward = 1; forward <= BOUNDARY_LOOKAHEAD_DAYS; forward += 1) {
        const candidate = boundaryAt(startedAt + forward * DAY_MS, minutes);
        if (isBufferActiveOnDay(buffer, candidate)) {
          nextBoundaryAt = candidate;
          break;
        }
      }
      return {
        id: attentionDayIdForBoundary(startedAt),
        startedAt,
        nextBoundaryAt: nextBoundaryAt ?? startedAt + DAY_MS,
      };
    }
  }

  // Fallback: local calendar day (documented, deterministic).
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  const startedAt = date.getTime();
  return {
    id: `ad-${getLocalDateKey(now)}`,
    startedAt,
    nextBoundaryAt: startedAt + DAY_MS,
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
