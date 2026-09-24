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
import { getPrimaryCooldown, RhythmRuntime } from '../domain/rhythm/types';
import { deriveAttentionGateStatus, AttentionGateStatus, ActiveReadingGate, DailyAttentionExchangeState } from '../domain/rhythm/attentionExchange';
import { ReadingEvidenceSnapshot } from '../domain/rhythm/readingEvidence';
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
  AppPolicyPayload,
  ApprovalResult,
  IOSSelectionEditPayload,
  ManagePartnerMutationPayload,
  PendingApproval,
  ProtectedMutation,
  RoutineScheduleEditPayload,
} from '../domain/accountability/types';
import {
  PROTECTED_OPERATIONS,
  requiresPartnerApproval,
  getEnabledPartners,
  formatDays,
} from '../domain/accountability/policy';
import {
  getAccountabilityService,
  resetAccountabilityService,
} from '../application/AccountabilityService';
import { InMemorySecureCredentialProvider } from '../platform/SecureCredentialProvider';

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

function projectPrimaryAttentionStatus(runtime: RhythmRuntime, now: number): AttentionGateStatus | undefined {
  const gates = runtime.activeReadingGates ?? {};
  const cooldowns = runtime.activeCooldowns ?? {};
  const hasAttention = (groupId: string) =>
    Boolean(gates[groupId] || (cooldowns[groupId] && cooldowns[groupId].endsAt > now));

  const foregroundGroupId = runtime.nativeForegroundGroupId;
  const activeSessionGroupId = runtime.activeSession?.groupId;
  const primaryCooldown = getPrimaryCooldown(runtime, now)?.groupId;
  const candidates = [
    foregroundGroupId,
    activeSessionGroupId,
    primaryCooldown,
    ...Object.values(gates)
      .sort((a, b) => b.dailyCooldownOrdinal - a.dailyCooldownOrdinal || b.createdAt - a.createdAt || a.groupId.localeCompare(b.groupId))
      .map((gate) => gate.groupId),
    ...Object.values(cooldowns)
      .filter((cooldown) => cooldown.endsAt > now)
      .sort((a, b) => b.startedAt - a.startedAt || a.groupId.localeCompare(b.groupId))
      .map((cooldown) => cooldown.groupId),
  ].filter((groupId): groupId is string => Boolean(groupId && hasAttention(groupId)));
  const groupId = candidates[0];
  if (!groupId) return undefined;
  return deriveAttentionGateStatus({
    groupId,
    gate: gates[groupId],
    cooldown: cooldowns[groupId],
    evidence: runtime.readingEvidence,
    now,
    currentDateKey: getLocalDateKey(now),
  });
}

function attentionStateProjection(runtime: RhythmRuntime, now = Date.now()) {
  return {
    activeAttentionGateStatus: projectPrimaryAttentionStatus(runtime, now),
    activeReadingGates: Object.fromEntries(
      Object.entries(runtime.activeReadingGates ?? {}).map(([groupId, gate]) => [groupId, { ...gate }])
    ) as Record<string, ActiveReadingGate>,
    dailyAttentionExchange: runtime.dailyAttentionExchange
      ? { ...runtime.dailyAttentionExchange }
      : undefined,
    readingEvidence: runtime.readingEvidence ? { ...runtime.readingEvidence } : undefined,
  };
}

interface PrototypeState {
  // Domain data (projected from RhythmCoordinator / Engine)
  rhythmState: RhythmState;
  activeRiskGroupId: string;
  activeTimerEndsAt?: number; // Absolute timestamp for countdowns
  activeAttentionGateStatus?: AttentionGateStatus;
  activeReadingGates?: Record<string, ActiveReadingGate>;
  dailyAttentionExchange?: DailyAttentionExchangeState;
  readingEvidence?: ReadingEvidenceSnapshot;
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
  refreshReadingEvidence: () => Promise<void>;
  openRhythmicReader: () => Promise<boolean>;
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
  updateRoutineWindow: (windowId: string, updates: Partial<RoutineWindow>) => Promise<void>;
  toggleRoutineDay: (day: number) => Promise<void>;
  toggleGroupProtection: (windowId: string, groupId: string, enabled: boolean) => Promise<void>;
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
  saveSelectedTime: (time: string) => Promise<void>;

  openAppEdit: (appId: string) => void;
  closeAppEdit: () => void;

  completeOnboarding: () => void;

  // Accountability
  accountability: AccountabilitySettings;
  pendingApproval: PendingApproval | null;

  // Protected mutation gateway & accountability actions
  requestProtectedMutation: (
    mutation: ProtectedMutation
  ) => Promise<{ status: 'executed' | 'pending-approval'; result?: unknown }>;
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
const inFlightApprovalIds = new Set<string>();
let protectedMutationInFlight = false;

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
  if (!pending) return;
  if (pending.operation === 'manage-accountability-partner') {
    const payload = pending.payload as ManagePartnerMutationPayload | undefined;
    if (payload && (payload.action === 'create' || payload.action === 'replace-password')) {
      deleteTransientSecret(payload.secretRef);
    }
  } else if (pending.operation === 'edit-ios-risk-group-selection') {
    const payload = pending.payload as IOSSelectionEditPayload | undefined;
    if (payload?.stagedSelectionRef) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const RhythmDevice = require('../../modules/rhythm-device').default;
        void RhythmDevice.discardStagedFamilyActivitySelection(payload.stagedSelectionRef);
      } catch {
        // Best effort
      }
    }
  }
}

