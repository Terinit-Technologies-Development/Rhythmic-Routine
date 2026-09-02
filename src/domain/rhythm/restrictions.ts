import { AccessLease, DailyAppUsage, DeviceApp, RiskGroup, RoutineWindow } from '../../types/domain';
import { ActiveCooldown, AppRestriction, getActiveAccessLeases, getActiveCooldowns, RestrictionReason } from './types';
import { isDailyAllowanceExhausted } from './allowance';

export interface RestrictionOptions {
  isOvernight?: boolean;
  dailyAppUsage?: Record<string, DailyAppUsage>;
}

/**
 * Computes effective desired app restrictions across active routine windows, overnight protection,
 * all active cooldowns, and exhausted daily allowances, minus active access lease suppressions.
 * Maintains the fundamental invariant: Essential apps are NEVER restricted.
 */
export function computeEffectiveRestrictions(
  activeWindows: RoutineWindow[],
  activeCooldowns: Record<string, ActiveCooldown> | ActiveCooldown[] | ActiveCooldown | undefined,
  riskGroups: RiskGroup[],
  apps: DeviceApp[],
  now: number = Date.now(),
  activeAccessLeases: Record<string, AccessLease> = {},
  options?: RestrictionOptions
): {
  appRestrictions: AppRestriction[];
  effectiveAppIds: string[];
} {
  const restrictionMap = new Map<string, AppRestriction>();
  const activeLeaseGroupIds = new Set(
    getActiveAccessLeases(activeAccessLeases, now).map((l) => l.groupId)
  );

  // Helper to ensure an app is never restricted if essential or unrestrictable
  const isRestrictable = (appId: string): boolean => {
    const app = apps.find((a) => a.id === appId);
    return app !== undefined && app.classification !== 'essential';
  };

  const addReason = (appId: string, reason: RestrictionReason) => {
    if (!isRestrictable(appId)) return;
    const existing = restrictionMap.get(appId) || {
      appId,
      reasons: [],
    };
    existing.reasons.push(reason);
    restrictionMap.set(appId, existing);
  };

  // 1. Process active Routine Windows
  for (const window of activeWindows) {
    if (!window.enabled) continue;

    for (const groupId of window.protectedGroupIds) {
      const group = riskGroups.find((g) => g.id === groupId);
      if (!group) continue;

      for (const appId of group.appIds) {
        addReason(appId, {
          type: 'routine',
          sourceId: window.id,
        });
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

    const group = riskGroups.find((g) => g.id === cooldown.groupId);
    if (!group) continue;

    for (const appId of group.appIds) {
      addReason(appId, {
        type: 'cooldown',
        sourceId: cooldown.groupId,
      });
    }
  }

  // 3. Process Overnight Protection (all Risk apps protected)
  if (options?.isOvernight) {
    for (const app of apps) {
      if (app.classification === 'risk') {
        addReason(app.id, {
          type: 'routine-overnight',
          sourceId: 'overnight',
        });
      }
    }
  }

  // 4. Process Daily Allowance Exhaustion
  for (const app of apps) {
    if (app.classification === 'risk') {
      if (isDailyAllowanceExhausted(app, options?.dailyAppUsage, now)) {
        addReason(app.id, {
          type: 'daily-allowance',
          sourceId: app.id,
        });
      }
    }
  }

  // 5. Apply Access Lease suppression after union of reasons
  const effectiveAppIds: string[] = [];
  const appRestrictions: AppRestriction[] = [];

  for (const [appId, restriction] of restrictionMap.entries()) {
    const app = apps.find((a) => a.id === appId);
    const isSuppressedByLease =
      app?.riskGroupId !== undefined && activeLeaseGroupIds.has(app.riskGroupId);

    if (!isSuppressedByLease) {
      effectiveAppIds.push(appId);
      appRestrictions.push(restriction);
    }
  }

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
