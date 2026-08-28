import { ActiveCooldown, getActiveCooldowns } from './types';

/**
 * Creates an active cooldown with absolute timestamp boundaries.
 */
export function startCooldown(
  groupId: string,
  startedAt: number,
  durationMinutes: number
): ActiveCooldown {
  const durationMs = Math.max(1, durationMinutes) * 60 * 1000;
  return {
    groupId,
    startedAt,
    endsAt: startedAt + durationMs,
  };
}

/**
 * Checks if a specific cooldown is currently active.
 */
export function isCooldownActive(
  cooldown: ActiveCooldown | undefined,
  now: number = Date.now()
): boolean {
  if (!cooldown) return false;
  return now < cooldown.endsAt;
}

/**
 * Checks if a specific cooldown has expired.
 */
export function isCooldownExpired(
  cooldown: ActiveCooldown | undefined,
  now: number = Date.now()
): boolean {
  if (!cooldown) return true;
  return now >= cooldown.endsAt;
}

/**
 * Restores and purges expired cooldowns from a persisted cooldowns map upon app startup.
 */
export function restoreCooldowns(
  cooldowns: Record<string, ActiveCooldown> = {},
  now: number = Date.now()
): Record<string, ActiveCooldown> {
  const activeList = getActiveCooldowns(cooldowns, now);
  const result: Record<string, ActiveCooldown> = {};
  for (const c of activeList) {
    result[c.groupId] = c;
  }
  return result;
}