type StoreGet = () => PrototypeState;
type StoreSet = (partial: Partial<PrototypeState> | ((state: PrototypeState) => Partial<PrototypeState>)) => void;

function clonePayload<T>(value: T, seen = new WeakMap<object, unknown>()): T {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value as object)) throw new Error('Protected mutation payload must not contain cycles');
  const clone: any = Array.isArray(value) ? [] : {};
  seen.set(value as object, clone);
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    clone[key] = clonePayload(child, seen);
  }
  seen.delete(value as object);
  return clone;
}

function freezePayload<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freezePayload(child);
  }
  return value;
}

function captureProtectedStateSnapshot(state: PrototypeState): string {
  return JSON.stringify({
    accountability: state.accountability,
    apps: state.apps.map(({ id, classification, riskGroupId }) => ({ id, classification, riskGroupId })),
    riskGroups: state.riskGroups.map((group) => ({
      id: group.id,
      name: group.name,
      description: group.description,
      appIds: group.appIds,
      allowanceMinutes: group.allowanceMinutes,
      sessionThresholdMinutes: group.sessionThresholdMinutes,
      lastAllowanceEditedDateKey: group.lastAllowanceEditedDateKey,
      cooldownMinutes: group.cooldownMinutes,
      recoveryActivityId: group.recoveryActivityId,
      nativeSelectionRef: group.nativeSelectionRef,
      nativeSelectionCount: group.nativeSelectionCount,
      nativeSelectionRevision: group.nativeSelectionRevision,
      origin: group.origin,
    })),
    routineWindows: state.routineWindows.map((window) => ({
      id: window.id,
      name: window.name,
      type: window.type,
      startTime: window.startTime,
      endTime: window.endTime,
      activeDays: window.activeDays,
      protectedGroupIds: window.protectedGroupIds,
      enabled: window.enabled,
    })),
  });
}

async function executeCreateRiskGroup(get: StoreGet, set: StoreSet, input: CreateRiskGroupInput): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new Error('risk-group-name-required');

  const id = createUniqueGroupId(name, get().riskGroups.map((group) => group.id));
  const next: RiskGroup = {
    id,
    name,
    description: input.description?.trim() || 'Custom protected attention group',
    iconName: 'folder-heart',
    iconColor: '#164B38',
    iconBg: '#E8EFE5',
    appIds: [],
    allowanceMinutes: input.allowanceMinutes ?? 30,
    cooldownMinutes: input.cooldownMinutes ?? 60,
    recoveryActivityId: 'walk',
    currentSessionMinutes: 0,
    isBufferingToday: false,
    origin: 'custom',
  };
  const nextGroups = [...get().riskGroups, next];
  await RhythmCoordinator.getInstance().updateConfig({ riskGroups: nextGroups });
  set({ riskGroups: nextGroups });
  return id;
}

async function executeSaveRiskGroupConfiguration(
  get: StoreGet,
  set: StoreSet,
  groupId: string,
  draft: RiskGroupConfigurationDraft
): Promise<SaveRiskGroupResult> {
  const state = get();
  const existing = state.riskGroups.find((group) => group.id === groupId);
  if (!existing) return { ok: false, groupId, reason: 'group-not-found' };

  const name = draft.name.trim();
  if (!name) return { ok: false, groupId, reason: 'name-required' };

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
      return { ok: false, groupId, reason: validation.reason ?? 'unavailable' };
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
    if (group.sessionThresholdMinutes !== undefined || (draft as any).sessionThresholdMinutes !== undefined) {
      nextGroup.sessionThresholdMinutes = draft.allowanceMinutes;
    }
    return nextGroup;
  });

  const updatedWindows = state.routineWindows.map((window) => {
    let protectedGroupIds = [...window.protectedGroupIds];
    if (window.id === 'morning-buffer') {
      protectedGroupIds = draft.morningProtected
        ? Array.from(new Set([...protectedGroupIds, groupId]))
        : protectedGroupIds.filter((id) => id !== groupId);
    } else if (window.id === 'evening-wind-down') {
      protectedGroupIds = draft.eveningProtected
        ? Array.from(new Set([...protectedGroupIds, groupId]))
        : protectedGroupIds.filter((id) => id !== groupId);
    }
    return { ...window, protectedGroupIds };
  });

  try {
    await RhythmCoordinator.getInstance().updateConfig({
      riskGroups: updatedRiskGroups,
      routineWindows: updatedWindows,
    });
  } catch {
    return { ok: false, groupId, reason: 'persistence-failed' };
  }
  set({ riskGroups: updatedRiskGroups, routineWindows: updatedWindows });

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
      // Configuration has already committed; history is best-effort.
    }
  }
  return { ok: true, groupId };
}

