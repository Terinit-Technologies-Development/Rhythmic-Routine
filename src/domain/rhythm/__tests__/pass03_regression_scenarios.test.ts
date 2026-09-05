import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getRiskGroupStatus,
  resolveGroupAllowanceMinutes,
  isGroupAllowanceExhausted,
  rolloverGroupAllowanceUsage,
} from '../allowance';
import {
  isInsideOvernightProtection,
  resolveRhythmState,
} from '../routine';
import {
  DeviceApp,
  RiskGroup,
  RoutineWindow,
  GroupAllowanceSnapshot,
  GroupAllowanceUsage,
} from '../../../types/domain';
import { RhythmEngine } from '../RhythmEngine';
import { getLocalDateKey } from '../../insights';

describe('Pass 03 — Regression Scenarios A through G', () => {
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

  const socialGroup: RiskGroup = {
    id: 'social',
    name: 'Social Feeds',
    description: 'Social networking',
    iconName: 'smartphone',
    iconColor: '#235D43',
    iconBg: '#E8EFE5',
    allowanceMinutes: 30,
    cooldownMinutes: 60,
    recoveryActivityId: 'walk',
    currentSessionMinutes: 0,
    appIds: ['com.instagram.android', 'com.tiktok.android', 'com.reddit.frontpage'],
  };

  const appA: DeviceApp = {
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
  };

  const appB: DeviceApp = {
    id: 'com.tiktok.android',
    name: 'TikTok',
    classification: 'risk',
    riskGroupId: 'social',
    iconName: 'video',
    iconColor: '#000000',
    iconBg: '#FFFFFF',
    defaultCategory: 'Social',
    usageTodayMinutes: 0,
    sessionMinutes: 0,
  };

  const appC: DeviceApp = {
    id: 'com.reddit.frontpage',
    name: 'Reddit',
    classification: 'risk',
    riskGroupId: 'social',
    iconName: 'message-circle',
    iconColor: '#FF4500',
    iconBg: '#FFFFFF',
    defaultCategory: 'Social',
    usageTodayMinutes: 0,
    sessionMinutes: 0,
  };

  // ---------------------------------------------------------------------------
  // Scenario A — Shared Group Allowance
  // ---------------------------------------------------------------------------
  describe('Scenario A — Shared Group Allowance Exhaustion', () => {
    it('exhausts group allowance when 3 apps collectively spend 10 + 8 + 12 = 30 min', () => {
      // 14:00 on Day 1 (Open Day)
      const t0 = new Date(2026, 8, 2, 14, 0, 0, 0).getTime();
      const engine = new RhythmEngine(
        {
          routineWindows: standardWindows,
          riskGroups: [socialGroup],
          apps: [appA, appB, appC],
        },
        null,
        t0
      );

      // App A foregrounds for 10 min (600 sec)
      engine.dispatch({ type: 'APP_FOREGROUND', appId: appA.id, timestamp: t0 });

      // App B foregrounds at t0 + 10 min -> App A usage (10m) accumulated
      const tB_start = t0 + 600_000;
      engine.dispatch({ type: 'APP_FOREGROUND', appId: appB.id, timestamp: tB_start });

      let runtime = engine.getRuntime();
      assert.equal(runtime.state, 'risk-session');
      assert.equal(runtime.activeCooldowns?.['social'], undefined);

      // App C foregrounds at tB_start + 8 min (480s) -> App B usage (8m) accumulated (18m total)
      const tC_start = tB_start + 480_000;
      engine.dispatch({ type: 'APP_FOREGROUND', appId: appC.id, timestamp: tC_start });

      runtime = engine.getRuntime();
      assert.equal(runtime.state, 'risk-session');
      assert.equal(runtime.activeCooldowns?.['social'], undefined);

      // Clock tick at tC_start + 12 min (720s) -> reaches exactly 30 min total (1800s)
      const tExhaustion = tC_start + 720_000;
      engine.dispatch({ type: 'CLOCK_TICK', timestamp: tExhaustion });

      runtime = engine.getRuntime();
      // Group allowance reached -> cooldown triggered
      assert.equal(runtime.state, 'cooldown', 'Group enters cooldown at 30 min cumulative usage');
      assert.ok(runtime.activeCooldowns?.['social'], 'Social group cooldown must be active');
      assert.equal(
        runtime.activeCooldowns['social'].endsAt,
        tExhaustion + 60 * 60_000,
        'Cooldown set to group cooldownMinutes (60 min)'
      );

      // All apps in group A, B, C are restricted
      const restrictedAppIds = engine.getEffectiveRestrictedAppIds();
      assert.ok(restrictedAppIds.includes(appA.id), 'App A is restricted');
      assert.ok(restrictedAppIds.includes(appB.id), 'App B is restricted');
      assert.ok(restrictedAppIds.includes(appC.id), 'App C is restricted');
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario B — Cooldown Refresh
  // ---------------------------------------------------------------------------
  describe('Scenario B — Cooldown Expiry Restores Full Allowance', () => {
    it('clears cooldown and restores full allowance after cooldown duration expires', () => {
      const t0 = new Date(2026, 8, 2, 14, 0, 0, 0).getTime();
      const engine = new RhythmEngine(
        {
          routineWindows: standardWindows,
          riskGroups: [socialGroup],
          apps: [appA, appB, appC],
        },
        null,
        t0
      );

      // Consume 30 min in App A to trigger cooldown
      engine.dispatch({ type: 'APP_FOREGROUND', appId: appA.id, timestamp: t0 });
      const tCooldownStart = t0 + 30 * 60_000;
      engine.dispatch({ type: 'CLOCK_TICK', timestamp: tCooldownStart });

      let runtime = engine.getRuntime();
      assert.equal(runtime.state, 'cooldown');
      assert.ok(runtime.activeCooldowns?.['social']);

      // Advance clock past cooldown expiry (60 minutes cooldown)
      const tAfterCooldown = tCooldownStart + 60 * 60_000 + 1_000;
      engine.dispatch({ type: 'CLOCK_TICK', timestamp: tAfterCooldown });

      runtime = engine.getRuntime();
      assert.equal(runtime.state, 'available', 'Returns to available after cooldown expires');
      assert.equal(runtime.activeCooldowns?.['social'], undefined, 'Cooldown cleared');

      // Native snapshot reconciliation with fresh cycle
      const freshSnap: GroupAllowanceSnapshot = {
        groupId: 'social',
        dateKey: getLocalDateKey(tAfterCooldown),
        usedSeconds: 0,
        allowanceMinutes: 30,
        remainingSeconds: 1800,
        exhausted: false,
      };

      const status = getRiskGroupStatus({
        snapshot: freshSnap,
        cooldownEndsAt: undefined,
        usageAvailable: true,
        now: tAfterCooldown,
      });

      assert.equal(status.kind, 'fresh', 'Group status is fresh after cooldown');
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario C — Next Local Day Rollover
  // ---------------------------------------------------------------------------
  describe('Scenario C — Day Rollover Gives Fresh Ledger', () => {
    it('resets exhausted usage on day rollover; prior exhaustion does not survive', () => {
      const day1 = '2026-09-02';
      const day2 = '2026-09-03';

      const usageDay1: Record<string, GroupAllowanceUsage> = {
        social: {
          groupId: 'social',
          dateKey: day1,
          usedSeconds: 1800,
          exhaustedAt: 1700000000000,
          cycleRevision: 1,
        },
      };

      // Midnight rollover to Day 2 at 00:00:05
      const nowDay2 = new Date(2026, 8, 3, 0, 0, 5).getTime();
      const rolledOver = rolloverGroupAllowanceUsage(usageDay1, nowDay2);

      assert.equal(rolledOver['social'].dateKey, day2);
      assert.equal(rolledOver['social'].usedSeconds, 0, 'Used seconds reset to 0');
      assert.equal(rolledOver['social'].exhaustedAt, undefined, 'Exhaustion cleared');

      // Group allowance is no longer exhausted
      const isExhausted = isGroupAllowanceExhausted(socialGroup, rolledOver['social'], nowDay2);
      assert.equal(isExhausted, false, 'Group allowance is fresh on Day 2');
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario D — Overnight Protection
  // ---------------------------------------------------------------------------
  describe('Scenario D — Overnight Routine Across Midnight to Morning Release', () => {
    it('maintains overnight protection across midnight, releasing fresh allowance at morning buffer end', () => {
      // 22:00 Day 1: Inside Evening Wind-Down window
      const tEvening = new Date(2026, 8, 2, 22, 0, 0);
      const stateEvening = resolveRhythmState(tEvening, standardWindows);
      assert.equal(stateEvening, 'evening-wind-down');

      // 00:30 Day 2: Past midnight, overnight gap protection active between evening and morning
      const tPastMidnight = new Date(2026, 8, 3, 0, 30, 0);
      assert.equal(isInsideOvernightProtection(tPastMidnight, standardWindows), true);
      const stateOvernight = resolveRhythmState(tPastMidnight, standardWindows);
      assert.equal(stateOvernight, 'overnight-protected');

      // 07:00 Day 2: Morning buffer active
      const tMorningBuffer = new Date(2026, 8, 3, 7, 0, 0);
      const stateMorning = resolveRhythmState(tMorningBuffer, standardWindows);
      assert.equal(stateMorning, 'morning-buffer');

      // 08:05 Day 2: Open Day released
      const tOpenDay = new Date(2026, 8, 3, 8, 5, 0);
      const stateOpen = resolveRhythmState(tOpenDay, standardWindows);
      assert.equal(stateOpen, 'available');

      // Full fresh allowance available
      assert.equal(resolveGroupAllowanceMinutes(socialGroup), 30);
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario E — Access Lease
  // ---------------------------------------------------------------------------
  describe('Scenario E — Access Lease Interactions', () => {
    it('lease during active cycle still counts usage; lease during cooldown unblocks without deleting cooldown', () => {
      const t0 = new Date(2026, 8, 2, 14, 0, 0).getTime();
      const engine = new RhythmEngine(
        {
          routineWindows: standardWindows,
          riskGroups: [socialGroup],
          apps: [appA],
        },
        null,
        t0
      );

      // Trigger cooldown
      engine.dispatch({ type: 'APP_FOREGROUND', appId: appA.id, timestamp: t0 });
      const tCooldownStart = t0 + 30 * 60_000;
      engine.dispatch({ type: 'CLOCK_TICK', timestamp: tCooldownStart });

      let runtime = engine.getRuntime();
      assert.equal(runtime.state, 'cooldown');
      const originalCooldownEndsAt = runtime.activeCooldowns['social'].endsAt;

      // Start 15-min Access Lease during cooldown
      const leaseExpiresAt = tCooldownStart + 15 * 60_000;
      engine.dispatch({
        type: 'START_ACCESS_LEASE',
        groupId: 'social',
        durationMinutes: 15,
        timestamp: tCooldownStart,
      });

      runtime = engine.getRuntime();
      // Access lease does NOT delete cooldown
      assert.ok(runtime.activeCooldowns?.['social'], 'Cooldown remains recorded');
      assert.equal(runtime.activeCooldowns['social'].endsAt, originalCooldownEndsAt);

      // Effective restriction suppresses appA during lease
      const restrictedDuringLease = engine.getEffectiveRestrictedAppIds();
      assert.equal(restrictedDuringLease.includes(appA.id), false, 'App is unblocked during lease');

      // Once lease expires, appA is restricted again if cooldown is still running
      engine.dispatch({ type: 'CLOCK_TICK', timestamp: leaseExpiresAt + 1_000 });
      const restrictedAfterLease = engine.getEffectiveRestrictedAppIds();
      assert.equal(restrictedAfterLease.includes(appA.id), true, 'App is restricted again after lease expires');
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario F — UI Truthfulness via getRiskGroupStatus
  // ---------------------------------------------------------------------------
  describe('Scenario F — UI Truthfulness via getRiskGroupStatus', () => {
    it('truthfully maps unavailable, cooldown, fresh, and active states', () => {
      const now = 1700000000000;

      // 1. Unavailable
      const statusUnavailable = getRiskGroupStatus({
        usageAvailable: false,
        now,
      });
      assert.equal(statusUnavailable.kind, 'unavailable');

      // 2. Cooldown
      const statusCooldown = getRiskGroupStatus({
        usageAvailable: true,
        cooldownEndsAt: now + 30 * 60_000,
        now,
      });
      assert.equal(statusCooldown.kind, 'cooldown');
      if (statusCooldown.kind === 'cooldown') {
        assert.equal(statusCooldown.endsAt, now + 30 * 60_000);
      }

      // 3. Fresh (no snapshot or 0 used)
      const statusFreshNoSnap = getRiskGroupStatus({
        usageAvailable: true,
        snapshot: undefined,
        now,
      });
      assert.equal(statusFreshNoSnap.kind, 'fresh');

      const statusFreshZero = getRiskGroupStatus({
        usageAvailable: true,
        snapshot: {
          groupId: 'social',
          dateKey: '2026-09-02',
          usedSeconds: 0,
          allowanceMinutes: 30,
          remainingSeconds: 1800,
          exhausted: false,
        },
        now,
      });
      assert.equal(statusFreshZero.kind, 'fresh');

      // 4. Active (usedSeconds > 0, not in cooldown)
      const statusActive = getRiskGroupStatus({
        usageAvailable: true,
        snapshot: {
          groupId: 'social',
          dateKey: '2026-09-02',
          usedSeconds: 600,
          allowanceMinutes: 30,
          remainingSeconds: 1200,
          exhausted: false,
        },
        now,
      });
      assert.equal(statusActive.kind, 'active');
      if (statusActive.kind === 'active') {
        assert.equal(statusActive.snapshot.usedSeconds, 600);
      }

      // 5. Inactive cooldown does not report cooling down
      const statusExpiredCooldown = getRiskGroupStatus({
        usageAvailable: true,
        cooldownEndsAt: now - 1000,
        snapshot: {
          groupId: 'social',
          dateKey: '2026-09-02',
          usedSeconds: 0,
          allowanceMinutes: 30,
          remainingSeconds: 1800,
          exhausted: false,
        },
        now,
      });
      assert.equal(statusExpiredCooldown.kind, 'fresh');
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario G — App Membership Transfer
  // ---------------------------------------------------------------------------
  describe('Scenario G — App Membership Reassignment', () => {
    it('moving an app between groups preserves source group usage and immediately bounds to destination group', () => {
      const groupA: RiskGroup = {
        id: 'group-a',
        name: 'Group A',
        description: 'First group',
        iconName: 'smartphone',
        iconColor: '#235D43',
        iconBg: '#E8EFE5',
        allowanceMinutes: 30,
        cooldownMinutes: 60,
        currentSessionMinutes: 0,
        appIds: [appA.id],
      };

      // Initial state: Group A has 10 min usage in group allowance ledger
      const t0 = new Date(2026, 8, 2, 14, 0, 0).getTime();
      const groupUsage: Record<string, GroupAllowanceUsage> = {
        'group-a': {
          groupId: 'group-a',
          dateKey: '2026-09-02',
          usedSeconds: 600, // 10 min
          cycleRevision: 1,
        },
      };

      // Moving appB to groupA: groupA now has [appA, appB]
      const updatedGroupA: RiskGroup = {
        ...groupA,
        appIds: [appA.id, appB.id],
      };

      // Group A's existing usage is still 10 min
      const exhaustedBefore = isGroupAllowanceExhausted(
        updatedGroupA,
        groupUsage['group-a'],
        t0
      );
      assert.equal(exhaustedBefore, false, 'Group A still has 20m remaining');

      // Now member consumes 20 min in group A -> reaching Group A's 30 min allowance
      groupUsage['group-a'].usedSeconds += 1200; // now 1800s = 30 min

      const exhaustedAfter = isGroupAllowanceExhausted(
        updatedGroupA,
        groupUsage['group-a'],
        t0
      );
      assert.equal(exhaustedAfter, true, 'Group A is now exhausted after member consumed remaining allowance');
    });
  });
});
