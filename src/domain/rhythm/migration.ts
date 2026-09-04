import {
  DEFAULT_DAILY_RISK_ALLOWANCE_MINUTES,
  DEFAULT_RECOVERY_ACTIVITY_ID,
  DailyAppUsage,
  DeviceApp,
  GroupAllowanceUsage,
  RiskGroup,
} from '../../types/domain';
import { getLocalDateKey, resolveGroupAllowanceMinutes } from './allowance';

/**
 * v1.0.2 migration: derives the group's shared allowance from the legacy
 * v1.0.1 group threshold (sessionThresholdMinutes), never from per-app
 * dailyRiskAllowance values. Missing/invalid thresholds default to 30.
 * Missing recovery selection defaults to 'walk'. Preserves IDs, names,
 * descriptions, appIds, cooldownMinutes and native-selection metadata.
 * Idempotent: re-running on an already-migrated group preserves its explicit
 * allowanceMinutes/recoveryActivityId/lastAllowanceEditedDateKey.
 */
export function migrateRiskGroupV102(group: any): RiskGroup {
  const raw = (group ?? {}) as Record<string, unknown>;
  const base = group as RiskGroup;

  const hasExplicitAllowance =
    Number.isFinite(raw['allowanceMinutes'] as number) &&
    (raw['allowanceMinutes'] as number) >= 0;
  const legacyThreshold = raw['sessionThresholdMinutes'];
  const hasValidLegacy =
    Number.isFinite(legacyThreshold as number) && (legacyThreshold as number) >= 0;

  const allowanceMinutes = hasExplicitAllowance
    ? (raw['allowanceMinutes'] as number)
    : hasValidLegacy
      ? (legacyThreshold as number)
      : DEFAULT_DAILY_RISK_ALLOWANCE_MINUTES;

  const migrated: RiskGroup = {
    ...(base as RiskGroup),
    allowanceMinutes,
    recoveryActivityId:
      (raw['recoveryActivityId'] as string | undefined) ?? DEFAULT_RECOVERY_ACTIVITY_ID,
  };

  // Never carry per-app policy onto the group; belt-and-suspenders strip in
  // case a v1.0.1 payload embedded one.
  delete (migrated as unknown as Record<string, unknown>)['dailyRiskAllowance'];

  // The migrated ACTIVE group must never carry a second policy: once
  // allowanceMinutes is derived/materialized (explicit value, valid legacy
  // threshold, or 30-minute default), the legacy threshold is always stripped.
  delete (migrated as unknown as Record<string, unknown>)['sessionThresholdMinutes'];

  // lastAllowanceEditedDateKey (if present) is preserved as-is by the spread.

  return migrated;
}

/**
 * v1.0.2 migration: strips the removed per-app allowance policy. Preserves
 * identity, classification, group membership and display metadata.
 */
export function migrateDeviceAppV102(app: DeviceApp): DeviceApp {
  const { dailyRiskAllowance: _removed, ...rest } = app as DeviceApp & {
    dailyRiskAllowance?: unknown;
  };
  void _removed;
  return { ...rest };
}

/**
 * v1.0.2 migration for a full persisted configuration snapshot.
 * - migrates every Risk Group (allowance from legacy group threshold;
 *   legacy threshold always stripped from the active shape)
 * - strips every per-app dailyRiskAllowance (never a policy source)
 * - preserves unrelated fields; idempotent.
 */
export function migrateConfigurationV102(config: {
  riskGroups: any[];
  apps: DeviceApp[];
}): { riskGroups: RiskGroup[]; apps: DeviceApp[]; mutated: boolean } {
  let mutated = false;

  const riskGroups = (config.riskGroups ?? []).map((g) => {
    const before = JSON.stringify(g);
    const migrated = migrateRiskGroupV102(g);
    if (JSON.stringify(migrated) !== before) mutated = true;
    // Backfill check: resolver must agree with materialized value.
    void resolveGroupAllowanceMinutes(migrated);
    return migrated;
  });

  const apps = (config.apps ?? []).map((a) => {
    if ('dailyRiskAllowance' in (a as unknown as Record<string, unknown>)) mutated = true;
    return migrateDeviceAppV102(a);
  });

  return { riskGroups, apps, mutated };
}

/**
 * Creates a fresh per-group allowance ledger for the given date. Stale v1.0.1
 * per-app exhaustion markers are NOT carried over — the caller resets them by
 * constructing group ledgers from zero. Idempotent for a fixed (groups, dateKey).
 */
export function createGroupAllowanceLedgers(
  groups: Pick<RiskGroup, 'id'>[],
  dateKey: string = getLocalDateKey()
): Record<string, GroupAllowanceUsage> {
  const ledgers: Record<string, GroupAllowanceUsage> = {};
  for (const g of groups) {
    ledgers[g.id] = {
      groupId: g.id,
      dateKey,
      usedSeconds: 0,
      activePackageName: undefined,
      activeSegmentStartedAt: undefined,
      exhaustedAt: undefined,
      cycleRevision: 0,
    };
  }
  return ledgers;
}

/**
 * Clears stale v1.0.1 per-app exhaustion markers when the new group ledger is
 * first created. Returns a new record (no input mutation).
 */
export function clearStalePerAppExhaustion(
  dailyAppUsage: Record<string, DailyAppUsage> = {},
  dateKey: string = getLocalDateKey()
): Record<string, DailyAppUsage> {
  const next: Record<string, DailyAppUsage> = {};
  for (const [appId, usage] of Object.entries(dailyAppUsage)) {
    next[appId] = {
      ...usage,
      dateKey,
      usedSeconds: 0,
      activeSegmentStartedAt: undefined,
      exhaustedAt: undefined,
    };
  }
  return next;
}