async function executeDeleteRiskGroup(
  get: StoreGet,
  set: StoreSet,
  groupId: string,
  replacementGroupId?: string
): Promise<DeleteRiskGroupResult> {
  const state = get();
  const target = state.riskGroups.find((group) => group.id === groupId);
  if (!target) return { ok: false, reason: 'group-not-found' };
  if (target.origin === 'seeded' || groupId === 'social' || groupId === 'entertainment') {
    return { ok: false, reason: 'cannot-delete-seeded-group' };
  }

  const coordinator = RhythmCoordinator.getInstance();
  const runtime = coordinator.getRuntimeSnapshot();
  if (runtime?.activeCooldowns?.[groupId] || runtime?.activeSession?.groupId === groupId) {
    return { ok: false, reason: 'active-runtime' };
  }

  const members = state.apps.filter((app) => app.riskGroupId === groupId || target.appIds.includes(app.id));
  if (members.length > 0 && !replacementGroupId) return { ok: false, reason: 'replacement-required' };
  if (replacementGroupId) {
    const replacement = state.riskGroups.find((group) => group.id === replacementGroupId);
    if (!replacement || replacementGroupId === groupId) return { ok: false, reason: 'invalid-replacement-group' };
  }

  const memberIds = new Set(members.map((app) => app.id));
  const updatedApps = state.apps.map((app) => memberIds.has(app.id) ? { ...app, riskGroupId: replacementGroupId } : app);
  const updatedRiskGroups = state.riskGroups
    .filter((group) => group.id !== groupId)
    .map((group) => replacementGroupId && group.id === replacementGroupId
      ? { ...group, appIds: Array.from(new Set([...group.appIds, ...members.map((app) => app.id)])) }
      : group);
  const updatedWindows = state.routineWindows.map((window) => ({
    ...window,
    protectedGroupIds: window.protectedGroupIds.filter((id) => id !== groupId),
  }));
  const activeRiskGroupId = state.activeRiskGroupId === groupId
    ? replacementGroupId || updatedRiskGroups[0]?.id || 'social'
    : state.activeRiskGroupId;
  const groupUsageSnapshots = state.groupUsageSnapshots ? { ...state.groupUsageSnapshots } : undefined;
  if (groupUsageSnapshots) delete groupUsageSnapshots[groupId];

  await coordinator.updateConfig({ apps: updatedApps, riskGroups: updatedRiskGroups, routineWindows: updatedWindows });
  await coordinator.dispatch({ type: 'RISK_GROUP_DELETED', groupId, timestamp: Date.now() });
  set({ apps: updatedApps, riskGroups: updatedRiskGroups, routineWindows: updatedWindows, activeRiskGroupId, groupUsageSnapshots });
  return { ok: true };
}

