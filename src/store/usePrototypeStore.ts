import { create } from 'zustand';
import {
  AppClassification,
  DeviceApp,
  EMERGENCY_ACCESS_MINUTES,
  InsightMetrics,
  OfflineActivity,
  RhythmState,
  RiskGroup,
  RoutineWindow,
  DailyUsageSnapshot,
  CreateRiskGroupInput,
  RiskGroupPatch,
  DeleteRiskGroupResult,
  RiskGroupConfigurationDraft,
  SaveRiskGroupResult,
} from '../types/domain';
import {
  initialApps,
  initialInsightMetrics,
  initialRiskGroups,
  initialRoutineWindows,
  offlineActivities as defaultOfflineActivities,
} from '../data/mockData';
import { getPlatformServices } from '../platform/PlatformServices';
import { MockUsageProvider } from '../platform/mock/MockUsageProvider';
import { createUniqueGroupId } from '../domain/selectors';
import { RhythmCoordinator } from '../application/RhythmCoordinator';
import { PermissionState } from '../platform/PermissionProvider';
import { getPrimaryCooldown } from '../domain/rhythm/types';
import {
  DailyRhythmSummary,
  LocalInsightsRepository,
  WeeklyRhythmSummary,
  getLocalDateKey,
  getSevenDayWindowStart,
  aggregateObservedRiskUsage,
  ObservedRiskUsageAggregation,
} from '../domain/insights';
import {
  DEFAULT_DAILY_RISK_ALLOWANCE_MINUTES,
  GroupAllowanceEditResult,
  resolveGroupAllowanceMinutes,
  resolveGroupRecoveryActivityId,
  validateGroupAllowanceEdit,
} from '../domain/rhythm/allowance';
import {
  AccountabilityOperation,
  AccountabilityPartner,
  AccountabilitySettings,
  ApprovalResult,
  ManagePartnerMutationPayload,
  PendingApproval,
  ProtectedMutation,
} from '../domain/accountability/types';
import {
  requiresPartnerApproval,
  getEnabledPartners,
} from '../domain/accountability/policy';
import {
  getAccountabilityService,
  resetAccountabilityService,
} from '../application/AccountabilityService';

function getPlatformOS(): string {
  if (typeof process !== 'undefined' && process.env?.RHYTHM_PLATFORM_OVERRIDE) {
    return process.env.RHYTHM_PLATFORM_OVERRIDE;
  }
  if (typeof window !== 'undefined' && (typeof navigator === 'undefined' || (navigator as any).product !== 'ReactNative')) {
    return 'web';
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rn = require('react-native');
    return rn?.Platform?.OS || 'web';
  } catch {
    return 'web';
  }
}

export type InsightDataState =
  | 'loading'
  | 'real'
  | 'empty'
  | 'demo-web'
  | 'permission-required'
  | 'error';

export function hydrateAppsWithDailyUsage(
  apps: DeviceApp[],
  snapshot?: DailyUsageSnapshot
): DeviceApp[] {
  const usageMap = new Map(
    snapshot?.apps.map((item) => [
      item.packageName,
      item,
    ]) ?? []
  );

  return apps.map((app) => {
    const usage = usageMap.get(app.id);

    return {
      ...app,
      usageTodayMinutes: usage
        ? Math.floor(usage.usedSeconds / 60)
        : 0,
    };
  });
}

const emptyInsightMetrics: InsightMetrics = {
  protectedTimeTodayMinutes: 0,
  protectedTimeWeeklyHours: 0,
  averageRiskSessionMinutes: 0,
  cooldownTriggersCount: 0,
  firstRiskAppUseTime: '—',
  finalRiskAppUseTime: '—',
  weeklyTrend: [
    { day: 'Mon', protectedMinutes: 0, riskMinutes: 0 },
    { day: 'Tue', protectedMinutes: 0, riskMinutes: 0 },
    { day: 'Wed', protectedMinutes: 0, riskMinutes: 0 },
    { day: 'Thu', protectedMinutes: 0, riskMinutes: 0 },
    { day: 'Fri', protectedMinutes: 0, riskMinutes: 0 },
    { day: 'Sat', protectedMinutes: 0, riskMinutes: 0 },
    { day: 'Sun', protectedMinutes: 0, riskMinutes: 0 },
  ],
};

export interface TimeSelectorConfig {
  visible: boolean;
  windowId?: string;
  field?: 'startTime' | 'endTime';
  title?: string;
  initialTime?: string;
}

export interface AppEditConfig {
  visible: boolean;
  appId?: string;
}

interface PrototypeState {
  // Domain data (projected from RhythmCoordinator / Engine)
  rhythmState: RhythmState;
  activeRiskGroupId: string;
  activeTimerEndsAt?: number; // Absolute timestamp for countdowns
  apps: DeviceApp[];
  riskGroups: RiskGroup[];
  routineWindows: RoutineWindow[];
  offlineActivities: OfflineActivity[];
  insightMetrics: InsightMetrics;
  weeklySummary?: WeeklyRhythmSummary;
  todaySummary?: DailyRhythmSummary;
  hasCompletedOnboarding: boolean;
  permissionState: PermissionState;

  // Daily usage & Insights State
  dailyUsageSnapshot?: DailyUsageSnapshot;
  groupUsageSnapshots?: Record<string, import('../types/domain').GroupAllowanceSnapshot>;
  dailyUsageLoading: boolean;
  dailyUsageError?: string;
  insightDataState: InsightDataState;

  // Search & Filters
  searchQuery: string;
  filterClassification: AppClassification | 'all';

  // UI Dialog Controls
  demoSwitcherVisible: boolean;
  emergencyModalVisible: boolean;
  timeSelector: TimeSelectorConfig;
  appEdit: AppEditConfig;

  // Core Actions
  initializeApps: () => Promise<void>;
  refreshInstalledApps: () => Promise<void>;
  refreshDailyUsage: () => Promise<void>;
  refreshInsights: () => Promise<void>;
  checkPermissions: () => Promise<void>;
  requestUsagePermission: () => Promise<void>;
  setRhythmState: (state: RhythmState) => Promise<void>;
  simulateCooldown: (groupId?: string) => Promise<void>;
  simulateRiskSession: (groupId?: string) => void;
  resolveExpiredTimer: () => Promise<void>;
  resetDemo: () => Promise<void>;

  startAccessLease: (groupId: string, durationMinutes?: number) => Promise<void>;
  triggerEmergencyBypass: () => Promise<void>;

  /**
   * v1.0.2: group-scoped allowance edit (sole policy owner). Moving apps
   * into/out of a group never resets policy/guard/usage.
   */
  updateRiskGroupAllowance: (
    groupId: string,
    nextMinutes: number
  ) => Promise<GroupAllowanceEditResult & { groupId: string }>;

  /** v1.0.2: group-scoped recovery activity selection. */
  updateRiskGroupRecoveryActivity: (
    groupId: string,
    activityId: string
  ) => Promise<{ ok: boolean; groupId: string; activityId: string }>;

