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
} from '../domain/insights';

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

  updateAppClassification: (
    appId: string,
    classification: AppClassification,
    riskGroupId?: string
  ) => void;
  updateRiskGroup: (groupId: string, updates: Partial<RiskGroup>) => void;
  updateRoutineWindow: (windowId: string, updates: Partial<RoutineWindow>) => void;
  toggleRoutineDay: (day: number) => void;
  toggleGroupProtection: (windowId: string, groupId: string, enabled: boolean) => void;
  addNewRiskGroup: (name: string, description: string) => string;

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
  insightMetrics: { ...initialInsightMetrics },
  weeklySummary: undefined,
  todaySummary: undefined,
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

      // Load real local insights
      await get().refreshInsights();
    } catch {
      // Fallback
    }
  },

  refreshInsights: async () => {
    try {
      const { storage } = getPlatformServices();
      const windows = get().routineWindows;
      const repo = new LocalInsightsRepository(storage, windows);

      const todayKey = getLocalDateKey();
      const todaySummary = await repo.getDailySummary(todayKey);
      const weeklySummary = await repo.getWeeklySummary(todayKey);

      set({
        todaySummary: todaySummary || undefined,
        weeklySummary,
        insightMetrics: weeklySummary.hasData
          ? {
              protectedTimeTodayMinutes: (todaySummary?.routineProtectedMinutes || 0) + (Object.values(todaySummary?.cooldownMinutesByGroup || {}).reduce((a, b) => a + b, 0)),
              protectedTimeWeeklyHours: Math.round((weeklySummary.totalProtectedMinutes / 60) * 10) / 10,
              averageRiskSessionMinutes: weeklySummary.averageRiskSessionMinutes,
              cooldownTriggersCount: weeklySummary.totalCooldownCount,
              firstRiskAppUseTime: todaySummary?.firstRiskAppUseTime || '08:00',
              finalRiskAppUseTime: todaySummary?.finalRiskAppUseTime || '21:30',
              weeklyTrend: weeklySummary.dailyTrend.map((t) => ({
                day: t.day,
                protectedMinutes: t.protectedMinutes,
                riskMinutes: t.riskMinutes,
              })),
            }
          : get().insightMetrics,
      });
    } catch {
      // Keep existing metrics on error
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
      insightMetrics: { ...initialInsightMetrics },
      weeklySummary: undefined,
      todaySummary: undefined,
      searchQuery: '',
      filterClassification: 'all',
      demoSwitcherVisible: false,
      emergencyModalVisible: false,
      timeSelector: { visible: false },
      appEdit: { visible: false },
    });
  },

  updateAppClassification: (appId, classification, riskGroupId) => {
    set((state) => {
      const targetGroupId = classification === 'risk' ? (riskGroupId || 'social') : undefined;

      const updatedApps = state.apps.map((app) => {
        if (app.id === appId) {
          return {
            ...app,
            classification,
            riskGroupId: targetGroupId,
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

      RhythmCoordinator.getInstance().updateConfig({
        apps: updatedApps,
        riskGroups: updatedRiskGroups,
      }).catch(() => {});

      return { apps: updatedApps, riskGroups: updatedRiskGroups };
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