async function executeResetLocalState(get: StoreGet, set: StoreSet): Promise<void> {
  const coordinator = RhythmCoordinator.getInstance();
  const { storage, credentials } = getPlatformServices();
  const service = getAccountabilityService();
  const existingPartners = get().accountability?.partners ?? [];

  // Fail before deleting JavaScript preferences or partner credentials if the
  // platform-owned Pass 03 state cannot be reset.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const RhythmDevice = require('../../modules/rhythm-device').default;
  const nativeResetSucceeded = await RhythmDevice.resetEnforcementState();
  if (nativeResetSucceeded === false) {
    throw new Error('Unable to clear native enforcement state during reset');
  }

  await storage.clearAll();
  for (const partner of existingPartners) {
    try {
      await service.removePartner(partner);
    } catch {
      // Best-effort credential cleanup.
    }
  }
  if (credentials instanceof InMemorySecureCredentialProvider) credentials.clear();
  transientApprovalSecrets.clear();
  inFlightApprovalIds.clear();

  resetAccountabilityService();
  coordinator.destroy();
  const runtime = await coordinator.initialize();
  const config = coordinator.getConfiguration();
  const primaryCooldown = getPrimaryCooldown(runtime);
  set({
    rhythmState: runtime.state,
    activeRiskGroupId: primaryCooldown?.groupId ?? runtime.activeSession?.groupId ?? 'social',
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
}

type MutationAuthorization =
  | { kind: 'disabled-mode' }
  | { kind: 'partner-approved'; partnerId: string; expectedEnabled: boolean };

async function executeRegisteredMutation(
  operation: AccountabilityOperation,
  payload: unknown,
  authorization: MutationAuthorization,
  get: StoreGet,
  alreadyLocked = false
): Promise<unknown> {
  const executor = mutationExecutors.get(operation);
  if (!executor) {
    throw new Error(`No protected mutation executor registered for ${operation}`);
  }
  if (!alreadyLocked) {
    if (protectedMutationInFlight) throw new Error('A protected change is already being applied');
    protectedMutationInFlight = true;
  }
  try {
    const currentSettings = get().accountability;
    if (authorization.kind === 'disabled-mode') {
      if (requiresPartnerApproval(currentSettings, operation)) {
        throw new Error('Partner approval is required for this protected change');
      }
    } else {
      if (currentSettings.enabled !== authorization.expectedEnabled) {
        throw new Error('Accountability state changed while approval was pending');
      }
      const approvingPartner = currentSettings.partners.find((partner) => partner.id === authorization.partnerId);
      if (!approvingPartner?.enabled) throw new Error('Approving partner is no longer enabled');
    }
    return await executor(payload);
  } finally {
    if (!alreadyLocked) protectedMutationInFlight = false;
  }
}

function registerDefaultMutationExecutors(
  get: () => PrototypeState,
  set: (partial: Partial<PrototypeState> | ((state: PrototypeState) => Partial<PrototypeState>)) => void
) {
  if (mutationExecutors.size > 0) return;

  mutationExecutors.set('enable-accountability', async () => {
    const state = get();
    if (state.accountability.enabled) return;
    if (getEnabledPartners(state.accountability).length === 0) {
      throw new Error('At least one enabled accountability partner is required');
    }
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
    if (!state.accountability.enabled) return;
    const nextAccountability: AccountabilitySettings = {
      ...state.accountability,
      enabled: false,
    };
    await RhythmCoordinator.getInstance().updateConfig({
      accountability: nextAccountability,
    });
    set({ accountability: nextAccountability });
  });

  mutationExecutors.set('change-app-classification', async (payload: AppPolicyPayload) => {
    const { appId, classification, riskGroupId, dailyAllowanceMinutes } = payload;
    const state = get();

    // 1. Target existence check
    const targetApp = state.apps.find((a) => a.id === appId);
    if (!targetApp) {
      throw new Error('App not found');
    }

    const targetGroupId = classification === 'risk' ? (riskGroupId || 'social') : undefined;
    if (classification === 'risk' && targetGroupId) {
      const groupExists = state.riskGroups.some((g) => g.id === targetGroupId);
      if (!groupExists) {
        throw new Error('Risk group not found');
      }
    }

    // 2. Validate allowance edit if requested
    if (dailyAllowanceMinutes !== undefined && targetGroupId && classification === 'risk') {
      const group = state.riskGroups.find((g) => g.id === targetGroupId);
      if (group) {
        const currentAllowance = resolveGroupAllowanceMinutes(group);
        if (dailyAllowanceMinutes !== currentAllowance) {
          const validation = validateGroupAllowanceEdit({
            currentMinutes: currentAllowance,
            requestedMinutes: dailyAllowanceMinutes,
            lastEditedDateKey: group.lastAllowanceEditedDateKey,
            todayDateKey: getLocalDateKey(),
          });
          if (!validation.ok) {
            throw new Error(`Invalid allowance: ${validation.reason}`);
          }
        }
      }
    }

    // 3. Atomically commit classification and allowance
    const updatedApps = state.apps.map((app) => {
      if (app.id === appId) {
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

    const todayKey = getLocalDateKey();
    const updatedRiskGroups = state.riskGroups.map((group) => {
      const hasApp = group.appIds.includes(appId);
      const shouldHave = classification === 'risk' && group.id === targetGroupId;
      let nextGroup = group;

      if (shouldHave && !hasApp) {
        nextGroup = { ...nextGroup, appIds: [...nextGroup.appIds, appId] };
      } else if (!shouldHave && hasApp) {
        nextGroup = { ...nextGroup, appIds: nextGroup.appIds.filter((id) => id !== appId) };
      }

      if (
        shouldHave &&
        dailyAllowanceMinutes !== undefined &&
        dailyAllowanceMinutes !== resolveGroupAllowanceMinutes(group)
      ) {
        nextGroup = {
          ...nextGroup,
          allowanceMinutes: dailyAllowanceMinutes,
          lastAllowanceEditedDateKey: todayKey,
        };
      }

      return nextGroup;
    });

    await RhythmCoordinator.getInstance().updateConfig({
      apps: updatedApps,
      riskGroups: updatedRiskGroups,
    });

    set({
      apps: updatedApps,
      riskGroups: updatedRiskGroups,
    });
  });

  mutationExecutors.set('change-daily-allowance', async ({ groupId, allowanceMinutes }) => {
    const state = get();
    const group = state.riskGroups.find((g) => g.id === groupId);
    if (!group) {
      throw new Error('Risk group not found');
    }
    const result = await RhythmCoordinator.getInstance().updateRiskGroupAllowance(groupId, allowanceMinutes);
    if (result.ok) {
      const config = RhythmCoordinator.getInstance().getConfig();
      if (config) set({ riskGroups: [...config.riskGroups] });
      await get().refreshDailyUsage();
    }
    return result;
  });

  mutationExecutors.set('create-risk-group', async (input) => {
    return await executeCreateRiskGroup(get, set, input);
  });

  mutationExecutors.set('edit-risk-group', async ({ groupId, draft }) => {
    return await executeSaveRiskGroupConfiguration(get, set, groupId, draft);
  });

  mutationExecutors.set('delete-risk-group', async ({ groupId, replacementGroupId }) => {
    return await executeDeleteRiskGroup(get, set, groupId, replacementGroupId);
  });

  mutationExecutors.set('edit-risk-group-protection', async ({ windowId, groupId, enabled }) => {
    const state = get();
    if (!state.riskGroups.some((group) => group.id === groupId)) throw new Error('Risk group not found');
    if (!state.routineWindows.some((window) => window.id === windowId)) throw new Error('Routine window not found');
    const routineWindows = state.routineWindows.map((window) => {
      if (window.id !== windowId) return window;
      const protectedGroupIds = enabled
        ? Array.from(new Set([...window.protectedGroupIds, groupId]))
        : window.protectedGroupIds.filter((id) => id !== groupId);
      return { ...window, protectedGroupIds };
    });
    await RhythmCoordinator.getInstance().updateConfig({ routineWindows });
    set({ routineWindows });
  });

  mutationExecutors.set('edit-routine-schedule', async ({ routineWindows }: RoutineScheduleEditPayload) => {
    await RhythmCoordinator.getInstance().updateConfig({
      routineWindows,
    });
    set({
      routineWindows,
    });
  });

  mutationExecutors.set('start-access-lease', async ({ groupId, durationMinutes }) => {
    const state = get();
    const group = state.riskGroups.find((g) => g.id === groupId);
    if (!group) {
      throw new Error('Risk group not found');
    }
    const coordinator = RhythmCoordinator.getInstance();
    const runtime = await coordinator.dispatch({
      type: 'START_ACCESS_LEASE',
      groupId,
      durationMinutes,
      reason: 'emergency',
      timestamp: Date.now(),
    });
    set({ rhythmState: runtime.state, emergencyModalVisible: false });
    await get().refreshInsights();
  });

  mutationExecutors.set('reset-local-state', async () => {
    await executeResetLocalState(get, set);
  });

  mutationExecutors.set('manage-accountability-partner', async (payload: ManagePartnerMutationPayload) => {
    const service = getAccountabilityService();

    if (payload.action === 'create') {
      const password = consumeTransientSecret(payload.secretRef);
      const partner = await service.createPartner({
        name: payload.name,
        relationshipLabel: payload.relationshipLabel,
        password,
      });

      const current = get();
      const nextAccountability: AccountabilitySettings = {
        ...current.accountability,
        partners: [...current.accountability.partners, partner],
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
      return partner;
    }

    if (payload.action === 'update') {
      const state = get();
      const nextPartners = [...state.accountability.partners];
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
        return updated;
      }
      throw new Error('Partner not found');
    }

    if (payload.action === 'remove') {
      const state = get();
      const nextPartners = [...state.accountability.partners];
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
        return;
      }
      throw new Error('Partner not found');
    }

    if (payload.action === 'replace-password') {
      const password = consumeTransientSecret(payload.secretRef);
      const existing = get().accountability.partners.find((p) => p.id === payload.partnerId);
      if (!existing) {
        throw new Error('Partner not found');
      }
      await service.replacePartnerPassword(existing, password);
      return;
    }
  });

  mutationExecutors.set('edit-ios-risk-group-selection', async (payload: IOSSelectionEditPayload) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const RhythmDevice = require('../../modules/rhythm-device').default;
    const commitResult = await RhythmDevice.commitStagedFamilyActivitySelection(
      payload.groupId,
      payload.stagedSelectionRef
    );
    if (!commitResult?.success) {
      throw new Error('Failed to commit staged iOS app selection');
    }

    const state = get();
    const existingGroup = state.riskGroups.find((g) => g.id === payload.groupId);
    if (!existingGroup) {
      if (commitResult.rollbackRef !== undefined && commitResult.previousRevision !== undefined) {
        await RhythmDevice.rollbackCommittedFamilyActivitySelection(
          payload.groupId,
          commitResult.rollbackRef,
          commitResult.previousRevision
        ).catch(() => {});
      }
      throw new Error('Target risk group not found');
    }

    const updatedGroups = state.riskGroups.map((group) =>
      group.id === payload.groupId
        ? {
            ...group,
            nativeSelectionRef: commitResult.localSelectionId ?? `selection.${payload.groupId}`,
            nativeSelectionCount: payload.tokenCount,
            nativeSelectionRevision: commitResult.revision ?? ((group.nativeSelectionRevision ?? 0) + 1),
          }
        : group
    );

    try {
      await RhythmCoordinator.getInstance().updateConfig({ riskGroups: updatedGroups });
    } catch (error) {
      if (commitResult.rollbackRef !== undefined && commitResult.previousRevision !== undefined) {
        await RhythmDevice.rollbackCommittedFamilyActivitySelection(
          payload.groupId,
          commitResult.rollbackRef,
          commitResult.previousRevision
        ).catch(() => {});
      }
      throw error;
    }

    if (commitResult.rollbackRef) {
      await RhythmDevice.discardStagedFamilyActivitySelection(commitResult.rollbackRef).catch(() => {});
    }

    set({ riskGroups: updatedGroups });
    await get().checkPermissions();
    return { success: true };
  });
}

async function verifyAndExecuteAccountabilityTransition(
  get: StoreGet,
  set: StoreSet,
  operation: 'enable-accountability' | 'disable-accountability',
  partnerId: string,
  password: string,
  expectedEnabled: boolean
): Promise<ApprovalResult> {
  registerDefaultMutationExecutors(get, set);
  const initial = get();
  if (protectedMutationInFlight || initial.pendingApproval) {
    return { ok: false, reason: 'approval-expired' };
  }
  if (initial.accountability.enabled !== expectedEnabled) {
    return { ok: false, reason: 'approval-expired' };
  }
  if (operation === 'enable-accountability' && getEnabledPartners(initial.accountability).length === 0) {
    return { ok: false, reason: 'no-enabled-partners' };
  }
  const partner = initial.accountability.partners.find((item) => item.id === partnerId);
  if (!partner || !partner.enabled) {
    return { ok: false, reason: partner ? 'partner-disabled' : 'partner-not-found' };
  }

  protectedMutationInFlight = true;
  try {
    const result = await getAccountabilityService().verifyApproval(
      {
        operation,
        summary: operation === 'enable-accountability' ? 'Enable Accountability Mode' : 'Disable Accountability Mode',
        partnerId,
      },
      password,
      partner
    );
    if (!result.ok) return result;

    const current = get();
    const currentPartner = current.accountability.partners.find((item) => item.id === partnerId);
    if (
      current.pendingApproval ||
      current.accountability.enabled !== expectedEnabled ||
      !currentPartner?.enabled ||
      currentPartner.credentialRef !== partner.credentialRef
    ) {
      return { ok: false, reason: 'approval-expired' };
    }

    await executeRegisteredMutation(
      operation,
      {},
      { kind: 'partner-approved', partnerId, expectedEnabled },
      get,
      true
    );
    return result;
  } finally {
    protectedMutationInFlight = false;
  }
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
        const attention = attentionStateProjection(nextRuntime);
        set({
          rhythmState: nextRuntime.state,
          activeTimerEndsAt: primaryCooldown?.endsAt,
          activeRiskGroupId: attention.activeAttentionGateStatus?.groupId || primaryCooldown?.groupId || nextRuntime.activeSession?.groupId || get().activeRiskGroupId,
          ...attention,
        });
      });

      const { permissions } = getPlatformServices();
      const permStatus = await permissions.getStatus();
      const primaryCooldown = getPrimaryCooldown(runtime);
      const attention = attentionStateProjection(runtime);

      set({
        apps: config?.apps ?? get().apps,
        riskGroups: config?.riskGroups ?? get().riskGroups,
        routineWindows: config?.routineWindows ?? get().routineWindows,
        accountability: config?.accountability ?? get().accountability,
        rhythmState: runtime.state,
        activeTimerEndsAt: primaryCooldown?.endsAt || (runtime.state === 'morning-buffer' ? Date.now() + INITIAL_TIMER_MS : undefined),
        activeRiskGroupId: attention.activeAttentionGateStatus?.groupId || primaryCooldown?.groupId || runtime.activeSession?.groupId || 'social',
        ...attention,
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

  refreshReadingEvidence: async () => {
    await RhythmCoordinator.getInstance().refreshDailyReadingEvidence();
  },

  openRhythmicReader: async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const RhythmDeviceModule = require('../../modules/rhythm-device').default;
      return await RhythmDeviceModule.openRhythmicReader();
    } catch {
      return false;
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
    const group = get().riskGroups.find((item) => item.id === groupId);
    await get().requestProtectedMutation({
      operation: 'start-access-lease',
      summary: `Allow ${group?.name ?? 'Risk Group'} for ${durationMinutes} minutes`,
      payload: { groupId, durationMinutes },
    });
  },

  triggerEmergencyBypass: async () => {
    const activeGroupId = get().activeRiskGroupId || 'social';
    const group = get().riskGroups.find((g) => g.id === activeGroupId) || get().riskGroups[0];
    await get().requestProtectedMutation({
      operation: 'start-access-lease',
      summary: `Allow ${group?.name ?? 'Risk Group'} for ${EMERGENCY_ACCESS_MINUTES} minutes`,
      payload: { groupId: activeGroupId, durationMinutes: EMERGENCY_ACCESS_MINUTES },
    });
  },

  resetDemo: async () => {
    await get().requestProtectedMutation({
      operation: 'reset-local-state',
      summary: 'Reset all demo data, local configuration, and accountability',
      payload: {},
    });
  },

  updateRiskGroupAllowance: async (groupId, nextMinutes) => {
    const result = await get().requestProtectedMutation({
      operation: 'change-daily-allowance',
      summary: `Change ${get().riskGroups.find((group) => group.id === groupId)?.name ?? 'Risk Group'} allowance to ${nextMinutes} minutes`,
      payload: { groupId, allowanceMinutes: nextMinutes },
    });
    if (result.status === 'pending-approval') {
      return { ok: false, nextMinutes, groupId, reason: 'approval-required' };
    }
    return result.result as GroupAllowanceEditResult & { groupId: string };
  },

  updateRiskGroupRecoveryActivity: async (groupId, activityId) => {
    const state = get();
    const group = state.riskGroups.find((item) => item.id === groupId);
    if (!group) return { ok: false, groupId, activityId };
    const morning = state.routineWindows.find((window) => window.id === 'morning-buffer');
    const evening = state.routineWindows.find((window) => window.id === 'evening-wind-down');
    const draft: RiskGroupConfigurationDraft = {
      name: group.name,
      description: group.description ?? '',
      allowanceMinutes: resolveGroupAllowanceMinutes(group),
      cooldownMinutes: group.cooldownMinutes,
      recoveryActivityId: activityId,
      morningProtected: morning?.protectedGroupIds.includes(groupId) ?? false,
      eveningProtected: evening?.protectedGroupIds.includes(groupId) ?? false,
    };
    const result = await get().saveRiskGroupConfiguration(groupId, draft);
    return { ok: result.ok, groupId, activityId: result.ok ? activityId : resolveGroupRecoveryActivityId(group) };
  },

  updateAppClassification: async (appId, classification, riskGroupId) => {
    const state = get();
    const app = state.apps.find((item) => item.id === appId);
    const payload: AppPolicyPayload = {
      appId,
      classification,
      riskGroupId: classification === 'risk' ? (riskGroupId || 'social') : undefined,
    };
    await get().requestProtectedMutation({
      operation: 'change-app-classification',
      summary: app ? `${app.name} classification change` : `Change app classification`,
      payload,
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

  updateRoutineWindow: async (windowId, updates) => {
    const state = get();
    const currentWindow = state.routineWindows.find((w) => w.id === windowId);
    if (!currentWindow) return;

    const nextWindows = state.routineWindows.map((w) =>
      w.id === windowId ? { ...w, ...updates } : w
    );

    await get().requestProtectedMutation({
      operation: 'edit-routine-schedule',
      summary: `Update ${currentWindow.name} routine schedule`,
      payload: {
        routineWindows: nextWindows,
      },
    });
  },

  toggleRoutineDay: async (day) => {
    const state = get();
    const morningWin =
      state.routineWindows.find((w) => w.type === 'morning-buffer') ||
      state.routineWindows.find((w) => w.id === 'morning-buffer') ||
      state.routineWindows[0];
    const currentDays = morningWin ? morningWin.activeDays : [1, 2, 3, 4, 5, 6, 7];
    const newDays = currentDays.includes(day)
      ? currentDays.filter((d) => d !== day)
      : [...currentDays, day].sort();

    const nextWindows = state.routineWindows.map((w) => ({ ...w, activeDays: newDays }));

    await get().requestProtectedMutation({
      operation: 'edit-routine-schedule',
      summary: `Change active routine days to ${formatDays(newDays)}`,
      payload: {
        routineWindows: nextWindows,
      },
    });
  },

  toggleGroupProtection: async (windowId, groupId, enabled) => {
    await get().requestProtectedMutation({
      operation: 'edit-risk-group-protection',
      summary: `${enabled ? 'Protect' : 'Unprotect'} ${get().riskGroups.find((group) => group.id === groupId)?.name ?? 'Risk Group'}`,
      payload: { windowId, groupId, enabled },
    });
  },

  createRiskGroup: async (input: CreateRiskGroupInput) => {
    const result = await get().requestProtectedMutation({
      operation: 'create-risk-group',
      summary: `Create Risk Group “${input.name.trim()}”`,
      payload: clonePayload(input),
    });
    return result.status === 'executed' ? result.result as string : 'pending';
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
    const result = await get().requestProtectedMutation({
      operation: 'edit-risk-group',
      summary: `Update ${existing.name}`,
      payload: { groupId, draft: clonePayload(draft) },
    });
    if (result.status === 'pending-approval') {
      return { ok: false, groupId, reason: 'approval-required' };
    }
    return result.result as SaveRiskGroupResult;
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
    const result = await get().requestProtectedMutation({
      operation: 'delete-risk-group',
      summary: `Delete ${target.name}`,
      payload: { groupId, replacementGroupId },
    });
    if (result.status === 'pending-approval') return { ok: false, reason: 'approval-required' };
    return result.result as DeleteRiskGroupResult;
  },

  addNewRiskGroup: async (name: string, description: string): Promise<string> => {
    return get().createRiskGroup({
      name,
      description,
      allowanceMinutes: DEFAULT_DAILY_RISK_ALLOWANCE_MINUTES,
    });
  },

  selectIosRiskGroupApps: async (groupId: string) => {
    if (getPlatformOS() !== 'ios') return;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const RhythmDevice = require('../../modules/rhythm-device').default;
    let result: { stagedSelectionRef: string; tokenCount: number } | null = null;
    try {
      result = await RhythmDevice.stageFamilyActivityPicker(groupId);
    } catch {
      // User cancelled picker or unsupported
      return;
    }
    if (!result || !result.stagedSelectionRef) return;

    const state = get();
    const group = state.riskGroups.find((g) => g.id === groupId);
    const groupName = group?.name || 'Risk Group';
    const count = result.tokenCount ?? 0;
    const summary = `Update ${groupName} protected apps (${count} selected)`;

    try {
      await get().requestProtectedMutation({
        operation: 'edit-ios-risk-group-selection',
        summary,
        payload: {
          groupId,
          stagedSelectionRef: result.stagedSelectionRef,
          tokenCount: count,
        },
      });
    } catch (error) {
      await RhythmDevice.discardStagedFamilyActivitySelection(result.stagedSelectionRef).catch(() => {});
      throw error;
    }
  },

  setSearchQuery: (query) => set({ searchQuery: query }),
  setFilterClassification: (filterClassification) => set({ filterClassification }),
  setDemoSwitcherVisible: (demoSwitcherVisible) => set({ demoSwitcherVisible }),
  setEmergencyModalVisible: (emergencyModalVisible) => set({ emergencyModalVisible }),

  openTimeSelector: (config) => set({ timeSelector: { ...config, visible: true } }),
  closeTimeSelector: () => set({ timeSelector: { visible: false } }),
  saveSelectedTime: async (time) => {
    const state = get();
    const { windowId, field } = state.timeSelector;

    if (!windowId || !field) {
      set({ timeSelector: { visible: false } });
      return;
    }

    const currentWindow = state.routineWindows.find((w) => w.id === windowId);
    if (!currentWindow) {
      set({ timeSelector: { visible: false } });
      return;
    }

    const nextWindows = state.routineWindows.map((w) =>
      w.id === windowId
        ? {
            ...w,
            [field]: time,
          }
        : w
    );

    const label = field === 'startTime' ? 'start time' : 'end time';

    set({
      timeSelector: {
        visible: false,
      },
    });

    await get().requestProtectedMutation({
      operation: 'edit-routine-schedule',
      summary: `Change ${currentWindow.name} ${label} to ${time}`,
      payload: {
        routineWindows: nextWindows,
      },
    });
  },

  openAppEdit: (appId) => set({ appEdit: { visible: true, appId } }),
  closeAppEdit: () => set({ appEdit: { visible: false, appId: undefined } }),

  completeOnboarding: () => {
    get().setRhythmState('morning-buffer');
    set({ hasCompletedOnboarding: true });
  },

  // Protected mutation gateway
  requestProtectedMutation: async (
    mutation: ProtectedMutation
  ): Promise<{ status: 'executed' | 'pending-approval'; result?: unknown }> => {
    registerDefaultMutationExecutors(get, set);
    const state = get();
    if (!PROTECTED_OPERATIONS.includes(mutation.operation)) {
      throw new Error('Unknown protected mutation operation');
    }
    if (protectedMutationInFlight) throw new Error('A protected change is already being applied');
    if (state.pendingApproval) throw new Error('Another protected change is already awaiting approval');

    const immutablePayload = freezePayload(clonePayload(mutation.payload));
    const requires = requiresPartnerApproval(state.accountability, mutation.operation);
    if (!requires) {
      const execResult = await executeRegisteredMutation(
        mutation.operation,
        immutablePayload,
        { kind: 'disabled-mode' },
        get
      );
      return { status: 'executed', result: execResult };
    }

    const enabledPartners = getEnabledPartners(state.accountability);
    if (enabledPartners.length === 0) {
      throw new Error('No enabled accountability partners available to approve this operation');
    }

    const pending: PendingApproval = {
      id: `approval_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      operation: mutation.operation,
      summary: mutation.summary,
      payload: immutablePayload,
      requestedAt: Date.now(),
      authorizationSnapshot: captureProtectedStateSnapshot(state),
      accountabilityEnabledAtRequest: state.accountability.enabled,
    };

    set({ pendingApproval: pending });
    return { status: 'pending-approval' };
  },

  approveProtectedMutation: async (
    partnerId: string,
    password: string
  ): Promise<ApprovalResult> => {
    registerDefaultMutationExecutors(get, set);
    const state = get();
    const pending = state.pendingApproval;
    if (!pending || inFlightApprovalIds.has(pending.id) || protectedMutationInFlight) {
      return { ok: false, reason: 'partner-not-found' };
    }

    inFlightApprovalIds.add(pending.id);
    try {
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

      const current = get();
      const currentPartner = current.accountability.partners.find((item) => item.id === partnerId);
      if (current.pendingApproval?.id !== pending.id || !currentPartner?.enabled || currentPartner.credentialRef !== partner?.credentialRef) {
        cleanupPendingApprovalSecrets(pending);
        if (current.pendingApproval?.id === pending.id) set({ pendingApproval: null });
        return { ok: false, reason: 'approval-expired' };
      }
      if (current.accountability.enabled !== pending.accountabilityEnabledAtRequest) {
        cleanupPendingApprovalSecrets(pending);
        set({ pendingApproval: null });
        return { ok: false, reason: 'approval-expired' };
      }
      if (
        pending.authorizationSnapshot !== undefined &&
        pending.authorizationSnapshot !== captureProtectedStateSnapshot(current)
      ) {
        cleanupPendingApprovalSecrets(pending);
        set({ pendingApproval: null });
        throw new Error('Protected mutation target changed while approval was pending. Review and submit the change again.');
      }

      // Double-submit safety: lock execution and clear the pending request before
      // entering the internal executor.
      protectedMutationInFlight = true;
      set({ pendingApproval: null });

      try {
        await executeRegisteredMutation(
          pending.operation,
          pending.payload,
          {
            kind: 'partner-approved',
            partnerId,
            expectedEnabled: pending.accountabilityEnabledAtRequest ?? true,
          },
          get,
          true
        );
        cleanupPendingApprovalSecrets(pending);
        return result;
      } catch (error) {
        cleanupPendingApprovalSecrets(pending);
        throw error;
      } finally {
        protectedMutationInFlight = false;
      }
    } finally {
      inFlightApprovalIds.delete(pending.id);
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
      if (result.status === 'executed') {
        deleteTransientSecret(secretRef);
        return result.result as AccountabilityPartner;
      }
      return {
        id: 'pending',
        name: params.name,
        relationshipLabel: params.relationshipLabel,
        credentialRef: 'pending',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        enabled: true,
      };
    } catch (error) {
      deleteTransientSecret(secretRef);
      throw error;
    }
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
    if (state.accountability.enabled && existing.enabled && updates.enabled === false) {
      const remainingEnabled = state.accountability.partners.filter((partner) => partner.id !== partnerId && partner.enabled);
      if (remainingEnabled.length === 0) {
        throw new Error('Cannot disable the last enabled partner while Accountability Mode is active.');
      }
    }
    const result = await get().requestProtectedMutation({
      operation: 'manage-accountability-partner',
      summary: `Update partner "${existing.name}"`,
      payload: { action: 'update', partnerId, updates } satisfies ManagePartnerMutationPayload,
    });
    return result.status === 'executed' ? result.result as AccountabilityPartner : existing;
  },

  deleteAccountabilityPartner: async (partnerId: string): Promise<void> => {
    const state = get();
    const existing = state.accountability.partners.find((p) => p.id === partnerId);
    if (!existing) {
      throw new Error('Partner not found');
    }
    if (state.accountability.enabled && existing.enabled) {
      const remainingEnabled = state.accountability.partners.filter((partner) => partner.id !== partnerId && partner.enabled);
      if (remainingEnabled.length === 0) {
        throw new Error('Cannot remove the last enabled partner while Accountability Mode is active.');
      }
    }

    await get().requestProtectedMutation({
      operation: 'manage-accountability-partner',
      summary: `Remove accountability partner "${existing.name}"`,
      payload: { action: 'remove', partnerId } satisfies ManagePartnerMutationPayload,
    });
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

    const secretRef = createTransientSecretRef(newPassword);
    try {
      const result = await get().requestProtectedMutation({
        operation: 'manage-accountability-partner',
        summary: `Change password for partner "${existing.name}"`,
        payload: { action: 'replace-password', partnerId, secretRef } satisfies ManagePartnerMutationPayload,
      });
      if (result.status === 'executed') deleteTransientSecret(secretRef);
    } catch (error) {
      deleteTransientSecret(secretRef);
      throw error;
    }
  },

  enableAccountability: async (
    partnerId: string,
    password: string
  ): Promise<ApprovalResult> => {
    return verifyAndExecuteAccountabilityTransition(get, set, 'enable-accountability', partnerId, password, false);
  },

  disableAccountability: async (
    partnerId: string,
    password: string
  ): Promise<ApprovalResult> => {
    if (!get().accountability.enabled) return { ok: true, partnerId };
    return verifyAndExecuteAccountabilityTransition(get, set, 'disable-accountability', partnerId, password, true);
  },
}));
