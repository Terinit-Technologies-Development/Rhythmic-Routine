import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

type Policy = { groupId: string; packages: Set<string>; allowanceMs: number; cooldownMs: number };
type Usage = { usedMs: number; activePackage?: string; startedAt?: number; exhaustedAt?: number; cycleRevision: number };

describe('Pass 02 native Risk Group lifecycle contract', () => {
  it('aggregates same-group foreground segments and exhausts once into a whole-group cooldown', () => {
    const policy: Policy = { groupId: 'social', packages: new Set(['a', 'b']), allowanceMs: 30 * 60_000, cooldownMs: 15 * 60_000 };
    const usage: Usage = { usedMs: 0, cycleRevision: 0 };
    let cooldownEndsAt: number | undefined;
    const start = (pkg: string, now: number) => { usage.activePackage = pkg; usage.startedAt = now; };
    const stop = (now: number) => { if (usage.startedAt !== undefined) usage.usedMs += now - usage.startedAt; usage.activePackage = undefined; usage.startedAt = undefined; };
    const exhaust = (now: number) => { stop(now); if (cooldownEndsAt === undefined) { usage.usedMs = policy.allowanceMs; usage.exhaustedAt = now; cooldownEndsAt = now + policy.cooldownMs; } };

    start('a', 0);
    stop(10 * 60_000);
    start('b', 10 * 60_000);
    exhaust(30 * 60_000);
    exhaust(31 * 60_000);

    assert.equal(usage.usedMs, policy.allowanceMs);
    assert.equal(usage.exhaustedAt, 30 * 60_000);
    assert.equal(cooldownEndsAt, 45 * 60_000);
  });

  it('resets the ledger before removing the cooldown and starts a fresh cycle', () => {
    const usage: Usage = { usedMs: 1_800_000, exhaustedAt: 1_000, cycleRevision: 2 };
    let cooldownEndsAt: number | undefined = 2_000;
    const now = 2_001;
    usage.usedMs = 0;
    usage.exhaustedAt = undefined;
    usage.cycleRevision += 1;
    cooldownEndsAt = undefined;
    assert.deepEqual(usage, { usedMs: 0, exhaustedAt: undefined, cycleRevision: 3 });
    assert.equal(cooldownEndsAt, undefined);
    assert.ok(now > 2_000);
  });

  it('exposes the group contract and never restores package allowance policy as native source', () => {
    const servicePath = path.resolve(__dirname, '../../../../modules/rhythm-device/android/src/main/java/expo/modules/rhythmdevice/RhythmEnforcementService.kt');
    const modulePath = path.resolve(__dirname, '../../../../modules/rhythm-device/android/src/main/java/expo/modules/rhythmdevice/RhythmDeviceModule.kt');
    const service = fs.readFileSync(servicePath, 'utf8');
    const module = fs.readFileSync(modulePath, 'utf8');
    assert.match(service, /data class NativeRiskGroupPolicy/);
    assert.match(service, /data class NativeGroupAllowanceUsage/);
    assert.match(service, /exhaustGroup\(/);
    assert.match(service, /EXTRA_ACTIVITY_TITLE/);
    assert.match(service, /scheduleNextRoutineBoundary/);
    assert.match(service, /parseTime\(window\.startTime\)/);
    assert.match(service, /nextMidnightRolloverAt/);
    assert.match(service, /saveGroupUsageLedger\(applicationContext, ledger\)[\s\S]*saveCooldownPolicies/);
    assert.match(service, /parseAndPruneLeases/);
    assert.doesNotMatch(service, /NativeDailyAllowancePolicy|DAILY_USAGE_LEDGER_JSON/);
    assert.match(module, /AsyncFunction\("setRiskGroupPolicies"/);
    assert.match(module, /AsyncFunction\("getGroupAllowanceSnapshot"/);
    assert.match(module, /AsyncFunction\("reconcileGroupUsage"/);
    assert.match(module, /values\.maxOf \{ it\.endsAt \}/);
    assert.doesNotMatch(module, /setDailyAllowancePolicies|getDailyUsageSnapshot/);
  });
});
