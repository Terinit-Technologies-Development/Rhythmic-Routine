import { RhythmConfiguration, RhythmRuntime } from './types';
import { isInsideWindow } from './routine';

/**
 * Computes the Android native BASE restriction registry.
 *
 * IMPORTANT:
 * - routine + cooldown reasons are included
 * - Access Leases are deliberately ignored (handled exclusively by native lease registry)
 * - Essential apps can never enter this set
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

  return [...restrictedAppIds];
}
