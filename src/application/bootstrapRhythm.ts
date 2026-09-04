import { getPlatformServices } from '../platform/PlatformServices';
import { initialApps, initialRiskGroups, initialRoutineWindows } from '../data/mockData';
import { RhythmEngine } from '../domain/rhythm/RhythmEngine';
import { EngineStatus, RhythmConfiguration, RhythmPreferences } from '../domain/rhythm/types';
import { reconcileRhythm } from './reconcileRhythm';
import { reconcileRiskGroupMembership } from '../domain/rhythm/membershipReconciliation';

import { migrateConfigurationV102 } from '../domain/rhythm/migration';

export interface BootstrapResult {
  engine: RhythmEngine;
  config: RhythmConfiguration;
  preferences: RhythmPreferences;
  status: EngineStatus;
}

export interface BootstrapOptions {
  deferRestrictionEffects?: boolean;
}

/**
 * Single bootstrap service executed during app startup.
 * Loads persisted preferences, runtime, reconciles active routines/cooldowns,
 * and returns the authoritative configuration and engine.
 */
export async function bootstrapRhythm(options: BootstrapOptions = {}): Promise<BootstrapResult> {
  const { storage, usage, permissions, restrictions } = getPlatformServices();
  const issues: string[] = [];

  let persistedPreferences: RhythmPreferences | null = null;
  let persistedRuntime: any = null;
  let installedApps: any[] = [];

  try {
    const results = await Promise.allSettled([
      storage.loadPreferences(),
      storage.loadRuntime(),
      usage.getInstalledApps(),
    ]);

    if (results[0].status === 'fulfilled') persistedPreferences = results[0].value;
    else issues.push('Failed to load local preferences from storage');

    if (results[1].status === 'fulfilled') persistedRuntime = results[1].value;
    else issues.push('Failed to load persisted runtime state');

    if (results[2].status === 'fulfilled') installedApps = results[2].value;
    else issues.push('Failed to query installed device applications');
  } catch (err) {
    issues.push(`Bootstrap exception: ${String(err)}`);
  }

  const isRealNative = installedApps.length > 0;
  const baseApps = isRealNative ? installedApps : initialApps;

  // Build preferences if not previously stored.
  // v1.0.2: allowance ownership lives on RiskGroup (allowanceMinutes,
  // lastAllowanceEditedDateKey, recoveryActivityId). Per-app dailyRiskAllowance
  // is never created here; persisted v1.0.1 values are stripped by migration.
  const preferences: RhythmPreferences = persistedPreferences || {
    routineWindows: initialRoutineWindows,
    riskGroups: isRealNative
      ? initialRiskGroups.map((g) => ({ ...g, appIds: [] }))
      : initialRiskGroups,
    appClassifications: baseApps.reduce<Record<string, { classification: any; riskGroupId?: string }>>((acc, app) => {
      acc[app.id] = {
        classification: app.classification,
        riskGroupId: app.riskGroupId,
      };
      return acc;
    }, {}),
    sessionResetGapMs: 5 * 60 * 1000,
    onboardingCompleted: true,
  };

  let configMigrationMutated = false;
  // True when persisted state used the v1.0.1 model (legacy group threshold
  // without an explicit group allowance, or any per-app allowance policy).
  // Used once to reset stale per-app exhaustion alongside group migration.
  let legacyAllowanceModelDetected = false;
  if (persistedPreferences) {
    for (const g of (persistedPreferences.riskGroups ?? []) as any[]) {
      const raw = g as Record<string, unknown>;
      if (
        Number.isFinite(raw['sessionThresholdMinutes'] as number) &&
        !Number.isFinite(raw['allowanceMinutes'] as number)
      ) {
        legacyAllowanceModelDetected = true;
        break;
      }
    }
    if (!legacyAllowanceModelDetected) {
      for (const entry of Object.values(persistedPreferences.appClassifications ?? {})) {
        if ('dailyRiskAllowance' in (entry as Record<string, unknown>)) {
          legacyAllowanceModelDetected = true;
          break;
        }
      }
    }
  }

  // v1.0.2 idempotent migration of persisted v1.0.1 configuration:
  // group allowance from legacy group sessionThresholdMinutes (default 30),
  // per-app allowance stripped (never a policy source), recovery defaults walk.
  {
    const migrated = migrateConfigurationV102({
      riskGroups: preferences.riskGroups as any[],
      apps: baseApps,
    });
    if (
      JSON.stringify(migrated.riskGroups) !== JSON.stringify(preferences.riskGroups) ||
      migrated.mutated
    ) {
      configMigrationMutated = true;
    }
    preferences.riskGroups = migrated.riskGroups;
    // Strip any persisted per-app allowance classifications (incorrect model).
    const nextClassifications: RhythmPreferences['appClassifications'] = {};
    for (const [appId, entry] of Object.entries(preferences.appClassifications ?? {})) {
      const { dailyRiskAllowance: _removed, ...rest } = entry as Record<string, unknown>;
      if ('dailyRiskAllowance' in (entry as Record<string, unknown>)) {
        configMigrationMutated = true;
      }
      void _removed;
      nextClassifications[appId] = rest as RhythmPreferences['appClassifications'][string];
    }
    preferences.appClassifications = nextClassifications;
    void migrated.apps;
  }

  // Reconcile installed app classifications against loaded preferences.
  // v1.0.2: classification + group membership only; no per-app allowance policy.
  const apps = baseApps.map((app) => {
    const saved = preferences.appClassifications[app.id];
    const classification = saved ? saved.classification : app.classification;
    const riskGroupId = saved ? saved.riskGroupId : app.riskGroupId;

    if (saved) {
      // Persisted shape stays free of per-app allowance state.
      const { dailyRiskAllowance: _removed, ...rest } = saved as Record<string, unknown>;
      if ('dailyRiskAllowance' in (saved as Record<string, unknown>)) {
        configMigrationMutated = true;
      }
      void _removed;
      preferences.appClassifications[app.id] = rest as RhythmPreferences['appClassifications'][string];
    } else {
      preferences.appClassifications[app.id] = {
        classification,
        riskGroupId,
      };
      configMigrationMutated = true;
    }

    return {
      ...app,
      classification,
      riskGroupId,
      dailyRiskAllowance: undefined,
    };
  });

  // Reconcile risk group membership strictly from authoritative app classifications
  if (isRealNative) {
    preferences.riskGroups = reconcileRiskGroupMembership(apps, preferences.riskGroups);
  }

  // Await savePreferences if preferences were freshly constructed, mutated by migration, or reconciled for native
  if (!persistedPreferences || configMigrationMutated || isRealNative) {
    try {
      await storage.savePreferences(preferences);
    } catch (err) {
      issues.push(`Failed to persist bootstrap preferences: ${String(err)}`);
    }
  }

  const config: RhythmConfiguration = {
    routineWindows: preferences.routineWindows,
    riskGroups: preferences.riskGroups,
    apps,
    sessionResetGapMs: preferences.sessionResetGapMs,
  };

  const now = Date.now();

  // v1.0.2 upgrade-once reset: stale v1.0.1 per-app exhausted usage must not
  // leak into the new group ledger. Only applied when legacy model state was
  // actually detected (normal boots preserve same-day runtime usage).
  if (legacyAllowanceModelDetected && persistedRuntime?.dailyAppUsage) {
    for (const usage of Object.values(
      persistedRuntime.dailyAppUsage as Record<string, Record<string, unknown>>
    )) {
      if (usage && typeof usage === 'object') {
        usage['usedSeconds'] = 0;
        usage['exhaustedAt'] = undefined;
        usage['activeSegmentStartedAt'] = undefined;
      }
    }
  }

  const engine = new RhythmEngine(config, persistedRuntime, now);

  // Cold-start restriction reapplication only if not deferred to coordinator
  if (!options.deferRestrictionEffects) {
    const desiredIds = engine.getEffectiveRestrictedAppIds();
    if (desiredIds.length > 0) {
      try {
        await restrictions.applyRestrictions(desiredIds);
      } catch {
        issues.push('Failed to apply cold-start desired restrictions to platform provider');
      }
    }
  }

  // Run initial engine reconciliation
  await reconcileRhythm(engine, config, now);

  // Check platform permission and capability status
  const permStatus = await permissions.getStatus();
  if (permStatus.usageAccess !== 'granted') {
    issues.push('Usage access permission is not granted');
  }
  if (permStatus.restrictionCapability === 'foundation-only') {
    issues.push('Restriction enforcement is foundation-only (OS shielding token binding required)');
  }

  const status: EngineStatus = {
    health: issues.length === 0 ? 'ready' : 'degraded',
    issues,
  };

  return {
    engine,
    config,
    preferences,
    status,
  };
}
