import { DeviceApp, RiskGroup, RoutineWindow } from '../../types/domain';
import { getRestrictableAppIds } from '../selectors';
import { ActiveCooldown, RestrictionReason } from './types';

/**
 * Computes all restriction reasons and active restricted app IDs from
 * active routine windows and active cooldowns.
 */
export function computeEffectiveRestrictions(
  activeRoutineWindows: RoutineWindow[],
  activeCooldown: ActiveCooldown | undefined,
  riskGroups: RiskGroup[],
  apps: DeviceApp[]
): {
  appRestrictions: { appId: string; reasons: RestrictionReason[] }[];
  effectiveAppIds: string[];
} {
  const reasonsByAppId = new Map<string, RestrictionReason[]>();

  // 1. Process active Routine Windows
  for (const window of activeRoutineWindows) {
    if (!window.enabled) continue;

    for (const groupId of window.protectedGroupIds) {
      const group = riskGroups.find((g) => g.id === groupId);
      if (!group) continue;

      const restrictableApps = getRestrictableAppIds(group.appIds, apps);
      for (const appId of restrictableApps) {
        const existing = reasonsByAppId.get(appId) || [];
        existing.push({
          type: 'routine',
          windowId: window.id,
          groupId: group.id,
        });
        reasonsByAppId.set(appId, existing);
      }
    }
  }

  // 2. Process active Cooldown
  if (activeCooldown) {
    const group = riskGroups.find((g) => g.id === activeCooldown.groupId);
    if (group) {
      const restrictableApps = getRestrictableAppIds(group.appIds, apps);
      for (const appId of restrictableApps) {
        const existing = reasonsByAppId.get(appId) || [];
        existing.push({
          type: 'cooldown',
          groupId: group.id,
        });
        reasonsByAppId.set(appId, existing);
      }
    }
  }

  const appRestrictions = Array.from(reasonsByAppId.entries()).map(
    ([appId, reasons]) => ({
      appId,
      reasons,
    })
  );

  const effectiveAppIds = appRestrictions.map((item) => item.appId);

  return {
    appRestrictions,
    effectiveAppIds,
  };
}

/**
 * Given the previous set of restricted app IDs and the newly computed set,
 * returns the delta: apps to newly restrict and apps to safely clear.
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
