import { create } from 'zustand';
import {
  AppClassification,
  DeviceApp,
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
import {
  createUniqueGroupId,
  getRestrictableAppIds,
  getRoutineWindow,
} from '../domain/selectors';

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
  // Domain data
  rhythmState: RhythmState;
  activeRiskGroupId: string;
  activeTimerEndsAt?: number; // Absolute timestamp for countdowns
  apps: DeviceApp[];
  riskGroups: RiskGroup[];
  routineWindows: RoutineWindow[];
  offlineActivities: OfflineActivity[];
  insightMetrics: InsightMetrics;
  hasCompletedOnboarding: boolean;

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
  setRhythmState: (state: RhythmState) => Promise<void>;
  simulateCooldown: (groupId?: string) => Promise<void>;
  simulateRiskSession: (groupId?: string) => void;
  resolveExpiredTimer: () => Promise<void>;
  resetDemo: () => Promise<void>;

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
  triggerEmergencyBypass: () => Promise<void>;
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
  hasCompletedOnboarding: true,

  searchQuery: '',
  filterClassification: 'all',

  demoSwitcherVisible: false,
  emergencyModalVisible: false,
  timeSelector: { visible: false },
  appEdit: { visible: false },

  initializeApps: async () => {
    try {
      const { usage } = getPlatformServices();
      const deviceApps = await usage.getInstalledApps();
      if (deviceApps && deviceApps.length > 0) {
        set({ apps: deviceApps });
      }
    } catch {
      // Fallback to initialApps
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

    // Sync restrictions via PlatformServices with Essential-App safety
    const { restrictions } = getPlatformServices();
    const { routineWindows, riskGroups, apps } = get();

    if (state === 'morning-buffer') {
      const morningWin = getRoutineWindow(routineWindows, 'morning-buffer');
      const protectedGroupIds = morningWin?.protectedGroupIds || [];
      const protectedAppIds = riskGroups
        .filter((g) => protectedGroupIds.includes(g.id))
        .flatMap((g) => g.appIds);
      const restrictable = getRestrictableAppIds(protectedAppIds, apps);
      await restrictions.applyRestrictions(restrictable);
    } else if (state === 'evening-wind-down') {
      const eveningWin = getRoutineWindow(routineWindows, 'evening-wind-down');
      const protectedGroupIds = eveningWin?.protectedGroupIds || [];
      const protectedAppIds = riskGroups
        .filter((g) => protectedGroupIds.includes(g.id))
        .flatMap((g) => g.appIds);
      const restrictable = getRestrictableAppIds(protectedAppIds, apps);
      await restrictions.applyRestrictions(restrictable);
    } else if (state === 'cooldown') {
      const activeGroup = riskGroups.find((g) => g.id === get().activeRiskGroupId);
      if (activeGroup) {
        const restrictable = getRestrictableAppIds(activeGroup.appIds, apps);
        await restrictions.applyRestrictions(restrictable);
      }
    } else {
      await restrictions.clearRestrictions(apps.map((a) => a.id));
    }
  },

  simulateCooldown: async (groupId = 'social') => {
    const group = get().riskGroups.find((g) => g.id === groupId);
    const durationMs = (group?.cooldownMinutes ?? 90) * 60 * 1000;

    set({
      rhythmState: 'cooldown',
      activeRiskGroupId: groupId,
      activeTimerEndsAt: Date.now() + durationMs,
    });

    if (group) {
      const { restrictions } = getPlatformServices();
      const restrictable = getRestrictableAppIds(group.appIds, get().apps);
      await restrictions.applyRestrictions(restrictable);
    }
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
      const group = state.riskGroups.find((g) => g.id === state.activeRiskGroupId);
      if (group) {
        const { restrictions } = getPlatformServices();
        await restrictions.clearRestrictions(group.appIds);
      }

      set({
        rhythmState: 'available',
        activeTimerEndsAt: undefined,
      });
    }
  },

  resetDemo: async () => {
    const { restrictions } = getPlatformServices();
    await restrictions.clearRestrictions(initialApps.map((a) => a.id));

    set({
      rhythmState: 'morning-buffer',
      activeRiskGroupId: 'social',
      activeTimerEndsAt: Date.now() + INITIAL_TIMER_MS,
      apps: [...initialApps],
      riskGroups: [...initialRiskGroups],
      routineWindows: [...initialRoutineWindows],
      offlineActivities: [...defaultOfflineActivities],
      insightMetrics: { ...initialInsightMetrics },
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

      return { apps: updatedApps, riskGroups: updatedRiskGroups };
    });
  },

  updateRiskGroup: (groupId, updates) => {
    set((state) => ({
      riskGroups: state.riskGroups.map((g) => (g.id === groupId ? { ...g, ...updates } : g)),
    }));
  },

  updateRoutineWindow: (windowId, updates) => {
    set((state) => ({
      routineWindows: state.routineWindows.map((w) =>
        w.id === windowId ? { ...w, ...updates } : w
      ),
    }));
  },

  toggleRoutineDay: (day) => {
    set((state) => {
      const morningWin = state.routineWindows.find((w) => w.id === 'morning-buffer');
      const currentDays = morningWin ? morningWin.activeDays : [1, 2, 3, 4, 5, 6, 7];
      const newDays = currentDays.includes(day)
        ? currentDays.filter((d) => d !== day)
        : [...currentDays, day].sort();

      return {
        routineWindows: state.routineWindows.map((w) => ({ ...w, activeDays: newDays })),
      };
    });
  },

  toggleGroupProtection: (windowId, groupId, enabled) => {
    set((state) => ({
      routineWindows: state.routineWindows.map((w) => {
        if (w.id !== windowId) return w;

        const currentIds = w.protectedGroupIds;
        const nextIds = enabled
          ? Array.from(new Set([...currentIds, groupId]))
          : currentIds.filter((id) => id !== groupId);

        return {
          ...w,
          protectedGroupIds: nextIds,
        };
      }),
    }));
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

    set((state) => ({ riskGroups: [...state.riskGroups, newGroup] }));
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

  triggerEmergencyBypass: async () => {
    const { restrictions } = getPlatformServices();
    await restrictions.clearRestrictions(get().apps.map((a) => a.id));

    set({
      rhythmState: 'available',
      activeTimerEndsAt: undefined,
      emergencyModalVisible: false,
    });
  },
}));
