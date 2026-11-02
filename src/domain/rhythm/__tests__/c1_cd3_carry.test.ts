import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  createDailyAttentionExchangeState,
  deriveAttentionGateStatus,
  reconcileReadingGate,
  type ActiveReadingGate,
  type ReadingEvidenceAvailability,
} from '../attentionExchange';
import { processRhythmEvent } from '../events';
import { computeEffectiveRestrictions } from '../restrictions';
import { RhythmEngine } from '../RhythmEngine';
import type { DeviceApp, RiskGroup } from '../../../types/domain';
import type { RhythmConfiguration, RhythmRuntime } from '../types';

const DAY_ONE = '2026-11-01';
const DAY_TWO = '2026-11-02';
const NOW = new Date(2026, 10, 2, 12, 0, 0, 0).getTime();

const gate: ActiveReadingGate = {
  groupId: 'social',
  attentionDateKey: DAY_ONE,
  dailyCooldownOrdinal: 3,
  createdAt: new Date(2026, 10, 1, 23, 50, 0, 0).getTime(),
  cooldownEndsAt: NOW - 60_000,
  requiredReadingSeconds: 3600,
  requiredQualifiedPages: 36,
};

function evidence(dateKey: string, seconds: number, pages: number): ReadingEvidenceAvailability {
  return {
    dateKey,
    providerAvailable: true,
    protocolCompatible: true,
    verifiedActiveSeconds: seconds,
    qualifiedPages: pages,
  };
}

const apps: DeviceApp[] = [
  {
    id: 'social.app',
    name: 'Social',
    classification: 'risk',
    riskGroupId: 'social',
    iconName: 'chat',
    iconColor: '#000',
    iconBg: '#fff',
    defaultCategory: 'Social',
    usageTodayMinutes: 0,
    sessionMinutes: 0,
  },
  {
    id: 'phone',
    name: 'Phone',
    classification: 'essential',
    iconName: 'phone',
    iconColor: '#000',
    iconBg: '#fff',
    defaultCategory: 'Communication',
    usageTodayMinutes: 0,
    sessionMinutes: 0,
  },
];

const groups: RiskGroup[] = [
  {
    id: 'social',
    name: 'Social',
    description: '',
    iconName: 'chat',
    iconColor: '#000',
    iconBg: '#fff',
    appIds: ['social.app', 'phone'],
    cooldownMinutes: 90,
    currentSessionMinutes: 0,
  },
];

const config: RhythmConfiguration = {
  apps,
  riskGroups: groups,
  routineWindows: [],
};

describe('C1 CD3 carry — unfinished baseline gate survives the calendar boundary', () => {
  test('unsatisfied gate is retained without evidence and with each partial aggregate', () => {
    assert.deepEqual(
      reconcileReadingGate({ gate, now: NOW, currentDateKey: DAY_TWO }),
      gate
    );
    assert.deepEqual(
      reconcileReadingGate({
        gate,
        evidence: evidence(DAY_TWO, 1800, 18),
        now: NOW,
        currentDateKey: DAY_TWO,
      }),
      gate
    );
    assert.deepEqual(
      reconcileReadingGate({
        gate,
        evidence: evidence(DAY_ONE, 3599, 36),
        now: NOW,
        currentDateKey: DAY_TWO,
      }),
      gate
    );
  });

  test('current-date and creation-date complete aggregates each satisfy independently', () => {
    assert.equal(
      reconcileReadingGate({
        gate,
        evidence: evidence(DAY_TWO, 3600, 36),
        now: NOW,
        currentDateKey: DAY_TWO,
      }),
      undefined
    );
    assert.equal(
      reconcileReadingGate({
        gate,
        evidence: evidence(DAY_ONE, 3600, 36),
        now: NOW,
        currentDateKey: DAY_TWO,
      }),
      undefined
    );
  });

  test('derived attention status evaluates the carried gate against one aggregate at a time', () => {
    const current = deriveAttentionGateStatus({
      gate,
      evidence: evidence(DAY_TWO, 3600, 36),
      now: NOW,
      currentDateKey: DAY_TWO,
    });
    const creation = deriveAttentionGateStatus({
      gate,
      evidence: evidence(DAY_ONE, 3600, 36),
      now: NOW,
      currentDateKey: DAY_TWO,
    });
    const partial = deriveAttentionGateStatus({
      gate,
      evidence: evidence(DAY_TWO, 1800, 18),
      now: NOW,
      currentDateKey: DAY_TWO,
    });
    const absent = deriveAttentionGateStatus({
      gate,
      now: NOW,
      currentDateKey: DAY_TWO,
    });

    assert.equal(current.phase, 'satisfied');
    assert.equal(creation.phase, 'satisfied');
    assert.equal(partial.phase, 'reading-required');
    assert.notEqual(absent.phase, 'satisfied');
    assert.equal(absent.requiredReadingSeconds, 3600);
    assert.equal(absent.requiredQualifiedPages, 36);
  });

  test('the unfinished gate keeps the risk group held and never restricts Essential apps', () => {
    const result = computeEffectiveRestrictions(
      [],
      undefined,
      groups,
      apps,
      NOW,
      {},
      {
        activeReadingGates: { social: gate },
        currentDateKey: DAY_TWO,
      }
    );

    assert.deepEqual(result.effectiveAppIds, ['social.app']);
    assert.equal(result.effectiveAppIds.includes('phone'), false);
  });

  test('the reducer retains the carried gate across a later clock tick', () => {
    const runtime: RhythmRuntime = {
      state: 'available',
      activeCooldowns: {},
      activeAccessLeases: {},
      activeRoutineWindowIds: [],
      activeRestrictions: [],
      dailyAttentionExchange: createDailyAttentionExchangeState(
        DAY_TWO,
        NOW,
        'ad-20261102'
      ),
      activeReadingGates: { social: gate },
      nativeAttentionAuthority: false,
    };

    const { nextRuntime } = processRhythmEvent(
      runtime,
      { type: 'CLOCK_TICK', timestamp: NOW },
      config
    );

    assert.equal(nextRuntime.activeReadingGates?.social?.attentionDateKey, DAY_ONE);
    assert.equal(nextRuntime.activeReadingGates?.social?.dailyCooldownOrdinal, 3);
  });

  test('restart rehydration retains the carried legacy-compatible reading gate', () => {
    const engine = new RhythmEngine(
      config,
      {
        state: 'available',
        activeCooldowns: {},
        activeAccessLeases: {},
        activeRoutineWindowIds: [],
        dailyAttentionExchange: createDailyAttentionExchangeState(
          DAY_TWO,
          NOW,
          'ad-20261102'
        ),
        activeReadingGates: { social: gate },
        lastReconciledAt: NOW,
        restorativeMigrationVersion: 2,
      },
      NOW
    );

    assert.equal(engine.getRuntime().activeReadingGates?.social?.attentionDateKey, DAY_ONE);
  });
});