  updateAppClassification: (
    appId: string,
    classification: AppClassification,
    riskGroupId?: string
  ) => Promise<void>;
  updateRiskGroup: (groupId: string, updates: Partial<RiskGroup>) => Promise<SaveRiskGroupResult>;
  updateRoutineWindow: (windowId: string, updates: Partial<RoutineWindow>) => void;
  toggleRoutineDay: (day: number) => void;
  toggleGroupProtection: (windowId: string, groupId: string, enabled: boolean) => void;
  createRiskGroup: (input: CreateRiskGroupInput) => Promise<string>;
  saveRiskGroupConfiguration: (groupId: string, draft: RiskGroupConfigurationDraft) => Promise<SaveRiskGroupResult>;
  saveRiskGroup: (groupId: string, patch: RiskGroupPatch) => Promise<void>;
  deleteRiskGroup: (groupId: string, replacementGroupId?: string) => Promise<DeleteRiskGroupResult>;
  addNewRiskGroup: (name: string, description: string) => Promise<string>;
  selectIosRiskGroupApps: (groupId: string) => Promise<void>;

  setSearchQuery: (query: string) => void;
  setFilterClassification: (classification: AppClassification | 'all') => void;
  setDemoSwitcherVisible: (visible: boolean) => void;
  setEmergencyModalVisible: (visible: boolean) => void;

  openTimeSelector: (config: Omit<TimeSelectorConfig, 'visible'>) => void;
  closeTimeSelector: () => void;
  saveSelectedTime: (time: string) => void;

  openAppEdit: (appId: string) => void;
  closeAppEdit: () => void;

  completeOnboarding: () => void;

  // Accountability
  accountability: AccountabilitySettings;
  pendingApproval: PendingApproval | null;

  // Protected mutation gateway & accountability actions
  requestProtectedMutation: <T>(
    mutation: ProtectedMutation<T>
  ) => Promise<{ status: 'executed' | 'pending-approval' }>;
  approveProtectedMutation: (
    partnerId: string,
    password: string
  ) => Promise<ApprovalResult>;
  cancelPendingApproval: () => void;

  createAccountabilityPartner: (params: {
    name: string;
    relationshipLabel?: string;
    password: string;
  }) => Promise<AccountabilityPartner>;
  updateAccountabilityPartner: (
    partnerId: string,
    updates: {
      name?: string;
      relationshipLabel?: string;
      enabled?: boolean;
    }
  ) => Promise<AccountabilityPartner>;
  deleteAccountabilityPartner: (partnerId: string) => Promise<void>;
  replaceAccountabilityPartnerPassword: (
    partnerId: string,
    newPassword: string
  ) => Promise<void>;
  enableAccountability: (
    partnerId: string,
    password: string
  ) => Promise<ApprovalResult>;
  disableAccountability: (
    partnerId: string,
    password: string
  ) => Promise<ApprovalResult>;
}

// Initial demo timer: 01:18:24 remaining until morning unlock
const INITIAL_TIMER_MS = (1 * 3600 + 18 * 60 + 24) * 1000;

const mutationExecutors = new Map<AccountabilityOperation, (payload: any) => Promise<any>>();

const transientApprovalSecrets = new Map<string, string>();

