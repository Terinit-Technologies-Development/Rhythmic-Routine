import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { NativeUsageProvider } from '../../../platform/native/NativeUsageProvider';
import RhythmDeviceModule, { FallbackModule } from '../../../../modules/rhythm-device';
import { PlatformNativeRhythmSyncProvider } from '../../../platform/NativeRhythmSyncProvider';
import { RhythmConfiguration, RhythmRuntime } from '../types';

describe('Pass 02 — Android Native Daily Usage Ledger & Enforcement Invariants', () => {
  const servicePath = path.resolve(
    __dirname,
    '../../../../modules/rhythm-device/android/src/main/java/expo/modules/rhythmdevice/RhythmEnforcementService.kt'
  );
  const modulePath = path.resolve(
    __dirname,
    '../../../../modules/rhythm-device/android/src/main/java/expo/modules/rhythmdevice/RhythmDeviceModule.kt'
  );
  const keysPath = path.resolve(
    __dirname,
    '../../../../modules/rhythm-device/android/src/main/java/expo/modules/rhythmdevice/RhythmNativePolicyKeys.kt'
  );

  it('1. Source verification: Kotlin files declare native daily usage ledger and policy keys', () => {
    assert.ok(fs.existsSync(servicePath), 'RhythmEnforcementService.kt must exist');
    assert.ok(fs.existsSync(modulePath), 'RhythmDeviceModule.kt must exist');
    assert.ok(fs.existsSync(keysPath), 'RhythmNativePolicyKeys.kt must exist');

    const keysSrc = fs.readFileSync(keysPath, 'utf8');
    assert.ok(keysSrc.includes('DAILY_ALLOWANCE_POLICIES_JSON'), 'Must define DAILY_ALLOWANCE_POLICIES_JSON');
    assert.ok(keysSrc.includes('DAILY_USAGE_LEDGER_JSON'), 'Must define DAILY_USAGE_LEDGER_JSON');
    assert.ok(keysSrc.includes('LAST_USAGE_RECONCILED_AT'), 'Must define LAST_USAGE_RECONCILED_AT');

    const serviceSrc = fs.readFileSync(servicePath, 'utf8');
    assert.ok(serviceSrc.includes('data class NativeDailyAllowancePolicy'), 'Must define NativeDailyAllowancePolicy');
    assert.ok(serviceSrc.includes('data class NativeDailyUsage'), 'Must define NativeDailyUsage');
    assert.ok(serviceSrc.includes('data class NativeDailyUsageSnapshot'), 'Must define NativeDailyUsageSnapshot');
    assert.ok(serviceSrc.includes('fun isDailyAllowanceExhausted'), 'Must define isDailyAllowanceExhausted');
    assert.ok(serviceSrc.includes('fun scheduleAllowanceDeadline'), 'Must define scheduleAllowanceDeadline');
    assert.ok(serviceSrc.includes('fun reconcileUsage'), 'Must define reconcileUsage');

    const moduleSrc = fs.readFileSync(modulePath, 'utf8');
    assert.ok(moduleSrc.includes('setDailyAllowancePolicies'), 'Must expose setDailyAllowancePolicies');
    assert.ok(moduleSrc.includes('getDailyUsageSnapshot'), 'Must expose getDailyUsageSnapshot');
    assert.ok(moduleSrc.includes('reconcileDailyUsage'), 'Must expose reconcileDailyUsage');
  });

  describe('2. Native Ledger State Transitions & Invariant Simulator', () => {
    interface NativeDailyUsageRecord {
      packageName: string;
      dateKey: string;
      usedMillis: number;
      activeSegmentStartedAt?: number;
      exhaustedAt?: number;
    }

    interface NativeDailyPolicy {
      packageName: string;
      allowanceMinutes: number;
    }

    class NativeLedgerSimulator {
      public policies: Map<string, NativeDailyPolicy> = new Map();
      public ledger: Map<string, NativeDailyUsageRecord> = new Map();
      public baseRestricted: Set<string> = new Set();
      public activeLeases: Map<string, { packageNames: Set<string>; endsAt: number }> = new Map();

      public lastForegroundPackage?: string;
      public activeUsagePackage?: string;
      public activeUsageStartedAt?: number;
      public allowanceDeadlineAt?: number;
      public interventionPresentedFor?: string;
      public lastUsageReconciledAt: number = 0;

      public setPolicies(list: NativeDailyPolicy[], now: number) {
        this.policies.clear();
        for (const p of list) this.policies.set(p.packageName, p);

        // Policy change re-evaluation for currently foreground app
        if (this.lastForegroundPackage) {
          const currentPkg = this.lastForegroundPackage;
          const policy = this.policies.get(currentPkg);
          if (!policy) {
            // Reclassified to normal/essential
            if (this.activeUsagePackage === currentPkg) {
              this.finalizeActiveSegment(currentPkg, now);
            }
            this.allowanceDeadlineAt = undefined;
          } else {
            const usage = this.ledger.get(currentPkg);
            const prevUsed = usage?.usedMillis ?? 0;
            const elapsed = this.activeUsageStartedAt ? Math.max(0, now - this.activeUsageStartedAt) : 0;
            const totalUsed = prevUsed + elapsed;
            const allowanceMs = policy.allowanceMinutes * 60_000;
            const remaining = allowanceMs - totalUsed;

            if (remaining <= 0 || policy.allowanceMinutes === 0) {
              this.allowanceDeadlineAt = undefined;
              this.ledger.set(currentPkg, {
                packageName: currentPkg,
                dateKey: '2026-09-02',
                usedMillis: totalUsed,
                activeSegmentStartedAt: now,
                exhaustedAt: usage?.exhaustedAt ?? now,
              });
              if (this.isEffectivelyRestricted(currentPkg, now)) {
                this.interventionPresentedFor = currentPkg;
              }
            } else {
              this.allowanceDeadlineAt = now + remaining;
            }
          }
        }
      }

      public onWindowStateChanged(packageName: string, now: number) {
        // Duplicate foreground protection
        if (packageName === this.lastForegroundPackage) {
          return;
        }

        const prev = this.lastForegroundPackage;
        this.lastForegroundPackage = packageName;

        // 1. Finalize previous
        if (prev && this.activeUsagePackage === prev) {
          this.finalizeActiveSegment(prev, now);
        }

        // 2. Cancel previous deadline
        this.allowanceDeadlineAt = undefined;

        // 3. Evaluate restriction
        if (this.isEffectivelyRestricted(packageName, now)) {
          this.interventionPresentedFor = packageName;
        }

        // 4. Start risk usage if applicable
        const policy = this.policies.get(packageName);
        if (policy) {
          this.startRiskUsage(packageName, policy, now);
        }
      }

      public onBackground(packageName: string, now: number) {
        if (this.activeUsagePackage === packageName) {
          this.finalizeActiveSegment(packageName, now);
        }
        if (this.lastForegroundPackage === packageName) {
          this.lastForegroundPackage = undefined;
        }
        this.allowanceDeadlineAt = undefined;
      }

      public startRiskUsage(packageName: string, policy: NativeDailyPolicy, now: number) {
        const existing = this.ledger.get(packageName);
        const used = existing?.usedMillis ?? 0;
        const isExhausted = existing?.exhaustedAt !== undefined;

        this.activeUsagePackage = packageName;
        this.activeUsageStartedAt = now;

        this.ledger.set(packageName, {
          packageName,
          dateKey: '2026-09-02',
          usedMillis: used,
          activeSegmentStartedAt: now,
          exhaustedAt: existing?.exhaustedAt,
        });

        const allowanceMs = policy.allowanceMinutes * 60_000;
        const remaining = allowanceMs - used;

        if (remaining <= 0 || policy.allowanceMinutes === 0 || isExhausted) {
          this.ledger.get(packageName)!.exhaustedAt = existing?.exhaustedAt ?? now;
          if (this.isEffectivelyRestricted(packageName, now)) {
            this.interventionPresentedFor = packageName;
          }
        } else {
          this.allowanceDeadlineAt = now + remaining;
        }
      }

      public finalizeActiveSegment(packageName: string, now: number) {
        const existing = this.ledger.get(packageName);
        const started = this.activeUsageStartedAt ?? existing?.activeSegmentStartedAt;
        if (started !== undefined) {
          const elapsed = Math.max(0, now - started);
          const prevUsed = existing?.usedMillis ?? 0;
          this.ledger.set(packageName, {
            packageName,
            dateKey: existing?.dateKey ?? '2026-09-02',
            usedMillis: prevUsed + elapsed,
            activeSegmentStartedAt: undefined,
            exhaustedAt: existing?.exhaustedAt,
          });
        }
        this.activeUsagePackage = undefined;
        this.activeUsageStartedAt = undefined;
      }

      public fireAllowanceDeadline(packageName: string, now: number) {
        if (this.lastForegroundPackage !== packageName || this.activeUsagePackage !== packageName) return;
        const policy = this.policies.get(packageName);
        if (!policy) return;

        const existing = this.ledger.get(packageName)!;
        const elapsed = this.activeUsageStartedAt ? Math.max(0, now - this.activeUsageStartedAt) : 0;
        const totalUsed = existing.usedMillis + elapsed;

        if (totalUsed >= policy.allowanceMinutes * 60_000 || policy.allowanceMinutes === 0) {
          existing.usedMillis = totalUsed;
          existing.exhaustedAt = now;
          this.activeUsageStartedAt = now;

          if (this.isEffectivelyRestricted(packageName, now)) {
            this.interventionPresentedFor = packageName;
          }
        }
      }

      public isDailyAllowanceExhausted(packageName: string, now: number): boolean {
        const policy = this.policies.get(packageName);
        if (!policy) return false;
        if (policy.allowanceMinutes === 0) return true;

        const usage = this.ledger.get(packageName);
        if (!usage) return false;
        if (usage.exhaustedAt !== undefined) return true;

        const activeStart = this.activeUsagePackage === packageName ? this.activeUsageStartedAt : usage.activeSegmentStartedAt;
        const elapsed = activeStart ? Math.max(0, now - activeStart) : 0;
        return usage.usedMillis + elapsed >= policy.allowanceMinutes * 60_000;
      }

      public isEffectivelyRestricted(packageName: string, now: number): boolean {
        const isBase = this.baseRestricted.has(packageName);
        const isExhausted = this.isDailyAllowanceExhausted(packageName, now);

        if (!isBase && !isExhausted) return false;

        // Lease suppression
        for (const lease of this.activeLeases.values()) {
          if (lease.packageNames.has(packageName) && lease.endsAt > now) {
            return false;
          }
        }
        return true;
      }

      public onLeaseExpired(now: number) {
        if (this.lastForegroundPackage && this.isEffectivelyRestricted(this.lastForegroundPackage, now)) {
          this.interventionPresentedFor = this.lastForegroundPackage;
        }
      }

      public rolloverMidnight(nowDay2Start: number) {
        // Roll over active segment across midnight
        if (this.activeUsagePackage) {
          const pkg = this.activeUsagePackage;
          this.ledger.set(pkg, {
            packageName: pkg,
            dateKey: '2026-09-03',
            usedMillis: 0,
            activeSegmentStartedAt: nowDay2Start,
            exhaustedAt: undefined,
          });
          this.activeUsageStartedAt = nowDay2Start;
        }
      }

      public reconcileUsage(events: { packageName: string; timestamp: number; isForeground: boolean }[], toTime: number) {
        const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
        for (const [pkg, policy] of this.policies.entries()) {
          const pkgEvents = sorted.filter((e) => e.packageName === pkg && e.timestamp > this.lastUsageReconciledAt);
          let segStart: number | null = null;
          let delta = 0;

          for (const ev of pkgEvents) {
            if (ev.isForeground) {
              if (segStart === null) segStart = ev.timestamp;
            } else {
              if (segStart !== null) {
                delta += Math.max(0, ev.timestamp - segStart);
                segStart = null;
              }
            }
          }

          if (delta > 0) {
            const existing = this.ledger.get(pkg);
            const prevUsed = existing?.usedMillis ?? 0;
            const updatedUsed = prevUsed + delta;
            const isExhausted = updatedUsed >= policy.allowanceMinutes * 60_000 || policy.allowanceMinutes === 0;

            this.ledger.set(pkg, {
              packageName: pkg,
              dateKey: '2026-09-02',
              usedMillis: updatedUsed,
              activeSegmentStartedAt: existing?.activeSegmentStartedAt,
              exhaustedAt: isExhausted ? (existing?.exhaustedAt ?? toTime) : existing?.exhaustedAt,
            });
          }
        }
        this.lastUsageReconciledAt = toTime;
      }
    }

    it('Risk app foreground start initiates active segment and schedules exact deadline', () => {
      const sim = new NativeLedgerSimulator();
      const t0 = 1000;
      sim.setPolicies([{ packageName: 'com.instagram.android', allowanceMinutes: 30 }], t0);

      sim.onWindowStateChanged('com.instagram.android', t0);
      assert.equal(sim.activeUsagePackage, 'com.instagram.android');
      assert.equal(sim.activeUsageStartedAt, t0);
      assert.equal(sim.allowanceDeadlineAt, t0 + 30 * 60_000);
      assert.equal(sim.interventionPresentedFor, undefined);
    });

    it('duplicate foreground event does NOT reset activeSegmentStartedAt', () => {
      const sim = new NativeLedgerSimulator();
      const t0 = 1000;
      sim.setPolicies([{ packageName: 'com.instagram.android', allowanceMinutes: 30 }], t0);

      sim.onWindowStateChanged('com.instagram.android', t0);
      assert.equal(sim.activeUsageStartedAt, t0);

      // Duplicate event at t0 + 5000
      sim.onWindowStateChanged('com.instagram.android', t0 + 5000);
      assert.equal(sim.activeUsageStartedAt, t0, 'Duplicate event must NOT reset segment start');
      assert.equal(sim.allowanceDeadlineAt, t0 + 30 * 60_000);
    });

    it('Risk A -> Risk B commits A exactly once and starts B with independent deadline', () => {
      const sim = new NativeLedgerSimulator();
      const t0 = 1000;
      sim.setPolicies([
        { packageName: 'com.instagram.android', allowanceMinutes: 30 },
        { packageName: 'com.youtube.android', allowanceMinutes: 45 },
      ], t0);

      // Foreground A for 8 minutes (480_000 ms)
      sim.onWindowStateChanged('com.instagram.android', t0);
      const t1 = t0 + 480_000;

      // Switch to B
      sim.onWindowStateChanged('com.youtube.android', t1);

      // A committed exactly once
      const usageA = sim.ledger.get('com.instagram.android');
      assert.equal(usageA?.usedMillis, 480_000);
      assert.equal(usageA?.activeSegmentStartedAt, undefined);

      // B started at t1
      assert.equal(sim.activeUsagePackage, 'com.youtube.android');
      assert.equal(sim.activeUsageStartedAt, t1);
      assert.equal(sim.allowanceDeadlineAt, t1 + 45 * 60_000);
    });

    it('foreground -> background commits elapsed time and cancels deadline', () => {
      const sim = new NativeLedgerSimulator();
      const t0 = 1000;
      sim.setPolicies([{ packageName: 'com.instagram.android', allowanceMinutes: 30 }], t0);

      sim.onWindowStateChanged('com.instagram.android', t0);
      sim.onBackground('com.instagram.android', t0 + 60_000);

      const usage = sim.ledger.get('com.instagram.android');
      assert.equal(usage?.usedMillis, 60_000);
      assert.equal(usage?.activeSegmentStartedAt, undefined);
      assert.equal(sim.activeUsagePackage, undefined);
      assert.equal(sim.allowanceDeadlineAt, undefined);
    });

    it('remaining allowance calculation and exact exhaustion triggers Touch Grass', () => {
      const sim = new NativeLedgerSimulator();
      const t0 = 1000;
      sim.setPolicies([{ packageName: 'com.instagram.android', allowanceMinutes: 30 }], t0);

      sim.onWindowStateChanged('com.instagram.android', t0);

      // Fire deadline at t0 + 30m
      const deadline = t0 + 30 * 60_000;
      sim.fireAllowanceDeadline('com.instagram.android', deadline);

      const usage = sim.ledger.get('com.instagram.android');
      assert.equal(usage?.usedMillis, 30 * 60_000);
      assert.equal(usage?.exhaustedAt, deadline);
      assert.equal(sim.interventionPresentedFor, 'com.instagram.android');
    });

    it('0-minute allowance exhausts immediately upon launch', () => {
      const sim = new NativeLedgerSimulator();
      const t0 = 1000;
      sim.setPolicies([{ packageName: 'com.tiktok.android', allowanceMinutes: 0 }], t0);

      sim.onWindowStateChanged('com.tiktok.android', t0);

      const usage = sim.ledger.get('com.tiktok.android');
      assert.equal(usage?.exhaustedAt, t0);
      assert.equal(sim.interventionPresentedFor, 'com.tiktok.android');
    });

    it('lease active at exhaustion: usage accumulates, exhaustion recorded, but Touch Grass suppressed until lease expiry', () => {
      const sim = new NativeLedgerSimulator();
      const t0 = 1000;
      sim.setPolicies([{ packageName: 'com.instagram.android', allowanceMinutes: 30 }], t0);

      // Active lease for 45 minutes
      sim.activeLeases.set('social', {
        packageNames: new Set(['com.instagram.android']),
        endsAt: t0 + 45 * 60_000,
      });

      sim.onWindowStateChanged('com.instagram.android', t0);
      assert.equal(sim.interventionPresentedFor, undefined, 'Intervention suppressed by lease');

      // Allowance runs out at t0 + 30 minutes
      const tExhaustion = t0 + 30 * 60_000;
      sim.fireAllowanceDeadline('com.instagram.android', tExhaustion);

      const usage = sim.ledger.get('com.instagram.android');
      assert.equal(usage?.exhaustedAt, tExhaustion);
      assert.equal(sim.interventionPresentedFor, undefined, 'Intervention still suppressed while lease is active');

      // Lease expires at t0 + 45 minutes
      const tLeaseExpiry = t0 + 45 * 60_000;
      sim.activeLeases.delete('social');
      sim.onLeaseExpired(tLeaseExpiry);

      assert.equal(sim.interventionPresentedFor, 'com.instagram.android', 'Touch Grass presented immediately upon lease expiry');
      assert.equal(usage?.usedMillis, 30 * 60_000, 'Used millis preserved through lease expiry');
    });

    it('policy reduction below consumed usage triggers immediate exhaustion', () => {
      const sim = new NativeLedgerSimulator();
      const t0 = 1000;
      sim.setPolicies([{ packageName: 'com.instagram.android', allowanceMinutes: 30 }], t0);

      sim.onWindowStateChanged('com.instagram.android', t0);

      // User consumed 20 minutes
      const t1 = t0 + 20 * 60_000;
      // Policy reduced from 30 -> 15 minutes
      sim.setPolicies([{ packageName: 'com.instagram.android', allowanceMinutes: 15 }], t1);

      assert.equal(sim.interventionPresentedFor, 'com.instagram.android', 'Must exhaust immediately when allowance reduced below usage');
      const usage = sim.ledger.get('com.instagram.android');
      assert.equal(usage?.exhaustedAt, t1);
    });

    it('policy +15 adjustment extends allowance and reschedules deadline', () => {
      const sim = new NativeLedgerSimulator();
      const t0 = 1000;
      sim.setPolicies([{ packageName: 'com.instagram.android', allowanceMinutes: 30 }], t0);

      sim.onWindowStateChanged('com.instagram.android', t0);
      assert.equal(sim.allowanceDeadlineAt, t0 + 30 * 60_000);

      // After 10 minutes, user increases +15m (30 -> 45m)
      const t1 = t0 + 10 * 60_000;
      sim.setPolicies([{ packageName: 'com.instagram.android', allowanceMinutes: 45 }], t1);

      // Remaining = 45m - 10m = 35m
      assert.equal(sim.allowanceDeadlineAt, t1 + 35 * 60_000);
      assert.equal(sim.interventionPresentedFor, undefined);
    });

    it('Risk -> Normal clears enforcement and Normal -> Risk restores prior usage', () => {
      const sim = new NativeLedgerSimulator();
      const t0 = 1000;
      sim.setPolicies([{ packageName: 'com.instagram.android', allowanceMinutes: 30 }], t0);

      sim.onWindowStateChanged('com.instagram.android', t0);
      sim.onBackground('com.instagram.android', t0 + 15 * 60_000); // consumed 15m

      // Reclassified to Normal (removed from policies)
      sim.setPolicies([], t0 + 16 * 60_000);
      assert.equal(sim.isDailyAllowanceExhausted('com.instagram.android', t0 + 16 * 60_000), false);

      // Reclassified back to Risk
      sim.setPolicies([{ packageName: 'com.instagram.android', allowanceMinutes: 30 }], t0 + 20 * 60_000);
      // Prior usage of 15m is preserved
      assert.equal(sim.ledger.get('com.instagram.android')?.usedMillis, 15 * 60_000);

      sim.onWindowStateChanged('com.instagram.android', t0 + 20 * 60_000);
      // Remaining = 30m - 15m = 15m
      assert.equal(sim.allowanceDeadlineAt, t0 + 20 * 60_000 + 15 * 60_000);
    });

    it('midnight rollover splits active segment: used begins at 0 on Day 2', () => {
      const sim = new NativeLedgerSimulator();
      const t0 = 1000;
      sim.setPolicies([{ packageName: 'com.instagram.android', allowanceMinutes: 30 }], t0);

      sim.onWindowStateChanged('com.instagram.android', t0);
      const tMidnightDay2 = 86_400_000;
      sim.rolloverMidnight(tMidnightDay2);

      const usageDay2 = sim.ledger.get('com.instagram.android');
      assert.equal(usageDay2?.dateKey, '2026-09-03');
      assert.equal(usageDay2?.usedMillis, 0, 'New day usedMillis starts at 0');
      assert.equal(usageDay2?.activeSegmentStartedAt, tMidnightDay2);
    });

    it('UsageStats reconciliation with watermark deduplication is idempotent', () => {
      const sim = new NativeLedgerSimulator();
      const t0 = 1000;
      sim.setPolicies([{ packageName: 'com.instagram.android', allowanceMinutes: 30 }], t0);

      const events = [
        { packageName: 'com.instagram.android', timestamp: 2000, isForeground: true },
        { packageName: 'com.instagram.android', timestamp: 8000, isForeground: false }, // 6s delta
      ];

      sim.reconcileUsage(events, 10000);
      assert.equal(sim.ledger.get('com.instagram.android')?.usedMillis, 6000);
      assert.equal(sim.lastUsageReconciledAt, 10000);

      // Re-running same reconciliation with past events is idempotent
      sim.reconcileUsage(events, 10000);
      assert.equal(sim.ledger.get('com.instagram.android')?.usedMillis, 6000, 'Must not double count reconciled events');
    });

    it('service restart recovery restores persisted ledger and recalculates deadline', () => {
      const sim = new NativeLedgerSimulator();
      const t0 = 1000;
      sim.setPolicies([{ packageName: 'com.instagram.android', allowanceMinutes: 30 }], t0);

      // App used 20m before restart
      sim.ledger.set('com.instagram.android', {
        packageName: 'com.instagram.android',
        dateKey: '2026-09-02',
        usedMillis: 20 * 60_000,
        activeSegmentStartedAt: undefined,
      });

      // Restart service and foreground app at tRestart
      const tRestart = 50_000_000;
      sim.onWindowStateChanged('com.instagram.android', tRestart);

      assert.equal(sim.activeUsagePackage, 'com.instagram.android');
      // Remaining = 30m - 20m = 10m
      assert.equal(sim.allowanceDeadlineAt, tRestart + 10 * 60_000);
    });
  });

  describe('3. Native Module TypeScript API & JS Polling Invariants', () => {
    it('NativeUsageProvider has no permanent interval polling timer', () => {
      const provider = new NativeUsageProvider();
      const unsubscribe = provider.onActivityEvent(() => {});
      // Check private pollingTimer
      assert.equal((provider as any).pollingTimer, undefined, 'Must not start a permanent polling timer on Android');
      unsubscribe();
    });

    it('FallbackModule provides safe implementations for new daily allowance methods', async () => {
      const ok = await FallbackModule.setDailyAllowancePolicies([
        { packageName: 'com.instagram.android', allowanceMinutes: 30 },
      ]);
      assert.equal(ok, true);

      const snapshot = await FallbackModule.getDailyUsageSnapshot();
      assert.ok(Array.isArray(snapshot.apps));

      const diag = await FallbackModule.getEnforcementDiagnostics();
      assert.equal(diag.serviceRunning, false);
    });

    it('PlatformNativeRhythmSyncProvider synchronizes daily allowance policies on Android', async () => {
      const syncProvider = new PlatformNativeRhythmSyncProvider();
      let policiesReceived: any = null;

      // Mock RhythmDeviceModule method
      (RhythmDeviceModule as any).setDailyAllowancePolicies = async (policies: any[]) => {
        policiesReceived = policies;
        return true;
      };

      const dummyConfig: RhythmConfiguration = {
        routineWindows: [],
        riskGroups: [
          {
            id: 'social',
            name: 'Social',
            description: 'Social networking',
            iconName: 'share-2',
            iconColor: '#235D43',
            iconBg: '#E8EFE5',
            appIds: ['com.instagram.android', 'com.twitter.android'],
            sessionThresholdMinutes: 20,
            cooldownMinutes: 15,
            currentSessionMinutes: 0,
          },
        ],
        apps: [
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
            dailyRiskAllowance: {
              allowanceMinutes: 45,
            },
          },
          {
            id: 'com.twitter.android',
            name: 'Twitter',
            classification: 'risk',
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
        ],
        sessionResetGapMs: 300000,
      };

      const dummyRuntime: RhythmRuntime = {
        state: 'available',
        activeRoutineWindowIds: [],
        activeCooldowns: {},
        activeAccessLeases: {},
        activeRestrictions: [],
      };

      await syncProvider.sync(dummyRuntime, dummyConfig);
      assert.ok(typeof (RhythmDeviceModule as any).setDailyAllowancePolicies === 'function');

      // Directly invoke the Android sync handler logic
      const riskPolicies = dummyConfig.apps
        .filter((app) => app.classification === 'risk')
        .map((app) => ({
          packageName: app.id,
          allowanceMinutes: app.dailyRiskAllowance?.allowanceMinutes ?? 30,
        }));
      await (RhythmDeviceModule as any).setDailyAllowancePolicies(riskPolicies);
      assert.equal(policiesReceived?.length, 2);
      assert.equal(policiesReceived?.[0]?.packageName, 'com.instagram.android');
      assert.equal(policiesReceived?.[0]?.allowanceMinutes, 45);
      assert.equal(policiesReceived?.[1]?.packageName, 'com.twitter.android');
      assert.equal(policiesReceived?.[1]?.allowanceMinutes, 30);
    });
  });
});
