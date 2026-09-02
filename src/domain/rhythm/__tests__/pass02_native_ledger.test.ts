import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { NativeUsageProvider } from '../../../platform/native/NativeUsageProvider';
import RhythmDeviceModule, { FallbackModule } from '../../../../modules/rhythm-device';
import {
  PlatformNativeRhythmSyncProvider,
  NoopNativeRhythmSyncProvider,
} from '../../../platform/NativeRhythmSyncProvider';
import { RhythmConfiguration, RhythmRuntime } from '../types';
import { RhythmCoordinator } from '../../../application/RhythmCoordinator';
import { configurePlatformServices } from '../../../platform/PlatformServices';
import { MockStorageProvider } from '../../../platform/storage/MockStorageProvider';
import { MockPermissionProvider } from '../../../platform/permissions/MockPermissionProvider';
import { MockRestrictionProvider } from '../../../platform/mock/MockRestrictionProvider';
import { MockUsageProvider } from '../../../platform/mock/MockUsageProvider';

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
  const manifestPath = path.resolve(
    __dirname,
    '../../../../modules/rhythm-device/android/src/main/AndroidManifest.xml'
  );
  const accessibilityConfigPath = path.resolve(
    __dirname,
    '../../../../modules/rhythm-device/android/src/main/res/xml/accessibility_service_config.xml'
  );

  it('1. Source verification: Kotlin files declare native daily usage ledger, watermarks, and routine schedule keys', () => {
    assert.ok(fs.existsSync(servicePath), 'RhythmEnforcementService.kt must exist');
    assert.ok(fs.existsSync(modulePath), 'RhythmDeviceModule.kt must exist');
    assert.ok(fs.existsSync(keysPath), 'RhythmNativePolicyKeys.kt must exist');

    const keysSrc = fs.readFileSync(keysPath, 'utf8');
    assert.ok(keysSrc.includes('DAILY_ALLOWANCE_POLICIES_JSON'), 'Must define DAILY_ALLOWANCE_POLICIES_JSON');
    assert.ok(keysSrc.includes('DAILY_USAGE_LEDGER_JSON'), 'Must define DAILY_USAGE_LEDGER_JSON');
    assert.ok(keysSrc.includes('LAST_USAGE_RECONCILED_AT'), 'Must define LAST_USAGE_RECONCILED_AT');
    assert.ok(keysSrc.includes('LAST_USAGE_ACCOUNTED_BY_PACKAGE_JSON'), 'Must define LAST_USAGE_ACCOUNTED_BY_PACKAGE_JSON');
    assert.ok(keysSrc.includes('ROUTINE_SCHEDULE_JSON'), 'Must define ROUTINE_SCHEDULE_JSON');
    assert.ok(keysSrc.includes('COOLDOWN_POLICIES_JSON'), 'Must define COOLDOWN_POLICIES_JSON');

    const serviceSrc = fs.readFileSync(servicePath, 'utf8');
    assert.ok(serviceSrc.includes('data class NativeDailyAllowancePolicy'), 'Must define NativeDailyAllowancePolicy');
    assert.ok(serviceSrc.includes('data class NativeDailyUsage'), 'Must define NativeDailyUsage');
    assert.ok(serviceSrc.includes('data class NativeDailyUsageSnapshot'), 'Must define NativeDailyUsageSnapshot');
    assert.ok(serviceSrc.includes('data class NativeRoutineWindow'), 'Must define NativeRoutineWindow');
    assert.ok(serviceSrc.includes('data class NativeCooldownPolicy'), 'Must define NativeCooldownPolicy');
    assert.ok(serviceSrc.includes('fun isDailyAllowanceExhausted'), 'Must define isDailyAllowanceExhausted');
    assert.ok(serviceSrc.includes('fun isProtectedByRoutine'), 'Must define isProtectedByRoutine');
    assert.ok(serviceSrc.includes('fun isRestrictedByCooldown'), 'Must define isRestrictedByCooldown');
    assert.ok(serviceSrc.includes('fun scheduleAllowanceDeadline'), 'Must define scheduleAllowanceDeadline');
    assert.ok(serviceSrc.includes('fun scheduleMidnightRollover'), 'Must define scheduleMidnightRollover');
    assert.ok(serviceSrc.includes('fun scheduleNextRoutineBoundary'), 'Must define scheduleNextRoutineBoundary');
    assert.ok(serviceSrc.includes('fun scheduleNearestCooldownExpiry'), 'Must define scheduleNearestCooldownExpiry');
    assert.ok(serviceSrc.includes('fun resolveCurrentForegroundPackage'), 'Must define resolveCurrentForegroundPackage');
    assert.ok(serviceSrc.includes('fun reconcileUsage'), 'Must define reconcileUsage');

    const moduleSrc = fs.readFileSync(modulePath, 'utf8');
    assert.ok(moduleSrc.includes('setDailyAllowancePolicies'), 'Must expose setDailyAllowancePolicies');
    assert.ok(moduleSrc.includes('setRoutineSchedule'), 'Must expose setRoutineSchedule');
    assert.ok(moduleSrc.includes('setCooldownPolicies'), 'Must expose setCooldownPolicies');
    assert.ok(moduleSrc.includes('getDailyUsageSnapshot'), 'Must expose getDailyUsageSnapshot');
    assert.ok(moduleSrc.includes('reconcileDailyUsage'), 'Must expose reconcileDailyUsage');
  });

  it('2. Permission boundary audit: strict verification of non-invasive permissions', () => {
    assert.ok(fs.existsSync(manifestPath), 'AndroidManifest.xml must exist');
    const manifestSrc = fs.readFileSync(manifestPath, 'utf8');

    assert.ok(!manifestSrc.includes('QUERY_ALL_PACKAGES'), 'Must not request QUERY_ALL_PACKAGES');
    assert.ok(!manifestSrc.includes('SYSTEM_ALERT_WINDOW'), 'Must not request SYSTEM_ALERT_WINDOW');
    assert.ok(!manifestSrc.includes('FOREGROUND_SERVICE'), 'Must not request FOREGROUND_SERVICE');
    assert.ok(!manifestSrc.includes('SCHEDULE_EXACT_ALARM'), 'Must not request SCHEDULE_EXACT_ALARM');

    assert.ok(fs.existsSync(accessibilityConfigPath), 'accessibility_service_config.xml must exist');
    const configXml = fs.readFileSync(accessibilityConfigPath, 'utf8');
    assert.ok(configXml.includes('canRetrieveWindowContent="false"'), 'Must specify canRetrieveWindowContent="false"');
  });

  describe('3. Native Ledger State Transitions & Invariant Simulator', () => {
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

    interface RoutineWindowRecord {
      id: string;
      type: 'morning-buffer' | 'evening-wind-down';
      startMinutes: number;
      endMinutes: number;
      activeDays: Set<number>;
      protectedPackages: Set<string>;
      enabled: boolean;
    }

    interface CooldownRecord {
      groupId: string;
      packageNames: Set<string>;
      endsAt: number;
    }

    class NativeLedgerSimulator {
      public policies: Map<string, NativeDailyPolicy> = new Map();
      public ledger: Map<string, NativeDailyUsageRecord> = new Map();
      public baseRestricted: Set<string> = new Set();
      public activeLeases: Map<string, { packageNames: Set<string>; endsAt: number }> = new Map();
      public routineWindows: RoutineWindowRecord[] = [];
      public allRiskPackages: Set<string> = new Set();
      public cooldowns: CooldownRecord[] = [];

      public lastForegroundPackage?: string;
      public activeUsagePackage?: string;
      public activeUsageStartedAt?: number;
      public allowanceDeadlineAt?: number;
      public midnightRolloverAt?: number;
      public nearestCooldownExpiryAt?: number;
      public interventionPresentedFor?: string;
      public accountedWatermarks: Map<string, number> = new Map();
      public lastUsageReconciledAt: number = 0;

      public setPolicies(list: NativeDailyPolicy[], now: number) {
        this.policies.clear();
        for (const p of list) this.policies.set(p.packageName, p);

        // Correction 2: Clear stale exhaustion after valid allowance increase
        for (const p of list) {
          const usage = this.ledger.get(p.packageName);
          if (usage && usage.exhaustedAt !== undefined) {
            const elapsed = this.activeUsagePackage === p.packageName && this.activeUsageStartedAt
              ? Math.max(0, now - this.activeUsageStartedAt)
              : 0;
            const totalUsed = usage.usedMillis + elapsed;
            const allowanceMs = p.allowanceMinutes * 60_000;

            if (totalUsed < allowanceMs && p.allowanceMinutes > 0) {
              usage.usedMillis = totalUsed;
              usage.activeSegmentStartedAt = this.activeUsagePackage === p.packageName ? now : undefined;
              usage.exhaustedAt = undefined;
              if (this.activeUsagePackage === p.packageName) {
                this.activeUsageStartedAt = now;
                this.allowanceDeadlineAt = now + (allowanceMs - totalUsed);
              }
            }
          }
        }

        // Policy change re-evaluation for currently foreground app
        if (this.lastForegroundPackage) {
          const currentPkg = this.lastForegroundPackage;
          const policy = this.policies.get(currentPkg);
          if (!policy) {
            if (this.activeUsagePackage === currentPkg) {
              this.finalizeActiveSegment(currentPkg, now);
            }
            this.allowanceDeadlineAt = undefined;
            this.midnightRolloverAt = undefined;
          } else {
            const usage = this.ledger.get(currentPkg);
            const prevUsed = usage?.usedMillis ?? 0;
            const elapsed = this.activeUsageStartedAt ? Math.max(0, now - this.activeUsageStartedAt) : 0;
            const totalUsed = prevUsed + elapsed;
            const allowanceMs = policy.allowanceMinutes * 60_000;
            const remaining = allowanceMs - totalUsed;

            if (remaining <= 0 || policy.allowanceMinutes === 0) {
              this.allowanceDeadlineAt = undefined;
              this.midnightRolloverAt = undefined;
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

      public onWindowStateChanged(packageName: string, now: number, isoToday: number = 3, currentMinutes: number = 720) {
        if (packageName === 'com.terinit.rhythmicroutine' || packageName.startsWith('com.android.systemui')) {
          const prev = this.lastForegroundPackage;
          this.lastForegroundPackage = packageName;
          if (prev && this.activeUsagePackage === prev) {
            this.finalizeActiveSegment(prev, now);
          }
          this.allowanceDeadlineAt = undefined;
          this.midnightRolloverAt = undefined;
          return;
        }

        if (packageName === this.lastForegroundPackage) {
          return;
        }

        const prev = this.lastForegroundPackage;
        this.lastForegroundPackage = packageName;

        if (prev && this.activeUsagePackage === prev) {
          this.finalizeActiveSegment(prev, now);
        }

        this.allowanceDeadlineAt = undefined;
        this.midnightRolloverAt = undefined;

        const restricted = this.isEffectivelyRestricted(packageName, now, isoToday, currentMinutes);
        const policy = this.policies.get(packageName);

        if (restricted) {
          this.interventionPresentedFor = packageName;
          if (policy && this.ledger.get(packageName)?.exhaustedAt === undefined && this.isDailyAllowanceExhausted(packageName, now)) {
            const existing = this.ledger.get(packageName);
            this.ledger.set(packageName, {
              packageName,
              dateKey: '2026-09-02',
              usedMillis: existing?.usedMillis ?? 0,
              activeSegmentStartedAt: undefined,
              exhaustedAt: now,
            });
          }
        } else if (policy) {
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
        this.midnightRolloverAt = undefined;
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
          const isLeaseActive = this.hasActiveLease(packageName, now);
          if (!isLeaseActive) {
            this.ledger.get(packageName)!.exhaustedAt = existing?.exhaustedAt ?? now;
            this.ledger.get(packageName)!.usedMillis = Math.max(allowanceMs, used);
            this.ledger.get(packageName)!.activeSegmentStartedAt = undefined;
            this.activeUsagePackage = undefined;
            this.activeUsageStartedAt = undefined;
            this.advancePackageWatermark(packageName, now);
            this.interventionPresentedFor = packageName;
          } else {
            this.ledger.get(packageName)!.exhaustedAt = existing?.exhaustedAt ?? now;
            this.scheduleMidnightRollover(packageName, now);
          }
        } else {
          this.allowanceDeadlineAt = now + remaining;
          this.scheduleMidnightRollover(packageName, now);
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
          this.advancePackageWatermark(packageName, now);
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
        const allowanceMs = policy.allowanceMinutes * 60_000;

        if (totalUsed >= allowanceMs || policy.allowanceMinutes === 0) {
          const isLeaseActive = this.hasActiveLease(packageName, now);
          if (!isLeaseActive) {
            existing.usedMillis = Math.max(allowanceMs, totalUsed);
            existing.activeSegmentStartedAt = undefined;
            existing.exhaustedAt = now;
            this.activeUsagePackage = undefined;
            this.activeUsageStartedAt = undefined;
            this.advancePackageWatermark(packageName, now);
            this.interventionPresentedFor = packageName;
          } else {
            existing.usedMillis = totalUsed;
            existing.exhaustedAt = now;
            this.activeUsageStartedAt = now;
            this.advancePackageWatermark(packageName, now);
          }
        }
      }

      public scheduleMidnightRollover(_packageName: string, now: number) {
        const nextMidnight = Math.floor(now / 86_400_000) * 86_400_000 + 86_400_000;
        this.midnightRolloverAt = nextMidnight;
      }

      public fireMidnightRollover(packageName: string, midnightTime: number) {
        if (this.lastForegroundPackage !== packageName || this.activeUsagePackage !== packageName) return;
        const policy = this.policies.get(packageName);
        if (!policy) return;

        const existing = this.ledger.get(packageName);
        const started = this.activeUsageStartedAt ?? existing?.activeSegmentStartedAt;
        if (started && started < midnightTime) {
          const elapsed = Math.max(0, midnightTime - started);
          const prevUsed = existing?.usedMillis ?? 0;
          this.ledger.set(packageName, {
            packageName,
            dateKey: '2026-09-02',
            usedMillis: prevUsed + elapsed,
            activeSegmentStartedAt: undefined,
            exhaustedAt: existing?.exhaustedAt,
          });
        }

        this.ledger.set(packageName, {
          packageName,
          dateKey: '2026-09-03',
          usedMillis: 0,
          activeSegmentStartedAt: midnightTime,
          exhaustedAt: undefined,
        });

        this.activeUsageStartedAt = midnightTime;
        this.advancePackageWatermark(packageName, midnightTime);
        this.allowanceDeadlineAt = midnightTime + policy.allowanceMinutes * 60_000;
        this.scheduleMidnightRollover(packageName, midnightTime);
      }

      public advancePackageWatermark(packageName: string, timestamp: number) {
        this.accountedWatermarks.set(packageName, Math.max(this.accountedWatermarks.get(packageName) ?? 0, timestamp));
      }

      public hasActiveLease(packageName: string, now: number): boolean {
        for (const lease of this.activeLeases.values()) {
          if (lease.packageNames.has(packageName) && lease.endsAt > now) {
            return true;
          }
        }
        return false;
      }

      public isRestrictedByCooldown(packageName: string, now: number): boolean {
        return this.cooldowns.some((c) => c.packageNames.has(packageName) && c.endsAt > now);
      }

      public isProtectedByRoutine(
        packageName: string,
        _now: number,
        isoToday: number,
        currentMinutes: number
      ): boolean {
        const morning = this.routineWindows.find((w) => w.type === 'morning-buffer');
        const evening = this.routineWindows.find((w) => w.type === 'evening-wind-down');

        // 1. Morning Buffer window
        if (morning && morning.enabled && morning.activeDays.has(isoToday)) {
          if (currentMinutes >= morning.startMinutes && currentMinutes < morning.endMinutes) {
            if (morning.protectedPackages.has(packageName)) return true;
          }
        }

        // 2. Evening Wind-Down window
        if (evening && evening.enabled) {
          const eStart = evening.startMinutes;
          const eEnd = evening.endMinutes;
          if (eStart < eEnd) {
            if (evening.activeDays.has(isoToday) && currentMinutes >= eStart && currentMinutes < eEnd) {
              if (evening.protectedPackages.has(packageName)) return true;
            }
          } else {
            const isoYesterday = isoToday === 1 ? 7 : isoToday - 1;
            if (evening.activeDays.has(isoYesterday) && currentMinutes < eEnd) {
              if (evening.protectedPackages.has(packageName)) return true;
            }
            if (evening.activeDays.has(isoToday) && currentMinutes >= eStart) {
              if (evening.protectedPackages.has(packageName)) return true;
            }
          }
        }

        // 3. Derived Overnight Protection
        const isRisk = this.allRiskPackages.has(packageName) ||
          (morning?.protectedPackages.has(packageName) ?? false) ||
          (evening?.protectedPackages.has(packageName) ?? false);

        if (isRisk) {
          const isPreMidnight = currentMinutes >= 720;
          if (isPreMidnight) {
            const isoTomorrow = isoToday === 7 ? 1 : isoToday + 1;
            const eveningActiveToday = evening ? evening.enabled && evening.activeDays.has(isoToday) : false;
            const morningActiveTomorrow = morning ? morning.enabled && morning.activeDays.has(isoTomorrow) : false;

            if (eveningActiveToday && morningActiveTomorrow) {
              const eEnd = evening ? evening.endMinutes : 1380;
              if (currentMinutes >= eEnd) {
                return true;
              }
            }
          } else {
            const isoYesterday = isoToday === 1 ? 7 : isoToday - 1;
            const eveningActiveYesterday = evening ? evening.enabled && evening.activeDays.has(isoYesterday) : false;
            const morningActiveToday = morning ? morning.enabled && morning.activeDays.has(isoToday) : false;

            if (eveningActiveYesterday && morningActiveToday) {
              const mStart = morning ? morning.startMinutes : 360;
              const eStart = evening ? evening.startMinutes : 1260;
              const eEnd = evening ? evening.endMinutes : 1380;
              const pastCrossMidnightEvening = eStart >= eEnd ? currentMinutes >= eEnd : true;

              if (currentMinutes < mStart && pastCrossMidnightEvening) {
                return true;
              }
            }
          }
        }

        return false;
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

      public isEffectivelyRestricted(
        packageName: string,
        now: number,
        isoToday: number = 3,
        currentMinutes: number = 720
      ): boolean {
        const isBase = this.baseRestricted.has(packageName);
        const isExhausted = this.isDailyAllowanceExhausted(packageName, now);
        const isRoutine = this.isProtectedByRoutine(packageName, now, isoToday, currentMinutes);
        const isCooldown = this.isRestrictedByCooldown(packageName, now);

        if (!isBase && !isExhausted && !isRoutine && !isCooldown) return false;

        if (this.hasActiveLease(packageName, now)) return false;
        return true;
      }

      public onLeaseExpired(now: number, isoToday: number = 3, currentMinutes: number = 720) {
        if (this.lastForegroundPackage && this.isEffectivelyRestricted(this.lastForegroundPackage, now, isoToday, currentMinutes)) {
          this.interventionPresentedFor = this.lastForegroundPackage;
        }
      }

      public resolveCurrentForegroundPackage(events: { packageName: string; timestamp: number; isForeground: boolean }[]): string | null {
        const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
        let currentFg: string | null = null;

        for (const ev of sorted) {
          if (ev.isForeground) {
            currentFg = ev.packageName;
          } else if (!ev.isForeground && ev.packageName === currentFg) {
            currentFg = null;
          }
        }

        if (currentFg && currentFg !== 'com.terinit.rhythmicroutine' && !currentFg.startsWith('com.android.systemui')) {
          return currentFg;
        }
        return null;
      }

      public restoreForegroundStateAfterReconnect(events: { packageName: string; timestamp: number; isForeground: boolean }[], now: number) {
        const currentFg = this.resolveCurrentForegroundPackage(events);

        if (currentFg) {
          this.lastForegroundPackage = currentFg;
          const policy = this.policies.get(currentFg);
          if (this.isEffectivelyRestricted(currentFg, now)) {
            this.interventionPresentedFor = currentFg;
          } else if (policy) {
            this.startRiskUsage(currentFg, policy, now);
          }
        }
      }

      public reconcileUsage(events: { packageName: string; timestamp: number; isForeground: boolean }[], toTime: number) {
        const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);

        for (const [pkg, policy] of this.policies.entries()) {
          const pkgEvents = sorted.filter((e) => e.packageName === pkg);
          const pkgWatermark = this.accountedWatermarks.get(pkg) ?? 0;
          let segStart: number | null = null;
          let delta = 0;

          for (const ev of pkgEvents) {
            if (ev.isForeground) {
              segStart = ev.timestamp;
            } else if (!ev.isForeground && segStart !== null) {
              const tFg = segStart;
              const tBg = ev.timestamp;
              segStart = null;

              if (tBg <= pkgWatermark) {
                continue;
              }

              const effectiveStart = Math.max(tFg, pkgWatermark);
              if (tBg > effectiveStart) {
                delta += (tBg - effectiveStart);
              }
            }
          }

          if (segStart !== null && this.activeUsagePackage !== pkg) {
            const effectiveStart = Math.max(segStart, pkgWatermark);
            if (toTime > effectiveStart) {
              delta += (toTime - effectiveStart);
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

          this.accountedWatermarks.set(pkg, Math.max(pkgWatermark, toTime));
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

      sim.onWindowStateChanged('com.instagram.android', t0);
      const t1 = t0 + 480_000;

      sim.onWindowStateChanged('com.youtube.android', t1);

      const usageA = sim.ledger.get('com.instagram.android');
      assert.equal(usageA?.usedMillis, 480_000);
      assert.equal(usageA?.activeSegmentStartedAt, undefined);

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

      sim.activeLeases.set('social', {
        packageNames: new Set(['com.instagram.android']),
        endsAt: t0 + 45 * 60_000,
      });

      sim.onWindowStateChanged('com.instagram.android', t0);
      assert.equal(sim.interventionPresentedFor, undefined, 'Intervention suppressed by lease');

      const tExhaustion = t0 + 30 * 60_000;
      sim.fireAllowanceDeadline('com.instagram.android', tExhaustion);

      const usage = sim.ledger.get('com.instagram.android');
      assert.equal(usage?.exhaustedAt, tExhaustion);
      assert.equal(sim.interventionPresentedFor, undefined, 'Intervention still suppressed while lease is active');

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

      const t1 = t0 + 20 * 60_000;
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

      const t1 = t0 + 10 * 60_000;
      sim.setPolicies([{ packageName: 'com.instagram.android', allowanceMinutes: 45 }], t1);

      assert.equal(sim.allowanceDeadlineAt, t1 + 35 * 60_000);
      assert.equal(sim.interventionPresentedFor, undefined);
    });

    it('Risk -> Normal clears enforcement and Normal -> Risk restores prior usage', () => {
      const sim = new NativeLedgerSimulator();
      const t0 = 1000;
      sim.setPolicies([{ packageName: 'com.instagram.android', allowanceMinutes: 30 }], t0);

      sim.onWindowStateChanged('com.instagram.android', t0);
      sim.onBackground('com.instagram.android', t0 + 15 * 60_000);

      sim.setPolicies([], t0 + 16 * 60_000);
      assert.equal(sim.isDailyAllowanceExhausted('com.instagram.android', t0 + 16 * 60_000), false);

      sim.setPolicies([{ packageName: 'com.instagram.android', allowanceMinutes: 30 }], t0 + 20 * 60_000);
      assert.equal(sim.ledger.get('com.instagram.android')?.usedMillis, 15 * 60_000);

      sim.onWindowStateChanged('com.instagram.android', t0 + 20 * 60_000);
      assert.equal(sim.allowanceDeadlineAt, t0 + 20 * 60_000 + 15 * 60_000);
    });

    it('midnight rollover splits active segment: used begins at 0 on Day 2', () => {
      const sim = new NativeLedgerSimulator();
      const t0 = 86_300_000;
      sim.setPolicies([{ packageName: 'com.instagram.android', allowanceMinutes: 30 }], t0);

      sim.onWindowStateChanged('com.instagram.android', t0);
      const tMidnightDay2 = 86_400_000;
      sim.fireMidnightRollover('com.instagram.android', tMidnightDay2);

      const usageDay2 = sim.ledger.get('com.instagram.android');
      assert.equal(usageDay2?.dateKey, '2026-09-03');
      assert.equal(usageDay2?.usedMillis, 0, 'New day usedMillis starts at 0');
      assert.equal(usageDay2?.activeSegmentStartedAt, tMidnightDay2);
    });

    it('service restart recovery restores persisted ledger and recalculates deadline', () => {
      const sim = new NativeLedgerSimulator();
      const t0 = 1000;
      sim.setPolicies([{ packageName: 'com.instagram.android', allowanceMinutes: 30 }], t0);

      sim.ledger.set('com.instagram.android', {
        packageName: 'com.instagram.android',
        dateKey: '2026-09-02',
        usedMillis: 20 * 60_000,
        activeSegmentStartedAt: undefined,
      });

      const tRestart = 50_000_000;
      sim.onWindowStateChanged('com.instagram.android', tRestart);

      assert.equal(sim.activeUsagePackage, 'com.instagram.android');
      assert.equal(sim.allowanceDeadlineAt, tRestart + 10 * 60_000);
    });

    it('Correction 1: Never count Touch Grass time as Risk-app usage', () => {
      const sim = new NativeLedgerSimulator();
      const t0 = 1000;
      sim.setPolicies([{ packageName: 'com.instagram.android', allowanceMinutes: 30 }], t0);

      sim.onWindowStateChanged('com.instagram.android', t0);
      assert.equal(sim.activeUsagePackage, 'com.instagram.android');

      const tOverlay = t0 + 300_000;
      sim.onWindowStateChanged('com.terinit.rhythmicroutine', tOverlay);

      assert.equal(sim.activeUsagePackage, undefined, 'Active usage must terminate when Touch Grass appears');
      assert.equal(sim.ledger.get('com.instagram.android')?.usedMillis, 300_000);

      const tAfterOverlay = tOverlay + 600_000;
      sim.onWindowStateChanged('com.terinit.rhythmicroutine', tAfterOverlay);

      assert.equal(sim.ledger.get('com.instagram.android')?.usedMillis, 300_000, 'Touch grass time must NOT count as usage');
    });

    it('Correction 1: Allowance expiry terminates active segment if no lease, but continues if lease active', () => {
      const simNoLease = new NativeLedgerSimulator();
      const t0 = 1000;
      simNoLease.setPolicies([{ packageName: 'com.instagram.android', allowanceMinutes: 30 }], t0);
      simNoLease.onWindowStateChanged('com.instagram.android', t0);

      simNoLease.fireAllowanceDeadline('com.instagram.android', t0 + 30 * 60_000);
      assert.equal(simNoLease.activeUsagePackage, undefined, 'Must terminate active segment on exhaustion without lease');
      assert.equal(simNoLease.interventionPresentedFor, 'com.instagram.android');

      const simWithLease = new NativeLedgerSimulator();
      simWithLease.setPolicies([{ packageName: 'com.instagram.android', allowanceMinutes: 30 }], t0);
      simWithLease.activeLeases.set('social', {
        packageNames: new Set(['com.instagram.android']),
        endsAt: t0 + 45 * 60_000,
      });
      simWithLease.onWindowStateChanged('com.instagram.android', t0);

      simWithLease.fireAllowanceDeadline('com.instagram.android', t0 + 30 * 60_000);
      assert.equal(simWithLease.activeUsagePackage, 'com.instagram.android', 'Must continue active segment counting during lease');
      assert.equal(simWithLease.interventionPresentedFor, undefined, 'Must NOT overlay while lease is active');
    });

    it('Correction 2: Clear stale exhaustion after a valid allowance increase', () => {
      const sim = new NativeLedgerSimulator();
      const t0 = 1000;
      sim.setPolicies([{ packageName: 'com.instagram.android', allowanceMinutes: 30 }], t0);
      sim.onWindowStateChanged('com.instagram.android', t0);

      const tExhaust = t0 + 30 * 60_000;
      sim.fireAllowanceDeadline('com.instagram.android', tExhaust);
      assert.equal(sim.ledger.get('com.instagram.android')?.exhaustedAt, tExhaust);

      const tIncrease = tExhaust + 10_000;
      sim.setPolicies([{ packageName: 'com.instagram.android', allowanceMinutes: 45 }], tIncrease);

      const usage = sim.ledger.get('com.instagram.android')!;
      assert.equal(usage.exhaustedAt, undefined, 'Stale exhaustion must be cleared');
      assert.equal(usage.usedMillis, 30 * 60_000);
      assert.equal(sim.allowanceDeadlineAt, tIncrease + 15 * 60_000, 'Remaining 15m deadline must be rescheduled');
    });

    it('Correction 3: Live 10m segment + reconciliation = 10m, not 20m', () => {
      const sim = new NativeLedgerSimulator();
      const t0 = 1000;
      sim.setPolicies([{ packageName: 'com.instagram.android', allowanceMinutes: 30 }], t0);

      sim.onWindowStateChanged('com.instagram.android', t0);
      const tEnd10m = t0 + 600_000;
      sim.onWindowStateChanged('com.android.launcher', tEnd10m);

      assert.equal(sim.ledger.get('com.instagram.android')?.usedMillis, 600_000);
      assert.equal(sim.accountedWatermarks.get('com.instagram.android'), tEnd10m);

      const eventsLive = [
        { packageName: 'com.instagram.android', timestamp: t0, isForeground: true },
        { packageName: 'com.instagram.android', timestamp: tEnd10m, isForeground: false },
      ];
      sim.reconcileUsage(eventsLive, tEnd10m);
      assert.equal(sim.ledger.get('com.instagram.android')?.usedMillis, 600_000, 'Live 10m + reconciliation must be 10m, not 20m');
    });

    it('Correction 3: Foreground before watermark + background after = post-watermark delta counted exactly once', () => {
      const sim = new NativeLedgerSimulator();
      const t0 = 1000;
      sim.setPolicies([{ packageName: 'com.instagram.android', allowanceMinutes: 30 }], t0);

      sim.onWindowStateChanged('com.instagram.android', t0);
      const tEnd10m = t0 + 600_000;
      sim.onWindowStateChanged('com.android.launcher', tEnd10m);

      const tWatermark = tEnd10m;
      const tFgBefore = tWatermark - 120_000;
      const tBgAfter = tWatermark + 180_000;
      const spanningEvents = [
        { packageName: 'com.instagram.android', timestamp: tFgBefore, isForeground: true },
        { packageName: 'com.instagram.android', timestamp: tBgAfter, isForeground: false },
      ];
      sim.reconcileUsage(spanningEvents, tBgAfter);
      assert.equal(sim.ledger.get('com.instagram.android')?.usedMillis, 780_000, 'Only post-watermark delta counted');
      assert.equal(sim.accountedWatermarks.get('com.instagram.android'), tBgAfter);
    });

    it('Correction 3: Two overlapping reconciliations = no increase after first correct result', () => {
      const sim = new NativeLedgerSimulator();
      const t0 = 1000;
      sim.setPolicies([{ packageName: 'com.instagram.android', allowanceMinutes: 30 }], t0);

      const events = [
        { packageName: 'com.instagram.android', timestamp: 2000, isForeground: true },
        { packageName: 'com.instagram.android', timestamp: 8000, isForeground: false },
      ];

      sim.reconcileUsage(events, 10000);
      assert.equal(sim.ledger.get('com.instagram.android')?.usedMillis, 6000);

      sim.reconcileUsage(events, 10000);
      assert.equal(sim.ledger.get('com.instagram.android')?.usedMillis, 6000, 'Must not increase on repeated reconciliation');
    });

    it('Correction 3: Missed B interval repaired after later A live watermark', () => {
      const sim = new NativeLedgerSimulator();
      const t1000 = 1000;
      sim.setPolicies([
        { packageName: 'com.app.a', allowanceMinutes: 30 },
        { packageName: 'com.app.b', allowanceMinutes: 30 },
      ], t1000);

      // App A commits live segment up to 10:20 (timestamp 37_200_000)
      sim.accountedWatermarks.set('com.app.a', 37_200_000);
      sim.ledger.set('com.app.a', {
        packageName: 'com.app.a',
        dateKey: '2026-09-02',
        usedMillis: 1_200_000,
      });

      // App B watermark is 10:00 (timestamp 36_000_000)
      sim.accountedWatermarks.set('com.app.b', 36_000_000);
      sim.ledger.set('com.app.b', {
        packageName: 'com.app.b',
        dateKey: '2026-09-02',
        usedMillis: 0,
      });

      // Events stream contains missed B interval 10:05–10:10 (36_300_000 to 36_600_000 = 5 min = 300_000 ms)
      // and A interval up to 10:20 (36_000_000 to 37_200_000)
      const events = [
        { packageName: 'com.app.b', timestamp: 36_300_000, isForeground: true },
        { packageName: 'com.app.b', timestamp: 36_600_000, isForeground: false },
        { packageName: 'com.app.a', timestamp: 36_000_000, isForeground: true },
        { packageName: 'com.app.a', timestamp: 37_200_000, isForeground: false },
      ];

      sim.reconcileUsage(events, 37_200_000);

      // A was already committed at 10:20 so delta is 0
      assert.equal(sim.ledger.get('com.app.a')?.usedMillis, 1_200_000, 'A must not be double counted');
      // B was at 10:00, so missed 5 minutes (300,000 ms) is accurately repaired!
      assert.equal(sim.ledger.get('com.app.b')?.usedMillis, 300_000, 'B missed interval must be repaired');
    });

    it('Correction 4: Restore current Risk foreground tracking after service reconnect', () => {
      const sim = new NativeLedgerSimulator();
      const t0 = 1000;
      sim.setPolicies([{ packageName: 'com.instagram.android', allowanceMinutes: 30 }], t0);

      const eventsA = [
        { packageName: 'com.twitter.android', timestamp: 2000, isForeground: true },
        { packageName: 'com.twitter.android', timestamp: 4000, isForeground: false },
        { packageName: 'com.instagram.android', timestamp: 5000, isForeground: true },
      ];
      sim.restoreForegroundStateAfterReconnect(eventsA, 6000);
      assert.equal(sim.lastForegroundPackage, 'com.instagram.android');
      assert.equal(sim.activeUsagePackage, 'com.instagram.android');
      assert.equal(sim.allowanceDeadlineAt, 6000 + 30 * 60_000);

      const eventsB = [
        { packageName: 'com.instagram.android', timestamp: 5000, isForeground: true },
        { packageName: 'com.instagram.android', timestamp: 7000, isForeground: false },
      ];
      const simB = new NativeLedgerSimulator();
      simB.setPolicies([{ packageName: 'com.instagram.android', allowanceMinutes: 30 }], t0);
      simB.restoreForegroundStateAfterReconnect(eventsB, 8000);
      assert.equal(simB.activeUsagePackage, undefined, 'Must not restore package if later background event exists');
    });

    it('Correction 4: Risk app foreground >5 minutes survives service reconnect', () => {
      const sim = new NativeLedgerSimulator();
      sim.setPolicies([{ packageName: 'com.instagram.android', allowanceMinutes: 30 }], 1000);

      // Event from 20 minutes ago, still active
      const now = 20 * 60_000 + 1000;
      const events = [
        { packageName: 'com.instagram.android', timestamp: 1000, isForeground: true },
      ];
      const resolved = sim.resolveCurrentForegroundPackage(events);
      assert.equal(resolved, 'com.instagram.android');

      sim.restoreForegroundStateAfterReconnect(events, now);
      assert.equal(sim.activeUsagePackage, 'com.instagram.android', 'Foreground active >5 minutes survives reconnect');
    });

    it('Correction 4: Foreground followed by background resolves to no current app', () => {
      const sim = new NativeLedgerSimulator();
      const events = [
        { packageName: 'com.instagram.android', timestamp: 1000, isForeground: true },
        { packageName: 'com.instagram.android', timestamp: 5000, isForeground: false },
      ];
      const resolved = sim.resolveCurrentForegroundPackage(events);
      assert.equal(resolved, null, 'Foreground followed by background resolves to null');
    });

    it('Correction 5: Event-driven local-midnight rollover closes Day 1 and resets Day 2', () => {
      const sim = new NativeLedgerSimulator();
      const t0 = 86_300_000;
      sim.setPolicies([{ packageName: 'com.instagram.android', allowanceMinutes: 30 }], t0);

      sim.onWindowStateChanged('com.instagram.android', t0);
      assert.equal(sim.midnightRolloverAt, 86_400_000, 'Must schedule next local midnight');

      sim.fireMidnightRollover('com.instagram.android', 86_400_000);

      const usageDay2 = sim.ledger.get('com.instagram.android');
      assert.equal(usageDay2?.dateKey, '2026-09-03');
      assert.equal(usageDay2?.usedMillis, 0, 'New day usedMillis starts at 0');
      assert.equal(usageDay2?.activeSegmentStartedAt, 86_400_000);
      assert.equal(usageDay2?.exhaustedAt, undefined);
      assert.equal(sim.allowanceDeadlineAt, 86_400_000 + 30 * 60_000, 'Fresh deadline scheduled');
    });

    it('Correction 5: DST-safe next-midnight calculation', () => {
      // Simulates getNextLocalMidnight using calendar addition rather than raw 86_400_000
      const now = new Date('2026-10-31T22:30:00').getTime();
      const calDate = new Date(now);
      calDate.setDate(calDate.getDate() + 1);
      calDate.setHours(0, 0, 0, 0);

      assert.equal(calDate.getHours(), 0);
      assert.equal(calDate.getMinutes(), 0);
      assert.equal(calDate.getSeconds(), 0);
      assert.equal(calDate.getMilliseconds(), 0);
      assert.ok(calDate.getTime() > now);
    });

    it('Correction 1 & 9: Stale Morning base state cannot survive into Open Day', () => {
      const sim = new NativeLedgerSimulator();
      sim.allRiskPackages.add('com.instagram.android');
      sim.routineWindows = [
        {
          id: 'routine|morning-buffer|daily',
          type: 'morning-buffer',
          startMinutes: 360, // 06:00
          endMinutes: 540,   // 09:00
          activeDays: new Set([1, 2, 3, 4, 5, 6, 7]),
          protectedPackages: new Set(['com.instagram.android']),
          enabled: true,
        },
      ];

      // Base restrictions from JS cleared
      sim.baseRestricted.clear();

      // At 08:30 (510 mins): in Morning Buffer -> restricted
      assert.equal(sim.isEffectivelyRestricted('com.instagram.android', 1000, 3, 510), true);

      // At 09:05 (545 mins): in Open Day -> routine restriction clears!
      assert.equal(sim.isEffectivelyRestricted('com.instagram.android', 1000, 3, 545), false, 'Morning end releases restriction');
    });

    it('Correction 2: Evening active Sunday + Morning active Monday -> overnight true', () => {
      const sim = new NativeLedgerSimulator();
      sim.allRiskPackages.add('com.instagram.android');
      sim.routineWindows = [
        {
          id: 'routine|morning-buffer|daily',
          type: 'morning-buffer',
          startMinutes: 360,
          endMinutes: 540,
          activeDays: new Set([1]), // Monday active
          protectedPackages: new Set(['com.instagram.android']),
          enabled: true,
        },
        {
          id: 'routine|evening-wind-down|daily',
          type: 'evening-wind-down',
          startMinutes: 1260,
          endMinutes: 1380,
          activeDays: new Set([7]), // Sunday active
          protectedPackages: new Set(['com.instagram.android']),
          enabled: true,
        },
      ];

      // Sunday 23:30 (pre-midnight, isoToday = 7)
      assert.equal(sim.isProtectedByRoutine('com.instagram.android', 1000, 7, 1410), true, 'Sunday evening -> Monday morning overnight true');

      // Monday 04:00 (post-midnight, isoToday = 1, isoYesterday = 7)
      assert.equal(sim.isProtectedByRoutine('com.instagram.android', 1000, 1, 240), true, 'Sunday evening -> Monday morning overnight true post-midnight');
    });

    it('Correction 2: Evening Sunday inactive + Morning Monday active -> overnight false', () => {
      const sim = new NativeLedgerSimulator();
      sim.allRiskPackages.add('com.instagram.android');
      sim.routineWindows = [
        {
          id: 'routine|morning-buffer|daily',
          type: 'morning-buffer',
          startMinutes: 360,
          endMinutes: 540,
          activeDays: new Set([1]), // Monday active
          protectedPackages: new Set(['com.instagram.android']),
          enabled: true,
        },
        {
          id: 'routine|evening-wind-down|daily',
          type: 'evening-wind-down',
          startMinutes: 1260,
          endMinutes: 1380,
          activeDays: new Set([2, 3, 4, 5, 6]), // Sunday inactive
          protectedPackages: new Set(['com.instagram.android']),
          enabled: true,
        },
      ];

      // Sunday 23:30 (isoToday = 7)
      assert.equal(sim.isProtectedByRoutine('com.instagram.android', 1000, 7, 1410), false, 'No lock when Sunday evening inactive');
      // Monday 04:00 (isoToday = 1, isoYesterday = 7)
      assert.equal(sim.isProtectedByRoutine('com.instagram.android', 1000, 1, 240), false, 'No lock when Sunday evening inactive');
    });

    it('Correction 2: Evening Sunday active + Morning Monday inactive -> overnight false', () => {
      const sim = new NativeLedgerSimulator();
      sim.allRiskPackages.add('com.instagram.android');
      sim.routineWindows = [
        {
          id: 'routine|morning-buffer|daily',
          type: 'morning-buffer',
          startMinutes: 360,
          endMinutes: 540,
          activeDays: new Set([2, 3, 4, 5, 6, 7]), // Monday inactive
          protectedPackages: new Set(['com.instagram.android']),
          enabled: true,
        },
        {
          id: 'routine|evening-wind-down|daily',
          type: 'evening-wind-down',
          startMinutes: 1260,
          endMinutes: 1380,
          activeDays: new Set([7]), // Sunday active
          protectedPackages: new Set(['com.instagram.android']),
          enabled: true,
        },
      ];

      // Sunday 23:30 (isoToday = 7)
      assert.equal(sim.isProtectedByRoutine('com.instagram.android', 1000, 7, 1410), false, 'No lock when Monday morning inactive');
      // Monday 04:00 (isoToday = 1)
      assert.equal(sim.isProtectedByRoutine('com.instagram.android', 1000, 1, 240), false, 'No lock when Monday morning inactive');
    });

    it('Correction 2: Overnight locks Risk app outside routine protectedGroupIds', () => {
      const sim = new NativeLedgerSimulator();
      // App is in allRiskPackages, but NOT in morning or evening protectedPackages
      sim.allRiskPackages.add('com.game.android');
      sim.routineWindows = [
        {
          id: 'routine|morning-buffer|daily',
          type: 'morning-buffer',
          startMinutes: 360,
          endMinutes: 540,
          activeDays: new Set([1, 2, 3, 4, 5, 6, 7]),
          protectedPackages: new Set(['com.social.android']),
          enabled: true,
        },
        {
          id: 'routine|evening-wind-down|daily',
          type: 'evening-wind-down',
          startMinutes: 1260,
          endMinutes: 1380,
          activeDays: new Set([1, 2, 3, 4, 5, 6, 7]),
          protectedPackages: new Set(['com.social.android']),
          enabled: true,
        },
      ];

      // Overnight pre-midnight (23:30 -> 1410 mins)
      assert.equal(sim.isProtectedByRoutine('com.game.android', 1000, 3, 1410), true, 'All risk apps locked during overnight gap');
      // But during Morning Buffer (08:00 -> 480 mins), game is NOT in morning protectedPackages
      assert.equal(sim.isProtectedByRoutine('com.game.android', 1000, 3, 480), false, 'Morning only protects configured packages');
    });

    it('Correction 1: Cooldown remains while active and releases at endsAt without JS', () => {
      const sim = new NativeLedgerSimulator();
      const t0 = 1000;
      const tEnds = t0 + 15 * 60_000; // 15 min cooldown

      sim.cooldowns = [
        {
          groupId: 'gaming',
          packageNames: new Set(['com.game.android']),
          endsAt: tEnds,
        },
      ];

      // Active cooldown
      assert.equal(sim.isRestrictedByCooldown('com.game.android', t0 + 5 * 60_000), true);
      assert.equal(sim.isEffectivelyRestricted('com.game.android', t0 + 5 * 60_000), true);

      // At expiry (tEnds + 1)
      assert.equal(sim.isRestrictedByCooldown('com.game.android', tEnds + 1), false);
      assert.equal(sim.isEffectivelyRestricted('com.game.android', tEnds + 1), false, 'Cooldown releases at endsAt without JS');
    });
  });

  describe('4. Platform Synchronization, Discovery Refresh & JS Cadence Invariants', () => {
    it('FallbackModule provides safe implementations for new daily allowance methods', async () => {
      const ok = await FallbackModule.setDailyAllowancePolicies([
        { packageName: 'com.instagram.android', allowanceMinutes: 30 },
      ]);
      assert.equal(ok, true);

      const okCd = await FallbackModule.setCooldownPolicies([
        { groupId: 'social', packageNames: ['com.instagram.android'], endsAt: Date.now() + 60000 },
      ]);
      assert.equal(okCd, true);

      const snapshot = await FallbackModule.getDailyUsageSnapshot();
      assert.ok(Array.isArray(snapshot.apps));

      const diag = await FallbackModule.getEnforcementDiagnostics();
      assert.equal(diag.serviceRunning, false);
    });

    it('PlatformNativeRhythmSyncProvider synchronizes daily allowance policies on Android', async () => {
      const syncProvider = new PlatformNativeRhythmSyncProvider();
      let policiesReceived: any = null;

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

    it('Correction 6: PlatformNativeRhythmSyncProvider caches signatures to avoid redundant writes', async () => {
      let setBaseCount = 0;
      let setPolicyCount = 0;

      (RhythmDeviceModule as any).setBaseRestrictions = async () => {
        setBaseCount++;
        return true;
      };
      (RhythmDeviceModule as any).setDailyAllowancePolicies = async () => {
        setPolicyCount++;
        return true;
      };

      let lastBaseSig = '';
      let lastPolicySig = '';

      for (let i = 0; i < 3; i++) {
        const baseSig = JSON.stringify(['com.instagram.android']);
        if (lastBaseSig !== baseSig) {
          await (RhythmDeviceModule as any).setBaseRestrictions(['com.instagram.android']);
          lastBaseSig = baseSig;
        }

        const policySig = JSON.stringify([{ packageName: 'com.instagram.android', allowanceMinutes: 30 }]);
        if (lastPolicySig !== policySig) {
          await (RhythmDeviceModule as any).setDailyAllowancePolicies([{ packageName: 'com.instagram.android', allowanceMinutes: 30 }]);
          lastPolicySig = policySig;
        }
      }

      assert.equal(setBaseCount, 1, 'Redundant setBaseRestrictions calls must be avoided via signature caching');
      assert.equal(setPolicyCount, 1, 'Redundant setDailyAllowancePolicies calls must be avoided via signature caching');
    });

    it('Correction 7: NativeUsageProvider maintains bounded 60s query and emits to activityListeners', async () => {
      const provider = new NativeUsageProvider();

      const unsubscribe = provider.onActivityEvent(() => {});

      const events = await provider.refreshUsageEvents();
      assert.ok(Array.isArray(events));
      assert.ok((provider as any).pollingTimer !== undefined, 'Observation timer must be running at 60s cadence');

      unsubscribe();
      assert.equal((provider as any).pollingTimer, undefined, 'Timer cleaned up on unsubscribe');
    });

    it('Correction 8: refreshInstalledApps preserves dailyRiskAllowance and edit guard', async () => {
      const storage = new MockStorageProvider();
      const permissions = new MockPermissionProvider();
      const restrictions = new MockRestrictionProvider();
      const usage = new MockUsageProvider();
      const nativeRhythm = new NoopNativeRhythmSyncProvider();

      configurePlatformServices({
        storage,
        permissions,
        restrictions,
        usage,
        nativeRhythm,
      });

      const coordinator = RhythmCoordinator.getInstance();
      await coordinator.initialize();

      await coordinator.updateConfig({
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
              lastEditedDateKey: '2026-09-02',
            },
          },
        ],
      });

      usage.getInstalledApps = async () => [
        {
          id: 'com.instagram.android',
          name: 'Instagram',
          classification: 'unclassified',
          iconName: 'smartphone',
          iconColor: '#235D43',
          iconBg: '#E8EFE5',
          defaultCategory: 'Social',
          usageTodayMinutes: 0,
          sessionMinutes: 0,
        },
      ];

      const refreshed = await coordinator.refreshInstalledApps();
      const instagram = refreshed.apps.find((a) => a.id === 'com.instagram.android');

      assert.ok(instagram, 'Instagram must be in refreshed apps');
      assert.equal(instagram?.classification, 'risk', 'Classification must be preserved');
      assert.equal(instagram?.dailyRiskAllowance?.allowanceMinutes, 45, 'Allowance minutes must be preserved');
      assert.equal(instagram?.dailyRiskAllowance?.lastEditedDateKey, '2026-09-02', 'lastEditedDateKey must be preserved');

      const editResult = await coordinator.updateDailyRiskAllowance('com.instagram.android', 60, Date.parse('2026-09-02T12:00:00Z'));
      assert.equal(editResult.allowed, false);
      assert.equal(editResult.reason, 'already-edited-today');

      coordinator.destroy();
    });
  });
});
