import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_DAILY_RISK_ALLOWANCE_MINUTES,
  getLocalDateKey,
  getGroupAllowanceSnapshot,
  isGroupAllowanceExhausted,
  rolloverGroupAllowanceUsage,
  resolveGroupAllowanceMinutes,
  resolveGroupRecoveryActivityId,
  validateGroupAllowanceEdit,
} from '../allowance';
import {
  clearStalePerAppExhaustion,
  createGroupAllowanceLedgers,
  migrateConfigurationV102,
  migrateDeviceAppV102,
  migrateRiskGroupV102,
} from '../migration';
import { DeviceApp, GroupAllowanceUsage, RiskGroup } from '../../../types/domain';
import { computeEffectiveRestrictions } from '../restrictions';
import { computeUnsuppressedBaseRestrictedAppIds } from '../nativePolicy';
import { RhythmCoordinator } from '../../../application/RhythmCoordinator';
import { bootstrapRhythm } from '../../../application/bootstrapRhythm';
import { MockStorageProvider } from '../../../platform/storage/MockStorageProvider';
import { MockPermissionProvider } from '../../../platform/permissions/MockPermissionProvider';
import { MockUsageProvider } from '../../../platform/mock/MockUsageProvider';
import { MockRestrictionProvider } from '../../../platform/mock/MockRestrictionProvider';
import { configurePlatformServices } from '../../../platform/PlatformServices';

function makeGroup(overrides: Partial<RiskGroup> = {}): RiskGroup {
  return {
    id: 'social',
    name: 'Social Feeds',
    description: 'Social scroll apps',
    iconName: 'message-square',
    iconColor: '#235D43',
    iconBg: '#E8EFE5',
    appIds: ['instagram', 'x', 'tiktok'],
    allowanceMinutes: 30,
    cooldownMinutes: 90,
    recoveryActivityId: 'walk',
    currentSessionMinutes: 0,
    ...overrides,
  };
}

function makeUsage(overrides: Partial<GroupAllowanceUsage> = {}): GroupAllowanceUsage {
  return {
    groupId: 'social',
    dateKey: '2026-09-02',
    usedSeconds: 0,
    activePackageName: undefined,
    activeSegmentStartedAt: undefined,
    exhaustedAt: undefined,
    cycleRevision: 0,
    ...overrides,
  };
}

