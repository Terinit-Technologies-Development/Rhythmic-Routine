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
import { mockRestrictionProvider } from '../platform/mock/MockRestrictionProvider';

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
  countdownSeconds: number; // e.g. 4704 = 01:18:24
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

  // Actions
  setRhythmState: (state: RhythmState) => void;
  simulateCooldown: (groupId?: string) => void;
  simulateRiskSession: (groupId?: string) => void;
  resetDemo: () => void;

  updateAppClassification: (
    appId: string,
    classification: AppClassification,
    riskGroupId?: string
  ) => void;
  updateRiskGroup: (groupId: string, updates: Partial<RiskGroup>) => void;
  updateRoutineWindow: (windowId: string, updates: Partial<RoutineWindow>) => void;
  toggleRoutineDay: (day: number) => void;
  toggleGroupInRoutineWindow: (windowId: string, groupId: string) => void;
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
  triggerEmergencyBypass: () => void;
  tickCountdown: () => void;
}

const getDefaultTimer = (state: RhythmState): number => {
  switch (state) {
    case 'morning-buffer':
      return 1 * 3600 + 18 * 60 + 24; // 01:18:24
    case 'cooldown':
      return 1 * 3600 + 12 * 60 + 34; // 01:12:34
    case 'risk-session':
      return 12 * 60 + 0; // 12:00 left of 30 min session
    case 'evening-wind-down':
      return 2 * 3600 + 45 * 60; // 02:45:00
    case 'available':
    default:
      return 0;
  }
};

export const usePrototypeStore = create<PrototypeState>((set, get) => ({
  rhythmState: 'morning-buffer',
  activeRiskGroupId: 'social',
  countdownSeconds: 1 * 3600 + 18 * 60 + 24, // 01:18:24
  apps: [...initialApps],
  riskGroups: [...initialRiskGroups],
  routineWindows: [...initialRoutineWindows],
  offlineActivities: [...defaultOfflineActivities],
  insightMetrics: { ...initialInsightMetrics },
  hasCompletedOnboarding: true, // starts true for immediate exploration; onboarding is fully accessible from switcher or route

  searchQuery: '',
  filterClassification: 'all',

  demoSwitcherVisible: false,
  emergencyModalVisible: false,
  timeSelector: { visible: false },
  appEdit: { visible: false },

  setRhythmState: (state: RhythmState) => {
    const timer = getDefaultTimer(state);
    set({ rhythmState: state, countdownSeconds: timer });

    // Sync mock restrictions
    const { riskGroups } = get();
    const socialGroup = riskGroups.find((g) => g.id === 'social');
    if (socialGroup) {
      if (state === 'morning-buffer' || state === 'cooldown' || state === 'evening-wind-down') {
        mockRestrictionProvider.applyRestrictions(socialGroup.appIds);
      } else {
        mockRestrictionProvider.clearRestrictions(socialGroup.appIds);
      }
    }
  },

  simulateCooldown: (groupId = 'social') => {
    const group = get().riskGroups.find((g) => g.id === groupId);
    const cooldownSeconds = (group ? group.cooldownMinutes : 90) * 60;
    set({
      rhythmState: 'cooldown',
      activeRiskGroupId: groupId,
      countdownSeconds: cooldownSeconds,
    });
    if (group) {
      mockRestrictionProvider.applyRestrictions(group.appIds);
    }
  },

  simulateRiskSession: (groupId = 'social') => {
    set({
      rhythmState: 'risk-session',
      activeRiskGroupId: groupId,
      countdownSeconds: 12 * 60,
    });
  },

  resetDemo: () => {
    set({
      rhythmState: 'morning-buffer',
      activeRiskGroupId: 'social',
      countdownSeconds: 1 * 3600 + 18 * 60 + 24,
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
      const updatedApps = state.apps.map((app) => {
        if (app.id === appId) {
          return {
            ...app,
            classification,
            riskGroupId: classification === 'risk' ? riskGroupId || app.riskGroupId || 'social' : undefined,
          };
        }
        return app;
      });

      // Also update risk groups membership
      const updatedRiskGroups = state.riskGroups.map((group) => {
        const hasApp = group.appIds.includes(appId);
        const shouldHave = classification === 'risk' && (riskGroupId || 'social') === group.id;

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
      routineWindows: state.routineWindows.map((w) => (w.id === windowId ? { ...w, ...updates } : w)),
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

  toggleGroupInRoutineWindow: (windowId, groupId) => {
    set((state) => ({
      routineWindows: state.routineWindows.map((w) => {
        if (w.id === windowId) {
          const hasGroup = w.protectedGroupIds.includes(groupId);
          return {
            ...w,
            protectedGroupIds: hasGroup
              ? w.protectedGroupIds.filter((id) => id !== groupId)
              : [...w.protectedGroupIds, groupId],
          };
        }
        return w;
      }),
    }));
  },

  addNewRiskGroup: (name, description) => {
    const id = name.toLowerCase().replace(/\s+/g, '-');
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
      routineWindowIds: ['morning-buffer', 'evening-wind-down'],
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

  completeOnboarding: () => set({ hasCompletedOnboarding: true, rhythmState: 'morning-buffer' }),

  triggerEmergencyBypass: () => {
    set({
      rhythmState: 'available',
      emergencyModalVisible: false,
      countdownSeconds: 0,
    });
    mockRestrictionProvider.clearRestrictions(get().apps.map((a) => a.id));
  },

  tickCountdown: () => {
    set((state) => {
      if (state.countdownSeconds > 0) {
        return { countdownSeconds: state.countdownSeconds - 1 };
      }
      return state;
    });
  },
}));
