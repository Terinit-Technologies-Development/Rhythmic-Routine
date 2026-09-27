import { AccessLease, DeviceApp, GroupAllowanceUsage, RiskGroup, RoutineWindow } from '../../types/domain';
import { ActiveCooldown, AppRestriction, getActiveAccessLeases, getActiveCooldowns, RestrictionReason } from './types';
import type { ActiveReadingGate } from './attentionExchange';
import type { ActiveRestorativeGate } from './restorativeGate';
import { getLocalDateKey, isGroupAllowanceExhausted } from './allowance';

/**
 * Narrow internal allowlist of first-party companion packages that must stay
 * reachable whenever Routine requires them (Meditation Focus). Never exposed as
 * a user classification: a user setting must not be able to make Meditation
 * inaccessible while Morning Meditation is required.
 */
export const OFFICIAL_COMPANION_PACKAGES: ReadonlySet<string> = new Set([
  'com.terinit.rhythmicmeditation',
  'com.terinit.rhythmicroutine',
]);

export interface RestrictionOptions {
  isOvernight?: boolean;
  /** v1.0.2: authoritative per-group allowance ledgers (sole allowance authority). */
  groupAllowanceUsage?: Record<string, GroupAllowanceUsage>;
  /** Pass 03: recovery satisfaction state per group for cooldown re-entry gating. */
  groupRecoverySatisfied?: Record<string, boolean>;
  /** Pass 03: reading obligations persist after their native cooldown timer expires. */
  activeReadingGates?: Record<string, ActiveReadingGate>;
  currentDateKey?: string;
  /** Pass 3: Restorative Gate obligations (authoritative gate state). */
  activeRestorativeGates?: Record<string, ActiveRestorativeGate>;
  /** Pass 3: Morning Meditation Focus is holding nonessential/Risk apps. */
  morningMeditationActive?: boolean;
  /** Pass 3: override for tests/special builds; defaults to OFFICIAL_COMPANION_PACKAGES. */
  officialCompanionPackages?: ReadonlySet<string>;
}

/**
 * Computes effective desired app restrictions across active routine windows, overnight protection,
 * all active cooldowns, and exhausted group allowances, minus active access lease suppressions.
 * Maintains the fundamental invariant: Essential apps are NEVER restricted.
 *
 * v1.0.2: the Risk Group shared allowance is the SOLE allowance authority. Legacy
 * per-app ledgers (DailyAppUsage) are never consulted here, even if present on
 * the runtime for migration/observational compatibility.
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
    const isElapsed = cooldown.endsAt <= now;
    const isRecoveryRequired = cooldown.recoveryRequired ?? false;
    const isSatisfied = options?.groupRecoverySatisfied?.[cooldown.groupId] ?? false;

    // Cooldown restriction clears only when time has elapsed AND (recovery is not required OR recovery is satisfied)
    if (isElapsed && (!isRecoveryRequired || isSatisfied)) continue;

    const group = riskGroups.find((g) => g.id === cooldown.groupId);
    if (!group) continue;

    for (const appId of group.appIds) {
      addReason(appId, {
        type: 'cooldown',
        sourceId: cooldown.groupId,
      });
    }
  }

  // An expired timer is no longer a cooldown. A current-day native reading gate
  // remains a separate restriction reason until native reconciliation clears it.
  const currentDateKey = options?.currentDateKey ?? getLocalDateKey(now);
  for (const [groupId, gate] of Object.entries(options?.activeReadingGates ?? {})) {
    if (gate.attentionDateKey !== currentDateKey || gate.cooldownEndsAt > now) continue;
    const group = riskGroups.find((item) => item.id === groupId);
    if (!group) continue;
    for (const appId of group.appIds) {
      const app = apps.find((item) => item.id === appId);
      if (app?.classification !== 'risk') continue;
      addReason(appId, { type: 'reading-quota', sourceId: groupId });
    }
  }

  // Pass 3: an incomplete Restorative Gate keeps blocking after its cooldown
  // timer expires. Central invariant:
  //   canReenter = cooldownElapsed && gateSatisfiedOrAbsent
  // — never "cooldown OR restorative activity", and completing Reader or
  // Meditation work never shortens cooldownEndsAt.
  for (const [groupId, gate] of Object.entries(options?.activeRestorativeGates ?? {})) {
    if (gate.status === 'satisfied' || gate.cooldownEndsAt > now) continue;
    const group = riskGroups.find((item) => item.id === groupId);
    if (!group) continue;
    for (const appId of group.appIds) {
      addReason(appId, { type: 'restorative-gate', sourceId: gate.gateId });
    }
  }

  // Pass 3: Morning Meditation Focus. Meditation, Routine itself, and Essential
  // apps stay reachable; normal nonessential and Risk apps are restricted until
  // the Attention Day's morning session is verified complete.
  if (options?.morningMeditationActive) {
    const companions = options.officialCompanionPackages ?? OFFICIAL_COMPANION_PACKAGES;
    for (const app of apps) {
      if (app.classification === 'essential') continue;
      if (companions.has(app.id)) continue;
      addReason(app.id, { type: 'morning-meditation', sourceId: 'morning-meditation' });
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

  // 4. Process Group Allowance Exhaustion (v1.0.2 sole allowance authority).
  // When a group's shared allowance is exhausted, every member Risk app is
  // restricted. Per-app ledgers are deliberately never consulted.
  if (options?.groupAllowanceUsage) {
    for (const group of riskGroups) {
      if (isGroupAllowanceExhausted(group, options.groupAllowanceUsage[group.id], now)) {
        for (const appId of group.appIds) {
          const app = apps.find((a) => a.id === appId);
          if (app && app.classification === 'risk') {
            addReason(appId, {
              type: 'daily-allowance',
              sourceId: group.id,
            });
          }
        }
      }
    }
  }

  // 5. Apply Access Lease suppression after union of reasons.
  // Pass 3: a lease can never trivially bypass Morning Meditation Focus — the
  // 'morning-meditation' reason survives lease suppression for nonessential apps.
  const effectiveAppIds: string[] = [];
  const appRestrictions: AppRestriction[] = [];

  for (const [appId, restriction] of restrictionMap.entries()) {
    const app = apps.find((a) => a.id === appId);
    const isSuppressedByLease =
      app?.riskGroupId !== undefined && activeLeaseGroupIds.has(app.riskGroupId);
    const holdsMorningFocus = restriction.reasons.some(
      (reason) => reason.type === 'morning-meditation'
    );

    if (!isSuppressedByLease || holdsMorningFocus) {
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