describe('Pass 01 (v1.0.2) — Group Allowance Domain & Migration', () => {
  describe('group default allowance', () => {
    it('defaults to 30 minutes when missing or invalid', () => {
      assert.equal(resolveGroupAllowanceMinutes({} as RiskGroup), 30);
      assert.equal(
        resolveGroupAllowanceMinutes({ allowanceMinutes: Number.NaN } as unknown as RiskGroup),
        30
      );
      assert.equal(
        resolveGroupAllowanceMinutes({ allowanceMinutes: -5 } as unknown as RiskGroup),
        30
      );
      assert.equal(DEFAULT_DAILY_RISK_ALLOWANCE_MINUTES, 30);
    });

    it('prefers explicit group allowance over legacy threshold', () => {
      assert.equal(
        resolveGroupAllowanceMinutes({
          allowanceMinutes: 45,
          sessionThresholdMinutes: 30,
        } as RiskGroup),
        45
      );
    });

    it('falls back to legacy sessionThresholdMinutes for unmigrated fixtures', () => {
      assert.equal(
        resolveGroupAllowanceMinutes({ sessionThresholdMinutes: 45 } as RiskGroup),
        45
      );
    });
  });

  describe('15-minute step validation', () => {
    it('rejects non-15-minute steps', () => {
      const r = validateGroupAllowanceEdit({
        currentMinutes: 30,
        requestedMinutes: 35,
        todayDateKey: '2026-09-02',
      });
      assert.equal(r.ok, false);
      assert.equal(r.reason, 'invalid-step');
    });

    it('rejects below-minimum values', () => {
      const r = validateGroupAllowanceEdit({
        currentMinutes: 30,
        requestedMinutes: -15,
        todayDateKey: '2026-09-02',
      });
      assert.equal(r.ok, false);
      assert.equal(r.reason, 'below-minimum');
    });
  });

  describe('once-per-day group edit guard', () => {
    it('rejects a second successful edit on the same local day', () => {
      const r = validateGroupAllowanceEdit({
        currentMinutes: 45,
        requestedMinutes: 30,
        lastEditedDateKey: '2026-09-02',
        todayDateKey: '2026-09-02',
      });
      assert.equal(r.ok, false);
      assert.equal(r.reason, 'already-edited-today');
    });

    it('permits editing again on the next local day', () => {
      const r = validateGroupAllowanceEdit({
        currentMinutes: 45,
        requestedMinutes: 60,
        lastEditedDateKey: '2026-09-02',
        todayDateKey: '2026-09-03',
      });
      assert.equal(r.ok, true);
      assert.equal(r.consumesDailyEdit, true);
    });
  });

  describe('maximum +15 upward change', () => {
    it('allows exactly +15', () => {
      const r = validateGroupAllowanceEdit({
        currentMinutes: 30,
        requestedMinutes: 45,
        todayDateKey: '2026-09-02',
      });
      assert.equal(r.ok, true);
      assert.equal(r.nextMinutes, 45);
      assert.equal(r.consumesDailyEdit, true);
    });

    it('rejects increases beyond +15', () => {
      const r = validateGroupAllowanceEdit({
        currentMinutes: 30,
        requestedMinutes: 60,
        todayDateKey: '2026-09-02',
      });
      assert.equal(r.ok, false);
      assert.equal(r.reason, 'increase-too-large');
    });
  });

  describe('unrestricted downward change in valid steps', () => {
    it('allows any valid 15-minute decrement including 0', () => {
      for (const target of [15, 0]) {
        const r = validateGroupAllowanceEdit({
          currentMinutes: 30,
          requestedMinutes: target,
          todayDateKey: '2026-09-02',
        });
        assert.equal(r.ok, true);
        assert.equal(r.nextMinutes, target);
        assert.equal(r.consumesDailyEdit, true);
      }
      const deep = validateGroupAllowanceEdit({
        currentMinutes: 60,
        requestedMinutes: 15,
        todayDateKey: '2026-09-02',
      });
      assert.equal(deep.ok, true);
      assert.equal(deep.nextMinutes, 15);
    });
  });

  describe('no-op/cancel guard behaviour', () => {
    it('does not consume the daily edit guard', () => {
      const r = validateGroupAllowanceEdit({
        currentMinutes: 30,
        requestedMinutes: 30,
        lastEditedDateKey: '2026-09-02',
        todayDateKey: '2026-09-02',
      });
      assert.equal(r.ok, true);
      assert.equal(r.consumesDailyEdit, false);
    });
  });

  describe('group usage / snapshot contract', () => {
    it('accumulates every member app against one shared pool', () => {
      const group = makeGroup({ allowanceMinutes: 30 });
      // 10m Instagram + 8m X + 12m TikTok = 30m total on the single ledger
      const usage = makeUsage({ usedSeconds: 10 * 60 + 8 * 60 + 12 * 60 });
      assert.equal(isGroupAllowanceExhausted(group, usage, '2026-09-02'), true);

      const partial = makeUsage({ usedSeconds: 10 * 60 + 8 * 60 });
      assert.equal(isGroupAllowanceExhausted(group, partial, '2026-09-02'), false);
    });

    it('treats a 0-minute allowance as immediately exhausted', () => {
      const group = makeGroup({ allowanceMinutes: 0 });
      assert.equal(isGroupAllowanceExhausted(group, makeUsage(), '2026-09-02'), true);
    });

    it('includes a live segment in the exhaustion check', () => {
      const group = makeGroup({ allowanceMinutes: 30 });
      const nowMs = new Date(2026, 8, 2, 14, 0, 0).getTime();
      const usage = makeUsage({
        dateKey: '2026-09-02',
        usedSeconds: 29 * 60,
        activeSegmentStartedAt: nowMs - 70 * 1000,
      });
      assert.equal(isGroupAllowanceExhausted(group, usage, nowMs), true);
    });

    it('resets ledgers at local-day rollover and splits active segments at midnight', () => {
      const usage = {
        social: makeUsage({
          dateKey: '2026-09-02',
          usedSeconds: 1800,
          exhaustedAt: 1700000000000,
          cycleRevision: 3,
        }),
        entertainment: makeUsage({
          groupId: 'entertainment',
          dateKey: '2026-09-02',
          usedSeconds: 600,
          activePackageName: 'com.example.video',
          activeSegmentStartedAt: new Date(2026, 8, 2, 23, 59, 30).getTime(),
          cycleRevision: 1,
        }),
      };
      const nowDay2 = new Date(2026, 8, 3, 0, 0, 15).getTime();
      const next = rolloverGroupAllowanceUsage(usage, nowDay2);

      assert.equal(next['social'].dateKey, '2026-09-03');
      assert.equal(next['social'].usedSeconds, 0);
      assert.equal(next['social'].exhaustedAt, undefined);
      assert.equal(next['social'].cycleRevision, 3);

      assert.equal(next['entertainment'].dateKey, '2026-09-03');
      assert.equal(next['entertainment'].usedSeconds, 0);
      assert.equal(
        next['entertainment'].activeSegmentStartedAt,
        new Date(2026, 8, 3, 0, 0, 0).getTime()
      );
      assert.equal(next['entertainment'].activePackageName, 'com.example.video');
    });

    it('builds a truthful snapshot for UI/sync', () => {
      const group = makeGroup({ allowanceMinutes: 30 });
      const snap = getGroupAllowanceSnapshot(
        group,
        makeUsage({ usedSeconds: 18 * 60 }),
        '2026-09-02'
      );
      assert.equal(snap.groupId, 'social');
      assert.equal(snap.allowanceMinutes, 30);
      assert.equal(snap.usedSeconds, 18 * 60);
      assert.equal(snap.remainingSeconds, 12 * 60);
      assert.equal(snap.exhausted, false);
    });
  });

  describe('migration from v1.0.1', () => {
    it('derives allowance from the old group sessionThresholdMinutes', () => {
      const migrated = migrateRiskGroupV102({
        id: 'social',
        name: 'Social Feeds',
        sessionThresholdMinutes: 45,
        cooldownMinutes: 90,
        appIds: ['instagram'],
      });
      assert.equal(migrated.allowanceMinutes, 45);
    });

    it('defaults invalid/missing thresholds to 30', () => {
      assert.equal(
        migrateRiskGroupV102({ id: 'g', sessionThresholdMinutes: -1 }).allowanceMinutes,
        30
      );
      assert.equal(migrateRiskGroupV102({ id: 'g' }).allowanceMinutes, 30);
    });

    it('ignores per-app dailyRiskAllowance as a policy source', () => {
      const migrated = migrateRiskGroupV102({
        id: 'social',
        sessionThresholdMinutes: 30,
        dailyRiskAllowance: { allowanceMinutes: 120 },
      } as any);
      assert.equal(migrated.allowanceMinutes, 30);
      assert.ok(!('dailyRiskAllowance' in migrated));
    });

    it('is idempotent', () => {
      const once = migrateRiskGroupV102({
        id: 'social',
        name: 'Social Feeds',
        sessionThresholdMinutes: 45,
        cooldownMinutes: 90,
        appIds: ['instagram'],
      });
      const twice = migrateRiskGroupV102(JSON.parse(JSON.stringify(once)));
      assert.deepEqual(twice, once);
    });

    it('defaults recoveryActivityId to walk and preserves explicit selection', () => {
      assert.equal(migrateRiskGroupV102({ id: 'g' }).recoveryActivityId, 'walk');
      assert.equal(resolveGroupRecoveryActivityId({} as RiskGroup), 'walk');
      assert.equal(
        migrateRiskGroupV102({ id: 'g', recoveryActivityId: 'stretch' }).recoveryActivityId,
        'stretch'
      );
    });

    it('preserves group identity/membership/cooldown and strips per-app policy', () => {
      const apps: DeviceApp[] = [
        {
          id: 'instagram',
          name: 'Instagram',
          classification: 'risk',
          riskGroupId: 'social',
          iconName: 'camera',
          iconColor: '#E1306C',
          iconBg: '#FCE4EC',
          defaultCategory: 'Social',
          usageTodayMinutes: 0,
          sessionMinutes: 0,
          dailyRiskAllowance: { allowanceMinutes: 60 },
        },
      ];
      const { riskGroups, apps: migratedApps } = migrateConfigurationV102({
        riskGroups: [
          {
            id: 'social',
            name: 'Social Feeds',
            description: 'd',
            appIds: ['instagram'],
            sessionThresholdMinutes: 45,
            cooldownMinutes: 90,
            nativeSelectionRef: 'sel-1',
            nativeSelectionCount: 2,
            nativeSelectionRevision: 7,
          },
        ],
        apps,
      });
      assert.equal(riskGroups[0].allowanceMinutes, 45);
      assert.equal(riskGroups[0].cooldownMinutes, 90);
      assert.deepEqual(riskGroups[0].appIds, ['instagram']);
      assert.equal(riskGroups[0].nativeSelectionRevision, 7);
      assert.ok(!('sessionThresholdMinutes' in riskGroups[0]));
      assert.ok(!('dailyRiskAllowance' in migratedApps[0]));

      // Serialized config carries no per-app allowance policy.
      const serialized = JSON.stringify({ riskGroups, apps: migratedApps });
      assert.ok(!serialized.includes('dailyRiskAllowance'));
    });

    it('does not reset group policy/edit guard when apps move between groups', () => {
      const before = migrateConfigurationV102({
        riskGroups: [
          {
            id: 'social',
            name: 'Social',
            appIds: ['instagram'],
            allowanceMinutes: 45,
            lastAllowanceEditedDateKey: '2026-09-02',
            recoveryActivityId: 'stretch',
            cooldownMinutes: 90,
          },
        ],
        apps: [
          {
            id: 'instagram',
            name: 'Instagram',
            classification: 'risk',
            riskGroupId: 'social',
            iconName: 'c',
            iconColor: '#000',
            iconBg: '#fff',
            defaultCategory: 'Social',
            usageTodayMinutes: 0,
            sessionMinutes: 0,
          },
        ],
      });
      // Simulate moving instagram social -> entertainment: group record itself
      // is untouched by membership edits.
      assert.equal(before.riskGroups[0].allowanceMinutes, 45);
      assert.equal(before.riskGroups[0].lastAllowanceEditedDateKey, '2026-09-02');
      assert.equal(before.riskGroups[0].recoveryActivityId, 'stretch');
    });

    it('resets stale per-app exhaustion when the group ledger is first created', () => {
      const cleared = clearStalePerAppExhaustion(
        {
          instagram: {
            appId: 'instagram',
            dateKey: '2026-09-02',
            usedSeconds: 1800,
            exhaustedAt: 1700000000000,
            activeSegmentStartedAt: 1700000000000,
          },
        },
        '2026-09-02'
      );
      assert.equal(cleared['instagram'].usedSeconds, 0);
      assert.equal(cleared['instagram'].exhaustedAt, undefined);
      assert.equal(cleared['instagram'].activeSegmentStartedAt, undefined);

      const ledgers = createGroupAllowanceLedgers([{ id: 'social' }], '2026-09-02');
      assert.equal(ledgers['social'].usedSeconds, 0);
      assert.equal(ledgers['social'].cycleRevision, 0);
    });

    it('strips per-app allowance while preserving identity/classification', () => {
      const app: DeviceApp = {
        id: 'instagram',
        name: 'Instagram',
        classification: 'risk',
        riskGroupId: 'social',
        iconName: 'camera',
        iconColor: '#E1306C',
        iconBg: '#FCE4EC',
        defaultCategory: 'Social',
        usageTodayMinutes: 5,
        sessionMinutes: 2,
        dailyRiskAllowance: { allowanceMinutes: 45, lastEditedDateKey: '2026-09-02' },
      };
      const migrated = migrateDeviceAppV102(app);
      assert.ok(!('dailyRiskAllowance' in migrated));
      assert.equal(migrated.classification, 'risk');
      assert.equal(migrated.riskGroupId, 'social');
    });
  });

  describe('bootstrap v1.0.1 -> v1.0.2 upgrade', () => {
    it('migrates persisted groups, strips per-app policy, and clears stale exhaustion', async () => {
      const legacyApps: DeviceApp[] = [
        {
          id: 'instagram',
          name: 'Instagram',
          classification: 'risk',
          riskGroupId: 'social',
          iconName: 'camera',
          iconColor: '#E1306C',
          iconBg: '#FCE4EC',
          defaultCategory: 'Social',
          usageTodayMinutes: 0,
          sessionMinutes: 0,
        },
      ];
      const mockStorage = new MockStorageProvider(
        {
          routineWindows: [],
          riskGroups: [
            {
              id: 'social',
              name: 'Social Feeds',
              description: 'Social',
              iconName: 'message-square',
              iconColor: '#235D43',
              iconBg: '#E8EFE5',
              appIds: ['instagram'],
              sessionThresholdMinutes: 45,
              cooldownMinutes: 90,
              currentSessionMinutes: 0,
            },
          ],
          appClassifications: {
            instagram: {
              classification: 'risk',
              riskGroupId: 'social',
              dailyRiskAllowance: { allowanceMinutes: 60 },
            },
          },
          sessionResetGapMs: 5 * 60 * 1000,
          onboardingCompleted: true,
        } as any,
        {
          state: 'available',
          activeCooldowns: {},
          activeAccessLeases: {},
          activeRoutineWindowIds: [],
          dailyAppUsage: {
            instagram: {
              appId: 'instagram',
              dateKey: '2026-09-02',
              usedSeconds: 1800,
              exhaustedAt: 1700000000000,
            },
          },
          lastReconciledAt: Date.now(),
        } as any
      );
      configurePlatformServices({
        storage: mockStorage,
        usage: new MockUsageProvider(legacyApps),
        permissions: new MockPermissionProvider(),
        restrictions: new MockRestrictionProvider(),
      });

      const { config, preferences } = await bootstrapRhythm({ deferRestrictionEffects: true });
      const social = config.apps.length
        ? config.riskGroups.find((g) => g.id === 'social')
        : undefined;
      assert.ok(social);
      // Allowance derived from legacy GROUP threshold (45), never app policy (60).
      assert.equal(social?.allowanceMinutes, 45);
      assert.equal(social?.recoveryActivityId, 'walk');
      assert.ok(!('sessionThresholdMinutes' in (social as object)));
      // No per-app allowance anywhere in persisted/active config.
      assert.ok(config.apps.every((a) => !('dailyRiskAllowance' in a) || a.dailyRiskAllowance === undefined));
      assert.ok(
        Object.values(preferences.appClassifications).every(
          (c) => !('dailyRiskAllowance' in (c as object))
        )
      );
      const persisted = await mockStorage.loadPreferences();
      assert.ok(
        JSON.stringify(persisted).includes('"allowanceMinutes":45') ||
          JSON.stringify(persisted?.riskGroups).includes('"allowanceMinutes":45')
      );
    });
  });

  describe('coordinator group APIs', () => {
    it('edits group allowance once per day and preserves usage', async () => {
      const apps: DeviceApp[] = [
        {
          id: 'instagram',
          name: 'Instagram',
          classification: 'risk',
          riskGroupId: 'social',
          iconName: 'camera',
          iconColor: '#E1306C',
          iconBg: '#FCE4EC',
          defaultCategory: 'Social',
          usageTodayMinutes: 0,
          sessionMinutes: 0,
        },
      ];
      configurePlatformServices({
        storage: new MockStorageProvider(),
        usage: new MockUsageProvider(apps),
        permissions: new MockPermissionProvider(),
        restrictions: new MockRestrictionProvider(),
      });
      const coordinator = RhythmCoordinator.getInstance();
      coordinator.destroy();
      await coordinator.initialize();

      const todayKey = getLocalDateKey(Date.now());
      void todayKey;
      const first = await coordinator.updateRiskGroupAllowance('social', 45);
      assert.equal(first.ok, true);
      assert.equal(
        coordinator.getConfig()?.riskGroups.find((g) => g.id === 'social')?.allowanceMinutes,
        45
      );

      const second = await coordinator.updateRiskGroupAllowance('social', 30);
      assert.equal(second.ok, false);
      assert.equal(second.reason, 'already-edited-today');

      const recovery = await coordinator.updateRiskGroupRecoveryActivity('social', 'stretch');
      assert.equal(recovery.ok, true);
      assert.equal(
        coordinator.getConfig()?.riskGroups.find((g) => g.id === 'social')?.recoveryActivityId,
        'stretch'
      );
      coordinator.destroy();
    });

    it('reports group-not-found for an unknown group', async () => {
      configurePlatformServices({
        storage: new MockStorageProvider(),
        usage: new MockUsageProvider([]),
        permissions: new MockPermissionProvider(),
        restrictions: new MockRestrictionProvider(),
      });
      const coordinator = RhythmCoordinator.getInstance();
      coordinator.destroy();
      await coordinator.initialize();

      const result = await coordinator.updateRiskGroupAllowance('no-such-group', 45);
      assert.equal(result.ok, false);
      assert.equal(result.reason, 'group-not-found');
      coordinator.destroy();
    });

    it('reports unavailable when the engine cannot initialize', async () => {
      const throwingPermissions = new MockPermissionProvider();
      throwingPermissions.getStatus = async () => {
        throw new Error('permission backend unreachable');
      };
      configurePlatformServices({
        storage: new MockStorageProvider(),
        usage: new MockUsageProvider([]),
        permissions: throwingPermissions,
        restrictions: new MockRestrictionProvider(),
      });
      const coordinator = RhythmCoordinator.getInstance();
      coordinator.destroy();

      const result = await coordinator.updateRiskGroupAllowance('social', 45);
      assert.equal(result.ok, false);
      assert.equal(result.reason, 'unavailable');
      coordinator.destroy();
    });
  });

  describe('sole group ownership regression', () => {
    const today = '2026-09-02';
    const nowMs = new Date(2026, 8, 2, 14, 0, 0).getTime();
    const memberApps: DeviceApp[] = [
      {
        id: 'instagram', name: 'Instagram', classification: 'risk', riskGroupId: 'social',
        iconName: 'c', iconColor: '#000', iconBg: '#fff', defaultCategory: 'Social',
        usageTodayMinutes: 0, sessionMinutes: 0,
        // Stale v1.0.1 per-app policy: must never act as authority.
        dailyRiskAllowance: { allowanceMinutes: 30 },
      },
      {
        id: 'x', name: 'X', classification: 'risk', riskGroupId: 'social',
        iconName: 'c', iconColor: '#000', iconBg: '#fff', defaultCategory: 'Social',
        usageTodayMinutes: 0, sessionMinutes: 0,
      },
      {
        id: 'tiktok', name: 'TikTok', classification: 'risk', riskGroupId: 'social',
        iconName: 'c', iconColor: '#000', iconBg: '#fff', defaultCategory: 'Social',
        usageTodayMinutes: 0, sessionMinutes: 0,
      },
      {
        id: 'phone', name: 'Phone', classification: 'essential',
        iconName: 'c', iconColor: '#000', iconBg: '#fff', defaultCategory: 'Communication',
        usageTodayMinutes: 0, sessionMinutes: 0,
      },
    ];
    const ownedGroup = makeGroup({ appIds: ['instagram', 'x', 'tiktok', 'phone'] });

    it('stale/exhausted per-app ledger cannot restrict when the group allowance is available', () => {
      const availableGroupUsage = {
        social: makeUsage({ dateKey: today, usedSeconds: 10 * 60 }),
      };
      // Stale v1.0.1 ledger: instagram looks fully exhausted per-app.
      const stalePerAppLedger = {
        instagram: {
          appId: 'instagram',
          dateKey: today,
          usedSeconds: 1800,
          exhaustedAt: nowMs - 1000,
        },
      };

      const res = computeEffectiveRestrictions(
        [], {}, [ownedGroup], memberApps, nowMs, {},
        { isOvernight: false, groupAllowanceUsage: availableGroupUsage }
      );
      assert.deepEqual(res.effectiveAppIds, []);

      const base = computeUnsuppressedBaseRestrictedAppIds(
        {
          state: 'available',
          activeCooldowns: {},
          activeAccessLeases: {},
          activeRoutineWindowIds: [],
          activeRestrictions: [],
          dailyAppUsage: stalePerAppLedger,
          groupAllowanceUsage: availableGroupUsage,
        },
        { routineWindows: [], riskGroups: [ownedGroup], apps: memberApps },
        nowMs
      );
      assert.deepEqual(base, [], 'Stale per-app exhaustion must not restrict anyone');
    });

    it('group exhaustion restricts every member app at once', () => {
      const exhaustedGroupUsage = {
        social: makeUsage({ dateKey: today, usedSeconds: 30 * 60 }),
      };

      const res = computeEffectiveRestrictions(
        [], {}, [ownedGroup], memberApps, nowMs, {},
        { isOvernight: false, groupAllowanceUsage: exhaustedGroupUsage }
      );
      assert.deepEqual(res.effectiveAppIds.sort(), ['instagram', 'tiktok', 'x']);
      for (const restriction of res.appRestrictions) {
        const reason = restriction.reasons.find((r) => r.type === 'daily-allowance');
        assert.ok(reason, `${restriction.appId} carries the group allowance reason`);
        assert.equal(reason?.sourceId, 'social');
      }

      const base = computeUnsuppressedBaseRestrictedAppIds(
        {
          state: 'available',
          activeCooldowns: {},
          activeAccessLeases: {},
          activeRoutineWindowIds: [],
          activeRestrictions: [],
          groupAllowanceUsage: exhaustedGroupUsage,
        },
        { routineWindows: [], riskGroups: [ownedGroup], apps: memberApps },
        nowMs
      );
      assert.deepEqual(base.sort(), ['instagram', 'tiktok', 'x']);
    });

    it('essential apps stay exempt even when their group is exhausted', () => {
      const exhaustedGroupUsage = {
        social: makeUsage({ dateKey: today, usedSeconds: 30 * 60 }),
      };
      const res = computeEffectiveRestrictions(
        [], {}, [ownedGroup], memberApps, nowMs, {},
        { isOvernight: false, groupAllowanceUsage: exhaustedGroupUsage }
      );
      assert.ok(!res.effectiveAppIds.includes('phone'));
    });
  });

  describe('migration always strips the legacy threshold', () => {
    it('strips invalid legacy thresholds while defaulting to 30', () => {
      for (const legacy of [-1, Number.NaN, 'forty-five', undefined]) {
        const migrated = migrateRiskGroupV102({ id: 'g', sessionThresholdMinutes: legacy } as any);
        assert.equal(migrated.allowanceMinutes, 30);
        assert.ok(!('sessionThresholdMinutes' in migrated), `must strip ${String(legacy)}`);
      }
    });

    it('strips missing legacy thresholds while defaulting to 30', () => {
      const migrated = migrateRiskGroupV102({ id: 'g', name: 'G' } as any);
      assert.equal(migrated.allowanceMinutes, 30);
      assert.ok(!('sessionThresholdMinutes' in migrated));
    });

    it('strips legacy threshold when an explicit allowance already exists', () => {
      const migrated = migrateRiskGroupV102({
        id: 'g',
        allowanceMinutes: 45,
        sessionThresholdMinutes: 20,
      } as any);
      assert.equal(migrated.allowanceMinutes, 45);
      assert.ok(!('sessionThresholdMinutes' in migrated));
    });

    it('stays stripped across repeated migration runs', () => {
      const once = migrateRiskGroupV102({ id: 'g', sessionThresholdMinutes: 45 } as any);
      const twice = migrateRiskGroupV102(JSON.parse(JSON.stringify(once)));
      assert.deepEqual(twice, once);
      assert.ok(!('sessionThresholdMinutes' in twice));
    });
  });
});
