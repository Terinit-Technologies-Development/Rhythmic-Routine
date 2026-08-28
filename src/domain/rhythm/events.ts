import {
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
  recordSessionActivity,
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
  let nextCooldown = currentRuntime.activeCooldown ? { ...currentRuntime.activeCooldown } : undefined;
  const effects: RhythmEffect[] = [];

  // Check if existing cooldown has expired
  if (nextCooldown && isCooldownExpired(nextCooldown, nowMs)) {
    effects.push({
      type: 'END_COOLDOWN',
      groupId: nextCooldown.groupId,
    });
    effects.push({
      type: 'RECORD_HISTORY',
      event: {
        type: 'cooldown-ended',
        groupId: nextCooldown.groupId,
        timestamp: nowMs,
      },
    });
    nextCooldown = undefined;
  }

  switch (event.type) {
    case 'CLOCK_TICK':
    case 'RECONCILE': {
      if (nextSession) {
        if (nextSession.activeAppId) {
          // App actively foregrounded; accumulate time
          nextSession = recordSessionActivity(nextSession, nextSession.activeAppId, nowMs);
          const group = config.riskGroups.find((g) => g.id === nextSession?.groupId);
          if (group && isThresholdReached(nextSession, group)) {
            nextCooldown = startCooldown(
              nextSession.groupId,
              nowMs,
              group.cooldownMinutes
            );
            effects.push({
              type: 'START_COOLDOWN',
              groupId: nextSession.groupId,
              endsAt: nextCooldown.endsAt,
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
            nextSession = recordSessionActivity(nextSession, event.appId, event.timestamp);
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
        }

        // Check if group threshold is now exceeded
        if (group && isThresholdReached(nextSession, group)) {
          nextCooldown = startCooldown(
            targetGroupId,
            event.timestamp,
            group.cooldownMinutes
          );

          effects.push({
            type: 'START_COOLDOWN',
            groupId: targetGroupId,
            endsAt: nextCooldown.endsAt,
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
            // Record elapsed time on previously active risk app
            nextSession = recordSessionActivity(nextSession, undefined, event.timestamp);
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
        nextSession = recordSessionActivity(nextSession, undefined, event.timestamp);
      }
      break;
    }

    case 'COOLDOWN_STARTED': {
      nextCooldown = {
        groupId: event.groupId,
        startedAt: nowMs,
        endsAt: event.endsAt,
      };
      nextSession = undefined;
      break;
    }

    case 'COOLDOWN_ENDED': {
      if (nextCooldown && nextCooldown.groupId === event.groupId) {
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
        nextCooldown = undefined;
      }
      break;
    }

    case 'ROUTINE_STARTED':
    case 'ROUTINE_ENDED':
      break;
  }

  // Resolve active routine window IDs
  const activeRoutineWindowIds = getActiveRoutineWindowIds(nowDate, config.routineWindows);
  const activeRoutineWindows = config.routineWindows.filter((w) => isInsideWindow(nowDate, w));

  // Compute effective restrictions and diff against previous
  const previousRestrictedAppIds = currentRuntime.activeRestrictions.map((r) => r.appId);
  const { appRestrictions, effectiveAppIds } = computeEffectiveRestrictions(
    activeRoutineWindows,
    nextCooldown,
    config.riskGroups,
    config.apps
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

  // Resolve overall high-level state
  const nextState = resolveRhythmState(
    nowDate,
    config.routineWindows,
    nextCooldown,
    nextSession
  );

  const nextRuntime: RhythmRuntime = {
    state: nextState,
    activeSession: nextSession,
    activeCooldown: nextCooldown,
    activeRoutineWindowIds,
    activeRestrictions: appRestrictions,
  };

  return {
    nextRuntime,
    effects,
  };
}
