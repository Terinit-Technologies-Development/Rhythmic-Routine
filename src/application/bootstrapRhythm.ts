import { getPlatformServices } from '../platform/PlatformServices';
import { initialApps, initialRiskGroups, initialRoutineWindows } from '../data/mockData';
import { RhythmEngine } from '../domain/rhythm/RhythmEngine';
import { EngineStatus, RhythmConfiguration, RhythmPreferences } from '../domain/rhythm/types';
import { reconcileRhythm } from './reconcileRhythm';

export interface BootstrapResult {
  engine: RhythmEngine;
  config: RhythmConfiguration;
  preferences: RhythmPreferences;
  status: EngineStatus;
}

/**
 * Single bootstrap service executed during app startup.
 * Loads persisted preferences, runtime, reconciles active routines/cooldowns,
 * enforces cold-start restrictions, and returns the authoritative configuration and engine.
 */
export async function bootstrapRhythm(): Promise<BootstrapResult> {
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

  const baseApps = installedApps.length > 0 ? installedApps : initialApps;

  // Build preferences if not previously stored
  const preferences: RhythmPreferences = persistedPreferences || {
    routineWindows: initialRoutineWindows,
    riskGroups: initialRiskGroups,
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

  // Reconcile installed app classifications against loaded preferences
  const apps = baseApps.map((app) => {
    const saved = preferences.appClassifications[app.id];
    if (saved) {
      return {
        ...app,
        classification: saved.classification,
        riskGroupId: saved.riskGroupId,
      };
    }
    return app;
  });

  const config: RhythmConfiguration = {
    routineWindows: preferences.routineWindows,
    riskGroups: preferences.riskGroups,
    apps,
    sessionResetGapMs: preferences.sessionResetGapMs,
  };

  const now = Date.now();
  const engine = new RhythmEngine(config, persistedRuntime, now);

  // Cold-start restriction reapplication:
  // Explicitly ensure all desired restrictions are applied to the platform provider
  const desiredIds = engine.getEffectiveRestrictedAppIds();
  if (desiredIds.length > 0) {
    try {
      await restrictions.applyRestrictions(desiredIds);
    } catch {
      issues.push('Failed to apply cold-start desired restrictions to platform provider');
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
