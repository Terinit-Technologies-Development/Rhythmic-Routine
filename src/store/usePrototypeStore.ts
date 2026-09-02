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
} from '../types/domain';
import {
  initialApps,
  initialInsightMetrics,
  initialRiskGroups,
  initialRoutineWindows,
  offlineActivities as defaultOfflineActivities,
} from '../data/mockData';
import { getPlatformServices } from '../platform/PlatformServices';
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
  AllowanceEditResult,
  DEFAULT_DAILY_RISK_ALLOWANCE_MINUTES,
} from '../domain/rhythm/allowance';

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

  updateDailyRiskAllowance: (
    appId: string,
    nextMinutes: number
  ) => Promise<AllowanceEditResult>;

  updateAppClassification: (
    appId: string,
    classification: AppClassification,
    riskGroupId?: string
  ) => Promise<void>;
  updateRiskGroup: (groupId: string, updates: Partial<RiskGroup>) => void;
  updateRoutineWindow: (windowId: string, updates: Partial<RoutineWindow>) => void;
  toggleRoutineDay: (day: number) => void;
  toggleGroupProtection: (windowId: string, groupId: string, enabled: boolean) => void;
  addNewRiskGroup: (name: string, description: string) => string;
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
}

// Initial demo timer: 01:18:24 remaining until morning unlock
const INITIAL_TIMER_MS = (1 * 3600 + 18 * 60 + 24) * 1000;

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
  dailyUsageLoading: false,
  dailyUsageError: undefined,
  insightDataState: getPlatformOS() === 'web' ? 'demo-web' : 'loading',
  hasCompletedOnboarding: true,
  permissionState: {
    usageAccess: 'unknown',
    restrictionAuthorization: 'unknown',
    restrictionCapability: 'foundation-only',
  },

  searchQuery: '',
  filterClassification: 'all',

  demoSwitcherVisible: false,
  emergencyModalVisible: false,
  timeSelector: { visible: false },
  appEdit: { visible: false },

  initializeApps: async () => {
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
      const snapshot =
        (await usage.reconcileDailyUsage?.()) ??
        (await usage.getDailyUsageSnapshot?.());

      if (!snapshot) {
        set({
          dailyUsageSnapshot: undefined,
          dailyUsageLoading: false,
        });
        return;
      }

      const currentApps = get().apps;
      const hydratedApps = hydrateAppsWithDailyUsage(currentApps, snapshot);

      set({
        apps: hydratedApps,
        dailyUsageSnapshot: snapshot,
        dailyUsageLoading: false,
      });
    } catch {
      set({
        dailyUsageLoading: false,
        dailyUsageError: 'Usage unavailable',
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

        const firstRiskTime =
          observedAggregation?.firstRiskUseTime ?? (todaySummary?.firstRiskAppUseTime || '—');
        const finalRiskTime =
          observedAggregation?.finalRiskUseTime ?? (todaySummary?.finalRiskAppUseTime || '—');

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
      insightMetrics: getPlatformOS() === 'web' ? { ...initialInsightMetrics } : { ...emptyInsightMetrics },
      weeklySummary: undefined,
      todaySummary: undefined,
      dailyUsageSnapshot: undefined,
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

  updateDailyRiskAllowance: async (appId, nextMinutes) => {
    const result = await RhythmCoordinator.getInstance().updateDailyRiskAllowance(appId, nextMinutes);
    if (result.allowed) {
      const config = RhythmCoordinator.getInstance().getConfig();
      if (config) {
        const snapshot = get().dailyUsageSnapshot;
        set({ apps: hydrateAppsWithDailyUsage(config.apps, snapshot) });
      }
      await get().refreshDailyUsage();
    }
    return result;
  },

  updateAppClassification: async (appId, classification, riskGroupId) => {
    const state = get();
    const targetGroupId = classification === 'risk' ? (riskGroupId || 'social') : undefined;

    const updatedApps = state.apps.map((app) => {
      if (app.id === appId) {
        let dailyRiskAllowance = app.dailyRiskAllowance;
        if (classification === 'risk' && !dailyRiskAllowance) {
          dailyRiskAllowance = {
            allowanceMinutes: DEFAULT_DAILY_RISK_ALLOWANCE_MINUTES,
          };
        }
        return {
          ...app,
          classification,
          riskGroupId: targetGroupId,
          dailyRiskAllowance,
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

  updateRiskGroup: (groupId, updates) => {
    set((state) => {
      const updatedRiskGroups = state.riskGroups.map((g) =>
        g.id === groupId ? { ...g, ...updates } : g
      );

      RhythmCoordinator.getInstance().updateConfig({
        riskGroups: updatedRiskGroups,
      }).catch(() => {});

      return { riskGroups: updatedRiskGroups };
    });
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

  addNewRiskGroup: (name, description) => {
    const existingIds = get().riskGroups.map((g) => g.id);
    const id = createUniqueGroupId(name, existingIds);

    const newGroup: RiskGroup = {
      id,
      name,
      description,
      iconName: 'folder-heart',
      iconColor: '#164B38',
      iconBg: '#E8EFE5',
      appIds: [],
      sessionThresholdMinutes: 30,
      cooldownMinutes: 60,
      currentSessionMinutes: 0,
      isBufferingToday: false,
    };

    const nextGroups = [...get().riskGroups, newGroup];
    set({ riskGroups: nextGroups });

    RhythmCoordinator.getInstance().updateConfig({
      riskGroups: nextGroups,
    }).catch(() => {});

    return id;
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
}));
