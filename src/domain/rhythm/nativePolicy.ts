import { RhythmConfiguration, RhythmRuntime } from './types';
import { isInsideOvernightProtection, isInsideWindow } from './routine';
import { isGroupAllowanceExhausted } from './allowance';

/**
 * Computes the Android native BASE restriction registry.
 *
 * IMPORTANT:
 * - routine + cooldown + overnight + GROUP allowance reasons are included
 * - Access Leases are deliberately ignored (handled exclusively by native lease registry)
 * - Essential apps can never enter this set
 *
 * v1.0.2: the Risk Group shared allowance is the SOLE allowance authority.
 * Legacy per-app ledgers (DailyAppUsage) are never consulted here, even if
 * present on the runtime for migration/observational compatibility.
 */
export function computeUnsuppressedBaseRestrictedAppIds(
  runtime: RhythmRuntime,
  config: RhythmConfiguration,
  nowMs: number = Date.now()
): string[] {
  const restrictedGroupIds = new Set<string>();
  const now = new Date(nowMs);

  for (const window of config.routineWindows) {
    if (!window.enabled) continue;
    if (!isInsideWindow(now, window)) continue;

    for (const groupId of window.protectedGroupIds) {
      restrictedGroupIds.add(groupId);
    }
  }

  for (const cooldown of Object.values(runtime.activeCooldowns ?? {})) {
    if (cooldown.endsAt > nowMs) {
      restrictedGroupIds.add(cooldown.groupId);
    }
  }

  const restrictedAppIds = new Set<string>();

  for (const group of config.riskGroups) {
    if (!restrictedGroupIds.has(group.id)) continue;

    for (const appId of group.appIds) {
      const app = config.apps.find((item) => item.id === appId);

      if (!app) continue;
      if (app.classification === 'essential') continue;
      if (app.classification !== 'risk') continue;

      restrictedAppIds.add(app.id);
    }
  }

  // Overnight protection locks all Risk apps
  if (isInsideOvernightProtection(now, config.routineWindows)) {
    for (const app of config.apps) {
      if (app.classification === 'essential') continue;
      if (app.classification !== 'risk') continue;
      restrictedAppIds.add(app.id);
    }
  }

  // v1.0.2: exhausted GROUP allowance locks every member Risk app.
  // Per-app ledgers are deliberately never consulted (sole group ownership).
  if (runtime.groupAllowanceUsage) {
    for (const group of config.riskGroups) {
      if (isGroupAllowanceExhausted(group, runtime.groupAllowanceUsage[group.id], nowMs)) {
        for (const appId of group.appIds) {
          const app = config.apps.find((item) => item.id === appId);
          if (!app) continue;
          if (app.classification === 'essential') continue;
          if (app.classification !== 'risk') continue;
          restrictedAppIds.add(app.id);
        }
      }
    }
  }

  return [...restrictedAppIds];
}
