import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  DEFAULT_READING_RECOVERY_TARGET,
  evaluateReentryEligibility,
  generateRecoverySessionId,
  isRecoveryRequiredForCycle,
  NativeRecoveryProviderClient,
  RecoveryProviderClient,
} from '../recovery';
import { startCooldown } from '../cooldowns';
import { computeEffectiveRestrictions } from '../restrictions';
import { normalizePersistedRuntime } from '../types';
import { RiskGroup, DeviceApp } from '../../../types/domain';

describe('Pass 03: Recovery Engine & Re-entry Gate', () => {
  test('DEFAULT_READING_RECOVERY_TARGET matches Pass 03 baseline (30m / 10p)', () => {
    assert.equal(DEFAULT_READING_RECOVERY_TARGET.requiredSeconds, 1800);
    assert.equal(DEFAULT_READING_RECOVERY_TARGET.requiredPages, 10);
  });

  test('generateRecoverySessionId produces valid RFC 4122 v4 UUID format', () => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    for (let i = 0; i < 20; i++) {
      const id = generateRecoverySessionId();
      assert.match(id, uuidRegex, `Generated ID ${id} must be a valid UUID v4`);
    }
  });

  test('isRecoveryRequiredForCycle preserves first free cycle rule', () => {
    // Cycle 1 is free: no recovery required
    assert.equal(isRecoveryRequiredForCycle(0), false);
    assert.equal(isRecoveryRequiredForCycle(1), false);

    // Subsequent cycles require reading recovery
    assert.equal(isRecoveryRequiredForCycle(2), true);
    assert.equal(isRecoveryRequiredForCycle(3), true);
  });

  describe('evaluateReentryEligibility policy evaluation matrix', () => {
    const now = 1000000;
    const cooldownPast = now - 5000;
    const cooldownFuture = now + 60000;

    test('Cycle with recovery NOT required allows re-entry once cooldown elapses', () => {
      // Cooldown still running
      const active = evaluateReentryEligibility({
        now,
        cooldownEndsAt: cooldownFuture,
        recoveryRequired: false,
        readerAvailable: true,
      });
      assert.equal(active.reentryEligible, false);
      assert.equal(active.cooldownElapsed, false);
      assert.equal(active.recoverySatisfied, true);

      // Cooldown elapsed
      const elapsed = evaluateReentryEligibility({
        now,
        cooldownEndsAt: cooldownPast,
        recoveryRequired: false,
        readerAvailable: true,
      });
      assert.equal(elapsed.reentryEligible, true);
      assert.equal(elapsed.cooldownElapsed, true);
      assert.equal(elapsed.recoverySatisfied, true);
    });

    test('Recovery required fails closed when Reader is absent/unavailable', () => {
      const result = evaluateReentryEligibility({
        now,
        cooldownEndsAt: cooldownPast,
        recoveryRequired: true,
        recoveryStatus: 'COMPLETE',
        readerAvailable: false,
      });
      assert.equal(result.reentryEligible, false);
      assert.equal(result.recoverySatisfied, false);
      assert.match(result.reason, /fail-closed/i);
    });

    test('Recovery required blocks re-entry if status is not COMPLETE', () => {
      const nonCompleteStatuses: ('ACTIVE' | 'ABANDONED' | 'EXPIRED' | null | undefined)[] = [
        'ACTIVE',
        'ABANDONED',
        'EXPIRED',
        null,
        undefined,
      ];

      for (const status of nonCompleteStatuses) {
        const result = evaluateReentryEligibility({
          now,
          cooldownEndsAt: cooldownPast,
          recoveryRequired: true,
          recoveryStatus: status,
          readerAvailable: true,
        });
        assert.equal(
          result.reentryEligible,
          false,
          `Status ${status} must not be eligible for re-entry`
        );
        assert.equal(result.recoverySatisfied, false);
        assert.equal(result.cooldownElapsed, true);
      }
    });

    test('Recovery required blocks re-entry if recovery COMPLETE but cooldown still active', () => {
      const result = evaluateReentryEligibility({
        now,
        cooldownEndsAt: cooldownFuture,
        recoveryRequired: true,
        recoveryStatus: 'COMPLETE',
        readerAvailable: true,
      });
      assert.equal(result.reentryEligible, false);
      assert.equal(result.cooldownElapsed, false);
      assert.equal(result.recoverySatisfied, true);
      assert.match(result.reason, /cooldown in progress/i);
    });

    test('Recovery required allows re-entry ONLY when cooldown elapsed AND recovery COMPLETE', () => {
      const result = evaluateReentryEligibility({
        now,
        cooldownEndsAt: cooldownPast,
        recoveryRequired: true,
        recoveryStatus: 'COMPLETE',
        readerAvailable: true,
      });
      assert.equal(result.reentryEligible, true);
      assert.equal(result.cooldownElapsed, true);
      assert.equal(result.recoverySatisfied, true);
      assert.match(result.reason, /Eligible for re-entry/i);
    });
  });

  describe('Cooldown & Restriction state lifecycle', () => {
    const now = 500000;
    const testGroup: RiskGroup = {
      id: 'social',
      name: 'Social',
      description: 'Social apps',
      iconName: 'chat',
      iconColor: '#000',
      iconBg: '#fff',
      appIds: ['com.twitter.android'],
      cooldownMinutes: 30,
      currentSessionMinutes: 0,
    };
    const testApp: DeviceApp = {
      id: 'com.twitter.android',
      name: 'Twitter',
      classification: 'risk',
      riskGroupId: 'social',
      dailyRiskAllowance: { allowanceMinutes: 30 },
      iconName: 'twitter',
      iconColor: '#1DA1F2',
      iconBg: '#E8F5FD',
      defaultCategory: 'Social',
      usageTodayMinutes: 0,
      sessionMinutes: 0,
    };

    test('startCooldown creates cooldown with attached recovery session ID and metadata', () => {
      const sessionId = generateRecoverySessionId();
      const cooldown = startCooldown('social', now, 30, {
        recoverySessionId: sessionId,
        recoveryRequired: true,
        cycleNumber: 2,
      });

      assert.equal(cooldown.groupId, 'social');
      assert.equal(cooldown.startedAt, now);
      assert.equal(cooldown.endsAt, now + 30 * 60 * 1000);
      assert.equal(cooldown.recoverySessionId, sessionId);
      assert.equal(cooldown.recoveryRequired, true);
      assert.equal(cooldown.cycleNumber, 2);
    });

    test('normalizePersistedRuntime preserves recovery session metadata across restart', () => {
      const sessionId = generateRecoverySessionId();
      const rawPersisted = {
        state: 'cooldown',
        activeCooldowns: {
          social: {
            groupId: 'social',
            startedAt: now,
            endsAt: now + 30 * 60 * 1000,
            recoverySessionId: sessionId,
            recoveryRequired: true,
            cycleNumber: 2,
          },
        },
        activeRoutineWindowIds: [],
        lastReconciledAt: now,
      };

      const normalized = normalizePersistedRuntime(rawPersisted);
      assert.ok(normalized);
      const restoredCooldown = normalized.activeCooldowns['social'];
      assert.ok(restoredCooldown);
      assert.equal(restoredCooldown.recoverySessionId, sessionId);
      assert.equal(restoredCooldown.recoveryRequired, true);
      assert.equal(restoredCooldown.cycleNumber, 2);
    });

    test('computeEffectiveRestrictions enforces cooldown while recovery is pending even if timer elapsed', () => {
      const elapsedTimestamp = now + 45 * 60 * 1000;
      const cooldown = startCooldown('social', now, 30, {
        recoveryRequired: true,
      });

      // Cooldown timer is elapsed (30m passed, 45m elapsed), but recovery is NOT satisfied
      const restrictedResult = computeEffectiveRestrictions(
        [],
        [cooldown],
        [testGroup],
        [testApp],
        elapsedTimestamp,
        {},
        {
          groupRecoverySatisfied: { social: false },
        }
      );

      assert.deepEqual(
        restrictedResult.effectiveAppIds,
        ['com.twitter.android'],
        'Apps must remain restricted when recovery is not satisfied'
      );

      // Once recovery is marked satisfied:
      const clearedResult = computeEffectiveRestrictions(
        [],
        [cooldown],
        [testGroup],
        [testApp],
        elapsedTimestamp,
        {},
        {
          groupRecoverySatisfied: { social: true },
        }
      );

      assert.deepEqual(
        clearedResult.effectiveAppIds,
        [],
        'Restrictions must clear when cooldown timer is elapsed AND recovery is satisfied'
      );
    });
  });

  describe('RecoveryProviderClient abstraction', () => {
    test('NativeRecoveryProviderClient safely handles missing native module in test environment', async () => {
      const client: RecoveryProviderClient = new NativeRecoveryProviderClient();

      // In pure Node.js test environment, native bridge gracefully returns false/null without throwing
      const isAvailable = await client.isReaderAvailable();
      assert.equal(typeof isAvailable, 'boolean');

      const status = await client.queryRecoveryStatus('some-session');
      assert.equal(status, null);

      const launched = await client.startRecoverySession({
        sessionId: generateRecoverySessionId(),
        requiredSeconds: 1800,
        requiredPages: 10,
        createdAt: Date.now(),
        expiresAt: Date.now() + 3600_000,
      });
      assert.equal(typeof launched, 'boolean');
    });
  });
});
