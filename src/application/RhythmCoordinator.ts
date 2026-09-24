import { getPlatformServices } from '../platform/PlatformServices';
import { RhythmEngine } from '../domain/rhythm/RhythmEngine';
import {
  EngineStatus,
  RhythmConfiguration,
  RhythmEffect,
  RhythmEvent,
  RhythmRuntime,
} from '../domain/rhythm/types';
import type { NativeAttentionExchangeSnapshot } from '../../modules/rhythm-device/src/RhythmDevice.types';
import { isValidLocalDateKey } from '../domain/rhythm/attentionExchange';
import { bootstrapRhythm } from './bootstrapRhythm';
import { reconcileRhythm } from './reconcileRhythm';
import { DeviceApp, RiskGroup } from '../types/domain';
import { reconcileRiskGroupMembership } from '../domain/rhythm/membershipReconciliation';
import {
  DailyReadingEvidenceClient,
  NativeDailyReadingEvidenceClient,
} from '../domain/rhythm/readingEvidence';
import {
  GroupAllowanceEditResult,
  getLocalDateKey,
  resolveGroupAllowanceMinutes,
  resolveGroupRecoveryActivityId,
  validateGroupAllowanceEdit,
} from '../domain/rhythm/allowance';

type RuntimeListener = (runtime: RhythmRuntime) => void;

const ENGINE_RECONCILE_INTERVAL_MS = 60_000;

