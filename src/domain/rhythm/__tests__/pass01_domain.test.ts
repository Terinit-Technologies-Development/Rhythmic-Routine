import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_DAILY_RISK_ALLOWANCE_MINUTES,
  DAILY_ALLOWANCE_STEP_MINUTES,
  MIN_DAILY_RISK_ALLOWANCE_MINUTES,
  validateDailyAllowanceEdit,
  isDailyAllowanceExhausted,
  rolloverDailyAppUsage,
} from '../allowance';
import {
  isInsideOvernightProtection,
  isInsideOpenDay,
  resolveRhythmState,
} from '../routine';
import {
  computeEffectiveRestrictions,
} from '../restrictions';
import {
  computeUnsuppressedBaseRestrictedAppIds,
} from '../nativePolicy';
import {
  DeviceApp,
  RiskGroup,
  RoutineWindow,
  RhythmConfiguration,
} from '../../../types/domain';
import { bootstrapRhythm } from '../../../application/bootstrapRhythm';
import { MockStorageProvider } from '../../../platform/storage/MockStorageProvider';
import { MockPermissionProvider } from '../../../platform/permissions/MockPermissionProvider';
import { configurePlatformServices } from '../../../platform/PlatformServices';

describe('Pass 01 — Overnight Protection, Daily Allowance & Domain Invariants', () => {
  const standardWindows: RoutineWindow[] = [
    {
      id: 'morning-buffer',
      name: 'Morning Buffer',
      type: 'morning-buffer',
      startTime: '06:30',
      endTime: '08:00',
      activeDays: [1, 2, 3, 4, 5, 6, 7],
      protectedGroupIds: ['social'],
      enabled: true,
      tagline: 'Morning focus',
      description: 'Buffer before work',
    },
    {
      id: 'open-day',
      name: 'Open Day',
      type: 'open-day',
      startTime: '08:00',
      endTime: '21:30',
      activeDays: [1, 2, 3, 4, 5, 6, 7],
      protectedGroupIds: [],
      enabled: true,
      tagline: 'Mindful daylight',
      description: 'Open day period',
    },
    {
      id: 'evening-wind-down',
      name: 'Evening Wind-Down',
      type: 'evening-wind-down',
      startTime: '21:30',
      endTime: '23:30',
      activeDays: [1, 2, 3, 4, 5, 6, 7],
      protectedGroupIds: ['social'],
      enabled: true,
      tagline: 'Evening focus',
      description: 'Wind down for sleep',
    },
  ];

  const standardRiskGroup: RiskGroup = {
    id: 'social',
    name: 'Social',
    description: 'Social networking',
    iconName: 'smartphone',
    iconColor: '#235D43',
    iconBg: '#E8EFE5',
    sessionThresholdMinutes: 20,
    cooldownMinutes: 60,
    currentSessionMinutes: 0,
    appIds: ['com.instagram.android'],
  };

  const standardApps: DeviceApp[] = [
    {
      id: 'com.instagram.android',
      name: 'Instagram',
      classification: 'risk',
      riskGroupId: 'social',
      iconName: 'smartphone',
      iconColor: '#235D43',
      iconBg: '#E8EFE5',
      defaultCategory: 'Social',
      usageTodayMinutes: 0,
      sessionMinutes: 0,
      dailyRiskAllowance: {
        allowanceMinutes: 30,
      },
    },
    {
      id: 'com.google.android.dialer',
      name: 'Phone',
      classification: 'essential',
      iconName: 'smartphone',
      iconColor: '#235D43',
      iconBg: '#E8EFE5',
      defaultCategory: 'Communication',
      usageTodayMinutes: 0,
      sessionMinutes: 0,
    },
    {
      id: 'com.example.notes',
      name: 'Notes',
      classification: 'normal',
      iconName: 'smartphone',
      iconColor: '#235D43',
      iconBg: '#E8EFE5',
      defaultCategory: 'Productivity',
      usageTodayMinutes: 0,
      sessionMinutes: 0,
    },
  ];

  describe('1. 24-Hour Timeline & Overnight Protection Progression', () => {
    // Reference date: Wednesday 2026-09-02 (weekday 3)
    const makeTime = (hour: number, minute: number, day: number = 2) =>
      new Date(2026, 8, day, hour, minute, 0, 0);

    it('identifies exact state across a full 24-hour cycle', () => {
      // 06:29 -> overnight-protected (gap before morning buffer)
      assert.equal(isInsideOvernightProtection(makeTime(6, 29), standardWindows), true);
      assert.equal(resolveRhythmState(makeTime(6, 29), standardWindows), 'overnight-protected');
      assert.equal(isInsideOpenDay(makeTime(6, 29), standardWindows), false);

      // 06:30 -> morning-buffer starts
      assert.equal(isInsideOvernightProtection(makeTime(6, 30), standardWindows), false);
      assert.equal(resolveRhythmState(makeTime(6, 30), standardWindows), 'morning-buffer');
      assert.equal(isInsideOpenDay(makeTime(6, 30), standardWindows), false);

      // 07:59 -> morning-buffer continues
      assert.equal(resolveRhythmState(makeTime(7, 59), standardWindows), 'morning-buffer');

      // 08:00 -> morning buffer ends, Open Day begins
      assert.equal(resolveRhythmState(makeTime(8, 0), standardWindows), 'available');
      assert.equal(isInsideOpenDay(makeTime(8, 0), standardWindows), true);

      // 12:00 -> midday Open Day
      assert.equal(resolveRhythmState(makeTime(12, 0), standardWindows), 'available');
      assert.equal(isInsideOpenDay(makeTime(12, 0), standardWindows), true);

      // 21:29 -> Open Day ends
      assert.equal(resolveRhythmState(makeTime(21, 29), standardWindows), 'available');
      assert.equal(isInsideOpenDay(makeTime(21, 29), standardWindows), true);

      // 21:30 -> Evening Wind-Down starts
      assert.equal(resolveRhythmState(makeTime(21, 30), standardWindows), 'evening-wind-down');
      assert.equal(isInsideOpenDay(makeTime(21, 30), standardWindows), false);
      assert.equal(isInsideOvernightProtection(makeTime(21, 30), standardWindows), false);

      // 23:29 -> Evening Wind-Down continues
      assert.equal(resolveRhythmState(makeTime(23, 29), standardWindows), 'evening-wind-down');
      assert.equal(isInsideOvernightProtection(makeTime(23, 29), standardWindows), false);

      // 23:30 -> Evening ends, Overnight Protection gap begins
      assert.equal(isInsideOvernightProtection(makeTime(23, 30), standardWindows), true);
      assert.equal(resolveRhythmState(makeTime(23, 30), standardWindows), 'overnight-protected');
      assert.equal(isInsideOpenDay(makeTime(23, 30), standardWindows), false);

      // 00:00 -> Midnight, Day 3 begins, still overnight protected
      assert.equal(isInsideOvernightProtection(makeTime(0, 0, 3), standardWindows), true);
      assert.equal(resolveRhythmState(makeTime(0, 0, 3), standardWindows), 'overnight-protected');

      // 02:00 -> Deep night, still overnight protected
      assert.equal(isInsideOvernightProtection(makeTime(2, 0, 3), standardWindows), true);
      assert.equal(resolveRhythmState(makeTime(2, 0, 3), standardWindows), 'overnight-protected');
    });

    it('Sunday night to Monday morning transition handles ISO weekday wrapping', () => {
      // 2026-09-06 is Sunday (ISO 7)
      // 2026-09-07 is Monday (ISO 1)
      const sunNight = new Date(2026, 8, 6, 23, 45, 0, 0);
      assert.equal(isInsideOvernightProtection(sunNight, standardWindows), true);
      assert.equal(resolveRhythmState(sunNight, standardWindows), 'overnight-protected');

      const monEarly = new Date(2026, 8, 7, 2, 30, 0, 0);
      assert.equal(isInsideOvernightProtection(monEarly, standardWindows), true);
      assert.equal(resolveRhythmState(monEarly, standardWindows), 'overnight-protected');
    });

    it('does not invent overnight lock if evening or morning window is disabled or inactive', () => {
      const disabledEvening = standardWindows.map((w) =>
        w.type === 'evening-wind-down' ? { ...w, enabled: false } : w
      );
      assert.equal(isInsideOvernightProtection(makeTime(2, 0), disabledEvening), false);

      const disabledMorning = standardWindows.map((w) =>
        w.type === 'morning-buffer' ? { ...w, enabled: false } : w
      );
      assert.equal(isInsideOvernightProtection(makeTime(2, 0), disabledMorning), false);

      // Sunday evening not active in activeDays
      const weekdayOnlyEvening = standardWindows.map((w) =>
        w.type === 'evening-wind-down' ? { ...w, activeDays: [1, 2, 3, 4, 5] } : w
      );
      const sunNight = new Date(2026, 8, 6, 23, 45, 0, 0); // Sunday night
      assert.equal(isInsideOvernightProtection(sunNight, weekdayOnlyEvening), false);
    });
  });

  describe('2. Per-Risk-App Daily Allowance & Anti-Backdoor Editing', () => {
    it('initializes and verifies default constants', () => {
      assert.equal(DEFAULT_DAILY_RISK_ALLOWANCE_MINUTES, 30);
      assert.equal(DAILY_ALLOWANCE_STEP_MINUTES, 15);
      assert.equal(MIN_DAILY_RISK_ALLOWANCE_MINUTES, 0);
    });

    it('validates allowed single edit rules for a local day', () => {
      const today = '2026-09-02';

      // Default 30 min -> +15 increase to 45 is allowed
      const r1 = validateDailyAllowanceEdit(undefined, 45, today);
      assert.equal(r1.allowed, true);
      assert.equal(r1.nextMinutes, 45);
      assert.equal(r1.consumesDailyEdit, true);

      // Current 30 min -> reduction by any 15m step (e.g. 15, 0) is allowed
      const r2 = validateDailyAllowanceEdit({ allowanceMinutes: 30 }, 15, today);
      assert.equal(r2.allowed, true);
      assert.equal(r2.nextMinutes, 15);
      assert.equal(r2.consumesDailyEdit, true);

      const r3 = validateDailyAllowanceEdit({ allowanceMinutes: 30 }, 0, today);
      assert.equal(r3.allowed, true);
      assert.equal(r3.nextMinutes, 0);
      assert.equal(r3.consumesDailyEdit, true);

      // No-op edit (30 -> 30) is allowed but does NOT consume the daily edit
      const rNoop = validateDailyAllowanceEdit({ allowanceMinutes: 30 }, 30, today);
      assert.equal(rNoop.allowed, true);
      assert.equal(rNoop.nextMinutes, 30);
      assert.equal(rNoop.consumesDailyEdit, false);
    });

    it('rejects invalid edits (non-15 steps, negative, increase > 15, same-day second edit)', () => {
      const today = '2026-09-02';

      // Non-15 step
      const rNonStep = validateDailyAllowanceEdit({ allowanceMinutes: 30 }, 35, today);
      assert.equal(rNonStep.allowed, false);
      assert.equal(rNonStep.reason, 'invalid-step');

      // Negative
      const rNeg = validateDailyAllowanceEdit({ allowanceMinutes: 30 }, -15, today);
      assert.equal(rNeg.allowed, false);
      assert.equal(rNeg.reason, 'below-minimum');

      // Increase > 15 (e.g. 30 -> 60)
      const rBigInc = validateDailyAllowanceEdit({ allowanceMinutes: 30 }, 60, today);
      assert.equal(rBigInc.allowed, false);
      assert.equal(rBigInc.reason, 'increase-too-large');

      // Second same-day edit
      const policyEditedToday = {
        allowanceMinutes: 45,
        lastEditedDateKey: today,
      };
      const rSecondEdit = validateDailyAllowanceEdit(policyEditedToday, 30, today);
      assert.equal(rSecondEdit.allowed, false);
      assert.equal(rSecondEdit.reason, 'already-edited-today');

      // Next day edit is permitted
      const tomorrow = '2026-09-03';
      const rNextDay = validateDailyAllowanceEdit(policyEditedToday, 60, tomorrow);
      assert.equal(rNextDay.allowed, true);
      assert.equal(rNextDay.nextMinutes, 60);
      assert.equal(rNextDay.consumesDailyEdit, true);
    });

    it('preserves policy across app reclassification (anti-bypass)', () => {
      const today = '2026-09-02';
      const app: DeviceApp = { ...standardApps[0], dailyRiskAllowance: { allowanceMinutes: 45, lastEditedDateKey: today } };

      // User switches Risk -> Normal
      const normalApp: DeviceApp = { ...app, classification: 'normal', riskGroupId: undefined };
      assert.equal(normalApp.dailyRiskAllowance?.allowanceMinutes, 45);
      assert.equal(normalApp.dailyRiskAllowance?.lastEditedDateKey, today);

      // User switches back to Risk on same day: allowance is preserved and still cannot edit again today
      const backToRiskApp: DeviceApp = { ...normalApp, classification: 'risk', riskGroupId: 'social' };
      assert.equal(backToRiskApp.dailyRiskAllowance?.allowanceMinutes, 45);
      const testEdit = validateDailyAllowanceEdit(backToRiskApp.dailyRiskAllowance, 60, today);
      assert.equal(testEdit.allowed, false);
      assert.equal(testEdit.reason, 'already-edited-today');
    });
  });

  describe('3. Daily Allowance Exhaustion & Restriction Union', () => {
    const today = '2026-09-02';
    const nowMs = new Date(2026, 8, 2, 14, 0, 0, 0).getTime(); // Midday 14:00

    it('evaluates allowance exhaustion based on usedSeconds + active segment', () => {
      const app: DeviceApp = { ...standardApps[0], dailyRiskAllowance: { allowanceMinutes: 30 } };

      // 29m 50s used (1790s) -> not exhausted
      const usage1 = {
        [app.id]: {
          appId: app.id,
          dateKey: today,
          usedSeconds: 1790,
        },
      };
      assert.equal(isDailyAllowanceExhausted(app, usage1, nowMs), false);

      // Exactly 30m used (1800s) -> exhausted
      const usage2 = {
        [app.id]: {
          appId: app.id,
          dateKey: today,
          usedSeconds: 1800,
        },
      };
      assert.equal(isDailyAllowanceExhausted(app, usage2, nowMs), true);

      // 29m used + active segment running for 70s -> total 30m10s -> exhausted
      const usage3 = {
        [app.id]: {
          appId: app.id,
          dateKey: today,
          usedSeconds: 1740,
          activeSegmentStartedAt: nowMs - 70000,
        },
      };
      assert.equal(isDailyAllowanceExhausted(app, usage3, nowMs), true);
    });

    it('unions routine, overnight, cooldown, and allowance exhaustion reasons', () => {
      const app: DeviceApp = { ...standardApps[0], dailyRiskAllowance: { allowanceMinutes: 30 } };
      const configApps = [app, standardApps[1], standardApps[2]];

      // Exhausted usage
      const dailyUsage = {
        [app.id]: {
          appId: app.id,
          dateKey: today,
          usedSeconds: 1800,
        },
      };

      // During Morning Buffer (routine active) AND daily allowance exhausted
      const morningWindow = standardWindows.find((w) => w.type === 'morning-buffer')!;
      const res = computeEffectiveRestrictions(
        [morningWindow],
        {},
        [standardRiskGroup],
        configApps,
        nowMs,
        {},
        {
          isOvernight: false,
          dailyAppUsage: dailyUsage,
        }
      );

      assert.deepEqual(res.effectiveAppIds, [app.id]);
      const appRest = res.appRestrictions.find((r) => r.appId === app.id);
      assert.ok(appRest);
      // Contains both routine and daily-allowance reasons
      assert.equal(appRest?.reasons.some((r) => r.type === 'routine'), true);
      assert.equal(appRest?.reasons.some((r) => r.type === 'daily-allowance'), true);
    });

    it('Access Lease temporarily suppresses effective restriction without altering usedSeconds or base set', () => {
      const app: DeviceApp = { ...standardApps[0], dailyRiskAllowance: { allowanceMinutes: 30 } };
      const config: RhythmConfiguration = {
        routineWindows: standardWindows,
        riskGroups: [standardRiskGroup],
        apps: [app, standardApps[1], standardApps[2]],
      };

      const dailyUsage = {
        [app.id]: {
          appId: app.id,
          dateKey: today,
          usedSeconds: 1800,
        },
      };

      // Native base set includes the exhausted app
      const baseAppIds = computeUnsuppressedBaseRestrictedAppIds(
        {
          state: 'available',
          activeCooldowns: {},
          activeAccessLeases: {},
          activeRoutineWindowIds: [],
          activeRestrictions: [],
          dailyAppUsage: dailyUsage,
        },
        config,
        nowMs
      );
      assert.ok(baseAppIds.includes(app.id), 'Base restriction includes exhausted app');

      // With active Access Lease for 'social'
      const activeLease = {
        social: {
          id: 'lease-social',
          groupId: 'social',
          startedAt: nowMs,
          endsAt: nowMs + 15 * 60 * 1000,
          reason: 'emergency' as const,
        },
      };

      const res = computeEffectiveRestrictions(
        [],
        {},
        [standardRiskGroup],
        config.apps,
        nowMs,
        activeLease,
        {
          isOvernight: false,
          dailyAppUsage: dailyUsage,
        }
      );

      // Effective restriction is suppressed
      assert.equal(res.effectiveAppIds.length, 0, 'Effective restriction suppressed during lease');

      // Base set still contains the app (sole writer invariant)
      const baseDuringLease = computeUnsuppressedBaseRestrictedAppIds(
        {
          state: 'available',
          activeCooldowns: {},
          activeAccessLeases: activeLease,
          activeRoutineWindowIds: [],
          activeRestrictions: [],
          dailyAppUsage: dailyUsage,
        },
        config,
        nowMs
      );
      assert.ok(baseDuringLease.includes(app.id), 'Base restriction unaffected by lease');
    });

    it('never restricts essential apps under any condition', () => {
      const essentialApp = standardApps[1]; // Phone
      const config: RhythmConfiguration = {
        routineWindows: standardWindows,
        riskGroups: [{ ...standardRiskGroup, appIds: [essentialApp.id] }],
        apps: standardApps,
      };

      // Test during overnight
      const resOvernight = computeEffectiveRestrictions(
        [],
        {},
        config.riskGroups,
        config.apps,
        nowMs,
        {},
        {
          isOvernight: true,
        }
      );
      assert.ok(!resOvernight.effectiveAppIds.includes(essentialApp.id));

      const baseOvernight = computeUnsuppressedBaseRestrictedAppIds(
        {
          state: 'overnight-protected',
          activeCooldowns: {},
          activeRoutineWindowIds: [],
          activeRestrictions: [],
        },
        config,
        new Date(2026, 8, 2, 2, 0, 0, 0).getTime()
      );
      assert.ok(!baseOvernight.includes(essentialApp.id));
    });
  });

  describe('4. Day Rollover & Midnight Transition', () => {
    it('resets usedSeconds and clears exhaustedAt at midnight while splitting active segment', () => {
      const day1 = '2026-09-02';
      const day2 = '2026-09-03';

      const usageDay1 = {
        'app-1': {
          appId: 'app-1',
          dateKey: day1,
          usedSeconds: 1800,
          exhaustedAt: 1700000000000,
        },
        'app-2': {
          appId: 'app-2',
          dateKey: day1,
          usedSeconds: 600,
          activeSegmentStartedAt: new Date(2026, 8, 2, 23, 59, 30).getTime(), // 30s before midnight
        },
      };

      // Rollover to Day 2 at 00:00:15
      const nowDay2 = new Date(2026, 8, 3, 0, 0, 15).getTime();
      const nextUsage = rolloverDailyAppUsage(usageDay1, nowDay2);

      // app-1 reset for Day 2
      assert.equal(nextUsage['app-1'].dateKey, day2);
      assert.equal(nextUsage['app-1'].usedSeconds, 0);
      assert.equal(nextUsage['app-1'].exhaustedAt, undefined);

      // app-2 split active segment: 15s elapsed since midnight on Day 2
      assert.equal(nextUsage['app-2'].dateKey, day2);
      assert.equal(nextUsage['app-2'].usedSeconds, 15);
      assert.equal(nextUsage['app-2'].exhaustedAt, undefined);
    });
  });

  describe('5. Bootstrap Migration & Persistence', () => {
    it('migrates existing Risk apps without policy to 30 minutes idempotently', async () => {
      const mockStorage = new MockStorageProvider();
      configurePlatformServices({
        storage: mockStorage,
        usage: {
          getInstalledApps: async () => [
            {
              id: 'com.instagram.android',
              name: 'Instagram',
              classification: 'risk',
              iconName: 'smartphone',
              iconColor: '#235D43',
              iconBg: '#E8EFE5',
              defaultCategory: 'Social',
              usageTodayMinutes: 0,
              sessionMinutes: 0,
              // No dailyRiskAllowance
            },
            {
              id: 'com.example.notes',
              name: 'Notes',
              classification: 'normal',
              iconName: 'smartphone',
              iconColor: '#235D43',
              iconBg: '#E8EFE5',
              defaultCategory: 'Productivity',
              usageTodayMinutes: 0,
              sessionMinutes: 0,
            },
          ],
          getAppUsageEvents: async () => [],
        },
        permissions: new MockPermissionProvider(),
        restrictions: {
          applyRestrictions: async () => true,
          clearRestrictions: async () => true,
          showFamilyActivityPicker: async () => true,
        },
      });

      const { config, preferences } = await bootstrapRhythm({ deferRestrictionEffects: true });
      const instagram = config.apps.find((a) => a.id === 'com.instagram.android');
      const notes = config.apps.find((a) => a.id === 'com.example.notes');

      // Risk app migrated to 30 min
      assert.equal(instagram?.dailyRiskAllowance?.allowanceMinutes, 30);
      assert.equal(preferences.appClassifications['com.instagram.android'].dailyRiskAllowance?.allowanceMinutes, 30);

      // Normal app has no policy
      assert.equal(notes?.dailyRiskAllowance, undefined);
      assert.equal(preferences.appClassifications['com.example.notes'].dailyRiskAllowance, undefined);
    });
  });
});
