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
  reconcileAttentionExchangeForAttentionDay,
  consumeMeditationSubstitution,
  reconcileReadingGate,
} from './attentionExchange';
import {
  createRestorativeGateForOrdinal,
  deterministicGateId,
  evaluateRestorativeGate,
  isMeditationPathAllowed,
  migrateLegacyReadingGate,
  readingRequirementForKind,
  requirementKindForCooldownOrdinal,
  RESTORATIVE_POLICY,
  selectGateProvider,
  type ActiveRestorativeGate,
} from './restorativeGate';
import { resolveAttentionDay } from './attentionDay';
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

  // Pass 3: the Attention Day (Morning-Buffer boundary) is the reset boundary
  // for the restorative policy — never midnight.
  const attentionDay = resolveAttentionDay(nowMs, config.routineWindows);

  let nextSession = currentRuntime.activeSession ? { ...currentRuntime.activeSession } : undefined;
  const nextCooldowns: Record<string, ActiveCooldown> = { ...(currentRuntime.activeCooldowns || {}) };
  const nextAccessLeases: Record<string, AccessLease> = { ...(currentRuntime.activeAccessLeases || {}) };
  let nextDailyAttentionExchange = reconcileAttentionExchangeForAttentionDay(
    currentRuntime.dailyAttentionExchange ??
      migrateDailyAttentionExchange(currentRuntime.activeCooldowns ?? {}, nowMs, currentRuntime.activeReadingGates ?? {}),
    attentionDay.id,
    nowMs
  );
  const nextReadingGates: Record<string, ActiveReadingGate> = Object.fromEntries(
    Object.entries(currentRuntime.activeReadingGates ?? {})
      .filter(([, gate]) => gate.attentionDateKey === currentDateKey)
      .map(([groupId, gate]) => [groupId, { ...gate }])
  );
  const nextRestorativeGates: Record<string, ActiveRestorativeGate> = Object.fromEntries(
    Object.entries(currentRuntime.activeRestorativeGates ?? {})
      .map(([groupId, gate]) => [groupId, { ...gate }])
  );
  let nextReadingEvidence = currentRuntime.readingEvidence?.dateKey === currentDateKey
    ? { ...currentRuntime.readingEvidence }
    : undefined;
  let nextMeditationEvidence = currentRuntime.meditationEvidence
    ? { ...currentRuntime.meditationEvidence }
    : undefined;
  let nextReaderSessionEvidence = currentRuntime.readerSessionEvidence
    ? { ...currentRuntime.readerSessionEvidence }
    : undefined;
  let nextNativeAttentionAuthority = currentRuntime.nativeAttentionAuthority === true;
  let nextNativeForegroundGroupId = currentRuntime.nativeForegroundGroupId;
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
              nextReadingGates,
              nextRestorativeGates,
              attentionDay.id
            );
            const newCooldown = allocated.cooldown;
            nextDailyAttentionExchange = allocated.dailyAttentionExchange;
            replaceRecord(nextReadingGates, allocated.activeReadingGates);
            replaceRecord(nextRestorativeGates, allocated.activeRestorativeGates);
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
            nextReadingGates,
            nextRestorativeGates,
            attentionDay.id
          );
          const newCooldown = allocated.cooldown;
          nextDailyAttentionExchange = allocated.dailyAttentionExchange;
          replaceRecord(nextReadingGates, allocated.activeReadingGates);
          replaceRecord(nextRestorativeGates, allocated.activeRestorativeGates);
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
      if (event.replaceExisting) replaceRecord(nextGroupAllowanceUsage, event.groupAllowanceUsage);
      else Object.assign(nextGroupAllowanceUsage, event.groupAllowanceUsage);
      break;
    }

    case 'SYNC_DAILY_READING_EVIDENCE': {
      nextReadingEvidence = { ...event.evidence };
      break;
    }

    case 'SYNC_MEDITATION_EVIDENCE': {
      // Bound-session evidence from the Meditation status provider. Cached for
      // gate evaluation; the trust decision happens in evaluateRestorativeGate.
      nextMeditationEvidence = { ...event.evidence };
      break;
    }

    case 'SYNC_READER_SESSION_EVIDENCE': {
      nextReaderSessionEvidence = { ...event.evidence };
      break;
    }

    case 'SELECT_RESTORATIVE_PROVIDER': {
      // Selecting a provider binds an opaque provider session id to the gate
      // BEFORE the provider launches. Selection is refused once meaningful
      // progress locked the gate, or once the meditation cap is exhausted.
      const gate = nextRestorativeGates[event.groupId];
      if (!gate) break;
      const meditationAllowed = event.provider !== 'meditation' ||
        isMeditationPathAllowed(nextDailyAttentionExchange.meditationSubstitutionsUsed ?? 0);
      const selected = selectGateProvider(gate, event.provider, { meditationAllowed });
      if (selected !== gate && selected.selectedProvider === event.provider) {
        nextRestorativeGates[event.groupId] = {
          ...selected,
          providerSessionId: event.providerSessionId,
        };
      }
      break;
    }

    case 'SYNC_NATIVE_ATTENTION_EXCHANGE': {
      nextNativeAttentionAuthority = true;
      if (event.dailyAttentionExchange.dateKey === currentDateKey) {
        const priorSubstitutionsUsed =
          nextDailyAttentionExchange.attentionDayId === attentionDay.id
            ? nextDailyAttentionExchange.meditationSubstitutionsUsed ?? 0
            : 0;
        const incomingSubstitutionsUsed =
          event.dailyAttentionExchange.meditationSubstitutionsUsed;
        nextDailyAttentionExchange = {
          ...event.dailyAttentionExchange,
          attentionDayId: attentionDay.id,
          // Native currently owns cooldown ordinals, not the Meditation cap.
          // A stale/native snapshot must not reset JS's same-Attention-Day
          // substitution ledger after verified provider completion.
          meditationSubstitutionsUsed: Math.max(
            priorSubstitutionsUsed,
            Number.isInteger(incomingSubstitutionsUsed) && incomingSubstitutionsUsed! >= 0
              ? incomingSubstitutionsUsed!
              : 0
          ),
        };
      } else {
        nextDailyAttentionExchange = createDailyAttentionExchangeState(
          currentDateKey,
          nowMs,
          attentionDay.id
        );
      }
      replaceRecord(nextReadingGates, Object.fromEntries(
        Object.entries(event.activeReadingGates)
          .filter(([groupId, gate]) => groupId === gate.groupId && gate.attentionDateKey === currentDateKey)
          .map(([groupId, gate]) => [groupId, { ...gate }])
      ));
      replaceRecord(nextCooldowns, Object.fromEntries(
        Object.entries(event.activeCooldowns)
          .filter(([, cooldown]) => cooldown.endsAt > nowMs)
          .map(([groupId, cooldown]) => [groupId, { ...cooldown }])
      ));
      // Native-allocated cooldowns carry their ordinal + requirements from the
      // production allocation path (allowance exhaustion). Derive the matching
      // Restorative Gate here — the same derivation the JS allocation route
      // performs — so CD3/CD4 gates exist for production cooldowns observed
      // while JS was absent. Idempotent: deterministic gate ids keep repeated
      // re-imports from resetting gate progress or identities.
      {
        const nativeCycles: {
          groupId: string;
          ordinal: number;
          createdAt: number;
          cooldownEndsAt: number;
          requirementKind?: string;
          requiredReadingSeconds: number;
          requiredQualifiedPages: number;
        }[] = [];
        for (const cooldown of Object.values(event.activeCooldowns)) {
          if (
            cooldown.attentionDateKey === currentDateKey &&
            typeof cooldown.dailyCooldownOrdinal === 'number' &&
            cooldown.dailyCooldownOrdinal > 0
          ) {
            nativeCycles.push({
              groupId: cooldown.groupId,
              ordinal: cooldown.dailyCooldownOrdinal,
              createdAt: cooldown.startedAt ?? 0,
              cooldownEndsAt: cooldown.endsAt,
              requirementKind: cooldown.requirementKind,
              requiredReadingSeconds: cooldown.requiredReadingSeconds ?? 0,
              requiredQualifiedPages: cooldown.requiredQualifiedPages ?? 0,
            });
          }
        }
        for (const gate of Object.values(event.activeReadingGates)) {
          if (
            gate.attentionDateKey === currentDateKey &&
            Number.isInteger(gate.dailyCooldownOrdinal) &&
            gate.dailyCooldownOrdinal > 0 &&
            !nativeCycles.some((cycle) => cycle.groupId === gate.groupId)
          ) {
            nativeCycles.push({
              groupId: gate.groupId,
              ordinal: gate.dailyCooldownOrdinal,
              createdAt: gate.createdAt,
              cooldownEndsAt: gate.cooldownEndsAt,
              requiredReadingSeconds: gate.requiredReadingSeconds ?? 0,
              requiredQualifiedPages: gate.requiredQualifiedPages ?? 0,
            });
          }
        }
        for (const cycle of nativeCycles) {
          const existing = nextRestorativeGates[cycle.groupId];
          const kind = requirementKindForCooldownOrdinal(cycle.ordinal);
          const kindRequirement = readingRequirementForKind(kind);
          // A migrated v1.2 obligation carries historical numbers (e.g.
          // 5400/47 at ordinal 4) and must stay LEGACY_READING with those
          // exact numbers until it naturally completes. Only exact kind
          // matches are created canonically; CD4+ new allocations carry no
          // baseline numbers (0/0) and are created from the kind table.
          const hasStaleNumbers =
            (cycle.requiredReadingSeconds > 0 || cycle.requiredQualifiedPages > 0) &&
            (cycle.requiredReadingSeconds !== kindRequirement.activeSeconds ||
              cycle.requiredQualifiedPages !== kindRequirement.qualifiedPages);
          if (hasStaleNumbers || cycle.requirementKind === 'legacy-reading') {
            const legacyId = `legacy-gate-${cycle.groupId}`;
            if (existing && existing.gateId === legacyId) continue;
            nextRestorativeGates[cycle.groupId] = migrateLegacyReadingGate({
              groupId: cycle.groupId,
              attentionDateKey: currentDateKey,
              dailyCooldownOrdinal: cycle.ordinal,
              createdAt: cycle.createdAt,
              cooldownEndsAt: cycle.cooldownEndsAt,
              requiredReadingSeconds: cycle.requiredReadingSeconds,
              requiredQualifiedPages: cycle.requiredQualifiedPages,
              attentionDayId: attentionDay.id,
              gateId: legacyId,
            });
            continue;
          }
          const gateId = deterministicGateId({
            attentionDayId: attentionDay.id,
            groupId: cycle.groupId,
            dailyCooldownOrdinal: cycle.ordinal,
          });
          if (existing && existing.gateId === gateId) continue;
          const gate = createRestorativeGateForOrdinal({
            groupId: cycle.groupId,
            attentionDayId: attentionDay.id,
            dailyCooldownOrdinal: cycle.ordinal,
            createdAt: cycle.createdAt,
            cooldownEndsAt: cycle.cooldownEndsAt,
            gateId,
          });
          if (gate) {
            nextRestorativeGates[cycle.groupId] = gate;
          } else {
            delete nextRestorativeGates[cycle.groupId];
          }
        }
      }
      replaceRecord(nextAccessLeases, Object.fromEntries(
        Object.entries(event.activeAccessLeases)
          .filter(([, lease]) => lease.endsAt > nowMs)
          .map(([groupId, lease]) => [groupId, { ...lease }])
      ));
      replaceRecord(nextGroupAllowanceUsage, Object.fromEntries(
        Object.entries(event.groupAllowanceUsage).map(([groupId, usage]) => [groupId, { ...usage }])
      ));
      nextNativeForegroundGroupId = event.foregroundGroupId;
      if (event.readingEvidence?.dateKey === currentDateKey) {
        nextReadingEvidence = { ...event.readingEvidence };
      }
      break;
    }

    case 'NATIVE_ATTENTION_AUTHORITY_ENABLED': {
      nextNativeAttentionAuthority = true;
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
        nextReadingGates,
        nextRestorativeGates,
        attentionDay.id
      );
      nextCooldowns[event.groupId] = allocated.cooldown;
      nextDailyAttentionExchange = allocated.dailyAttentionExchange;
      replaceRecord(nextReadingGates, allocated.activeReadingGates);
      replaceRecord(nextRestorativeGates, allocated.activeRestorativeGates);
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
        } else if (event.legacy) {
          nextCooldowns[event.groupId] = {
            groupId: event.groupId,
            startedAt,
            endsAt,
          };
          nextDailyAttentionExchange = {
            ...nextDailyAttentionExchange,
            cooldownsTriggered: nextDailyAttentionExchange.cooldownsTriggered + 1,
            updatedAt: nowMs,
          };
        } else {
          // A newly observed native cooldown can be allocated once. Native-only cycles
          // that elapsed while JS was absent cannot be reconstructed in Pass 02.
          const allocated = allocateAttentionCooldown(
            event.groupId,
            startedAt,
            endsAt,
            nextDailyAttentionExchange,
            nextReadingGates,
            nextRestorativeGates,
            attentionDay.id,
            nowMs
          );
          nextCooldowns[event.groupId] = allocated.cooldown;
          nextDailyAttentionExchange = allocated.dailyAttentionExchange;
          replaceRecord(nextReadingGates, allocated.activeReadingGates);
          replaceRecord(nextRestorativeGates, allocated.activeRestorativeGates);
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
      delete nextRestorativeGates[event.groupId];
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
  const nativeGatesMustRemain = nextNativeAttentionAuthority ||
    (event.type === 'SYNC_DAILY_READING_EVIDENCE' && event.preserveNativeGates === true);
  if (!nativeGatesMustRemain) {
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
  }

  // Restorative completion is reconciled from bound provider evidence even
  // when native owns cooldown allocation. Native authority must not suppress
  // a verified Reader/Meditation completion; the completed gate and its
  // one-time Meditation substitution are projected back to native below.
  for (const [groupId, gate] of Object.entries(nextRestorativeGates)) {
    const evaluation = evaluateRestorativeGate({
      gate,
      now: nowMs,
      attentionDayId: attentionDay.id,
      currentDateKey,
      acceptedEvidenceDateKeys: [currentDateKey, getLocalDateKey(gate.createdAt)],
      readerDailyEvidence: nextReadingEvidence,
      readerSessionEvidence: nextReaderSessionEvidence,
      meditationEvidence: nextMeditationEvidence,
      meditationSubstitutionsUsed: nextDailyAttentionExchange.meditationSubstitutionsUsed ?? 0,
    });
    if (!evaluation.gate) {
      delete nextRestorativeGates[groupId];
      continue;
    }
    nextRestorativeGates[groupId] = evaluation.gate;
    if (evaluation.substitutionConsumed) {
      nextDailyAttentionExchange = consumeMeditationSubstitution(
        nextDailyAttentionExchange,
        nowMs
      );
    }
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
      activeReadingGates: nextReadingGates,
      currentDateKey,
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
    activeRestorativeGates: nextRestorativeGates,
    ...(nextReadingEvidence ? { readingEvidence: nextReadingEvidence } : {}),
    ...(nextMeditationEvidence ? { meditationEvidence: nextMeditationEvidence } : {}),
    ...(nextReaderSessionEvidence ? { readerSessionEvidence: nextReaderSessionEvidence } : {}),
    ...(currentRuntime.morningMeditation ? { morningMeditation: currentRuntime.morningMeditation } : {}),
    nativeAttentionAuthority: nextNativeAttentionAuthority,
    nativeForegroundGroupId: nextNativeForegroundGroupId,
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
  currentRestorativeGates: Record<string, ActiveRestorativeGate> = {},
  attentionDayId?: string,
  allocationAt: number = startedAt
): {
  cooldown: ActiveCooldown;
  dailyAttentionExchange: NonNullable<RhythmRuntime['dailyAttentionExchange']>;
  activeReadingGates: Record<string, ActiveReadingGate>;
  activeRestorativeGates: Record<string, ActiveRestorativeGate>;
} {
  const state = currentState ?? createDailyAttentionExchangeState(getLocalDateKey(allocationAt), allocationAt);
  const allocation = allocateCooldownRequirement(state, allocationAt);
  const resolvedAttentionDayId =
    attentionDayId ?? allocation.nextState.attentionDayId ?? `ad-${allocation.nextState.dateKey}`;
  const requirementKind = requirementKindForCooldownOrdinal(allocation.ordinal);
  const cooldown: ActiveCooldown = {
    groupId,
    startedAt,
    endsAt,
    dailyCooldownOrdinal: allocation.ordinal,
    attentionDateKey: allocation.nextState.dateKey,
    requirementKind,
    requiredReadingSeconds: allocation.requirement.activeSeconds,
    requiredQualifiedPages: allocation.requirement.qualifiedPages,
    ...(requirementKind === 'restorative-choice'
      ? {
          restorativeReadingSeconds: RESTORATIVE_POLICY.restorativeChoiceReadingSeconds,
          restorativeReadingPages: RESTORATIVE_POLICY.restorativeChoiceQualifiedPages,
          requiredMeditationSeconds: RESTORATIVE_POLICY.restorativeChoiceMeditationSeconds,
        }
      : {}),
  };

  // Reader v1.2 compatibility view (quota screens / Reader preview keep working).
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

  // Pass 3: one Restorative Gate per cooldown instance (deterministic id).
  const activeRestorativeGates = { ...currentRestorativeGates };
  delete activeRestorativeGates[groupId];
  const gate = createRestorativeGateForOrdinal({
    groupId,
    attentionDayId: resolvedAttentionDayId,
    dailyCooldownOrdinal: allocation.ordinal,
    createdAt: startedAt,
    cooldownEndsAt: endsAt,
  });
  if (gate) {
    activeRestorativeGates[groupId] = gate;
  }

  return {
    cooldown,
    dailyAttentionExchange: { ...allocation.nextState, attentionDayId: resolvedAttentionDayId },
    activeReadingGates,
    activeRestorativeGates,
  };
}

function replaceRecord<T>(target: Record<string, T>, source: Record<string, T>): void {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, source);
}
