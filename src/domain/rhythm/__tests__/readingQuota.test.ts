import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  createDailyAttentionExchangeState,
  deriveAttentionGateStatus,
  requirementForCooldownOrdinal,
} from '../attentionExchange';
import { resolveReadingQuotaView } from '../readingQuota';
import { ReadingEvidenceSnapshot } from '../readingEvidence';

const dateKey = '2026-09-26';

function evidence(seconds: number, pages: number): ReadingEvidenceSnapshot {
  return {
    dateKey,
    providerAvailable: true,
    protocolCompatible: true,
    verifiedActiveSeconds: seconds,
    qualifiedPages: pages,
    readerUpdatedAtEpochMs: 1,
    syncedAtEpochMs: 2,
  };
}

describe('v1.2 reading quota view', () => {
  test('first cooldowns carry no reading quota', () => {
    const view = resolveReadingQuotaView({
      dateKey,
      dailyAttentionExchange: createDailyAttentionExchangeState(dateKey, 1),
    });

    assert.equal(view.nextOrdinal, 1);
    assert.equal(view.nextHasReadingQuota, false);
    assert.deepEqual(
      [view.nextRequiredSeconds, view.nextRequiredPages],
      [requirementForCooldownOrdinal(1).activeSeconds, requirementForCooldownOrdinal(1).qualifiedPages]
    );
    assert.equal(view.activeTarget, undefined);
  });

  test('next ordinal follows the global cooldown count and policy', () => {
    const exchange = createDailyAttentionExchangeState(dateKey, 1);
    exchange.cooldownsTriggered = 3;

    const view = resolveReadingQuotaView({ dateKey, dailyAttentionExchange: exchange });

    assert.equal(view.nextOrdinal, 4);
    assert.equal(view.nextRequiredSeconds, 5400);
    assert.equal(view.nextRequiredPages, 47);
    assert.equal(view.nextHasReadingQuota, true);
  });

  test('stale daily state and stale evidence do not leak into today', () => {
    const exchange = createDailyAttentionExchangeState('2026-09-25', 1);
    exchange.cooldownsTriggered = 5;

    const view = resolveReadingQuotaView({
      dateKey,
      dailyAttentionExchange: exchange,
      evidence: { ...evidence(3600, 36), dateKey: '2026-09-25', verifiedActiveSeconds: 3600 },
    });

    assert.equal(view.cooldownsTriggered, 0);
    assert.equal(view.nextOrdinal, 1);
    assert.equal(view.evidenceAvailable, false);
    assert.equal(view.verifiedSeconds, 0);
    assert.equal(view.qualifiedPages, 0);
  });

  test('verified daily totals are reported only for compatible evidence', () => {
    const view = resolveReadingQuotaView({
      dateKey,
      evidence: evidence(1850, 12),
      dailyAttentionExchange: createDailyAttentionExchangeState(dateKey, 1),
    });

    assert.equal(view.evidenceAvailable, true);
    assert.equal(view.verifiedSeconds, 1850);
    assert.equal(view.qualifiedPages, 12);
  });

  test('active gate exposes required, verified, and remaining quotas', () => {
    const exchange = createDailyAttentionExchangeState(dateKey, 1);
    exchange.cooldownsTriggered = 3;
    const gate = {
      groupId: 'social',
      attentionDateKey: dateKey,
      dailyCooldownOrdinal: 3,
      createdAt: 10,
      cooldownEndsAt: 20,
      requiredReadingSeconds: 3600,
      requiredQualifiedPages: 36,
    };
    const status = deriveAttentionGateStatus({
      groupId: 'social',
      gate,
      evidence: evidence(1200, 11),
      now: 15,
      currentDateKey: dateKey,
    });

    const view = resolveReadingQuotaView({
      dateKey,
      evidence: evidence(1200, 11),
      dailyAttentionExchange: exchange,
      attentionStatus: status,
    });

    assert.equal(view.activeTarget?.ordinal, 3);
    assert.equal(view.activeTarget?.requiredSeconds, 3600);
    assert.equal(view.activeTarget?.verifiedSeconds, 1200);
    assert.equal(view.activeTarget?.remainingSeconds, 2400);
    assert.equal(view.activeTarget?.remainingPages, 25);
  });

  test('ordinal fallback stays conservative when daily state is missing', () => {
    const gate = {
      groupId: 'social',
      attentionDateKey: dateKey,
      dailyCooldownOrdinal: 4,
      createdAt: 10,
      cooldownEndsAt: 20,
      requiredReadingSeconds: 5400,
      requiredQualifiedPages: 47,
    };
    const status = deriveAttentionGateStatus({
      groupId: 'social',
      gate,
      evidence: evidence(0, 0),
      now: 15,
      currentDateKey: dateKey,
    });

    const view = resolveReadingQuotaView({ dateKey, attentionStatus: status });

    assert.equal(view.cooldownsTriggered, 4);
    assert.equal(view.nextOrdinal, 5);
    assert.equal(view.nextRequiredSeconds, 7200);
    assert.equal(view.nextRequiredPages, 58);
    assert.equal(view.activeTarget?.ordinal, 4);
  });
});
