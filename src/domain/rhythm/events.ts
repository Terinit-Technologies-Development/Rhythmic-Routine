import {
  ActiveCooldown,
  RhythmConfiguration,
  RhythmEffect,
  RhythmEvent,
  RhythmRuntime,
  SESSION_RESET_GAP_MS,
} from './types';
import {
  getActiveRoutineWindowIds,
  isInsideWindow,
  resolveRhythmState,
} from './routine';
import {
  createNewRiskSession,
  getAppRiskGroupId,
  isThresholdReached,
  recordActiveUsage,
  resumeRiskSession,
  shouldContinueSession,
} from './sessions';
import { isCooldownExpired, startCooldown } from './cooldowns';
import {
  computeEffectiveRestrictions,
  diffRestrictions,
} from './restrictions';

/**
 * Pure transition reducer processing a single RhythmEvent given configuration and current runtime state.
 */
export function processRhythmEvent(
  currentRuntime: RhythmRuntime,
  event: RhythmEvent,
  config: RhythmConfiguration
): {
  nextRuntime: RhythmRuntime;
  effects: RhythmEffect[];
} {
  const nowMs = 'timestamp' in event ? event.timestamp : Date.now();
  const nowDate = new Date(nowMs);
  const gapMs = config.sessionResetGapMs ?? SESSION_RESET_GAP_MS;

  let nextSession = currentRuntime.activeSession ? { ...currentRuntime.activeSession } : undefined;
  const nextCooldowns: Record<string, ActiveCooldown> = { ...(currentRuntime.activeCooldowns || {}) };
  const effects: RhythmEffect[] = [];

  // 1. Check expired cooldowns individually (multi-group support)
  for (const [groupId, cooldown] of Object.entries(nextCooldowns)) {
    if (isCooldownExpired(cooldown, nowMs)) {
      delete nextCooldowns[groupId];
      effects.push({
        type: 'END_COOLDOWN',
        groupId,
      });
      effects.push({
        type: 'RECORD_HISTORY',
        event: {
          type: 'cooldown-ended',
          groupId,
          timestamp: nowMs,
        },
      });
    }
  }

  // 2. Process specific event
  switch (event.type) {
    case 'CLOCK_TICK':
    case 'RECONCILE': {
      if (nextSession) {
        if (nextSession.activeAppId) {
          // App actively foregrounded; accumulate time
          nextSession = recordActiveUsage(nextSession, nextSession.activeAppId, nowMs);
          const group = config.riskGroups.find((g) => g.id === nextSession?.groupId);
          if (group && isThresholdReached(nextSession, group)) {
            const newCooldown = startCooldown(
              nextSession.groupId,
              nowMs,
              group.cooldownMinutes
            );
            nextCooldowns[nextSession.groupId] = newCooldown;

            effects.push({
              type: 'START_COOLDOWN',
              groupId: nextSession.groupId,
              endsAt: newCooldown.endsAt,
            });
            effects.push({
              type: 'RECORD_HISTORY',
              event: {
                type: 'cooldown-started',
                groupId: nextSession.groupId,
                timestamp: nowMs,
              },
            });
            effects.push({
              type: 'RECORD_HISTORY',
              event: {
                type: 'risk-session-ended',
                groupId: nextSession.groupId,
                durationSeconds: nextSession.accumulatedSeconds,
                timestamp: nowMs,
              },
            });
            nextSession = undefined;
          }
        } else {
          // App in background; check inactivity timeout
          if (nowMs - nextSession.lastActivityAt > gapMs) {
            effects.push({
              type: 'RECORD_HISTORY',
              event: {
                type: 'risk-session-ended',
                groupId: nextSession.groupId,
                durationSeconds: nextSession.accumulatedSeconds,
                timestamp: nowMs,
              },
            });
            nextSession = undefined;
          }
        }
      }
      break;
    }

    case 'APP_FOREGROUND': {
      const targetGroupId = getAppRiskGroupId(event.appId, config.apps);

      if (targetGroupId) {
        const group = config.riskGroups.find((g) => g.id === targetGroupId);

        if (nextSession) {
          if (shouldContinueSession(nextSession, targetGroupId, event.timestamp, gapMs)) {
            // If already active, record active usage; if returning after inactive gap, resume pointer without adding gap time
            nextSession = nextSession.activeAppId
              ? recordActiveUsage(nextSession, event.appId, event.timestamp)
              : resumeRiskSession(nextSession, event.appId, event.timestamp);
          } else {
            // End old session and start new
            effects.push({
              type: 'RECORD_HISTORY',
              event: {
                type: 'risk-session-ended',
                groupId: nextSession.groupId,
                durationSeconds: nextSession.accumulatedSeconds,
                timestamp: event.timestamp,
              },
            });
            nextSession = createNewRiskSession(targetGroupId, event.appId, event.timestamp);
          }
        } else {
          nextSession = createNewRiskSession(targetGroupId, event.appId, event.timestamp);
          effects.push({
            type: 'RECORD_HISTORY',
            event: {
              type: 'risk-session-started',
              groupId: targetGroupId,
              appId: event.appId,
              timestamp: event.timestamp,
            },
          });
        }

        // Check if group threshold is now exceeded
        if (group && isThresholdReached(nextSession, group)) {
          const newCooldown = startCooldown(
            targetGroupId,
            event.timestamp,
            group.cooldownMinutes
          );
          nextCooldowns[targetGroupId] = newCooldown;

          effects.push({
            type: 'START_COOLDOWN',
            groupId: targetGroupId,
            endsAt: newCooldown.endsAt,
          });

          effects.push({
            type: 'RECORD_HISTORY',
            event: {
              type: 'cooldown-started',
              groupId: targetGroupId,
              timestamp: event.timestamp,
            },
          });

          effects.push({
            type: 'RECORD_HISTORY',
            event: {
              type: 'risk-session-ended',
              groupId: nextSession.groupId,
              durationSeconds: nextSession.accumulatedSeconds,
              timestamp: event.timestamp,
            },
          });
          nextSession = undefined;
        }
      } else {
        // App is not a risk app (essential or normal)
        if (nextSession) {
          if (nextSession.activeAppId) {
            // Finalize active interval on previously active risk app
            nextSession = recordActiveUsage(nextSession, undefined, event.timestamp);
          }
          if (event.timestamp - nextSession.lastActivityAt > gapMs) {
            effects.push({
              type: 'RECORD_HISTORY',
              event: {
                type: 'risk-session-ended',
                groupId: nextSession.groupId,
                durationSeconds: nextSession.accumulatedSeconds,
                timestamp: event.timestamp,
              },
            });
            nextSession = undefined;
          }
        }
      }
      break;
    }

    case 'APP_BACKGROUND': {
      if (nextSession && nextSession.activeAppId === event.appId) {
        nextSession = recordActiveUsage(nextSession, undefined, event.timestamp);
      }
      break;
    }

    case 'COOLDOWN_STARTED': {
      nextCooldowns[event.groupId] = {
        groupId: event.groupId,
        startedAt: nowMs,
        endsAt: event.endsAt,
      };
      if (nextSession?.groupId === event.groupId) {
        nextSession = undefined;
      }
      break;
    }

    case 'COOLDOWN_ENDED': {
      if (nextCooldowns[event.groupId]) {
        delete nextCooldowns[event.groupId];
        effects.push({
          type: 'END_COOLDOWN',
          groupId: event.groupId,
        });
        effects.push({
          type: 'RECORD_HISTORY',
          event: {
            type: 'cooldown-ended',
            groupId: event.groupId,
            timestamp: event.timestamp,
          },
        });
      }
      break;
    }

    case 'ROUTINE_STARTED':
    case 'ROUTINE_ENDED':
      break;
  }

  // 3. Resolve active routine windows
  const activeRoutineWindowIds = getActiveRoutineWindowIds(nowDate, config.routineWindows);
  const activeRoutineWindows = config.routineWindows.filter((w) => isInsideWindow(nowDate, w));

  // 4. Compute desired effective restrictions and diff against previous
  const previousRestrictedAppIds = currentRuntime.activeRestrictions.map((r) => r.appId);
  const { appRestrictions, effectiveAppIds } = computeEffectiveRestrictions(
    activeRoutineWindows,
    nextCooldowns,
    config.riskGroups,
    config.apps,
    nowMs
  );

  const { toApply, toClear } = diffRestrictions(
    previousRestrictedAppIds,
    effectiveAppIds
  );

  if (toApply.length > 0) {
    effects.push({
      type: 'APPLY_RESTRICTIONS',
      appIds: toApply,
    });
  }

  if (toClear.length > 0) {
    effects.push({
      type: 'CLEAR_RESTRICTIONS',
      appIds: toClear,
    });
  }

  // 5. Resolve high-level state
  const nextState = resolveRhythmState(
    nowDate,
    config.routineWindows,
    nextCooldowns,
    nextSession
  );

  const nextRuntime: RhythmRuntime = {
    state: nextState,
    activeSession: nextSession,
    activeCooldowns: nextCooldowns,
    activeRoutineWindowIds,
    activeRestrictions: appRestrictions,
  };

  return {
    nextRuntime,
    effects,
  };
}
