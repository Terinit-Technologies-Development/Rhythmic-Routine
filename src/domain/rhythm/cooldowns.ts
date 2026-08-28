import { ActiveCooldown } from './types';

/**
 * Creates an active cooldown with absolute start and end timestamps.
 */
export function startCooldown(
  groupId: string,
  now: number,
  cooldownMinutes: number
): ActiveCooldown {
  const durationMs = Math.max(1, cooldownMinutes) * 60 * 1000;
  return {
    groupId,
    startedAt: now,
    endsAt: now + durationMs,
  };
}

/**
 * Checks if a cooldown is currently active.
 */
export function isCooldownActive(
  cooldown: ActiveCooldown | undefined,
  now: number
): boolean {
  if (!cooldown) return false;
  return cooldown.endsAt > now;
}

/**
 * Checks if a cooldown has expired.
 */
export function isCooldownExpired(
  cooldown: ActiveCooldown | undefined,
  now: number
): boolean {
  if (!cooldown) return true;
  return cooldown.endsAt <= now;
}

/**
 * Restores a persisted cooldown, returning undefined if it already expired.
 */
export function restoreCooldown(
  persisted: ActiveCooldown | undefined,
  now: number
): ActiveCooldown | undefined {
  if (!persisted) return undefined;
  if (persisted.endsAt <= now) return undefined;
  return persisted;
}
