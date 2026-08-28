import { getPlatformServices } from '../platform/PlatformServices';
import { initialApps, initialRiskGroups, initialRoutineWindows } from '../data/mockData';
import { RhythmEngine } from '../domain/rhythm/RhythmEngine';
import { RhythmConfiguration, RhythmPreferences } from '../domain/rhythm/types';
import { reconcileRhythm } from './reconcileRhythm';

export interface BootstrapResult {
  engine: RhythmEngine;
  config: RhythmConfiguration;
  preferences: RhythmPreferences;
}

/**
 * Single bootstrap service executed during app startup.
 * Loads persisted preferences, runtime, reconciles active routines/cooldowns,
 * and sets up the Rhythm Engine instance.
 */
export async function bootstrapRhythm(): Promise<BootstrapResult> {
  const { storage, usage, permissions } = getPlatformServices();

  const [persistedPreferences, persistedRuntime, installedApps] = await Promise.all([
    storage.loadPreferences(),
    storage.loadRuntime(),
    usage.getInstalledApps(),
  ]);

  const baseApps = installedApps.length > 0 ? installedApps : initialApps;

  // Build preferences if not previously stored
  const preferences: RhythmPreferences = persistedPreferences || {
    routineWindows: initialRoutineWindows,
    riskGroups: initialRiskGroups,
    appClassifications: baseApps.reduce<Record<string, { classification: string; riskGroupId?: string }>>((acc, app) => {
      acc[app.id] = {
        classification: app.classification,
        riskGroupId: app.riskGroupId,
      };
      return acc;
    }, {}),
    sessionResetGapMs: 5 * 60 * 1000,
    onboardingCompleted: true,
  };

  // Reconcile app classifications against loaded preferences
  const apps = baseApps.map((app) => {
    const saved = preferences.appClassifications[app.id];
    if (saved) {
      return {
        ...app,
        classification: saved.classification as any,
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

  // Run initial reconciliation
  await reconcileRhythm(engine, config, now);

  // Check permission status
  await permissions.getStatus();

  return {
    engine,
    config,
    preferences,
  };
}
