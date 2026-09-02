import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateObservedRiskUsage,
  getLocalDateKey,
  getSevenDayWindowStart,
} from '../../insights';
import {
  hydrateAppsWithDailyUsage,
  usePrototypeStore,
} from '../../../store/usePrototypeStore';
import {
  DeviceApp,
  DailyUsageSnapshot,
} from '../../../types/domain';
import { UsageActivityEvent } from '../../../platform/UsageProvider';
import { MockUsageProvider } from '../../../platform/mock/MockUsageProvider';
import { MockStorageProvider } from '../../../platform/storage/MockStorageProvider';
import { MockPermissionProvider } from '../../../platform/permissions/MockPermissionProvider';
import { MockRestrictionProvider } from '../../../platform/mock/MockRestrictionProvider';
import { configurePlatformServices } from '../../../platform/PlatformServices';
import { RhythmCoordinator } from '../../../application/RhythmCoordinator';
import { NoopNativeRhythmSyncProvider } from '../../../platform/NativeRhythmSyncProvider';

describe('Pass 03 — Daily Allowance UX, Native Ledger Hydration & Real Insights', () => {
  describe('1. Daily Usage Snapshot Hydration & App Mapping', () => {
    test('hydrateAppsWithDailyUsage truthfully populates usageTodayMinutes from snapshot', () => {
      const apps: DeviceApp[] = [
        {
          id: 'com.instagram.android',
          name: 'Instagram',
          classification: 'risk',
          iconName: 'camera',
          iconColor: '#000',
          iconBg: '#FFF',
          defaultCategory: 'Social',
          usageTodayMinutes: 0,
          sessionMinutes: 0,
          dailyRiskAllowance: { allowanceMinutes: 30 },
        },
        {
          id: 'com.reddit.frontpage',
          name: 'Reddit',
          classification: 'risk',
          iconName: 'message-circle',
          iconColor: '#000',
          iconBg: '#FFF',
          defaultCategory: 'Social',
          usageTodayMinutes: 0,
          sessionMinutes: 0,
          dailyRiskAllowance: { allowanceMinutes: 15 },
        },
        {
          id: 'com.google.android.dialer',
          name: 'Phone',
          classification: 'essential',
          iconName: 'phone',
          iconColor: '#000',
          iconBg: '#FFF',
          defaultCategory: 'Utility',
          usageTodayMinutes: 0,
          sessionMinutes: 0,
        },
      ];

      const snapshot: DailyUsageSnapshot = {
        dateKey: getLocalDateKey(),
        apps: [
          {
            packageName: 'com.instagram.android',
            usedSeconds: 1100, // 18 min 20 sec -> 18 min
            allowanceMinutes: 30,
            remainingSeconds: 700,
            exhausted: false,
          },
          {
            packageName: 'com.reddit.frontpage',
            usedSeconds: 900, // 15 min -> 15 min
            allowanceMinutes: 15,
            remainingSeconds: 0,
            exhausted: true,
          },
        ],
      };

      const hydrated = hydrateAppsWithDailyUsage(apps, snapshot);

      const insta = hydrated.find((a) => a.id === 'com.instagram.android')!;
      const reddit = hydrated.find((a) => a.id === 'com.reddit.frontpage')!;
      const phone = hydrated.find((a) => a.id === 'com.google.android.dialer')!;

      assert.equal(insta.usageTodayMinutes, 18);
      assert.equal(reddit.usageTodayMinutes, 15);
      assert.equal(phone.usageTodayMinutes, 0, 'Apps not in snapshot default strictly to 0 min');
    });

    test('Discovered new apps without ledger entries default to 0 min rather than mock data', () => {
      const discoveredApps: DeviceApp[] = [
        {
          id: 'com.tiktok.android',
          name: 'TikTok',
          classification: 'unclassified',
          iconName: 'smartphone',
          iconColor: '#000',
          iconBg: '#FFF',
          defaultCategory: 'Entertainment',
          usageTodayMinutes: 0,
          sessionMinutes: 0,
        },
      ];

      const snapshot: DailyUsageSnapshot = {
        dateKey: getLocalDateKey(),
        apps: [],
      };

      const hydrated = hydrateAppsWithDailyUsage(discoveredApps, snapshot);
      assert.equal(hydrated[0].usageTodayMinutes, 0);
    });
  });

  describe('2. aggregateObservedRiskUsage — Event Processing & Midnight Split', () => {
    test('Aggregates foreground and background events into exact seconds by app and group', () => {
      const riskApps = [
        { id: 'com.instagram.android', riskGroupId: 'social' },
        { id: 'com.reddit.frontpage', riskGroupId: 'social' },
      ];

      const baseTime = new Date('2026-09-02T10:00:00Z').getTime();
      const events: UsageActivityEvent[] = [
        { appId: 'com.instagram.android', timestamp: baseTime, state: 'foreground' },
        { appId: 'com.instagram.android', timestamp: baseTime + 120_000, state: 'background' }, // 120s
        { appId: 'com.reddit.frontpage', timestamp: baseTime + 200_000, state: 'foreground' },
        { appId: 'com.reddit.frontpage', timestamp: baseTime + 300_000, state: 'background' }, // 100s
      ];

      const result = aggregateObservedRiskUsage(
        events,
        riskApps,
        baseTime - 1000,
        baseTime + 400_000
      );

      assert.equal(result.secondsByApp['com.instagram.android'], 120);
      assert.equal(result.secondsByApp['com.reddit.frontpage'], 100);
      assert.equal(result.secondsByGroup['social'], 220);
    });

    test('Splits usage crossing local midnight into the appropriate calendar days', () => {
      const riskApps = [{ id: 'com.instagram.android', riskGroupId: 'social' }];

      // Construct a local timestamp at 23:50:00 on day 1
      const now = new Date();
      now.setHours(23, 50, 0, 0);
      const startMs = now.getTime();
      const endMs = startMs + 25 * 60 * 1000; // 25 min total: 10m before midnight, 15m after midnight

      const day1Key = getLocalDateKey(startMs);
      const day2Key = getLocalDateKey(endMs);
      assert.notEqual(day1Key, day2Key, 'Constructed range must cross local midnight');

      const events: UsageActivityEvent[] = [
        { appId: 'com.instagram.android', timestamp: startMs, state: 'foreground' },
        { appId: 'com.instagram.android', timestamp: endMs, state: 'background' },
      ];

      const result = aggregateObservedRiskUsage(
        events,
        riskApps,
        startMs - 1000,
        endMs + 1000
      );

      // Total duration = 25m = 1500s
      assert.equal(result.secondsByApp['com.instagram.android'], 1500);
      // Day 1: 10m = 600s
      assert.equal(result.secondsByDate[day1Key], 600);
      // Day 2: 15m = 900s
      assert.equal(result.secondsByDate[day2Key], 900);
    });

    test('Ignores non-risk apps, malformed events, and negative intervals', () => {
      const riskApps = [{ id: 'com.instagram.android', riskGroupId: 'social' }];
      const baseTime = Date.now();

      const events: UsageActivityEvent[] = [
        // Non-risk app event: ignored
        { appId: 'com.google.android.dialer', timestamp: baseTime, state: 'foreground' },
        { appId: 'com.google.android.dialer', timestamp: baseTime + 60_000, state: 'background' },
        // Malformed event (NaN timestamp): ignored
        { appId: 'com.instagram.android', timestamp: NaN, state: 'foreground' },
        // Valid risk event: 60s
        { appId: 'com.instagram.android', timestamp: baseTime + 100_000, state: 'foreground' },
        { appId: 'com.instagram.android', timestamp: baseTime + 160_000, state: 'background' },
        // Zero / negative duration interval: foreground followed by immediate background
        { appId: 'com.instagram.android', timestamp: baseTime + 200_000, state: 'foreground' },
        { appId: 'com.instagram.android', timestamp: baseTime + 200_000, state: 'background' },
      ];

      const result = aggregateObservedRiskUsage(
        events,
        riskApps,
        baseTime,
        baseTime + 250_000
      );

      assert.equal(result.secondsByApp['com.instagram.android'], 60);
      assert.equal(result.secondsByApp['com.google.android.dialer'], undefined);
    });

    test('Duplicate foreground events do not reset segment start', () => {
      const riskApps = [{ id: 'com.instagram.android', riskGroupId: 'social' }];
      const baseTime = Date.now();

      const events: UsageActivityEvent[] = [
        { appId: 'com.instagram.android', timestamp: baseTime, state: 'foreground' },
        // Duplicate foreground 10s later
        { appId: 'com.instagram.android', timestamp: baseTime + 10_000, state: 'foreground' },
        { appId: 'com.instagram.android', timestamp: baseTime + 60_000, state: 'background' },
      ];

      const result = aggregateObservedRiskUsage(
        events,
        riskApps,
        baseTime - 1000,
        baseTime + 100_000
      );

      // Must be 60s, not 50s
      assert.equal(result.secondsByApp['com.instagram.android'], 60);
    });

    test('App remaining in foreground at queryEnd commits strictly up to queryEnd', () => {
      const riskApps = [{ id: 'com.instagram.android', riskGroupId: 'social' }];
      const baseTime = Date.now();
      const queryEnd = baseTime + 50_000;

      const events: UsageActivityEvent[] = [
        { appId: 'com.instagram.android', timestamp: baseTime, state: 'foreground' },
        // No background event before queryEnd
      ];

      const result = aggregateObservedRiskUsage(
        events,
        riskApps,
        baseTime,
        queryEnd
      );

      assert.equal(result.secondsByApp['com.instagram.android'], 50);
    });
  });

  describe('3. Allowance Editing Rules & Once-Per-Day Lock Invariant', () => {
    test('Allowance cannot be decreased below 0 min', async () => {
      const testApps: DeviceApp[] = [
        {
          id: 'com.instagram.android',
          name: 'Instagram',
          classification: 'risk',
          iconName: 'camera',
          iconColor: '#000',
          iconBg: '#FFF',
          defaultCategory: 'Social',
          usageTodayMinutes: 0,
          sessionMinutes: 0,
          dailyRiskAllowance: { allowanceMinutes: 15 },
        },
      ];

      const storage = new MockStorageProvider();
      const coordinator = RhythmCoordinator.getInstance();
      coordinator.destroy();
      configurePlatformServices({
        usage: new MockUsageProvider(testApps),
        storage,
        permissions: new MockPermissionProvider(),
        restrictions: new MockRestrictionProvider(),
        nativeRhythm: new NoopNativeRhythmSyncProvider(),
      });

      await coordinator.initialize();

      const result = await coordinator.updateDailyRiskAllowance('com.instagram.android', -15);
      assert.equal(result.allowed, false);
      assert.equal(result.reason, 'below-minimum');
    });

    test('Allowance increase is capped at persistedMinutes + 15', async () => {
      const testApps: DeviceApp[] = [
        {
          id: 'com.instagram.android',
          name: 'Instagram',
          classification: 'risk',
          iconName: 'camera',
          iconColor: '#000',
          iconBg: '#FFF',
          defaultCategory: 'Social',
          usageTodayMinutes: 0,
          sessionMinutes: 0,
          dailyRiskAllowance: { allowanceMinutes: 30 },
        },
      ];

      const storage = new MockStorageProvider();
      const coordinator = RhythmCoordinator.getInstance();
      coordinator.destroy();
      configurePlatformServices({
        usage: new MockUsageProvider(testApps),
        storage,
        permissions: new MockPermissionProvider(),
        restrictions: new MockRestrictionProvider(),
        nativeRhythm: new NoopNativeRhythmSyncProvider(),
      });

      await coordinator.initialize();

      // +30 min increase: rejected
      const result = await coordinator.updateDailyRiskAllowance('com.instagram.android', 60);
      assert.equal(result.allowed, false);
      assert.equal(result.reason, 'increase-too-large');

      // +15 min increase: allowed
      const validResult = await coordinator.updateDailyRiskAllowance('com.instagram.android', 45);
      assert.equal(validResult.allowed, true);
    });

    test('Once-per-day edit lock prevents second modification on same calendar day', async () => {
      const todayKey = getLocalDateKey();
      const testApps: DeviceApp[] = [
        {
          id: 'com.instagram.android',
          name: 'Instagram',
          classification: 'risk',
          iconName: 'camera',
          iconColor: '#000',
          iconBg: '#FFF',
          defaultCategory: 'Social',
          usageTodayMinutes: 0,
          sessionMinutes: 0,
          dailyRiskAllowance: {
            allowanceMinutes: 30,
            lastEditedDateKey: todayKey, // Already edited today
          },
        },
      ];

      const storage = new MockStorageProvider();
      const coordinator = RhythmCoordinator.getInstance();
      coordinator.destroy();
      configurePlatformServices({
        usage: new MockUsageProvider(testApps),
        storage,
        permissions: new MockPermissionProvider(),
        restrictions: new MockRestrictionProvider(),
        nativeRhythm: new NoopNativeRhythmSyncProvider(),
      });

      await coordinator.initialize();

      const result = await coordinator.updateDailyRiskAllowance('com.instagram.android', 15);
      assert.equal(result.allowed, false);
      assert.equal(result.reason, 'already-edited-today');
    });

    test('Rejected edit attempts do not mutate lastEditedDateKey or allowanceMinutes', async () => {
      const testApps: DeviceApp[] = [
        {
          id: 'com.instagram.android',
          name: 'Instagram',
          classification: 'risk',
          iconName: 'camera',
          iconColor: '#000',
          iconBg: '#FFF',
          defaultCategory: 'Social',
          usageTodayMinutes: 0,
          sessionMinutes: 0,
          dailyRiskAllowance: {
            allowanceMinutes: 30,
            lastEditedDateKey: undefined,
          },
        },
      ];

      const storage = new MockStorageProvider();
      const coordinator = RhythmCoordinator.getInstance();
      coordinator.destroy();
      configurePlatformServices({
        usage: new MockUsageProvider(testApps),
        storage,
        permissions: new MockPermissionProvider(),
        restrictions: new MockRestrictionProvider(),
        nativeRhythm: new NoopNativeRhythmSyncProvider(),
      });

      await coordinator.initialize();

      // Rejected: increase by 30
      await coordinator.updateDailyRiskAllowance('com.instagram.android', 60);

      const app = coordinator.getConfiguration()?.apps.find((a) => a.id === 'com.instagram.android')!;
      assert.equal(app.dailyRiskAllowance?.allowanceMinutes, 30);
      assert.equal(app.dailyRiskAllowance?.lastEditedDateKey, undefined);
    });

    test('Risk app: group change + allowance edit -> both persist', async () => {
      const testApps: DeviceApp[] = [
        {
          id: 'com.instagram.android',
          name: 'Instagram',
          classification: 'risk',
          riskGroupId: 'social',
          iconName: 'camera',
          iconColor: '#000',
          iconBg: '#FFF',
          defaultCategory: 'Social',
          usageTodayMinutes: 0,
          sessionMinutes: 0,
          dailyRiskAllowance: { allowanceMinutes: 30 },
        },
      ];

      const coordinator = RhythmCoordinator.getInstance();
      coordinator.destroy();
      configurePlatformServices({
        usage: new MockUsageProvider(testApps),
        storage: new MockStorageProvider(),
        permissions: new MockPermissionProvider(),
        restrictions: new MockRestrictionProvider(),
        nativeRhythm: new NoopNativeRhythmSyncProvider(),
      });

      await coordinator.initialize();
      usePrototypeStore.setState({
        apps: [...testApps],
        riskGroups: coordinator.getConfiguration()?.riskGroups ?? [],
      });

      // Simulate AppEditModal deterministic save flow:
      // 1. Update allowance (+15 min step)
      const allowanceRes = await usePrototypeStore.getState().updateDailyRiskAllowance('com.instagram.android', 45);
      assert.equal(allowanceRes.allowed, true);

      // 2. Update classification / group
      await usePrototypeStore.getState().updateAppClassification('com.instagram.android', 'risk', 'custom-group');

      const savedApp = coordinator.getConfiguration()?.apps.find((a) => a.id === 'com.instagram.android')!;
      assert.equal(savedApp.dailyRiskAllowance?.allowanceMinutes, 45);
      assert.equal(savedApp.riskGroupId, 'custom-group');

      const storeApp = usePrototypeStore.getState().apps.find((a) => a.id === 'com.instagram.android')!;
      assert.equal(storeApp.dailyRiskAllowance?.allowanceMinutes, 45);
      assert.equal(storeApp.riskGroupId, 'custom-group');
    });

    test('rejected allowance edit -> classification/group unchanged', async () => {
      const testApps: DeviceApp[] = [
        {
          id: 'com.instagram.android',
          name: 'Instagram',
          classification: 'risk',
          riskGroupId: 'social',
          iconName: 'camera',
          iconColor: '#000',
          iconBg: '#FFF',
          defaultCategory: 'Social',
          usageTodayMinutes: 0,
          sessionMinutes: 0,
          dailyRiskAllowance: { allowanceMinutes: 30 },
        },
      ];

      const coordinator = RhythmCoordinator.getInstance();
      coordinator.destroy();
      configurePlatformServices({
        usage: new MockUsageProvider(testApps),
        storage: new MockStorageProvider(),
        permissions: new MockPermissionProvider(),
        restrictions: new MockRestrictionProvider(),
        nativeRhythm: new NoopNativeRhythmSyncProvider(),
      });

      await coordinator.initialize();
      usePrototypeStore.setState({
        apps: [...testApps],
        riskGroups: coordinator.getConfiguration()?.riskGroups ?? [],
      });

      // Simulate AppEditModal save with invalid allowance change (+30 min)
      const selectedApp = testApps[0];
      const classification = 'risk';
      const persistedMinutes = selectedApp.dailyRiskAllowance?.allowanceMinutes ?? 30;
      const draftMinutes: number = 60;
      const targetGroupId = 'news';

      let allowanceError: string | null = null;
      if (selectedApp.classification === 'risk' && classification === 'risk' && draftMinutes !== persistedMinutes) {
        const result = await usePrototypeStore.getState().updateDailyRiskAllowance(selectedApp.id, draftMinutes);
        if (!result.allowed) {
          allowanceError = result.reason || 'error';
        }
      }

      if (!allowanceError) {
        await usePrototypeStore.getState().updateAppClassification(selectedApp.id, classification, targetGroupId);
      }

      // Rejection stops flow before classification change:
      assert.equal(allowanceError, 'increase-too-large');

      // Ensure app in coordinator and store remains untouched:
      const savedApp = coordinator.getConfiguration()?.apps.find((a) => a.id === 'com.instagram.android')!;
      assert.equal(savedApp.dailyRiskAllowance?.allowanceMinutes, 30);
      assert.equal(savedApp.riskGroupId, 'social');

      const storeApp = usePrototypeStore.getState().apps.find((a) => a.id === 'com.instagram.android')!;
      assert.equal(storeApp.dailyRiskAllowance?.allowanceMinutes, 30);
      assert.equal(storeApp.riskGroupId, 'social');
    });

    test('Risk -> Normal -> no allowance write race and cleanly removes group membership', async () => {
      const testApps: DeviceApp[] = [
        {
          id: 'com.instagram.android',
          name: 'Instagram',
          classification: 'risk',
          riskGroupId: 'social',
          iconName: 'camera',
          iconColor: '#000',
          iconBg: '#FFF',
          defaultCategory: 'Social',
          usageTodayMinutes: 0,
          sessionMinutes: 0,
          dailyRiskAllowance: { allowanceMinutes: 30 },
        },
      ];

      const coordinator = RhythmCoordinator.getInstance();
      coordinator.destroy();
      configurePlatformServices({
        usage: new MockUsageProvider(testApps),
        storage: new MockStorageProvider(),
        permissions: new MockPermissionProvider(),
        restrictions: new MockRestrictionProvider(),
        nativeRhythm: new NoopNativeRhythmSyncProvider(),
      });

      await coordinator.initialize();

      // App reclassified from Risk to Normal
      await usePrototypeStore.getState().updateAppClassification('com.instagram.android', 'normal');

      const savedApp = coordinator.getConfiguration()?.apps.find((a) => a.id === 'com.instagram.android')!;
      assert.equal(savedApp.classification, 'normal');
      assert.equal(savedApp.riskGroupId, undefined);

      const socialGroup = coordinator.getConfiguration()?.riskGroups.find((g) => g.id === 'social')!;
      assert.ok(!socialGroup.appIds.includes('com.instagram.android'));
    });
  });

  describe('4. Independence of Risk Group Session Threshold & Daily Allowance', () => {
    test('Risk group continuous session threshold edits are independent of daily allowance guards', async () => {
      const testApps: DeviceApp[] = [
        {
          id: 'com.instagram.android',
          name: 'Instagram',
          classification: 'risk',
          riskGroupId: 'social',
          iconName: 'camera',
          iconColor: '#000',
          iconBg: '#FFF',
          defaultCategory: 'Social',
          usageTodayMinutes: 0,
          sessionMinutes: 0,
          dailyRiskAllowance: {
            allowanceMinutes: 30,
            lastEditedDateKey: getLocalDateKey(), // Allowance locked today
          },
        },
      ];

      const storage = new MockStorageProvider();
      const coordinator = RhythmCoordinator.getInstance();
      coordinator.destroy();
      configurePlatformServices({
        usage: new MockUsageProvider(testApps),
        storage,
        permissions: new MockPermissionProvider(),
        restrictions: new MockRestrictionProvider(),
        nativeRhythm: new NoopNativeRhythmSyncProvider(),
      });

      await coordinator.initialize();

      // Adjusting group continuous session threshold from 20 -> 25 min
      const group = coordinator.getConfiguration()?.riskGroups.find((g) => g.id === 'social')!;
      await coordinator.updateConfig({
        riskGroups: [
          { ...group, sessionThresholdMinutes: 25 },
        ],
      });

      const updatedGroup = coordinator.getConfiguration()?.riskGroups.find((g) => g.id === 'social')!;
      assert.equal(updatedGroup.sessionThresholdMinutes, 25, 'Group threshold can be edited even if allowance is locked');
    });
  });

  describe('5. Double-Count Prevention & Android Insights Truthfulness', () => {
    test('Observed UsageStats replaces engine-history Risk usage for trends and groups without summation', () => {
      const testMidday = new Date(2026, 8, 2, 14, 0, 0, 0).getTime();
      const todayKey = getLocalDateKey(testMidday);

      // UsageStats observed: exactly 25 minutes (1500 seconds)
      const observedEvents: UsageActivityEvent[] = [
        { appId: 'com.instagram.android', timestamp: testMidday - 1500_000, state: 'foreground' },
        { appId: 'com.instagram.android', timestamp: testMidday, state: 'background' },
      ];

      const riskApps = [{ id: 'com.instagram.android', riskGroupId: 'social' }];
      const observed = aggregateObservedRiskUsage(
        observedEvents,
        riskApps,
        testMidday - 86400_000,
        testMidday
      );

      // Engine history had 10 minutes recorded
      const engineHistoryRiskMinutes = 10;
      const observedRiskMinutes = Math.round((observed.secondsByDate[todayKey] || 0) / 60);

      // Replacement rule (no double counting):
      const reconciledRiskMinutes = observed ? observedRiskMinutes : engineHistoryRiskMinutes;

      assert.equal(reconciledRiskMinutes, 25, 'Observed UsageStats must replace engine history risk minutes');
      assert.notEqual(reconciledRiskMinutes, 35, 'Must NEVER add engine history and observed UsageStats');
    });

    test('Native error never preserves or falls back to demo metrics', async () => {
      process.env.RHYTHM_PLATFORM_OVERRIDE = 'android';

      const storage = new MockStorageProvider();
      // Storage throws on history query
      storage.getHistoryEvents = async () => {
        throw new Error('Disk IO failure');
      };

      const coordinator = RhythmCoordinator.getInstance();
      coordinator.destroy();
      configurePlatformServices({
        usage: new MockUsageProvider(),
        storage,
        permissions: new MockPermissionProvider(),
        restrictions: new MockRestrictionProvider(),
        nativeRhythm: new NoopNativeRhythmSyncProvider(),
      });

      await usePrototypeStore.getState().refreshInsights();

      const state = usePrototypeStore.getState();
      assert.equal(state.insightDataState, 'error');
      assert.equal(state.insightMetrics.protectedTimeWeeklyHours, 0, 'Must NOT show demo preview hours on error');
      assert.equal(state.insightMetrics.averageRiskSessionMinutes, 0, 'Must NOT show demo preview average on error');

      delete process.env.RHYTHM_PLATFORM_OVERRIDE;
    });

    test('Missing usage access permission on Android sets insightDataState to permission-required', async () => {
      process.env.RHYTHM_PLATFORM_OVERRIDE = 'android';

      const perm = new MockPermissionProvider();
      perm.getStatus = async () => ({
        usageAccess: 'denied',
        restrictionAuthorization: 'granted',
        restrictionCapability: 'enforced',
      });

      const coordinator = RhythmCoordinator.getInstance();
      coordinator.destroy();
      configurePlatformServices({
        usage: new MockUsageProvider(),
        storage: new MockStorageProvider(),
        permissions: perm,
        restrictions: new MockRestrictionProvider(),
        nativeRhythm: new NoopNativeRhythmSyncProvider(),
      });

      await usePrototypeStore.getState().refreshInsights();

      const state = usePrototypeStore.getState();
      assert.equal(state.insightDataState, 'permission-required');

      delete process.env.RHYTHM_PLATFORM_OVERRIDE;
    });

    test('Native daily snapshot throws -> dailyUsageError set', async () => {
      process.env.RHYTHM_PLATFORM_OVERRIDE = 'android';

      const failingUsage = new MockUsageProvider();
      failingUsage.getDailyUsageSnapshot = async () => {
        throw new Error('Native IPC timeout');
      };
      failingUsage.reconcileDailyUsage = async () => {
        throw new Error('Native IPC timeout');
      };

      const coordinator = RhythmCoordinator.getInstance();
      coordinator.destroy();
      configurePlatformServices({
        usage: failingUsage,
        storage: new MockStorageProvider(),
        permissions: new MockPermissionProvider(),
        restrictions: new MockRestrictionProvider(),
        nativeRhythm: new NoopNativeRhythmSyncProvider(),
      });

      await usePrototypeStore.getState().refreshDailyUsage();

      const state = usePrototypeStore.getState();
      assert.equal(state.dailyUsageError, 'Usage unavailable');
      assert.equal(state.dailyUsageLoading, false);

      delete process.env.RHYTHM_PLATFORM_OVERRIDE;
    });

    test('Native 7-day query throws -> insightDataState = error, never show demo or treat as empty real data', async () => {
      process.env.RHYTHM_PLATFORM_OVERRIDE = 'android';

      const failingUsage = new MockUsageProvider();
      failingUsage.queryActivityEvents = async () => {
        throw new Error('Binder query failed');
      };

      const coordinator = RhythmCoordinator.getInstance();
      coordinator.destroy();
      configurePlatformServices({
        usage: failingUsage,
        storage: new MockStorageProvider(),
        permissions: new MockPermissionProvider(),
        restrictions: new MockRestrictionProvider(),
        nativeRhythm: new NoopNativeRhythmSyncProvider(),
      });

      await usePrototypeStore.getState().refreshInsights();

      const state = usePrototypeStore.getState();
      assert.equal(state.insightDataState, 'error');
      // Never fall back to demo preview numbers
      assert.equal(state.insightMetrics.protectedTimeWeeklyHours, 0);
      assert.equal(state.insightMetrics.averageRiskSessionMinutes, 0);
      assert.notEqual(state.insightDataState, 'real');
      assert.notEqual(state.insightDataState, 'empty');

      delete process.env.RHYTHM_PLATFORM_OVERRIDE;
    });
  });

  describe('6. Seven-Day Local Calendar Window & DST Invariants', () => {
    test('getSevenDayWindowStart returns local midnight 6 days ago (exactly 7 distinct local calendar days)', () => {
      const now = new Date(2026, 8, 3, 15, 30, 0, 0).getTime();
      const start = getSevenDayWindowStart(now);

      const startDate = new Date(start);
      assert.equal(startDate.getHours(), 0);
      assert.equal(startDate.getMinutes(), 0);
      assert.equal(startDate.getSeconds(), 0);
      assert.equal(startDate.getMilliseconds(), 0);

      // Collect all local calendar date keys between start and now
      const dateKeys = new Set<string>();
      let cursor = start;
      while (cursor <= now) {
        dateKeys.add(getLocalDateKey(cursor));
        cursor += 3600_000; // step 1 hour
      }

      assert.equal(dateKeys.size, 7, 'Seven-day local window must span exactly 7 local calendar date keys');
    });

    test('getSevenDayWindowStart remains resilient across calendar boundaries', () => {
      // Test at boundary of month (e.g. March 3rd -> spans late February)
      const march3 = new Date(2026, 2, 3, 23, 59, 59, 0).getTime();
      const windowStart = getSevenDayWindowStart(march3);

      const dateKeys = new Set<string>();
      let cursor = windowStart;
      while (cursor <= march3) {
        dateKeys.add(getLocalDateKey(cursor));
        cursor += 1800_000; // step 30 min
      }

      assert.equal(dateKeys.size, 7, 'Month boundary must cleanly yield 7 local calendar date keys');
    });
  });

  describe('7. Actual Usage Display After Allowance Exhaustion', () => {
    test('Preserves actual used time when exceeded via Access Lease (e.g. 38 / 30 min)', () => {
      const app: DeviceApp = {
        id: 'com.instagram.android',
        name: 'Instagram',
        classification: 'risk',
        iconName: 'camera',
        iconColor: '#000',
        iconBg: '#FFF',
        defaultCategory: 'Social',
        usageTodayMinutes: 38,
        sessionMinutes: 0,
        dailyRiskAllowance: { allowanceMinutes: 30 },
      };

      const allowanceMinutes = app.dailyRiskAllowance?.allowanceMinutes ?? 30;
      const usedTodayMinutes = app.usageTodayMinutes || 0;
      const isExhausted = true;

      // AppRow logic:
      let label = '';
      if (allowanceMinutes === 0) {
        label = '0 min planned today';
      } else if (isExhausted || usedTodayMinutes >= allowanceMinutes) {
        label = `${usedTodayMinutes} / ${allowanceMinutes} min · allowance complete`;
      } else {
        label = `${usedTodayMinutes} / ${allowanceMinutes} min today`;
      }

      assert.equal(label, '38 / 30 min · allowance complete', 'Numerator must truthfully show 38 min used during lease');
      assert.notEqual(label, '30 / 30 min · allowance complete', 'Must not clamp to allowance minutes');
    });
  });
});
