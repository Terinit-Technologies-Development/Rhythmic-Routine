import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  computeMonitoringConfigSignature,
  projectNativeRoutineSchedule,
  projectNativeRoutineSchedulePayload,
} from '../../../platform/NativeRhythmSyncProvider';
import { resolveAttentionDay } from '../attentionDay';
import type { RhythmConfiguration } from '../types';
import type { DeviceApp, RiskGroup, RoutineWindow } from '../../../types/domain';

const apps: DeviceApp[] = [
  {
    id: 'social.app',
    name: 'Social',
    classification: 'risk',
    riskGroupId: 'social',
    iconName: 'circle',
    iconColor: '#000',
    iconBg: '#fff',
    defaultCategory: 'Social',
    usageTodayMinutes: 0,
    sessionMinutes: 0,
  },
];

const groups: RiskGroup[] = [
  {
    id: 'social',
    name: 'Social Feeds',
    description: '',
    iconName: 'circle',
    iconColor: '#000',
    iconBg: '#fff',
    appIds: ['social.app'],
    allowanceMinutes: 30,
    cooldownMinutes: 90,
    currentSessionMinutes: 0,
  },
];

function morning(id: string, endTime: string): RoutineWindow {
  return {
    id,
    name: id,
    type: 'morning-buffer',
    startTime: '07:00',
    endTime,
    activeDays: [1, 2, 3, 4, 5, 6, 7],
    protectedGroupIds: ['social'],
    enabled: true,
    tagline: '',
    description: '',
  };
}

const ordered: RhythmConfiguration = {
  routineWindows: [morning('z', '08:30'), morning('a', '07:30')],
  riskGroups: groups,
  apps,
};

const reversed: RhythmConfiguration = {
  ...ordered,
  routineWindows: [...ordered.routineWindows].reverse(),
};

describe('F21 — native schedule preserves semantic configuration order', () => {
  test('projection keeps z-before-a even though ids are opposite order', () => {
    const projected = projectNativeRoutineSchedule(ordered);
    assert.deepEqual(projected.windows.map((window) => window.id), ['z', 'a']);
    assert.deepEqual(projected.windows.map((window) => window.endTime), ['08:30', '07:30']);
  });

  test('production JS resolver and projected native payload agree on the first clock', () => {
    const projected = projectNativeRoutineSchedule(ordered);
    const localWindows = projected.windows.map((window) => ({
      id: window.id,
      name: window.id,
      type: window.type as RoutineWindow['type'],
      startTime: window.startTime,
      endTime: window.endTime,
      activeDays: window.activeDays,
      protectedGroupIds: ['social'],
      enabled: window.enabled,
      tagline: '',
      description: '',
    }));
    const at = new Date(2026, 8, 28, 8, 0, 0, 0).getTime();
    const jsDay = resolveAttentionDay(at, ordered.routineWindows);
    const projectedDay = resolveAttentionDay(at, localWindows);

    assert.equal(jsDay.id, projectedDay.id);
    assert.equal(jsDay.nextBoundaryAt, projectedDay.nextBoundaryAt);
    assert.equal(new Date(jsDay.nextBoundaryAt).getHours(), 8);
    assert.equal(new Date(jsDay.nextBoundaryAt).getMinutes(), 30);
  });

  test('reordering changes the fingerprint; stable order is idempotent', () => {
    assert.equal(
      computeMonitoringConfigSignature(ordered),
      computeMonitoringConfigSignature(ordered)
    );
    assert.notEqual(
      computeMonitoringConfigSignature(ordered),
      computeMonitoringConfigSignature(reversed)
    );
    assert.equal(
      JSON.stringify(projectNativeRoutineSchedulePayload(ordered)),
      JSON.stringify(projectNativeRoutineSchedulePayload(ordered))
    );
    assert.notEqual(
      JSON.stringify(projectNativeRoutineSchedulePayload(ordered)),
      JSON.stringify(projectNativeRoutineSchedulePayload(reversed))
    );
  });
});
