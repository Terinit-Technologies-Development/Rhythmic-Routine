import { getPlatformServices } from '../platform/PlatformServices';
import { RhythmEngine } from '../domain/rhythm/RhythmEngine';
import { RhythmConfiguration, RhythmEffect } from '../domain/rhythm/types';

/**
 * Reconciles current state across configuration, clock time, restrictions, and storage.
 */
export async function reconcileRhythm(
  engine: RhythmEngine,
  config: RhythmConfiguration,
  now: number = Date.now()
): Promise<RhythmEffect[]> {
  const { restrictions, storage } = getPlatformServices();

  const effects = engine.reconcile(now);

  for (const effect of effects) {
    switch (effect.type) {
      case 'APPLY_RESTRICTIONS':
        await restrictions.applyRestrictions(effect.appIds);
        break;
      case 'CLEAR_RESTRICTIONS':
        await restrictions.clearRestrictions(effect.appIds);
        break;
      case 'RECORD_HISTORY':
        await storage.appendHistoryEvent(effect.event);
        break;
    }
  }

  // Persist latest runtime state
  const persistedRuntime = engine.toPersistedRuntime(now);
  await storage.saveRuntime(persistedRuntime);

  return effects;
}