function createTransientSecretRef(secret: string): string {
  const ref = `secret_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  transientApprovalSecrets.set(ref, secret);
  return ref;
}

function consumeTransientSecret(ref: string): string {
  const value = transientApprovalSecrets.get(ref);
  transientApprovalSecrets.delete(ref);
  if (!value) {
    throw new Error('Protected secret is no longer available');
  }
  return value;
}

function deleteTransientSecret(ref?: string): void {
  if (!ref) return;
  transientApprovalSecrets.delete(ref);
}

export function __getTransientSecretCountForTests(): number {
  return transientApprovalSecrets.size;
}

function cleanupPendingApprovalSecrets(pending: PendingApproval | null): void {
  if (pending?.operation !== 'manage-accountability-partner') {
    return;
  }
  const payload = pending.payload as ManagePartnerMutationPayload | undefined;
  if (payload && (payload.action === 'create' || payload.action === 'replace-password')) {
    deleteTransientSecret(payload.secretRef);
  }
}

async function executeRegisteredMutation(
  operation: AccountabilityOperation,
  payload: unknown
): Promise<unknown> {
  const executor = mutationExecutors.get(operation);
  if (!executor) {
    throw new Error(`No protected mutation executor registered for ${operation}`);
  }
  return await executor(payload);
}

function registerDefaultMutationExecutors(
  get: () => PrototypeState,
  set: (partial: Partial<PrototypeState> | ((state: PrototypeState) => Partial<PrototypeState>)) => void
) {
  if (mutationExecutors.size > 0) return;

  mutationExecutors.set('enable-accountability', async () => {
    const state = get();
    const nextAccountability: AccountabilitySettings = {
      ...state.accountability,
      enabled: true,
    };
    await RhythmCoordinator.getInstance().updateConfig({
      accountability: nextAccountability,
    });
    set({ accountability: nextAccountability });
  });

  mutationExecutors.set('disable-accountability', async () => {
    const state = get();
    const nextAccountability: AccountabilitySettings = {
      ...state.accountability,
      enabled: false,
    };
    await RhythmCoordinator.getInstance().updateConfig({
      accountability: nextAccountability,
    });
    set({ accountability: nextAccountability });
  });

  mutationExecutors.set('change-app-classification', async ({ appId, classification, riskGroupId }) => {
    await get().updateAppClassification(appId, classification, riskGroupId);
  });

  mutationExecutors.set('change-daily-allowance', async ({ groupId, allowanceMinutes }) => {
    await get().updateRiskGroupAllowance(groupId, allowanceMinutes);
  });

  mutationExecutors.set('create-risk-group', async (input) => {
    return await get().createRiskGroup(input);
  });

  mutationExecutors.set('edit-risk-group', async ({ groupId, draft }) => {
    return await get().saveRiskGroupConfiguration(groupId, draft);
  });

  mutationExecutors.set('delete-risk-group', async ({ groupId, replacementGroupId }) => {
    return await get().deleteRiskGroup(groupId, replacementGroupId);
  });

  mutationExecutors.set('edit-risk-group-protection', async ({ windowId, groupId, enabled }) => {
    get().toggleGroupProtection(windowId, groupId, enabled);
  });

  mutationExecutors.set('start-access-lease', async ({ groupId, durationMinutes }) => {
    await get().startAccessLease(groupId, durationMinutes);
  });

  mutationExecutors.set('reset-local-state', async () => {
    await get().resetDemo();
  });

  mutationExecutors.set('manage-accountability-partner', async (payload: ManagePartnerMutationPayload) => {
    const service = getAccountabilityService();
    const state = get();
    const nextPartners = [...state.accountability.partners];

    if (payload.action === 'create') {
      const password = consumeTransientSecret(payload.secretRef);
      const partner = await service.createPartner({
        name: payload.name,
        relationshipLabel: payload.relationshipLabel,
        password,
      });

      const nextAccountability: AccountabilitySettings = {
        ...state.accountability,
        partners: [...state.accountability.partners, partner],
      };

      try {
        await RhythmCoordinator.getInstance().updateConfig({
          accountability: nextAccountability,
        });
      } catch (error) {
        try {
          await service.removePartner(partner);
        } catch {
          // Best-effort cleanup.
        }
        throw error;
      }

      set({ accountability: nextAccountability });
      return;
    }

    if (payload.action === 'update') {
      const existing = nextPartners.find((p) => p.id === payload.partnerId);
      if (existing) {
        if (state.accountability.enabled && payload.updates.enabled === false && existing.enabled) {
          const remainingEnabled = nextPartners.filter((p) => p.id !== payload.partnerId && p.enabled);
          if (remainingEnabled.length === 0) {
            throw new Error('Cannot disable the last enabled partner while Accountability Mode is active.');
          }
        }
        const updated = service.updatePartnerMetadata(existing, payload.updates);
        const updatedPartners = nextPartners.map((p) => (p.id === payload.partnerId ? updated : p));
        const nextAccountability: AccountabilitySettings = {
          ...state.accountability,
          partners: updatedPartners,
        };
        await RhythmCoordinator.getInstance().updateConfig({
          accountability: nextAccountability,
        });
        set({ accountability: nextAccountability });
      }
      return;
    }

    if (payload.action === 'remove') {
      const existing = nextPartners.find((p) => p.id === payload.partnerId);
      if (existing) {
        if (state.accountability.enabled) {
          const remainingEnabled = nextPartners.filter((p) => p.id !== payload.partnerId && p.enabled);
          if (remainingEnabled.length === 0) {
            throw new Error('Cannot remove the last enabled partner while Accountability Mode is active.');
          }
        }
        const filteredPartners = nextPartners.filter((p) => p.id !== payload.partnerId);
        const nextAccountability: AccountabilitySettings = {
          ...state.accountability,
          partners: filteredPartners,
        };
        await RhythmCoordinator.getInstance().updateConfig({
          accountability: nextAccountability,
        });
        set({ accountability: nextAccountability });

        // Credential cleanup is secondary (best-effort)
        try {
          await service.removePartner(existing);
        } catch {
          // Non-fatal orphan cleanup failure.
        }
      }
      return;
    }

    if (payload.action === 'replace-password') {
      const password = consumeTransientSecret(payload.secretRef);
      const existing = nextPartners.find((p) => p.id === payload.partnerId);
      if (!existing) {
        throw new Error('Partner not found');
      }
      await service.replacePartnerPassword(existing, password);
      return;
    }
  });
}

export const usePrototypeStore = create<PrototypeState>((set, get) => ({
  rhythmState: 'morning-buffer',
  activeRiskGroupId: 'social',
  activeTimerEndsAt: Date.now() + INITIAL_TIMER_MS,
  apps: [...initialApps],
  riskGroups: [...initialRiskGroups],
  routineWindows: [...initialRoutineWindows],
  offlineActivities: [...defaultOfflineActivities],
  insightMetrics: getPlatformOS() === 'web' ? { ...initialInsightMetrics } : { ...emptyInsightMetrics },
  weeklySummary: undefined,
  todaySummary: undefined,
  dailyUsageSnapshot: undefined,
  groupUsageSnapshots: undefined,
  dailyUsageLoading: false,
  dailyUsageError: undefined,
  insightDataState: getPlatformOS() === 'web' ? 'demo-web' : 'loading',
  hasCompletedOnboarding: true,
  permissionState: {
    usageAccess: 'unknown',
    restrictionAuthorization: 'unknown',
    restrictionCapability: 'foundation-only',
  },

  accountability: {
    enabled: false,
    partners: [],
  },
  pendingApproval: null,

  searchQuery: '',
  filterClassification: 'all',

  demoSwitcherVisible: false,
  emergencyModalVisible: false,
  timeSelector: { visible: false },
  appEdit: { visible: false },

  initializeApps: async () => {
    registerDefaultMutationExecutors(get, set);
    try {
      const coordinator = RhythmCoordinator.getInstance();
      const runtime = await coordinator.initialize();
      const config = coordinator.getConfiguration();

      // Subscribe store to live runtime engine updates
      coordinator.subscribe((nextRuntime) => {
        const primaryCooldown = getPrimaryCooldown(nextRuntime);
        set({
          rhythmState: nextRuntime.state,
          activeTimerEndsAt: primaryCooldown?.endsAt,
          activeRiskGroupId: primaryCooldown?.groupId || nextRuntime.activeSession?.groupId || get().activeRiskGroupId,
        });
      });

      const { permissions } = getPlatformServices();
      const permStatus = await permissions.getStatus();
      const primaryCooldown = getPrimaryCooldown(runtime);

      set({
        apps: config?.apps ?? get().apps,
        riskGroups: config?.riskGroups ?? get().riskGroups,
        routineWindows: config?.routineWindows ?? get().routineWindows,
        accountability: config?.accountability ?? get().accountability,
        rhythmState: runtime.state,
        activeTimerEndsAt: primaryCooldown?.endsAt || (runtime.state === 'morning-buffer' ? Date.now() + INITIAL_TIMER_MS : undefined),
        activeRiskGroupId: primaryCooldown?.groupId || runtime.activeSession?.groupId || 'social',
        permissionState: permStatus,
      });

      // Load real local daily usage and insights
      await get().refreshDailyUsage();
      await get().refreshInsights();
    } catch {
      // Fallback
    }
  },

  refreshInstalledApps: async () => {
    try {
      const coordinator = RhythmCoordinator.getInstance();
      const result = await coordinator.refreshInstalledApps();
      if (result.apps && result.apps.length > 0) {
        const snapshot = get().dailyUsageSnapshot;
        set({
          apps: hydrateAppsWithDailyUsage(result.apps, snapshot),
          riskGroups: result.riskGroups,
        });
      }
    } catch {
      // Non-fatal
    }
  },

  refreshDailyUsage: async () => {
    const { usage } = getPlatformServices();

    set({
      dailyUsageLoading: true,
      dailyUsageError: undefined,
    });

    try {
      let groupSnapshotsMap: Record<string, import('../types/domain').GroupAllowanceSnapshot> | undefined;
      const nativeGroupSnapshots =
        (await usage.reconcileGroupUsage?.()) ??
        (await usage.getGroupUsageSnapshot?.());

      if (nativeGroupSnapshots && nativeGroupSnapshots.length > 0) {
        groupSnapshotsMap = {};
        for (const s of nativeGroupSnapshots) {
          groupSnapshotsMap[s.groupId] = s;
        }
      }

      const snapshot =
        (await usage.reconcileDailyUsage?.()) ??
        (await usage.getDailyUsageSnapshot?.());

      const currentApps = get().apps;
      const hydratedApps = snapshot ? hydrateAppsWithDailyUsage(currentApps, snapshot) : currentApps;

      const platformOS = getPlatformOS();
      const isWebOrMock =
        platformOS === 'web' ||
        usage instanceof MockUsageProvider ||
        usage.constructor.name === 'MockUsageProvider' ||
        Boolean((usage as any).isMock);

      const hasGroupSnapshots = Boolean(nativeGroupSnapshots && nativeGroupSnapshots.length > 0);

      if (!isWebOrMock && !hasGroupSnapshots) {
        set({
          apps: hydratedApps,
          dailyUsageSnapshot: snapshot ?? undefined,
          groupUsageSnapshots: undefined,
          dailyUsageLoading: false,
          dailyUsageError: 'Usage unavailable',
        });
        return;
      }

      set({
        apps: hydratedApps,
        dailyUsageSnapshot: snapshot ?? undefined,
        groupUsageSnapshots: groupSnapshotsMap,
        dailyUsageLoading: false,
        dailyUsageError: undefined,
      });
    } catch {
      // Invariant 4: A failed native snapshot refresh does NOT clear native cooldown.
      // Show `Usage unavailable` and recover on a later refresh.
      set({
        dailyUsageLoading: false,
        dailyUsageError: 'Usage unavailable',
        dailyUsageSnapshot: undefined,
        groupUsageSnapshots: undefined,
      });
    }
  },

  refreshInsights: async () => {
    const platformOS = getPlatformOS();
    const isWeb = platformOS === 'web';

    if (!isWeb) {
      set({ insightDataState: 'loading' });
    }

    try {
      const { storage, permissions, usage } = getPlatformServices();
      const permStatus = await permissions.getStatus();

      if (platformOS === 'android' && permStatus.usageAccess !== 'granted') {
        set({
          insightDataState: 'permission-required',
          permissionState: permStatus,
          insightMetrics: { ...emptyInsightMetrics },
        });
        return;
      }

      const windows = get().routineWindows;
      const repo = new LocalInsightsRepository(storage, windows);

      const todayKey = getLocalDateKey();
      const todaySummary = await repo.getDailySummary(todayKey);
      const weeklySummary = await repo.getWeeklySummary(todayKey);

      const apps = get().apps;
      const riskApps = apps.filter((a) => a.classification === 'risk');

      let observedAggregation: ObservedRiskUsageAggregation | undefined;

      if (platformOS === 'android' && usage.queryActivityEvents) {
        const now = Date.now();
        const start = getSevenDayWindowStart(now);
        const events = await usage.queryActivityEvents(start, now);
        observedAggregation = aggregateObservedRiskUsage(
          events,
          riskApps.map((a) => ({ id: a.id, riskGroupId: a.riskGroupId })),
          start,
          now
        );
      }

      const hasHistoryData = !!weeklySummary.hasData;
      const hasObservedData =
        !!observedAggregation &&
        (Object.values(observedAggregation.secondsByApp).some((s) => s > 0) ||
          Object.values(observedAggregation.secondsByDate).some((s) => s > 0));
      const hasRealData = hasHistoryData || hasObservedData;

      if (hasRealData) {
        // Double-count prevention:
        // On Android, observed UsageStats replaces engine Risk usage!
        // Engine history is retained for routine protection, cooldown count, access lease count.
        const weeklyTrend = weeklySummary.dailyTrend.map((t) => {
          const riskMins = observedAggregation
            ? Math.round((observedAggregation.secondsByDate[t.dateKey] || 0) / 60)
            : t.riskMinutes;

          return {
            day: t.day,
            protectedMinutes: t.protectedMinutes,
            riskMinutes: riskMins,
          };
        });

        // Group usage: On Android, use sum(observed usage for Risk apps belonging to group)
        const groupUsageMinutes: Record<string, number> = {};
        if (observedAggregation) {
          for (const [groupId, sec] of Object.entries(observedAggregation.secondsByGroup)) {
            groupUsageMinutes[groupId] = Math.round(sec / 60);
          }
        } else {
          Object.assign(groupUsageMinutes, weeklySummary.groupUsageMinutes);
        }

        const firstRiskTime = observedAggregation
          ? (observedAggregation.firstRiskUseTime ?? '—')
          : (todaySummary?.firstRiskAppUseTime || '—');
        const finalRiskTime = observedAggregation
          ? (observedAggregation.finalRiskUseTime ?? '—')
          : (todaySummary?.finalRiskAppUseTime || '—');

        const updatedWeeklySummary: WeeklyRhythmSummary = {
          ...weeklySummary,
          groupUsageMinutes,
          hasData: true,
        };

        set({
          todaySummary: todaySummary || undefined,
          weeklySummary: updatedWeeklySummary,
          insightDataState: 'real',
          insightMetrics: {
            protectedTimeTodayMinutes: todaySummary?.observedProtectedMinutes || 0,
            protectedTimeWeeklyHours: Math.round((weeklySummary.totalProtectedMinutes / 60) * 10) / 10,
            averageRiskSessionMinutes: weeklySummary.averageRiskSessionMinutes,
            cooldownTriggersCount: weeklySummary.totalCooldownCount,
            firstRiskAppUseTime: firstRiskTime,
            finalRiskAppUseTime: finalRiskTime,
            weeklyTrend,
          },
        });
      } else if (isWeb) {
        set({
          todaySummary: todaySummary || undefined,
          weeklySummary,
          insightDataState: 'demo-web',
          insightMetrics: { ...initialInsightMetrics },
        });
      } else {
        // Native empty state
        set({
          todaySummary: todaySummary || undefined,
          weeklySummary,
          insightDataState: 'empty',
          insightMetrics: { ...emptyInsightMetrics },
        });
      }
    } catch {
      if (isWeb) {
        set({
          insightDataState: 'demo-web',
          insightMetrics: { ...initialInsightMetrics },
        });
      } else {
        set({
          insightDataState: 'error',
          insightMetrics: { ...emptyInsightMetrics },
        });
      }
    }
  },

  checkPermissions: async () => {
    try {
      const { permissions } = getPlatformServices();
      const status = await permissions.getStatus();
      set({ permissionState: status });
    } catch {
      // Fallback
    }
  },

  requestUsagePermission: async () => {
    try {
      const { permissions } = getPlatformServices();
      await permissions.requestUsageAccess();
      const status = await permissions.getStatus();
      set({ permissionState: status });
    } catch {
      // Fallback
    }
  },

  setRhythmState: async (state: RhythmState) => {
    let timerEndsAt: number | undefined;

    switch (state) {
      case 'morning-buffer':
        timerEndsAt = Date.now() + (1 * 3600 + 18 * 60 + 24) * 1000;
        break;
      case 'cooldown':
        timerEndsAt = Date.now() + (1 * 3600 + 12 * 60 + 34) * 1000;
        break;
      case 'risk-session':
        timerEndsAt = Date.now() + 12 * 60 * 1000;
        break;
      case 'evening-wind-down':
        timerEndsAt = Date.now() + (2 * 3600 + 45 * 60) * 1000;
        break;
      case 'available':
      default:
        timerEndsAt = undefined;
        break;
    }

    set({ rhythmState: state, activeTimerEndsAt: timerEndsAt });
  },

  simulateCooldown: async (groupId = 'social') => {
    const group = get().riskGroups.find((g) => g.id === groupId);
    const durationMs = (group?.cooldownMinutes ?? 90) * 60 * 1000;
    const endsAt = Date.now() + durationMs;

    set({
      rhythmState: 'cooldown',
      activeRiskGroupId: groupId,
      activeTimerEndsAt: endsAt,
    });

    // Route through coordinator dispatch so engine owns state and executes effects
    const coordinator = RhythmCoordinator.getInstance();
    await coordinator.dispatch({
      type: 'COOLDOWN_STARTED',
      groupId,
      endsAt,
      timestamp: Date.now(),
    });
  },

  simulateRiskSession: (groupId = 'social') => {
    set({
      rhythmState: 'risk-session',
      activeRiskGroupId: groupId,
      activeTimerEndsAt: Date.now() + 12 * 60 * 1000,
    });
  },

  resolveExpiredTimer: async () => {
    const state = get();
    if (
      state.rhythmState === 'cooldown' &&
      state.activeTimerEndsAt &&
      Date.now() >= state.activeTimerEndsAt
    ) {
      // Reconcile through coordinator; let engine's restriction union determine clear deltas
      const coordinator = RhythmCoordinator.getInstance();
      const nextRuntime = await coordinator.reconcile(Date.now());

      const primaryCooldown = getPrimaryCooldown(nextRuntime);
      set({
        rhythmState: nextRuntime.state,
        activeTimerEndsAt: primaryCooldown?.endsAt,
      });
    }
  },

  startAccessLease: async (groupId: string, durationMinutes = EMERGENCY_ACCESS_MINUTES) => {
    const coordinator = RhythmCoordinator.getInstance();
    const runtime = await coordinator.dispatch({
      type: 'START_ACCESS_LEASE',
      groupId,
      durationMinutes,
      reason: 'emergency',
      timestamp: Date.now(),
    });

    set({
      rhythmState: runtime.state,
      emergencyModalVisible: false,
    });

    await get().refreshInsights();
  },

  triggerEmergencyBypass: async () => {
    const activeGroupId = get().activeRiskGroupId || 'social';
    await get().startAccessLease(activeGroupId, EMERGENCY_ACCESS_MINUTES);
  },

  resetDemo: async () => {
    transientApprovalSecrets.clear();
    registerDefaultMutationExecutors(get, set);
    resetAccountabilityService();
    const coordinator = RhythmCoordinator.getInstance();
    const { storage } = getPlatformServices();
    await storage.clearAll();
    coordinator.destroy();
    const runtime = await coordinator.initialize();
    const config = coordinator.getConfiguration();
    const primaryCooldown = getPrimaryCooldown(runtime);

    set({
      rhythmState: runtime.state,
      activeRiskGroupId:
        primaryCooldown?.groupId ??
        runtime.activeSession?.groupId ??
        'social',
      activeTimerEndsAt: primaryCooldown?.endsAt,
      apps: config?.apps ?? [...initialApps],
      riskGroups: config?.riskGroups ?? [...initialRiskGroups],
      routineWindows: config?.routineWindows ?? [...initialRoutineWindows],
      offlineActivities: [...defaultOfflineActivities],
      accountability: config?.accountability ?? { enabled: false, partners: [] },
      pendingApproval: null,
      insightMetrics: getPlatformOS() === 'web' ? { ...initialInsightMetrics } : { ...emptyInsightMetrics },
      weeklySummary: undefined,
      todaySummary: undefined,
      dailyUsageSnapshot: undefined,
      groupUsageSnapshots: undefined,
      dailyUsageLoading: false,
      dailyUsageError: undefined,
      insightDataState: getPlatformOS() === 'web' ? 'demo-web' : 'loading',
      searchQuery: '',
      filterClassification: 'all',
      demoSwitcherVisible: false,
      emergencyModalVisible: false,
      timeSelector: { visible: false },
      appEdit: { visible: false },
    });
  },

  updateRiskGroupAllowance: async (groupId, nextMinutes) => {
    const result = await RhythmCoordinator.getInstance().updateRiskGroupAllowance(groupId, nextMinutes);
    if (result.ok) {
      const config = RhythmCoordinator.getInstance().getConfig();
      if (config) {
        set({ riskGroups: [...config.riskGroups] });
      }
      await get().refreshDailyUsage();
    }
    return result;
  },

  updateRiskGroupRecoveryActivity: async (groupId, activityId) => {
    const result = await RhythmCoordinator.getInstance().updateRiskGroupRecoveryActivity(
      groupId,
      activityId,
      Date.now(),
      get().offlineActivities.map((a) => a.id)
    );
    if (result.ok) {
      const config = RhythmCoordinator.getInstance().getConfig();
      if (config) {
        set({ riskGroups: [...config.riskGroups] });
      }
    }
    return result;
  },

  updateAppClassification: async (appId, classification, riskGroupId) => {
    const state = get();
    const targetGroupId = classification === 'risk' ? (riskGroupId || 'social') : undefined;

    const updatedApps = state.apps.map((app) => {
      if (app.id === appId) {
        // v1.0.2: classification + membership only. Per-app allowance no
        // longer exists; group policy/guard/usage are never reset by moves.
        const { dailyRiskAllowance: _removed, ...rest } = app;
        void _removed;
        return {
          ...rest,
          classification,
          riskGroupId: targetGroupId,
          dailyRiskAllowance: undefined,
        };
      }
      return app;
    });

    // Maintain Invariant: if not 'risk', remove app from all risk groups
    const updatedRiskGroups = state.riskGroups.map((group) => {
      const hasApp = group.appIds.includes(appId);
      const shouldHave = classification === 'risk' && group.id === targetGroupId;

      if (shouldHave && !hasApp) {
        return { ...group, appIds: [...group.appIds, appId] };
      } else if (!shouldHave && hasApp) {
        return { ...group, appIds: group.appIds.filter((id) => id !== appId) };
      }
      return group;
    });

    await RhythmCoordinator.getInstance().updateConfig({
      apps: updatedApps,
      riskGroups: updatedRiskGroups,
    });

    set({
      apps: updatedApps,
      riskGroups: updatedRiskGroups,
    });
  },

  updateRiskGroup: async (groupId, updates) => {
    const state = get();
    const existing = state.riskGroups.find((g) => g.id === groupId);
    if (!existing) {
      return { ok: false, groupId, reason: 'group-not-found' };
    }
    const morningWin = state.routineWindows.find((w) => w.id === 'morning-buffer');
    const eveningWin = state.routineWindows.find((w) => w.id === 'evening-wind-down');
    const morningProtected = morningWin ? morningWin.protectedGroupIds.includes(groupId) : false;
    const eveningProtected = eveningWin ? eveningWin.protectedGroupIds.includes(groupId) : false;

    const draft: RiskGroupConfigurationDraft & { sessionThresholdMinutes?: number } = {
      name: updates.name !== undefined ? updates.name : existing.name,
      description: updates.description !== undefined ? updates.description : (existing.description ?? ''),
      allowanceMinutes:
        updates.allowanceMinutes !== undefined
          ? updates.allowanceMinutes
          : updates.sessionThresholdMinutes !== undefined
          ? updates.sessionThresholdMinutes
          : resolveGroupAllowanceMinutes(existing),
      sessionThresholdMinutes: updates.sessionThresholdMinutes,
      cooldownMinutes: updates.cooldownMinutes !== undefined ? updates.cooldownMinutes : existing.cooldownMinutes,
      recoveryActivityId:
        updates.recoveryActivityId !== undefined
          ? updates.recoveryActivityId
          : resolveGroupRecoveryActivityId(existing),
      morningProtected,
      eveningProtected,
    };

    return get().saveRiskGroupConfiguration(groupId, draft);
  },

  updateRoutineWindow: (windowId, updates) => {
    set((state) => {
      const updatedWindows = state.routineWindows.map((w) =>
        w.id === windowId ? { ...w, ...updates } : w
      );

      RhythmCoordinator.getInstance().updateConfig({
        routineWindows: updatedWindows,
      }).catch(() => {});

      return { routineWindows: updatedWindows };
    });
  },

  toggleRoutineDay: (day) => {
    set((state) => {
      const morningWin = state.routineWindows.find((w) => w.id === 'morning-buffer');
      const currentDays = morningWin ? morningWin.activeDays : [1, 2, 3, 4, 5, 6, 7];
      const newDays = currentDays.includes(day)
        ? currentDays.filter((d) => d !== day)
        : [...currentDays, day].sort();

      const updatedWindows = state.routineWindows.map((w) => ({ ...w, activeDays: newDays }));

      RhythmCoordinator.getInstance().updateConfig({
        routineWindows: updatedWindows,
      }).catch(() => {});

      return { routineWindows: updatedWindows };
    });
  },

  toggleGroupProtection: (windowId, groupId, enabled) => {
    set((state) => {
      const updatedWindows = state.routineWindows.map((w) => {
        if (w.id !== windowId) return w;

        const currentIds = w.protectedGroupIds;
        const nextIds = enabled
          ? Array.from(new Set([...currentIds, groupId]))
          : currentIds.filter((id) => id !== groupId);

        return {
          ...w,
          protectedGroupIds: nextIds,
        };
      });

      RhythmCoordinator.getInstance().updateConfig({
        routineWindows: updatedWindows,
      }).catch(() => {});

      return { routineWindows: updatedWindows };
    });
  },

  createRiskGroup: async (input: CreateRiskGroupInput) => {
    const name = input.name.trim();
    if (!name) throw new Error('risk-group-name-required');

    const id = createUniqueGroupId(
      name,
      get().riskGroups.map((g) => g.id)
    );

    const allowanceMinutes = input.allowanceMinutes ?? 30;
    const cooldownMinutes = input.cooldownMinutes ?? 60;

    const next: RiskGroup = {
      id,
      name,
      description: input.description?.trim() || 'Custom protected attention group',
      iconName: 'folder-heart',
      iconColor: '#164B38',
      iconBg: '#E8EFE5',
      appIds: [],
      allowanceMinutes,
      cooldownMinutes,
      recoveryActivityId: 'walk',
      currentSessionMinutes: 0,
      isBufferingToday: false,
      origin: 'custom',
    };

    const nextGroups = [...get().riskGroups, next];
    await RhythmCoordinator.getInstance().updateConfig({ riskGroups: nextGroups });
    set({ riskGroups: nextGroups });
    return id;
  },

  saveRiskGroupConfiguration: async (
    groupId: string,
    draft: RiskGroupConfigurationDraft
  ): Promise<SaveRiskGroupResult> => {
    const state = get();
    const existing = state.riskGroups.find((g) => g.id === groupId);
    if (!existing) {
      return { ok: false, groupId, reason: 'group-not-found' };
    }

    const name = draft.name.trim();
    if (!name) {
      return { ok: false, groupId, reason: 'name-required' };
    }

    const currentAllowance = resolveGroupAllowanceMinutes(existing);
    const allowanceChanged = draft.allowanceMinutes !== currentAllowance;
    const todayKey = getLocalDateKey();

    if (allowanceChanged) {
      const validation = validateGroupAllowanceEdit({
        currentMinutes: currentAllowance,
        requestedMinutes: draft.allowanceMinutes,
        lastEditedDateKey: existing.lastAllowanceEditedDateKey,
        todayDateKey: todayKey,
      });
      if (!validation.ok) {
        return {
          ok: false,
          groupId,
          reason: validation.reason ?? 'unavailable',
        };
      }
    }

    const updatedRiskGroups = state.riskGroups.map((group) => {
      if (group.id !== groupId) return group;
      const nextGroup: RiskGroup = {
        ...group,
        name,
        description: draft.description.trim(),
        allowanceMinutes: draft.allowanceMinutes,
        cooldownMinutes: draft.cooldownMinutes,
        recoveryActivityId: draft.recoveryActivityId,
        lastAllowanceEditedDateKey: allowanceChanged ? todayKey : group.lastAllowanceEditedDateKey,
      };
      if (
        group.sessionThresholdMinutes !== undefined ||
        (draft as any).sessionThresholdMinutes !== undefined
      ) {
        nextGroup.sessionThresholdMinutes = draft.allowanceMinutes;
      }
      return nextGroup;
    });

    const updatedWindows = state.routineWindows.map((win) => {
      let protectedGroupIds = [...win.protectedGroupIds];
      if (win.id === 'morning-buffer') {
        if (draft.morningProtected && !protectedGroupIds.includes(groupId)) {
          protectedGroupIds.push(groupId);
        } else if (!draft.morningProtected && protectedGroupIds.includes(groupId)) {
          protectedGroupIds = protectedGroupIds.filter((id) => id !== groupId);
        }
      } else if (win.id === 'evening-wind-down') {
        if (draft.eveningProtected && !protectedGroupIds.includes(groupId)) {
          protectedGroupIds.push(groupId);
        } else if (!draft.eveningProtected && protectedGroupIds.includes(groupId)) {
          protectedGroupIds = protectedGroupIds.filter((id) => id !== groupId);
        }
      }
      return { ...win, protectedGroupIds };
    });

    try {
      await RhythmCoordinator.getInstance().updateConfig({
        riskGroups: updatedRiskGroups,
        routineWindows: updatedWindows,
      });
    } catch {
      return { ok: false, groupId, reason: 'persistence-failed' };
    }

    set({
      riskGroups: updatedRiskGroups,
      routineWindows: updatedWindows,
    });

    if (allowanceChanged) {
      try {
        const { storage } = getPlatformServices();
        await storage.appendHistoryEvent({
          type: 'group-allowance-edited',
          groupId,
          previousMinutes: currentAllowance,
          nextMinutes: draft.allowanceMinutes,
          timestamp: Date.now(),
        });
      } catch {
        // Configuration has already committed.
        // History failure must not report the save itself as failed.
      }
    }

    return { ok: true, groupId };
  },

  saveRiskGroup: async (groupId: string, patch: RiskGroupPatch) => {
    const state = get();
    const existing = state.riskGroups.find((g) => g.id === groupId);
    if (!existing) {
      throw new Error('group-not-found');
    }
    const morningWin = state.routineWindows.find((w) => w.id === 'morning-buffer');
    const eveningWin = state.routineWindows.find((w) => w.id === 'evening-wind-down');
    const morningProtected = morningWin ? morningWin.protectedGroupIds.includes(groupId) : false;
    const eveningProtected = eveningWin ? eveningWin.protectedGroupIds.includes(groupId) : false;

    const draft: RiskGroupConfigurationDraft & { sessionThresholdMinutes?: number } = {
      name: patch.name !== undefined ? patch.name : existing.name,
      description: patch.description !== undefined ? patch.description : (existing.description ?? ''),
      allowanceMinutes:
        patch.allowanceMinutes !== undefined
          ? patch.allowanceMinutes
          : (patch as any).sessionThresholdMinutes !== undefined
          ? (patch as any).sessionThresholdMinutes
          : resolveGroupAllowanceMinutes(existing),
      sessionThresholdMinutes: (patch as any).sessionThresholdMinutes,
      cooldownMinutes: patch.cooldownMinutes !== undefined ? patch.cooldownMinutes : existing.cooldownMinutes,
      recoveryActivityId:
        patch.recoveryActivityId !== undefined
          ? patch.recoveryActivityId
          : resolveGroupRecoveryActivityId(existing),
      morningProtected,
      eveningProtected,
    };

    const res = await get().saveRiskGroupConfiguration(groupId, draft);
    if (!res.ok) {
      throw new Error(res.reason);
    }
  },

  deleteRiskGroup: async (
    groupId: string,
    replacementGroupId?: string
  ): Promise<DeleteRiskGroupResult> => {
    const state = get();
    const target = state.riskGroups.find((g) => g.id === groupId);
    if (!target) {
      return { ok: false, reason: 'group-not-found' };
    }

    const isSeeded = target.origin === 'seeded' || target.id === 'social' || target.id === 'entertainment';
    if (isSeeded) {
      return { ok: false, reason: 'cannot-delete-seeded-group' };
    }

    const coordinator = RhythmCoordinator.getInstance();
    const runtime = coordinator.getRuntimeSnapshot();

    const hasActiveCooldown = Boolean(runtime?.activeCooldowns?.[groupId]);
    const hasActiveSession = runtime?.activeSession?.groupId === groupId;

    if (hasActiveCooldown || hasActiveSession) {
      return {
        ok: false,
        reason: 'active-runtime',
      };
    }

    // Find apps that belong to this group (by app.riskGroupId or target.appIds)
    const members = state.apps.filter(
      (a) => a.riskGroupId === groupId || target.appIds.includes(a.id)
    );

    if (members.length > 0) {
      if (!replacementGroupId) {
        return { ok: false, reason: 'replacement-required' };
      }
      if (replacementGroupId === groupId) {
        return { ok: false, reason: 'invalid-replacement-group' };
      }
      const replacement = state.riskGroups.find((g) => g.id === replacementGroupId);
      if (!replacement) {
        return { ok: false, reason: 'invalid-replacement-group' };
      }
    } else if (replacementGroupId) {
      if (replacementGroupId === groupId) {
        return { ok: false, reason: 'invalid-replacement-group' };
      }
      const replacement = state.riskGroups.find((g) => g.id === replacementGroupId);
      if (!replacement) {
        return { ok: false, reason: 'invalid-replacement-group' };
      }
    }

    // 1. Reassign member apps
    const memberAppIds = new Set(members.map((a) => a.id));
    const updatedApps = state.apps.map((app) => {
      if (memberAppIds.has(app.id)) {
        return {
          ...app,
          riskGroupId: replacementGroupId,
        };
      }
      return app;
    });

    // 2. Remove group from riskGroups & append to replacement group appIds
    const updatedRiskGroups = state.riskGroups
      .filter((g) => g.id !== groupId)
      .map((g) => {
        if (replacementGroupId && g.id === replacementGroupId) {
          const combinedAppIds = Array.from(
            new Set([...g.appIds, ...members.map((a) => a.id)])
          );
          return { ...g, appIds: combinedAppIds };
        }
        return g;
      });

    // 3. Remove group id from routine window protection arrays
    const updatedWindows = state.routineWindows.map((w) => ({
      ...w,
      protectedGroupIds: w.protectedGroupIds.filter((id) => id !== groupId),
    }));

    // 4. Safely reconcile activeRiskGroupId
    let nextActiveRiskGroupId = state.activeRiskGroupId;
    if (nextActiveRiskGroupId === groupId) {
      nextActiveRiskGroupId = replacementGroupId || updatedRiskGroups[0]?.id || 'social';
    }

    // 5. Clean up snapshots
    let updatedSnapshots = state.groupUsageSnapshots;
    if (updatedSnapshots && updatedSnapshots[groupId]) {
      updatedSnapshots = { ...updatedSnapshots };
      delete updatedSnapshots[groupId];
    }

    // Persist one coherent config update
    await RhythmCoordinator.getInstance().updateConfig({
      apps: updatedApps,
      riskGroups: updatedRiskGroups,
      routineWindows: updatedWindows,
    });

    // Dispatch RISK_GROUP_DELETED to engine to purge active cooldowns, leases, usage, and session
    await RhythmCoordinator.getInstance().dispatch({
      type: 'RISK_GROUP_DELETED',
      groupId,
      timestamp: Date.now(),
    });

    set({
      apps: updatedApps,
      riskGroups: updatedRiskGroups,
      routineWindows: updatedWindows,
      activeRiskGroupId: nextActiveRiskGroupId,
      groupUsageSnapshots: updatedSnapshots,
    });

    return { ok: true };
  },

  addNewRiskGroup: async (name: string, description: string): Promise<string> => {
    return get().createRiskGroup({
      name,
      description,
      allowanceMinutes: DEFAULT_DAILY_RISK_ALLOWANCE_MINUTES,
    });
  },

  selectIosRiskGroupApps: async (groupId: string) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Platform } = require('react-native');
      if (Platform.OS !== 'ios') return;
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const RhythmDevice = require('../../modules/rhythm-device').default;
      const result = await RhythmDevice.showFamilyActivityPicker(groupId);
      if (!result) return;

      const state = get();
      const updatedRiskGroups = state.riskGroups.map((group) =>
        group.id === groupId
          ? {
              ...group,
              nativeSelectionRef: result.localSelectionId,
              nativeSelectionCount: result.tokenCount ?? 0,
              nativeSelectionRevision: result.revision ?? ((group.nativeSelectionRevision ?? 0) + 1),
            }
          : group
      );

      set({ riskGroups: updatedRiskGroups });
      await RhythmCoordinator.getInstance().updateConfig({ riskGroups: updatedRiskGroups });
      await get().checkPermissions();
    } catch {
      // User cancelled or unsupported
    }
  },

  setSearchQuery: (query) => set({ searchQuery: query }),
  setFilterClassification: (filterClassification) => set({ filterClassification }),
  setDemoSwitcherVisible: (demoSwitcherVisible) => set({ demoSwitcherVisible }),
  setEmergencyModalVisible: (emergencyModalVisible) => set({ emergencyModalVisible }),

  openTimeSelector: (config) => set({ timeSelector: { ...config, visible: true } }),
  closeTimeSelector: () => set({ timeSelector: { visible: false } }),
  saveSelectedTime: (time) => {
    const { timeSelector } = get();
    if (timeSelector.windowId && timeSelector.field) {
      get().updateRoutineWindow(timeSelector.windowId, {
        [timeSelector.field]: time,
      });
    }
    set({ timeSelector: { visible: false } });
  },

  openAppEdit: (appId) => set({ appEdit: { visible: true, appId } }),
  closeAppEdit: () => set({ appEdit: { visible: false, appId: undefined } }),

  completeOnboarding: () => {
    get().setRhythmState('morning-buffer');
    set({ hasCompletedOnboarding: true });
  },

  // Protected mutation gateway
  requestProtectedMutation: async <T>(
    mutation: ProtectedMutation<T>
  ): Promise<{ status: 'executed' | 'pending-approval' }> => {
    registerDefaultMutationExecutors(get, set);
    const state = get();
    const requires = requiresPartnerApproval(state.accountability, mutation.operation);
    if (!requires) {
      await executeRegisteredMutation(mutation.operation, mutation.payload);
      return { status: 'executed' };
    }

    const currentPending = state.pendingApproval;
    if (currentPending) {
      throw new Error('Another protected change is already awaiting approval');
    }

    const enabledPartners = getEnabledPartners(state.accountability);
    if (enabledPartners.length === 0 && mutation.operation !== 'enable-accountability') {
      throw new Error('No enabled accountability partners available to approve this operation');
    }

    const pending: PendingApproval<T> = {
      id: `approval_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      operation: mutation.operation,
      summary: mutation.summary,
      payload: mutation.payload,
      requestedAt: Date.now(),
    };

    set({ pendingApproval: pending as PendingApproval });
    return { status: 'pending-approval' };
  },

  approveProtectedMutation: async (
    partnerId: string,
    password: string
  ): Promise<ApprovalResult> => {
    registerDefaultMutationExecutors(get, set);
    const state = get();
    const pending = state.pendingApproval;
    if (!pending) {
      return { ok: false, reason: 'partner-not-found' };
    }

    const partner = state.accountability.partners.find((p) => p.id === partnerId);
    const service = getAccountabilityService();

    const result = await service.verifyApproval(
      {
        operation: pending.operation,
        summary: pending.summary,
        partnerId,
      },
      password,
      partner
    );

    if (!result.ok) {
      return result;
    }

    try {
      await executeRegisteredMutation(pending.operation, pending.payload);
      cleanupPendingApprovalSecrets(pending);
      set({ pendingApproval: null });
      return result;
    } catch (error) {
      cleanupPendingApprovalSecrets(pending);
      set({ pendingApproval: null });
      throw error;
    }
  },

  cancelPendingApproval: () => {
    const pending = get().pendingApproval;
    cleanupPendingApprovalSecrets(pending);
    set({ pendingApproval: null });
  },

  // Partner Management Actions
  createAccountabilityPartner: async (params: {
    name: string;
    relationshipLabel?: string;
    password: string;
  }): Promise<AccountabilityPartner> => {
    const state = get();
    if (state.accountability.enabled) {
      const secretRef = createTransientSecretRef(params.password);
      try {
        const result = await get().requestProtectedMutation({
          operation: 'manage-accountability-partner',
          summary: `Add accountability partner "${params.name}"`,
          payload: {
            action: 'create',
            name: params.name,
            relationshipLabel: params.relationshipLabel,
            secretRef,
          } satisfies ManagePartnerMutationPayload,
        });

        if (result.status !== 'pending-approval') {
          deleteTransientSecret(secretRef);
        }
      } catch (error) {
        deleteTransientSecret(secretRef);
        throw error;
      }

      const now = Date.now();
      return {
        id: 'pending',
        name: params.name,
        relationshipLabel: params.relationshipLabel,
        credentialRef: 'pending',
        createdAt: now,
        updatedAt: now,
        enabled: true,
      };
    }

    const service = getAccountabilityService();
    const partner = await service.createPartner(params);
    const nextAccountability: AccountabilitySettings = {
      ...state.accountability,
      partners: [...state.accountability.partners, partner],
    };

    try {
      await RhythmCoordinator.getInstance().updateConfig({
        accountability: nextAccountability,
      });
    } catch (error) {
      try {
        await service.removePartner(partner);
      } catch {
        // Best-effort rollback.
      }
      throw error;
    }

    set({ accountability: nextAccountability });
    return partner;
  },

  updateAccountabilityPartner: async (
    partnerId: string,
    updates: {
      name?: string;
      relationshipLabel?: string;
      enabled?: boolean;
    }
  ): Promise<AccountabilityPartner> => {
    const state = get();
    const existing = state.accountability.partners.find((p) => p.id === partnerId);
    if (!existing) {
      throw new Error('Partner not found');
    }

    if (state.accountability.enabled) {
      if (updates.enabled === false && existing.enabled) {
        const remainingEnabled = state.accountability.partners.filter((p) => p.id !== partnerId && p.enabled);
        if (remainingEnabled.length === 0) {
          throw new Error('Cannot disable the last enabled partner while Accountability Mode is active.');
        }
      }
      await get().requestProtectedMutation({
        operation: 'manage-accountability-partner',
        summary: `Update partner "${existing.name}"`,
        payload: {
          action: 'update',
          partnerId,
          updates,
        } satisfies ManagePartnerMutationPayload,
      });
      return existing;
    }

    const service = getAccountabilityService();
    const updated = service.updatePartnerMetadata(existing, updates);
    const nextAccountability: AccountabilitySettings = {
      ...state.accountability,
      partners: state.accountability.partners.map((p) =>
        p.id === partnerId ? updated : p
      ),
    };

    await RhythmCoordinator.getInstance().updateConfig({
      accountability: nextAccountability,
    });
    set({ accountability: nextAccountability });
    return updated;
  },

  deleteAccountabilityPartner: async (partnerId: string): Promise<void> => {
    const state = get();
    const existing = state.accountability.partners.find((p) => p.id === partnerId);
    if (!existing) {
      throw new Error('Partner not found');
    }

    if (state.accountability.enabled) {
      const remainingEnabled = state.accountability.partners.filter((p) => p.id !== partnerId && p.enabled);
      if (remainingEnabled.length === 0) {
        throw new Error('Cannot remove the last enabled partner while Accountability Mode is active.');
      }
      await get().requestProtectedMutation({
        operation: 'manage-accountability-partner',
        summary: `Remove accountability partner "${existing.name}"`,
        payload: {
          action: 'remove',
          partnerId,
        } satisfies ManagePartnerMutationPayload,
      });
      return;
    }

    const nextAccountability: AccountabilitySettings = {
      ...state.accountability,
      partners: state.accountability.partners.filter((p) => p.id !== partnerId),
    };

    await RhythmCoordinator.getInstance().updateConfig({
      accountability: nextAccountability,
    });
    set({ accountability: nextAccountability });

    // Credential cleanup is secondary (best-effort)
    try {
      const service = getAccountabilityService();
      await service.removePartner(existing);
    } catch {
      // Non-fatal orphan cleanup failure.
    }
  },

  replaceAccountabilityPartnerPassword: async (
    partnerId: string,
    newPassword: string
  ): Promise<void> => {
    const state = get();
    const existing = state.accountability.partners.find((p) => p.id === partnerId);
    if (!existing) {
      throw new Error('Partner not found');
    }

    if (state.accountability.enabled) {
      const secretRef = createTransientSecretRef(newPassword);
      try {
        const result = await get().requestProtectedMutation({
          operation: 'manage-accountability-partner',
          summary: `Change password for partner "${existing.name}"`,
          payload: {
            action: 'replace-password',
            partnerId,
            secretRef,
          } satisfies ManagePartnerMutationPayload,
        });

        if (result.status !== 'pending-approval') {
          deleteTransientSecret(secretRef);
        }
      } catch (error) {
        deleteTransientSecret(secretRef);
        throw error;
      }
      return;
    }

    const service = getAccountabilityService();
    await service.replacePartnerPassword(existing, newPassword);
  },

  enableAccountability: async (
    partnerId: string,
    password: string
  ): Promise<ApprovalResult> => {
    const state = get();
    const enabledPartners = getEnabledPartners(state.accountability);
    if (enabledPartners.length === 0) {
      return { ok: false, reason: 'no-enabled-partners' };
    }

    const partner = state.accountability.partners.find((p) => p.id === partnerId);
    if (!partner || !partner.enabled) {
      return { ok: false, reason: partner ? 'partner-disabled' : 'partner-not-found' };
    }

    const service = getAccountabilityService();
    const result = await service.verifyApproval(
      {
        operation: 'enable-accountability',
        summary: 'Enable Accountability Mode',
        partnerId,
      },
      password,
      partner
    );

    if (result.ok) {
      const nextAccountability: AccountabilitySettings = {
        ...state.accountability,
        enabled: true,
      };
      await RhythmCoordinator.getInstance().updateConfig({
        accountability: nextAccountability,
      });
      set({ accountability: nextAccountability });
    }

    return result;
  },

  disableAccountability: async (
    partnerId: string,
    password: string
  ): Promise<ApprovalResult> => {
    const state = get();
    if (!state.accountability.enabled) {
      return { ok: true, partnerId };
    }

    const partner = state.accountability.partners.find((p) => p.id === partnerId);
    if (!partner || !partner.enabled) {
      return { ok: false, reason: partner ? 'partner-disabled' : 'partner-not-found' };
    }

    const service = getAccountabilityService();
    const result = await service.verifyApproval(
      {
        operation: 'disable-accountability',
        summary: 'Disable Accountability Mode',
        partnerId,
      },
      password,
      partner
    );

    if (result.ok) {
      const nextAccountability: AccountabilitySettings = {
        ...state.accountability,
        enabled: false,
      };
      await RhythmCoordinator.getInstance().updateConfig({
        accountability: nextAccountability,
      });
      set({ accountability: nextAccountability });
    }

    return result;
  },
}));