function getPlatformOS(): string {
  if (typeof process !== 'undefined' && process.env?.RHYTHM_PLATFORM_OVERRIDE) {
    return process.env.RHYTHM_PLATFORM_OVERRIDE;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('react-native')?.Platform?.OS ?? 'web';
  } catch {
    return 'web';
  }
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function createNativeAttentionImportEvent(
  snapshot: NativeAttentionExchangeSnapshot,
  now: number
): RhythmEvent | undefined {
  const today = getLocalDateKey(now);
  if (
    !snapshot ||
    snapshot.dateKey !== today ||
    !isValidLocalDateKey(snapshot.dateKey) ||
    !Number.isInteger(snapshot.cooldownsTriggered) || snapshot.cooldownsTriggered < 0 ||
    !isFiniteNonNegative(snapshot.highestRequiredActiveSeconds) ||
    !Number.isInteger(snapshot.highestRequiredQualifiedPages) || snapshot.highestRequiredQualifiedPages < 0
  ) return undefined;

  const activeReadingGates = Object.fromEntries(
    (Array.isArray(snapshot.readingGates) ? snapshot.readingGates : [])
      .filter((gate) =>
        gate && typeof gate.groupId === 'string' && gate.groupId.length > 0 &&
        gate.attentionDateKey === today && Number.isInteger(gate.dailyCooldownOrdinal) && gate.dailyCooldownOrdinal > 0 &&
        isFiniteNonNegative(gate.createdAt) && isFiniteNonNegative(gate.cooldownEndsAt) &&
        isFiniteNonNegative(gate.requiredReadingSeconds) && Number.isInteger(gate.requiredQualifiedPages) && gate.requiredQualifiedPages >= 0
      )
      .map((gate) => [gate.groupId, { ...gate }])
  );
  const activeCooldowns = Object.fromEntries(
    (Array.isArray(snapshot.cooldowns) ? snapshot.cooldowns : [])
      .filter((cooldown) =>
        cooldown && typeof cooldown.groupId === 'string' && cooldown.groupId.length > 0 &&
        isFiniteNonNegative(cooldown.endsAt) && cooldown.endsAt > now &&
        (cooldown.startedAt === undefined || isFiniteNonNegative(cooldown.startedAt))
      )
      .map((cooldown) => [cooldown.groupId, {
        groupId: cooldown.groupId,
        startedAt: cooldown.startedAt ?? 0,
        endsAt: cooldown.endsAt,
        ...(cooldown.attentionDateKey ? { attentionDateKey: cooldown.attentionDateKey } : {}),
        ...(cooldown.dailyCooldownOrdinal !== undefined ? { dailyCooldownOrdinal: cooldown.dailyCooldownOrdinal } : {}),
        requiredReadingSeconds: cooldown.requiredReadingSeconds ?? 0,
        requiredQualifiedPages: cooldown.requiredQualifiedPages ?? 0,
      }])
  );
  const activeAccessLeases = Object.fromEntries(
    (Array.isArray(snapshot.activeAccessLeases) ? snapshot.activeAccessLeases : [])
      .filter((lease) => lease && typeof lease.groupId === 'string' && isFiniteNonNegative(lease.endsAt) && lease.endsAt > now)
      .map((lease) => [lease.groupId, {
        id: `native-lease-${lease.groupId}-${lease.endsAt}`,
        groupId: lease.groupId,
        startedAt: now,
        endsAt: lease.endsAt,
        reason: 'emergency' as const,
      }])
  );

  const groupAllowanceUsage = Object.fromEntries(
    (Array.isArray(snapshot.groupUsage) ? snapshot.groupUsage : [])
      .filter((usage) =>
        usage && typeof usage.groupId === 'string' && usage.dateKey === today &&
        isFiniteNonNegative(usage.usedSeconds) && Number.isFinite(usage.cycleRevision)
      )
      .map((usage) => [usage.groupId, {
        groupId: usage.groupId,
        dateKey: usage.dateKey,
        usedSeconds: Math.floor(usage.usedSeconds),
        ...(usage.activePackageName ? { activePackageName: usage.activePackageName } : {}),
        ...(isFiniteNonNegative(usage.activeSegmentStartedAt) ? { activeSegmentStartedAt: usage.activeSegmentStartedAt } : {}),
        ...(isFiniteNonNegative(usage.exhaustedAt) ? { exhaustedAt: usage.exhaustedAt } : usage.exhausted ? { exhaustedAt: now } : {}),
        cycleRevision: Math.max(0, Math.floor(usage.cycleRevision)),
      }])
  );

  const readingEvidence = snapshot.evidence && snapshot.evidence.dateKey === today &&
    typeof snapshot.evidence.providerAvailable === 'boolean' &&
    typeof snapshot.evidence.protocolCompatible === 'boolean' &&
    isFiniteNonNegative(snapshot.evidence.verifiedActiveSeconds) &&
    Number.isInteger(snapshot.evidence.qualifiedPages) && snapshot.evidence.qualifiedPages >= 0 &&
    isFiniteNonNegative(snapshot.evidence.updatedAtEpochMs)
    ? {
        dateKey: today,
        providerAvailable: snapshot.evidence.providerAvailable,
        protocolCompatible: snapshot.evidence.protocolCompatible,
        verifiedActiveSeconds: snapshot.evidence.verifiedActiveSeconds,
        qualifiedPages: snapshot.evidence.qualifiedPages,
        readerUpdatedAtEpochMs: snapshot.evidence.updatedAtEpochMs,
        syncedAtEpochMs: now,
      }
    : undefined;

  return {
    type: 'SYNC_NATIVE_ATTENTION_EXCHANGE',
    dailyAttentionExchange: {
      dateKey: today,
      cooldownsTriggered: snapshot.cooldownsTriggered,
      highestRequiredActiveSeconds: Math.floor(snapshot.highestRequiredActiveSeconds),
      highestRequiredQualifiedPages: snapshot.highestRequiredQualifiedPages,
      updatedAt: isFiniteNonNegative(snapshot.updatedAt) ? snapshot.updatedAt : now,
    },
    activeReadingGates,
    activeCooldowns,
    activeAccessLeases,
    groupAllowanceUsage,
    ...(typeof snapshot.foregroundGroupId === 'string' ? { foregroundGroupId: snapshot.foregroundGroupId } : {}),
    ...(readingEvidence ? { readingEvidence } : {}),
    timestamp: now,
  };
}

export class RhythmCoordinator {
  private static instance: RhythmCoordinator | null = null;
  private engine: RhythmEngine | null = null;
  private config: RhythmConfiguration | null = null;
  private status: EngineStatus = { health: 'ready', issues: [] };
  private listeners: Set<RuntimeListener> = new Set();
  private unsubscribeActivity?: () => void;
  private reconcileTimer?: ReturnType<typeof setInterval>;
  private isInitialized = false;
  private evidenceRefreshPromise?: Promise<void>;
  private readonly dailyReadingEvidenceClient: DailyReadingEvidenceClient;

  constructor(dailyReadingEvidenceClient: DailyReadingEvidenceClient = new NativeDailyReadingEvidenceClient()) {
    this.dailyReadingEvidenceClient = dailyReadingEvidenceClient;
  }

  public static getInstance(): RhythmCoordinator {
    if (!RhythmCoordinator.instance) {
      RhythmCoordinator.instance = new RhythmCoordinator();
    }
    return RhythmCoordinator.instance;
  }

  /**
   * Initializes the coordinator and bootstraps the Rhythm Engine.
   */
  public async initialize(): Promise<RhythmRuntime> {
    if (this.isInitialized && this.engine) {
      return this.engine.getRuntime();
    }

    const { engine, config, status } = await bootstrapRhythm({
      deferRestrictionEffects: true,
    });
    this.engine = engine;
    this.config = config;
    this.status = status;
    this.isInitialized = true;

    const now = Date.now();

    // CRITICAL: Native import occurs before first outward native state write.
    await this.reconcilePlatformActivation(now, {
      importNativeState: true,
      finalSync: true,
    });

    // Subscribe to platform usage activity events
    const { usage } = getPlatformServices();
    if (usage.onActivityEvent) {
      this.unsubscribeActivity = usage.onActivityEvent((event) => {
        this.dispatch(
          event.state === 'foreground'
            ? {
                type: 'APP_FOREGROUND',
                appId: event.appId,
                timestamp: event.timestamp,
              }
            : {
                type: 'APP_BACKGROUND',
                appId: event.appId,
                timestamp: event.timestamp,
              }
        ).catch(() => {});
      });
    }

    // Start bounded domain clock reconciliation for continuous foreground progress
    this.startReconciliationClock();

    this.notifyListeners();
    return this.engine.getRuntime();
  }

  /**
   * Centralized executor for engine effects.
   */
  private async executeEffects(effects: RhythmEffect[]): Promise<void> {
    const { restrictions, storage } = getPlatformServices();

    for (const effect of effects) {
      switch (effect.type) {
        case 'APPLY_RESTRICTIONS':
          await restrictions.applyRestrictions(effect.appIds);
          break;
        case 'CLEAR_RESTRICTIONS':
          await restrictions.clearRestrictions(effect.appIds);
          break;
        case 'START_ACCESS_LEASE': {
          const group = this.config?.riskGroups.find((item) => item.id === effect.groupId);
          if (group && restrictions.startAccessLease) {
            await restrictions.startAccessLease({
              groupId: effect.groupId,
              appIds: group.appIds,
              startsAt: Date.now(),
              endsAt: effect.endsAt,
            });
          }
          break;
        }
        case 'END_ACCESS_LEASE':
          await restrictions.endAccessLease?.(effect.groupId);
          break;
        case 'RECORD_HISTORY':
          await storage.appendHistoryEvent(effect.event);
          break;
      }
    }
  }

  /**
   * Synchronizes authoritative engine state to platform native layer.
   */
  private async syncNativeState(): Promise<void> {
    if (!this.engine || !this.config) return;
    try {
      await getPlatformServices().nativeRhythm.sync(
        this.engine.getRuntime(),
        this.config
      );
    } catch {
      // Platform sync boundary
    }
  }

  /**
   * Dispatches an event into the engine and executes resulting effects.
   */
  public async dispatch(event: RhythmEvent): Promise<RhythmRuntime> {
    if (!this.engine || !this.config) {
      await this.initialize();
    }
    if (!this.engine || !this.config) {
      throw new Error('Rhythm Engine failed to initialize');
    }

    const { storage } = getPlatformServices();
    const effects = this.engine.dispatch(event);

    await this.executeEffects(effects);

    // Persist runtime state
    const now = 'timestamp' in event ? event.timestamp : Date.now();
    await storage.saveRuntime(this.engine.toPersistedRuntime(now));

    await this.syncNativeState();

    const runtime = this.engine.getRuntime();
    if (runtime.readingEvidence?.dateKey !== getLocalDateKey(now)) {
      await this.refreshDailyEvidence(now, false);
    }

    this.notifyListeners();
    return this.engine.getRuntime();
  }

  /**
   * Imports background cooldowns and access leases created by native extensions while JS was suspended.
   */
  private async importNativeStateOnResume(now: number): Promise<void> {
    if (!this.engine || !this.config) {
      return;
    }

    const services = getPlatformServices();
    if (getPlatformOS() === 'android') {
      let snapshot: NativeAttentionExchangeSnapshot | null = null;
      try {
        snapshot = await services.nativeRhythm.getAndroidSnapshot?.() ?? null;
      } catch {
        snapshot = null;
      }

      if (!snapshot) {
        try {
          // Android native authority is imported independently of the iOS App Group snapshot.
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const RhythmDeviceModule = require('../../modules/rhythm-device').default;
          snapshot = await RhythmDeviceModule?.getAttentionExchangeSnapshot?.() ?? null;
        } catch {
          snapshot = null;
        }
      }

      if (snapshot?.attentionStateInitialized) {
        const event = createNativeAttentionImportEvent(snapshot, now);
        if (event) {
          const effects = this.engine.dispatch(event);
          await this.executeEffects(effects);
        } else if (!this.engine.getRuntime().nativeAttentionAuthority) {
          const effects = this.engine.dispatch({ type: 'NATIVE_ATTENTION_AUTHORITY_ENABLED', timestamp: now });
          await this.executeEffects(effects);
        }
      } else if (snapshot) {
        // Upgrade bridge for pre-v1.2 native cooldowns: restore existing timers
        // without retroactive reading debt, while preserving usage and leases.
        for (const cooldown of snapshot.cooldowns ?? []) {
          if (cooldown.endsAt <= now) continue;
          const effects = this.engine.dispatch({
            type: 'NATIVE_COOLDOWN_RESTORED',
            groupId: cooldown.groupId,
            endsAt: cooldown.endsAt,
            legacy: true,
            timestamp: now,
          });
          await this.executeEffects(effects);
        }
        for (const lease of snapshot.activeAccessLeases ?? []) {
          if (lease.endsAt <= now) continue;
          const effects = this.engine.dispatch({
            type: 'NATIVE_ACCESS_LEASE_RESTORED',
            groupId: lease.groupId,
            endsAt: lease.endsAt,
            timestamp: now,
          });
          await this.executeEffects(effects);
        }
        const groupAllowanceUsage = Object.fromEntries(
          (snapshot.groupUsage ?? [])
            .filter((usage) => usage.dateKey === getLocalDateKey(now) && isFiniteNonNegative(usage.usedSeconds))
            .map((usage) => [usage.groupId, {
              groupId: usage.groupId,
              dateKey: usage.dateKey,
              usedSeconds: Math.floor(usage.usedSeconds),
              ...(usage.activePackageName ? { activePackageName: usage.activePackageName } : {}),
              ...(isFiniteNonNegative(usage.activeSegmentStartedAt) ? { activeSegmentStartedAt: usage.activeSegmentStartedAt } : {}),
              ...(isFiniteNonNegative(usage.exhaustedAt) ? { exhaustedAt: usage.exhaustedAt } : usage.exhausted ? { exhaustedAt: now } : {}),
              cycleRevision: Math.max(0, Math.floor(usage.cycleRevision)),
            }])
        );
        const effects = this.engine.dispatch({
          type: 'SYNC_GROUP_ALLOWANCE_USAGE',
          groupAllowanceUsage,
          replaceExisting: true,
          timestamp: now,
        });
        await this.executeEffects(effects);
      }

      return;
    }

    // iOS keeps its existing App Group snapshot import path.
    const snapshot = await services.nativeRhythm.getSnapshot?.();
    if (!snapshot) return;

    for (const [groupId, endsAt] of Object.entries(snapshot.activeCooldownEndsAt ?? {})) {
      if (endsAt <= now) continue;
      const effects = this.engine.dispatch({ type: 'NATIVE_COOLDOWN_RESTORED', groupId, endsAt, timestamp: now });
      await this.executeEffects(effects);
    }
    for (const [groupId, endsAt] of Object.entries(snapshot.activeAccessLeaseEndsAt ?? {})) {
      if (endsAt <= now) continue;
      const effects = this.engine.dispatch({ type: 'NATIVE_ACCESS_LEASE_RESTORED', groupId, endsAt, timestamp: now });
      await this.executeEffects(effects);
    }
  }

  /**
   * Reconciles current state (clock time, active routines, cooldown expiry).
   */
  public async reconcile(
    now: number = Date.now(),
    options?: { syncNative?: boolean; refreshEvidence?: boolean }
  ): Promise<RhythmRuntime> {
    if (!this.engine || !this.config) {
      return this.initialize();
    }
    await reconcileRhythm(this.engine, this.config, now);
    const runtime = this.engine.getRuntime();
    if (options?.refreshEvidence !== false && (
      Object.keys(runtime.activeReadingGates ?? {}).length > 0 ||
      runtime.readingEvidence?.dateKey !== getLocalDateKey(now)
    )) {
      await this.refreshDailyEvidence(now, false);
    }
    if (options?.syncNative !== false) {
      await this.syncNativeState();
    }
    this.notifyListeners();
    return this.engine.getRuntime();
  }

  /**
   * Unified platform activation algorithm for cold-start initialization and resume.
   * 1. Refreshes platform permissions.
   * 2. Imports native background state (cooldowns, leases) before any outward write.
   * 3. Reconciles pure TypeScript engine against current clock.
   * 4. Persists updated runtime state to local SQLite/KV storage.
   * 5. Syncs final authoritative state to native platform layers.
   */
  private async reconcilePlatformActivation(
    now: number,
    options: {
      importNativeState: boolean;
      finalSync: boolean;
    }
  ): Promise<void> {
    if (!this.engine || !this.config) {
      return;
    }

    const services = getPlatformServices();

    await services.permissions.getStatus();

    if (options.importNativeState) {
      await this.importNativeStateOnResume(now);
    }

    await this.reconcile(now, {
      syncNative: false,
      refreshEvidence: false,
    });
    // Refresh on initialization/resume even when today's cached projection exists.
    await this.refreshDailyEvidence(now, true);

    const desiredIds = this.engine.getEffectiveRestrictedAppIds();
    if (desiredIds.length > 0) {
      try {
        await services.restrictions.applyRestrictions(desiredIds);
      } catch {
        // Platform restriction application failure
      }
    }

    await services.storage.saveRuntime(
      this.engine.toPersistedRuntime(now)
    );

    if (options.finalSync) {
      await this.syncNativeState();
    }
  }

  /**
   * Complete resume lifecycle:
   * Reconciles native background state into engine and synchronizes outward.
   */
  public async handleAppResume(): Promise<void> {
    if (!this.engine || !this.config) {
      await this.initialize();
      return;
    }

    const now = Date.now();
    // Import native policy/gates before usage refresh can dispatch and sync JS
    // projections; stale JavaScript state must never be written over Android authority.
    await this.importNativeStateOnResume(now);

    // Explicitly trigger an immediate bounded activity events refresh to update
    // TypeScript Risk Group session continuity without waiting for the 60s periodic timer.
    const { usage } = getPlatformServices();
    if (usage.refreshActivityEvents) {
      try {
        await usage.refreshActivityEvents();
      } catch {
        // Platform usage refresh boundary
      }
    }

    await this.reconcilePlatformActivation(now, {
      importNativeState: false,
      finalSync: true,
    });

    this.notifyListeners();
  }

  /** Refreshes Reader Protocol V2 evidence for the current local date on demand. */
  public async refreshDailyReadingEvidence(now: number = Date.now()): Promise<void> {
    await this.refreshDailyEvidence(now, true, true);
  }

  private async refreshDailyEvidence(now: number, force: boolean, reconcileNative: boolean = false): Promise<void> {
    if (!this.engine || !this.config) return;
    if (this.evidenceRefreshPromise) {
      await this.evidenceRefreshPromise;
      return;
    }

    const dateKey = getLocalDateKey(now);
    const runtime = this.engine.getRuntime();
    const hasActiveGate = Object.keys(runtime.activeReadingGates ?? {}).length > 0;
    if (!force && !hasActiveGate && runtime.readingEvidence?.dateKey === dateKey) return;

    const refresh = (async () => {
      const evidence = await this.dailyReadingEvidenceClient.query(dateKey);
      if (!this.engine || !this.config) return;
      // Discard a response if another event already moved engine state into a new local day.
      if (this.engine.getRuntime().dailyAttentionExchange?.dateKey !== dateKey) return;

      const effects = this.engine.dispatch({
        type: 'SYNC_DAILY_READING_EVIDENCE',
        evidence,
        preserveNativeGates: this.engine.getRuntime().nativeAttentionAuthority === true,
        timestamp: now,
      });
      await this.executeEffects(effects);
      if (reconcileNative && getPlatformOS() === 'android') {
        // Native re-queries Reader through the shared Android client and imports
        // its gate-clearing decision; the JS cache never deletes native gates.
        await this.importNativeStateOnResume(now);
      }
      await getPlatformServices().storage.saveRuntime(this.engine.toPersistedRuntime(now));
      if (reconcileNative) await this.syncNativeState();
      this.notifyListeners();
    })();
    this.evidenceRefreshPromise = refresh;
    try {
      await refresh;
    } finally {
      if (this.evidenceRefreshPromise === refresh) this.evidenceRefreshPromise = undefined;
    }
  }

  /**
   * Updates configuration, persists preferences, and executes restriction effects immediately.
   */
  public async updateConfig(nextConfig: Partial<RhythmConfiguration>): Promise<void> {
    if (!this.config || !this.engine) {
      await this.initialize();
    }
    if (!this.config || !this.engine) return;

    const candidateConfig: RhythmConfiguration = {
      ...this.config,
      ...nextConfig,
    };

    const { storage } = getPlatformServices();
    const appClassifications = candidateConfig.apps.reduce<Record<string, { classification: any; riskGroupId?: string }>>((acc, app) => {
      acc[app.id] = {
        classification: app.classification,
        riskGroupId: app.riskGroupId,
      };
      return acc;
    }, {});

    await storage.savePreferences({
      routineWindows: candidateConfig.routineWindows,
      riskGroups: candidateConfig.riskGroups,
      appClassifications,
      sessionResetGapMs: candidateConfig.sessionResetGapMs ?? 5 * 60 * 1000,
      onboardingCompleted: true,
      accountability: candidateConfig.accountability ?? { enabled: false, partners: [] },
    });

    // Commit in-memory config only after preference persistence succeeds.
    this.config = candidateConfig;

    // Execute effects emitted directly from updateConfiguration
    const effects = this.engine.updateConfiguration(candidateConfig);
    await this.executeEffects(effects);

    await storage.saveRuntime(this.engine.toPersistedRuntime(Date.now()));
    await this.syncNativeState();
    this.notifyListeners();
  }

  public getRuntimeSnapshot(): RhythmRuntime | null {
    return this.engine?.getRuntime() ?? null;
  }

  public getConfig(): RhythmConfiguration | null {
    return this.config ? { ...this.config } : null;
  }

  /**
   * v1.0.2: validates and updates a Risk Group's shared allowance.
   * Enforces (per group per local day):
   * - multiples of 15 min, minimum 0
   * - max +15 min upward per successful daily edit
   * - unrestricted valid downward steps (incl. 0)
   * - no-op/cancel does not consume the guard
   * - moving apps between groups never resets policy/guard/usage (this method
   *   touches only allowanceMinutes + lastAllowanceEditedDateKey)
   * Increasing preserves already-consumed usage (remaining time only changes);
   * decreasing below current usage exhausts the group once sync applies.
   * Usage itself is never reset here.
   */
  public async updateRiskGroupAllowance(
    groupId: string,
    nextMinutes: number,
    nowMs: number = Date.now()
  ): Promise<GroupAllowanceEditResult & { groupId: string }> {
    if (!this.config || !this.engine) {
      try {
        await this.initialize();
      } catch {
        return { ok: false, nextMinutes, groupId, reason: 'unavailable' };
      }
    }
    if (!this.config || !this.engine) {
      return { ok: false, nextMinutes, groupId, reason: 'unavailable' };
    }

    const group = this.config.riskGroups.find((g) => g.id === groupId);
    if (!group) {
      return { ok: false, nextMinutes, groupId, reason: 'group-not-found' };
    }

    const currentMinutes = resolveGroupAllowanceMinutes(group);
    const todayKey = getLocalDateKey(nowMs);
    const result = validateGroupAllowanceEdit({
      currentMinutes,
      requestedMinutes: nextMinutes,
      lastEditedDateKey: group.lastAllowanceEditedDateKey,
      todayDateKey: todayKey,
    });
    if (!result.ok || !result.consumesDailyEdit) {
      return { ...result, groupId };
    }

    const updatedGroups = this.config.riskGroups.map((g) =>
      g.id === groupId
        ? { ...g, allowanceMinutes: result.nextMinutes, lastAllowanceEditedDateKey: todayKey }
        : g
    );

    const { storage } = getPlatformServices();
    await storage.appendHistoryEvent({
      type: 'group-allowance-edited',
      groupId,
      previousMinutes: currentMinutes,
      nextMinutes: result.nextMinutes,
      timestamp: nowMs,
    });

    await this.updateConfig({ riskGroups: updatedGroups });
    return { ...result, groupId };
  }

  /**
   * v1.0.2: updates a Risk Group's recovery activity reference. Validates
   * against the local OfflineActivity catalog ids when available; unknown ids
   * fall back to the 'walk' default at resolve time. Never touches allowance,
   * edit guard, or usage.
   */
  public async updateRiskGroupRecoveryActivity(
    groupId: string,
    activityId: string,
    nowMs: number = Date.now(),
    validActivityIds?: readonly string[]
  ): Promise<{ ok: boolean; groupId: string; activityId: string }> {
    if (!this.config || !this.engine) {
      await this.initialize();
    }
    if (!this.config || !this.engine) {
      return { ok: false, groupId, activityId };
    }

    const group = this.config.riskGroups.find((g) => g.id === groupId);
    if (!group) {
      return { ok: false, groupId, activityId };
    }

    const catalogIds = validActivityIds ?? (await this.getKnownRecoveryActivityIds());
    const nextActivityId =
      catalogIds.length === 0 || catalogIds.includes(activityId)
        ? activityId
        : resolveGroupRecoveryActivityId(group);

    if (nextActivityId === resolveGroupRecoveryActivityId(group) && group.recoveryActivityId !== undefined) {
      return { ok: true, groupId, activityId: nextActivityId };
    }

    const updatedGroups = this.config.riskGroups.map((g) =>
      g.id === groupId ? { ...g, recoveryActivityId: nextActivityId } : g
    );

    const { storage } = getPlatformServices();
    await storage.appendHistoryEvent({
      type: 'group-recovery-activity-changed',
      groupId,
      activityId: nextActivityId,
      timestamp: nowMs,
    });

    await this.updateConfig({ riskGroups: updatedGroups });
    return { ok: true, groupId, activityId: nextActivityId };
  }

  /**
   * Dispatches RISK_GROUP_DELETED to engine, purges runtime cooldowns,
   * leases, usage, and session, syncs native state, and persists.
   */
  public async deleteRiskGroup(groupId: string, nowMs: number = Date.now()): Promise<void> {
    if (!this.engine || !this.config) {
      await this.initialize();
    }
    if (!this.engine || !this.config) return;

    await this.dispatch({
      type: 'RISK_GROUP_DELETED',
      groupId,
      timestamp: nowMs,
    });
  }

  private async getKnownRecoveryActivityIds(): Promise<string[]> {
    try {
      const mod = await import('../data/mockData').catch(() => null);
      const list = (mod as { offlineActivities?: { id: string }[] } | null)?.offlineActivities;
      if (Array.isArray(list)) return list.map((a) => a.id);
    } catch {
      // fall through
    }
    return [];
  }

  /**
   * Refreshes installed launcher apps from platform usage provider,
   * merges existing classifications, defaults new packages to unclassified,
   * reconciles group membership, and updates configuration.
   */
  public async refreshInstalledApps(): Promise<{ apps: DeviceApp[]; riskGroups: RiskGroup[] }> {
    if (!this.config || !this.engine) {
      await this.initialize();
    }
    if (!this.config || !this.engine) {
      return { apps: [], riskGroups: [] };
    }

    const { usage } = getPlatformServices();
    const discoveredApps = await usage.getInstalledApps();
    if (!discoveredApps || discoveredApps.length === 0) {
      return { apps: this.config.apps, riskGroups: this.config.riskGroups };
    }

    const existingAppMap = new Map(this.config.apps.map((a) => [a.id, a]));
    const mergedApps: DeviceApp[] = discoveredApps.map((discovered) => {
      const existing = existingAppMap.get(discovered.id);
      if (existing) {
        // v1.0.2: membership/classification merge only; per-app allowance is
        // never carried (group owns policy, movement never resets it).
        return {
          ...discovered,
          classification: existing.classification,
          riskGroupId: existing.riskGroupId,
          dailyRiskAllowance: undefined,
        };
      }
      return {
        ...discovered,
        classification: 'unclassified',
        riskGroupId: undefined,
      };
    });

    const reconciledRiskGroups = reconcileRiskGroupMembership(mergedApps, this.config.riskGroups);

    await this.updateConfig({
      apps: mergedApps,
      riskGroups: reconciledRiskGroups,
    });

    return { apps: mergedApps, riskGroups: reconciledRiskGroups };
  }

  /**
   * Starts bounded reconciliation clock for continuous foreground time progression.
   */
  private startReconciliationClock(): void {
    if (this.reconcileTimer) return;

    this.reconcileTimer = setInterval(() => {
      const now = Date.now();
      this.dispatch({
        type: 'CLOCK_TICK',
        timestamp: now,
      })
        .then(() => this.refreshDailyEvidence(now, false))
        .catch(() => {});
    }, ENGINE_RECONCILE_INTERVAL_MS);

    if (this.reconcileTimer && typeof (this.reconcileTimer as any).unref === 'function') {
      (this.reconcileTimer as any).unref();
    }
  }

  /**
   * Subscribes to runtime engine changes.
   */
  public subscribe(listener: RuntimeListener): () => void {
    this.listeners.add(listener);
    if (this.engine) {
      listener(this.engine.getRuntime());
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getRuntime(): RhythmRuntime | null {
    return this.engine ? this.engine.getRuntime() : null;
  }

  public getConfiguration(): RhythmConfiguration | null {
    return this.config
      ? {
          routineWindows: [...this.config.routineWindows],
          riskGroups: [...this.config.riskGroups],
          apps: [...this.config.apps],
          sessionResetGapMs: this.config.sessionResetGapMs,
        }
      : null;
  }

  public getStatus(): EngineStatus {
    return {
      health: this.status.health,
      issues: [...this.status.issues],
    };
  }

  public getEngine(): RhythmEngine | null {
    return this.engine;
  }

  private notifyListeners(): void {
    if (!this.engine) return;
    const runtime = this.engine.getRuntime();
    for (const listener of this.listeners) {
      listener(runtime);
    }
  }

  public destroy(): void {
    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = undefined;
    }
    if (this.unsubscribeActivity) {
      this.unsubscribeActivity();
      this.unsubscribeActivity = undefined;
    }
    this.listeners.clear();
    this.isInitialized = false;
    this.evidenceRefreshPromise = undefined;
    this.engine = null;
    this.config = null;
  }
}
