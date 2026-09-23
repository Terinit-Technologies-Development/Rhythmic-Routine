import {
  AccessLease,
  ActiveCooldown,
  DailyAppUsage,
  EMERGENCY_ACCESS_MINUTES,
  GroupAllowanceUsage,
  RhythmConfiguration,
  RhythmEffect,
  RhythmEvent,
  RhythmRuntime,
  SESSION_RESET_GAP_MS,
} from './types';
import {
  getActiveRoutineWindowIds,
  isInsideOvernightProtection,
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
  ActiveReadingGate,
  allocateCooldownRequirement,
  createDailyAttentionExchangeState,
  migrateDailyAttentionExchange,
  reconcileAttentionExchangeDate,
  reconcileReadingGate,
} from './attentionExchange';
import {
  computeEffectiveRestrictions,
  diffRestrictions,
} from './restrictions';
import {
  getLocalDateKey,
  isGroupAllowanceExhausted,
  rolloverDailyAppUsage,
  rolloverGroupAllowanceUsage,
} from './allowance';

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
  const currentDateKey = getLocalDateKey(nowMs);

  let nextSession = currentRuntime.activeSession ? { ...currentRuntime.activeSession } : undefined;
  const nextCooldowns: Record<string, ActiveCooldown> = { ...(currentRuntime.activeCooldowns || {}) };
  const nextAccessLeases: Record<string, AccessLease> = { ...(currentRuntime.activeAccessLeases || {}) };
  let nextDailyAttentionExchange = reconcileAttentionExchangeDate(
    currentRuntime.dailyAttentionExchange ??
      migrateDailyAttentionExchange(currentRuntime.activeCooldowns ?? {}, nowMs, currentRuntime.activeReadingGates ?? {}),
    nowMs
  );
  const nextReadingGates: Record<string, ActiveReadingGate> = Object.fromEntries(
    Object.entries(currentRuntime.activeReadingGates ?? {})
      .filter(([, gate]) => gate.attentionDateKey === currentDateKey)
      .map(([groupId, gate]) => [groupId, { ...gate }])
  );
  let nextReadingEvidence = currentRuntime.readingEvidence?.dateKey === currentDateKey
    ? { ...currentRuntime.readingEvidence }
    : undefined;
  const nextDailyAppUsage: Record<string, DailyAppUsage> = rolloverDailyAppUsage(
    currentRuntime.dailyAppUsage || {},
    nowMs
  );
  const nextGroupAllowanceUsage: Record<string, GroupAllowanceUsage> = rolloverGroupAllowanceUsage(
    currentRuntime.groupAllowanceUsage || {},
    nowMs
  );
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

  // 2. Check expired access leases (multi-group support)
  for (const [groupId, lease] of Object.entries(nextAccessLeases)) {
    if (lease.endsAt <= nowMs) {
      delete nextAccessLeases[groupId];
      effects.push({
        type: 'END_ACCESS_LEASE',
        groupId,
      });
      effects.push({
        type: 'RECORD_HISTORY',
        event: {
          type: 'access-lease-ended',
          groupId,
          timestamp: nowMs,
        },
      });
    }
  }

  // 3. Process specific event
  switch (event.type) {
    case 'CLOCK_TICK':
    case 'RECONCILE': {
      if (nextSession) {
        if (nextSession.activeAppId) {
          // App actively foregrounded; accumulate time
          nextSession = recordActiveUsage(nextSession, nextSession.activeAppId, nowMs);
          const group = config.riskGroups.find((g) => g.id === nextSession?.groupId);
          if (group && isThresholdReached(nextSession, group)) {
            const timerCooldown = startCooldown(
              nextSession.groupId,
              nowMs,
              group.cooldownMinutes
            );
            const allocated = allocateAttentionCooldown(
              nextSession.groupId,
              nowMs,
              timerCooldown.endsAt,
              nextDailyAttentionExchange,
              nextReadingGates
            );
            const newCooldown = allocated.cooldown;
            nextDailyAttentionExchange = allocated.dailyAttentionExchange;
            replaceRecord(nextReadingGates, allocated.activeReadingGates);
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
      // Finalize active segment for any previously foregrounded app
      for (const [id, usage] of Object.entries(nextDailyAppUsage)) {
        if (id !== event.appId && usage.activeSegmentStartedAt) {
          const elapsed = Math.max(0, Math.floor((event.timestamp - usage.activeSegmentStartedAt) / 1000));
          nextDailyAppUsage[id] = {
            ...usage,
            usedSeconds: usage.usedSeconds + elapsed,
            activeSegmentStartedAt: undefined,
          };
        }
      }

      // If foregrounded app is a Risk app, start its active segment for today if not already active
      const targetApp = config.apps.find((a) => a.id === event.appId);
      if (targetApp && targetApp.classification === 'risk') {
        const currentUsage = nextDailyAppUsage[event.appId] || {
          appId: event.appId,
          dateKey: getLocalDateKey(event.timestamp),
          usedSeconds: 0,
        };
        if (!currentUsage.activeSegmentStartedAt) {
          nextDailyAppUsage[event.appId] = {
            ...currentUsage,
            activeSegmentStartedAt: event.timestamp,
          };
        }
      }

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
          const timerCooldown = startCooldown(
            targetGroupId,
            event.timestamp,
            group.cooldownMinutes
          );
          const allocated = allocateAttentionCooldown(
            targetGroupId,
            event.timestamp,
            timerCooldown.endsAt,
            nextDailyAttentionExchange,
            nextReadingGates
          );
          const newCooldown = allocated.cooldown;
          nextDailyAttentionExchange = allocated.dailyAttentionExchange;
          replaceRecord(nextReadingGates, allocated.activeReadingGates);
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
      const usage = nextDailyAppUsage[event.appId];
      if (usage && usage.activeSegmentStartedAt) {
        const elapsed = Math.max(0, Math.floor((event.timestamp - usage.activeSegmentStartedAt) / 1000));
        nextDailyAppUsage[event.appId] = {
          ...usage,
          usedSeconds: usage.usedSeconds + elapsed,
          activeSegmentStartedAt: undefined,
        };
      }

      if (nextSession && nextSession.activeAppId === event.appId) {
        nextSession = recordActiveUsage(nextSession, undefined, event.timestamp);
      }
      break;
    }

    case 'SYNC_DAILY_APP_USAGE': {
      Object.assign(nextDailyAppUsage, event.dailyAppUsage);
      break;
    }

    case 'SYNC_GROUP_ALLOWANCE_USAGE': {
      Object.assign(nextGroupAllowanceUsage, event.groupAllowanceUsage);
      break;
    }

    case 'SYNC_DAILY_READING_EVIDENCE': {
      nextReadingEvidence = { ...event.evidence };
      break;
    }

    case 'UPDATE_DAILY_ALLOWANCE':
    case 'UPDATE_GROUP_ALLOWANCE':
    case 'UPDATE_GROUP_RECOVERY_ACTIVITY':
      // Configuration-owned (coordinator updateConfig path); no direct runtime
      // mutation beyond clock reconciliation performed above.
      break;

    case 'COOLDOWN_STARTED': {
      const allocated = allocateAttentionCooldown(
        event.groupId,
        nowMs,
        event.endsAt,
        nextDailyAttentionExchange,
        nextReadingGates
      );
      nextCooldowns[event.groupId] = allocated.cooldown;
      nextDailyAttentionExchange = allocated.dailyAttentionExchange;
      replaceRecord(nextReadingGates, allocated.activeReadingGates);
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

    case 'START_ACCESS_LEASE': {
      const durationMinutes = event.durationMinutes ?? EMERGENCY_ACCESS_MINUTES;
      const endsAt = nowMs + durationMinutes * 60 * 1000;
      const lease: AccessLease = {
        id: `lease-${event.groupId}-${nowMs}`,
        groupId: event.groupId,
        startedAt: nowMs,
        endsAt,
        reason: event.reason ?? 'emergency',
      };
      nextAccessLeases[event.groupId] = lease;

      effects.push({
        type: 'START_ACCESS_LEASE',
        groupId: event.groupId,
        endsAt,
      });
      effects.push({
        type: 'RECORD_HISTORY',
        event: {
          type: 'access-lease-started',
          groupId: event.groupId,
          reason: lease.reason,
          timestamp: nowMs,
        },
      });
      break;
    }

    case 'END_ACCESS_LEASE': {
      if (nextAccessLeases[event.groupId]) {
        delete nextAccessLeases[event.groupId];
        effects.push({
          type: 'END_ACCESS_LEASE',
          groupId: event.groupId,
        });
        effects.push({
          type: 'RECORD_HISTORY',
          event: {
            type: 'access-lease-ended',
            groupId: event.groupId,
            timestamp: event.timestamp,
          },
        });
      }
      break;
    }

    case 'NATIVE_COOLDOWN_RESTORED': {
      if (event.endsAt > nowMs) {
        const existing = nextCooldowns[event.groupId];
        const configuredMinutes =
          config.riskGroups.find((g) => g.id === event.groupId)?.cooldownMinutes ?? 60;
        const startedAt = existing?.startedAt ?? Math.max(nowMs, event.endsAt - configuredMinutes * 60_000);
        const endsAt = Math.max(existing?.endsAt ?? 0, event.endsAt);
        if (existing) {
          // Repeated snapshots for one native cooldown are idempotent. In particular,
          // do not allocate a second daily ordinal for a cooldown already in runtime.
          nextCooldowns[event.groupId] = { ...existing, startedAt, endsAt };
          const gate = nextReadingGates[event.groupId];
          if (gate && gate.dailyCooldownOrdinal === existing.dailyCooldownOrdinal) {
            nextReadingGates[event.groupId] = { ...gate, cooldownEndsAt: endsAt };
          }
        } else {
          // A newly observed native cooldown can be allocated once. Native-only cycles
          // that elapsed while JS was absent cannot be reconstructed in Pass 02.
          const allocated = allocateAttentionCooldown(
            event.groupId,
            startedAt,
            endsAt,
            nextDailyAttentionExchange,
            nextReadingGates,
            nowMs
          );
          nextCooldowns[event.groupId] = allocated.cooldown;
          nextDailyAttentionExchange = allocated.dailyAttentionExchange;
          replaceRecord(nextReadingGates, allocated.activeReadingGates);
        }
      }
      break;
    }

    case 'NATIVE_ACCESS_LEASE_RESTORED': {
      if (event.endsAt > nowMs) {
        const existing = nextAccessLeases[event.groupId];
        nextAccessLeases[event.groupId] = {
          id: existing?.id ?? `native-lease-${event.groupId}-${event.endsAt}`,
          groupId: event.groupId,
          startedAt: existing?.startedAt ?? nowMs,
          endsAt: Math.max(existing?.endsAt ?? 0, event.endsAt),
          reason: existing?.reason ?? 'emergency',
        };
      }
      break;
    }

    case 'ROUTINE_STARTED':
    case 'ROUTINE_ENDED':
      break;

    case 'RISK_GROUP_DELETED': {
      delete nextReadingGates[event.groupId];
      if (nextCooldowns[event.groupId]) {
        delete nextCooldowns[event.groupId];
        effects.push({
          type: 'END_COOLDOWN',
          groupId: event.groupId,
        });
      }
      if (nextAccessLeases[event.groupId]) {
        delete nextAccessLeases[event.groupId];
        effects.push({
          type: 'END_ACCESS_LEASE',
          groupId: event.groupId,
        });
      }
      delete nextGroupAllowanceUsage[event.groupId];

      if (nextSession?.groupId === event.groupId) {
        nextSession = undefined;
      }

      break;
    }
  }

  // A completed requirement remains represented during its timer, then disappears
  // only after both the timer and verified daily evidence satisfy the gate.
  for (const [groupId, gate] of Object.entries(nextReadingGates)) {
    const reconciledGate = reconcileReadingGate({
      gate,
      evidence: nextReadingEvidence,
      now: nowMs,
      currentDateKey,
    });
    if (reconciledGate) nextReadingGates[groupId] = reconciledGate;
    else delete nextReadingGates[groupId];
  }

  // 4. Resolve active routine windows
  const activeRoutineWindowIds = getActiveRoutineWindowIds(nowDate, config.routineWindows);
  const activeRoutineWindows = config.routineWindows.filter((w) => isInsideWindow(nowDate, w));

  // Record observed routine transitions
  const prevWindowIds = new Set(currentRuntime.activeRoutineWindowIds || []);
  const nextWindowIds = new Set(activeRoutineWindowIds);
  for (const winId of nextWindowIds) {
    if (!prevWindowIds.has(winId)) {
      effects.push({
        type: 'RECORD_HISTORY',
        event: { type: 'routine-started', windowId: winId, timestamp: nowMs },
      });
    }
  }
  for (const winId of prevWindowIds) {
    if (!nextWindowIds.has(winId)) {
      effects.push({
        type: 'RECORD_HISTORY',
        event: { type: 'routine-ended', windowId: winId, timestamp: nowMs },
      });
    }
  }

  const isOvernight = isInsideOvernightProtection(nowDate, config.routineWindows);
  const wasOvernight = currentRuntime.state === 'overnight-protected';

  // Record observed effective group-protection transitions using state-before vs state-after
  // NOTE (Pass 03 Insights): Daily allowance exhaustion is tracked per-app via 'daily-allowance-exhausted'.
  // Group protection events ('group-protection-started'/'ended') capture routine windows, cooldowns,
  // and overnight protection gaps. Pass 03 Insights aggregation must combine group protection
  // intervals with per-app daily allowance exhaustion history.
  const computeProtectedGroupsFromRuntimeState = (
    windowIds: string[],
    cooldowns: Record<string, ActiveCooldown>,
    leases: Record<string, AccessLease>,
    isOvernightGap: boolean
  ): Set<string> => {
    const result = new Set<string>();
    for (const winId of windowIds) {
      const win = config.routineWindows.find((w) => w.id === winId);
      if (win && win.enabled) {
        for (const gid of win.protectedGroupIds) result.add(gid);
      }
    }
    for (const cd of Object.values(cooldowns)) {
      result.add(cd.groupId);
    }
    if (isOvernightGap) {
      for (const group of config.riskGroups) {
        const hasRiskApp = group.appIds.some((id) => {
          const app = config.apps.find((a) => a.id === id);
          return app && app.classification === 'risk';
        });
        if (hasRiskApp) {
          result.add(group.id);
        }
      }
    }
    for (const lease of Object.values(leases)) {
      result.delete(lease.groupId);
    }
    return result;
  };

  const prevProtected = computeProtectedGroupsFromRuntimeState(
    currentRuntime.activeRoutineWindowIds || [],
    currentRuntime.activeCooldowns || {},
    currentRuntime.activeAccessLeases || {},
    wasOvernight
  );
  const nextProtected = computeProtectedGroupsFromRuntimeState(
    activeRoutineWindowIds,
    nextCooldowns,
    nextAccessLeases,
    isOvernight
  );

  for (const gid of nextProtected) {
    if (!prevProtected.has(gid)) {
      effects.push({
        type: 'RECORD_HISTORY',
        event: { type: 'group-protection-started', groupId: gid, timestamp: nowMs },
      });
    }
  }

  for (const gid of prevProtected) {
    if (!nextProtected.has(gid)) {
      effects.push({
        type: 'RECORD_HISTORY',
        event: { type: 'group-protection-ended', groupId: gid, timestamp: nowMs },
      });
    }
  }

  // Check and record newly exhausted group allowances (v1.0.2 authoritative path)
  for (const group of config.riskGroups) {
    const usage = nextGroupAllowanceUsage[group.id];
    if (usage && isGroupAllowanceExhausted(group, usage, nowMs)) {
      if (!usage.exhaustedAt) {
        usage.exhaustedAt = nowMs;
        effects.push({
          type: 'RECORD_HISTORY',
          event: {
            type: 'group-allowance-exhausted',
            groupId: group.id,
            timestamp: nowMs,
          },
        });
      }
    }
  }

  // v1.0.2: per-app usage remains raw observation only (rollover/segments/
  // sync above). It is never interpreted as an app allowance/exhaustion and
  // never emits per-app allowance-exhausted history: individual apps own no
  // allowance. Only the shared group ledger above produces exhaustion history.

  // 5. Compute desired effective restrictions and diff against previous
  const previousRestrictedAppIds = currentRuntime.activeRestrictions.map((r) => r.appId);
  const { appRestrictions, effectiveAppIds } = computeEffectiveRestrictions(
    activeRoutineWindows,
    nextCooldowns,
    config.riskGroups,
    config.apps,
    nowMs,
    nextAccessLeases,
    {
      isOvernight,
      groupAllowanceUsage: nextGroupAllowanceUsage,
    }
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

  // 6. Resolve high-level state
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
    activeAccessLeases: nextAccessLeases,
    activeRoutineWindowIds,
    activeRestrictions: appRestrictions,
    dailyAppUsage: nextDailyAppUsage,
    groupAllowanceUsage: nextGroupAllowanceUsage,
    dailyAttentionExchange: nextDailyAttentionExchange,
    activeReadingGates: nextReadingGates,
    ...(nextReadingEvidence ? { readingEvidence: nextReadingEvidence } : {}),
  };

  return {
    nextRuntime,
    effects,
  };
}

/** The single allocation path used by both JS cooldown creation routes and native imports. */
function allocateAttentionCooldown(
  groupId: string,
  startedAt: number,
  endsAt: number,
  currentState: RhythmRuntime['dailyAttentionExchange'],
  currentGates: Record<string, ActiveReadingGate>,
  allocationAt: number = startedAt
): {
  cooldown: ActiveCooldown;
  dailyAttentionExchange: NonNullable<RhythmRuntime['dailyAttentionExchange']>;
  activeReadingGates: Record<string, ActiveReadingGate>;
} {
  const state = currentState ?? createDailyAttentionExchangeState(getLocalDateKey(allocationAt), allocationAt);
  const allocation = allocateCooldownRequirement(state, allocationAt);
  const cooldown: ActiveCooldown = {
    groupId,
    startedAt,
    endsAt,
    dailyCooldownOrdinal: allocation.ordinal,
    attentionDateKey: allocation.nextState.dateKey,
    requiredReadingSeconds: allocation.requirement.activeSeconds,
    requiredQualifiedPages: allocation.requirement.qualifiedPages,
  };
  const activeReadingGates = { ...currentGates };
  delete activeReadingGates[groupId];
  if (allocation.requirement.activeSeconds > 0 || allocation.requirement.qualifiedPages > 0) {
    activeReadingGates[groupId] = {
      groupId,
      attentionDateKey: allocation.nextState.dateKey,
      dailyCooldownOrdinal: allocation.ordinal,
      createdAt: startedAt,
      cooldownEndsAt: endsAt,
      requiredReadingSeconds: allocation.requirement.activeSeconds,
      requiredQualifiedPages: allocation.requirement.qualifiedPages,
    };
  }
  return {
    cooldown,
    dailyAttentionExchange: allocation.nextState,
    activeReadingGates,
  };
}

function replaceRecord<T>(target: Record<string, T>, source: Record<string, T>): void {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, source);
}
