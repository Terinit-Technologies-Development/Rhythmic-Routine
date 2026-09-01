import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { reconcileRiskGroupMembership } from '../membershipReconciliation';
import { RhythmEngine } from '../RhythmEngine';
import { computeUnsuppressedBaseRestrictedAppIds } from '../nativePolicy';
import { DeviceApp, RiskGroup, RoutineWindow } from '../../../types/domain';
import { RhythmConfiguration } from '../types';

describe('Pass 04D — V1 Android App Discovery & Overlay Enforcement Finalization', () => {
  const rootDir = path.resolve(__dirname, '../../../../');

  it('module manifest declares launcher queries and excludes QUERY_ALL_PACKAGES', () => {
    const manifestPath = path.resolve(
      rootDir,
      'modules/rhythm-device/android/src/main/AndroidManifest.xml'
    );
    assert.ok(fs.existsSync(manifestPath), 'Module manifest must exist');
    const content = fs.readFileSync(manifestPath, 'utf8');

    assert.ok(content.includes('<queries>'), 'Manifest must declare <queries>');
    assert.ok(content.includes('android.intent.action.MAIN'), 'Queries must include ACTION_MAIN');
    assert.ok(
      content.includes('android.intent.category.LAUNCHER'),
      'Queries must include CATEGORY_LAUNCHER'
    );
    assert.ok(
      !content.includes('QUERY_ALL_PACKAGES'),
      'QUERY_ALL_PACKAGES must be STRICTLY ABSENT'
    );
  });

  it('RhythmOverlayActivity is opaque, calm, singleTask, and excluded from recents', () => {
    const manifestPath = path.resolve(
      rootDir,
      'modules/rhythm-device/android/src/main/AndroidManifest.xml'
    );
    const content = fs.readFileSync(manifestPath, 'utf8');

    assert.ok(
      content.includes('android:theme="@style/Theme.Rhythm.Overlay"'),
      'Overlay activity must use Theme.Rhythm.Overlay'
    );
    assert.ok(
      content.includes('android:excludeFromRecents="true"'),
      'Overlay activity must be excluded from recent tasks'
    );
    assert.ok(
      content.includes('android:launchMode="singleTask"'),
      'Overlay activity must use singleTask launch mode'
    );

    const stylesPath = path.resolve(
      rootDir,
      'modules/rhythm-device/android/src/main/res/values/styles.xml'
    );
    assert.ok(fs.existsSync(stylesPath), 'styles.xml must exist');
    const stylesContent = fs.readFileSync(stylesPath, 'utf8');

    assert.ok(
      stylesContent.includes('<style name="Theme.Rhythm.Overlay"'),
      'styles.xml must declare Theme.Rhythm.Overlay'
    );
    assert.ok(
      stylesContent.includes('#FAF7F0'),
      'Overlay must use calm brand background #FAF7F0'
    );
  });

  it('reconcileRiskGroupMembership derives membership strictly from real risk apps', () => {
    const apps: DeviceApp[] = [
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
      },
      {
        id: 'com.google.android.youtube',
        name: 'YouTube',
        classification: 'risk',
        riskGroupId: 'entertainment',
        iconName: 'smartphone',
        iconColor: '#235D43',
        iconBg: '#E8EFE5',
        defaultCategory: 'Video',
        usageTodayMinutes: 0,
        sessionMinutes: 0,
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
        id: 'com.android.chrome',
        name: 'Chrome',
        classification: 'normal',
        iconName: 'smartphone',
        iconColor: '#235D43',
        iconBg: '#E8EFE5',
        defaultCategory: 'Browser',
        usageTodayMinutes: 0,
        sessionMinutes: 0,
      },
      {
        id: 'com.spotify.music',
        name: 'Spotify',
        classification: 'unclassified',
        iconName: 'smartphone',
        iconColor: '#235D43',
        iconBg: '#E8EFE5',
        defaultCategory: 'Audio',
        usageTodayMinutes: 0,
        sessionMinutes: 0,
      },
    ];

    const initialGroups: RiskGroup[] = [
      {
        id: 'social',
        name: 'Social Media',
        description: 'Infinite feeds',
        iconName: 'smartphone',
        iconColor: '#235D43',
        iconBg: '#E8EFE5',
        sessionThresholdMinutes: 20,
        cooldownMinutes: 60,
        currentSessionMinutes: 0,
        appIds: ['instagram', 'x', 'stale_id'], // Contains stale mock IDs
      },
      {
        id: 'entertainment',
        name: 'Entertainment',
        description: 'Video streaming',
        iconName: 'smartphone',
        iconColor: '#235D43',
        iconBg: '#E8EFE5',
        sessionThresholdMinutes: 30,
        cooldownMinutes: 60,
        currentSessionMinutes: 0,
        appIds: ['youtube', 'tiktok'], // Contains stale mock IDs
      },
    ];

    const reconciled = reconcileRiskGroupMembership(apps, initialGroups);

    const socialGroup = reconciled.find((g) => g.id === 'social');
    const entGroup = reconciled.find((g) => g.id === 'entertainment');

    assert.deepEqual(
      socialGroup?.appIds,
      ['com.instagram.android'],
      'Social group must contain only real Instagram package and prune stale IDs'
    );
    assert.deepEqual(
      entGroup?.appIds,
      ['com.google.android.youtube'],
      'Entertainment group must contain only real YouTube package and prune stale IDs'
    );
    assert.ok(
      !socialGroup?.appIds.includes('com.google.android.dialer'),
      'Essential app must never be in any risk group'
    );
    assert.ok(
      !socialGroup?.appIds.includes('com.spotify.music'),
      'Unclassified app must never be in any risk group'
    );
  });

  it('Evening Wind-Down restricts real package IDs and excludes essential apps', () => {
    // 22:00 local time
    const fixedNow = new Date(2026, 8, 1, 22, 0, 0, 0).getTime();

    const routineWindows: RoutineWindow[] = [
      {
        id: 'evening-wind-down',
        name: 'Evening Wind-Down',
        type: 'evening-wind-down',
        startTime: '21:30',
        endTime: '23:30',
        activeDays: [1, 2, 3, 4, 5, 6, 7],
        protectedGroupIds: ['social', 'entertainment'],
        enabled: true,
        tagline: 'Evening focus',
        description: 'Wind down for rest',
      },
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
        description: 'Calm morning routine',
      },
    ];

    const riskGroups: RiskGroup[] = [
      {
        id: 'social',
        name: 'Social',
        description: 'Feeds',
        iconName: 'smartphone',
        iconColor: '#235D43',
        iconBg: '#E8EFE5',
        sessionThresholdMinutes: 20,
        cooldownMinutes: 60,
        currentSessionMinutes: 0,
        appIds: ['com.instagram.android', 'com.zhiliaoapp.musically'],
      },
      {
        id: 'entertainment',
        name: 'Entertainment',
        description: 'Streaming',
        iconName: 'smartphone',
        iconColor: '#235D43',
        iconBg: '#E8EFE5',
        sessionThresholdMinutes: 30,
        cooldownMinutes: 60,
        currentSessionMinutes: 0,
        appIds: ['com.google.android.youtube'],
      },
    ];

    const apps: DeviceApp[] = [
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
      },
      {
        id: 'com.google.android.youtube',
        name: 'YouTube',
        classification: 'risk',
        riskGroupId: 'entertainment',
        iconName: 'smartphone',
        iconColor: '#235D43',
        iconBg: '#E8EFE5',
        defaultCategory: 'Video',
        usageTodayMinutes: 0,
        sessionMinutes: 0,
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
        id: 'com.android.chrome',
        name: 'Chrome',
        classification: 'normal',
        iconName: 'smartphone',
        iconColor: '#235D43',
        iconBg: '#E8EFE5',
        defaultCategory: 'Browser',
        usageTodayMinutes: 0,
        sessionMinutes: 0,
      },
    ];

    const config: RhythmConfiguration = {
      routineWindows,
      riskGroups,
      apps,
      sessionResetGapMs: 5 * 60 * 1000,
    };

    const engine = new RhythmEngine(config, null, fixedNow);
    const runtime = engine.getRuntime();

    assert.equal(runtime.state, 'evening-wind-down', 'State must be evening-wind-down at 22:00');

    const restricted = engine.getEffectiveRestrictedAppIds();
    assert.ok(
      restricted.includes('com.instagram.android'),
      'Must restrict real Instagram package'
    );
    assert.ok(
      restricted.includes('com.google.android.youtube'),
      'Must restrict real YouTube package'
    );
    assert.ok(
      !restricted.includes('com.google.android.dialer'),
      'Essential Phone package MUST NOT be restricted'
    );
    assert.ok(
      !restricted.includes('com.android.chrome'),
      'Normal Chrome package MUST NOT be restricted'
    );

    const baseRestricted = computeUnsuppressedBaseRestrictedAppIds(runtime, config, fixedNow);
    assert.ok(
      baseRestricted.includes('com.instagram.android'),
      'Native base restriction must contain real Instagram package'
    );
    assert.ok(
      baseRestricted.includes('com.google.android.youtube'),
      'Native base restriction must contain real YouTube package'
    );
    assert.ok(
      !baseRestricted.includes('com.google.android.dialer'),
      'Native base restriction must NEVER contain essential phone package'
    );
  });

  it('Morning Buffer restricts real package IDs during morning window', () => {
    // 07:00 local time
    const fixedNow = new Date(2026, 8, 1, 7, 0, 0, 0).getTime();

    const routineWindows: RoutineWindow[] = [
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
        description: 'Morning buffer window',
      },
    ];

    const riskGroups: RiskGroup[] = [
      {
        id: 'social',
        name: 'Social',
        description: 'Feeds',
        iconName: 'smartphone',
        iconColor: '#235D43',
        iconBg: '#E8EFE5',
        sessionThresholdMinutes: 20,
        cooldownMinutes: 60,
        currentSessionMinutes: 0,
        appIds: ['com.zhiliaoapp.musically'],
      },
    ];

    const apps: DeviceApp[] = [
      {
        id: 'com.zhiliaoapp.musically',
        name: 'TikTok',
        classification: 'risk',
        riskGroupId: 'social',
        iconName: 'smartphone',
        iconColor: '#235D43',
        iconBg: '#E8EFE5',
        defaultCategory: 'Social',
        usageTodayMinutes: 0,
        sessionMinutes: 0,
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
    ];

    const config: RhythmConfiguration = {
      routineWindows,
      riskGroups,
      apps,
      sessionResetGapMs: 5 * 60 * 1000,
    };

    const engine = new RhythmEngine(config, null, fixedNow);
    const runtime = engine.getRuntime();

    assert.equal(runtime.state, 'morning-buffer', 'State must be morning-buffer at 07:00');

    const restricted = engine.getEffectiveRestrictedAppIds();
    assert.ok(
      restricted.includes('com.zhiliaoapp.musically'),
      'Must restrict real TikTok package'
    );
    assert.ok(
      !restricted.includes('com.google.android.dialer'),
      'Essential Phone package must never be restricted'
    );
  });

  it('Access Lease temporarily suppresses real package from effective restrictions without altering base set', () => {
    const fixedNow = new Date(2026, 8, 1, 22, 0, 0, 0).getTime();

    const config: RhythmConfiguration = {
      routineWindows: [
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
          description: 'Wind down',
        },
      ],
      riskGroups: [
        {
          id: 'social',
          name: 'Social',
          description: 'Feeds',
          iconName: 'smartphone',
          iconColor: '#235D43',
          iconBg: '#E8EFE5',
          sessionThresholdMinutes: 20,
          cooldownMinutes: 60,
          currentSessionMinutes: 0,
          appIds: ['com.instagram.android'],
        },
      ],
      apps: [
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
        },
      ],
      sessionResetGapMs: 5 * 60 * 1000,
    };

    const engine = new RhythmEngine(config, null, fixedNow);

    // Initial restricted state
    assert.deepEqual(engine.getEffectiveRestrictedAppIds(), ['com.instagram.android']);
    assert.deepEqual(
      computeUnsuppressedBaseRestrictedAppIds(engine.getRuntime(), config, fixedNow),
      ['com.instagram.android']
    );

    // Start 15m Access Lease for 'social'
    engine.dispatch({
      type: 'START_ACCESS_LEASE',
      groupId: 'social',
      durationMinutes: 15,
      timestamp: fixedNow,
    });

    // Effective restriction is now suppressed (0 apps restricted)
    assert.deepEqual(
      engine.getEffectiveRestrictedAppIds(),
      [],
      'Effective restriction must be suppressed during active Access Lease'
    );

    // Base restriction remains intact (sole writer invariant: native base set is NOT touched)
    assert.deepEqual(
      computeUnsuppressedBaseRestrictedAppIds(engine.getRuntime(), config, fixedNow),
      ['com.instagram.android'],
      'Base restriction set must NEVER subtract access leases'
    );

    // After lease expires (20 minutes later), effective restriction returns
    const afterExpiry = fixedNow + 20 * 60 * 1000;
    engine.dispatch({
      type: 'CLOCK_TICK',
      timestamp: afterExpiry,
    });
    assert.deepEqual(
      engine.getEffectiveRestrictedAppIds(),
      ['com.instagram.android'],
      'Effective restriction must immediately return when access lease expires'
    );
  });

  it('Touch Grass overlay Kotlin implementation tracks isVisible and auto-close timer', () => {
    const activitySourcePath = path.resolve(
      rootDir,
      'modules/rhythm-device/android/src/main/java/expo/modules/rhythmdevice/RhythmOverlayActivity.kt'
    );
    assert.ok(fs.existsSync(activitySourcePath), 'RhythmOverlayActivity.kt must exist');
    const content = fs.readFileSync(activitySourcePath, 'utf8');

    assert.ok(content.includes('@Volatile'), 'Must track isVisible as @Volatile');
    assert.ok(content.includes('var isVisible: Boolean'), 'Must declare isVisible boolean');
    assert.ok(content.includes('autoCloseRunnable'), 'Must define autoCloseRunnable');
    assert.ok(
      content.includes('isEffectivelyRestricted'),
      'Must recheck effective restriction in auto-close loop'
    );
    assert.ok(content.includes('navigateHome()'), 'Back behavior must route to Android Home');
    assert.ok(content.includes('CATEGORY_HOME'), 'Must use CATEGORY_HOME for Back press');
  });

  it('RhythmEnforcementService notifies and debounces foreground intervention', () => {
    const serviceSourcePath = path.resolve(
      rootDir,
      'modules/rhythm-device/android/src/main/java/expo/modules/rhythmdevice/RhythmEnforcementService.kt'
    );
    assert.ok(fs.existsSync(serviceSourcePath), 'RhythmEnforcementService.kt must exist');
    const content = fs.readFileSync(serviceSourcePath, 'utf8');

    assert.ok(
      content.includes('fun onBaseRestrictionsChanged()'),
      'Must declare onBaseRestrictionsChanged()'
    );
    assert.ok(
      content.includes('resolveRecentForegroundPackage()'),
      'Must declare resolveRecentForegroundPackage() to seed foreground state'
    );
    assert.ok(content.includes('DEBOUNCE_MS'), 'Must define intervention debounce interval');
    assert.ok(
      content.includes('RhythmOverlayActivity.isVisible'),
      'Must skip intervention if overlay is already visible'
    );
    assert.ok(content.includes('TAG = "RhythmEnforcement"'), 'Must log with RhythmEnforcement tag');
  });
});
