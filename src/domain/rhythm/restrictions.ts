import { AccessLease, DeviceApp, RiskGroup, RoutineWindow } from '../../types/domain';
import { ActiveCooldown, AppRestriction, getActiveAccessLeases, getActiveCooldowns } from './types';

/**
 * Computes effective desired app restrictions across active routine windows, all active cooldowns,
 * minus active access lease suppressions.
 * Maintains the fundamental invariant: Essential apps are NEVER restricted.
 */
export function computeEffectiveRestrictions(
  activeWindows: RoutineWindow[],
  activeCooldowns: Record<string, ActiveCooldown> | ActiveCooldown[] | ActiveCooldown | undefined,
  riskGroups: RiskGroup[],
  apps: DeviceApp[],
  now: number = Date.now(),
  activeAccessLeases: Record<string, AccessLease> = {}
): {
  appRestrictions: AppRestriction[];
  effectiveAppIds: string[];
} {
  const restrictionMap = new Map<string, AppRestriction>();
  const activeLeaseGroupIds = new Set(
    getActiveAccessLeases(activeAccessLeases, now).map((l) => l.groupId)
  );

  // Helper to ensure an app is never restricted if essential
  const isRestrictable = (appId: string): boolean => {
    const app = apps.find((a) => a.id === appId);
    return app !== undefined && app.classification !== 'essential';
  };

  // 1. Process active Routine Windows
  for (const window of activeWindows) {
    if (!window.enabled) continue;

    for (const groupId of window.protectedGroupIds) {
      // If group has an active access lease, suppress restriction for this group
      if (activeLeaseGroupIds.has(groupId)) continue;

      const group = riskGroups.find((g) => g.id === groupId);
      if (!group) continue;

      for (const appId of group.appIds) {
        if (!isRestrictable(appId)) continue;

        const existing = restrictionMap.get(appId) || {
          appId,
          reasons: [],
        };
        existing.reasons.push({
          type: 'routine',
          sourceId: window.id,
        });
        restrictionMap.set(appId, existing);
      }
    }
  }

  // 2. Process all active Cooldowns (multi-group support)
  const cooldownList: ActiveCooldown[] = Array.isArray(activeCooldowns)
    ? activeCooldowns
    : activeCooldowns && 'groupId' in activeCooldowns
    ? [activeCooldowns as ActiveCooldown]
    : activeCooldowns
    ? getActiveCooldowns(activeCooldowns as Record<string, ActiveCooldown>, now)
    : [];

  for (const cooldown of cooldownList) {
    if (cooldown.endsAt <= now) continue;

    // If group has an active access lease, suppress cooldown restriction for this group
    if (activeLeaseGroupIds.has(cooldown.groupId)) continue;

    const group = riskGroups.find((g) => g.id === cooldown.groupId);
    if (!group) continue;

    for (const appId of group.appIds) {
      if (!isRestrictable(appId)) continue;

      const existing = restrictionMap.get(appId) || {
        appId,
        reasons: [],
      };
      existing.reasons.push({
        type: 'cooldown',
        sourceId: cooldown.groupId,
      });
      restrictionMap.set(appId, existing);
    }
  }

  const appRestrictions = Array.from(restrictionMap.values());
  const effectiveAppIds = appRestrictions.map((r) => r.appId);

  return {
    appRestrictions,
    effectiveAppIds,
  };
}

/**
 * Computes restriction delta to apply / clear.
 */
export function diffRestrictions(
  previousAppIds: string[],
  nextAppIds: string[]
): {
  toApply: string[];
  toClear: string[];
} {
  const prevSet = new Set(previousAppIds);
  const nextSet = new Set(nextAppIds);

  const toApply = nextAppIds.filter((id) => !prevSet.has(id));
  const toClear = previousAppIds.filter((id) => !nextSet.has(id));

  return {
    toApply,
    toClear,
  };
}
