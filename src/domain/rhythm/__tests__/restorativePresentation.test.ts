import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  deriveRestorativeCardCopy,
  describeMeditationPath,
  describeReaderPath,
  selectPrimaryRestorativeGate,
} from '../restorativePresentation';
import { deriveRestorativeStatus, type ActiveRestorativeGate, type RestorativeStatusView } from '../restorativeGate';

function gate(
  overrides: Partial<ActiveRestorativeGate> & Pick<ActiveRestorativeGate, 'groupId' | 'createdAt'>
): ActiveRestorativeGate {
  return {
    gateId: `gate-${overrides.groupId}`,
    attentionDayId: 'ad-20261103-0800',
    dailyCooldownOrdinal: 5,
    cooldownEndsAt: overrides.createdAt + 5_400_000,
    requirementKind: 'restorative-choice',
    status: 'pending-selection',
    ...overrides,
  };
}

function view(overrides: Partial<RestorativeStatusView> = {}): RestorativeStatusView {
  return {
    groupId: 'social',
    phase: 'pending-selection',
    requirementKind: 'restorative-choice',
    cooldownRemainingSeconds: 0,
    gateSatisfied: false,
    meditationPathsRemaining: 2,
    ...overrides,
  };
}

describe('FR14/FR15 — restorative UI copy stays separate and honest', () => {
  test('cooldown timer and selected obligation are both visible, with remaining evidence', () => {
    const copy = deriveRestorativeCardCopy(
      view({
        phase: 'reader-in-progress',
        selectedProvider: 'reader',
        cooldownRemainingSeconds: 1_800,
        obligation: {
          kind: 'reader-recovery-session',
          provider: 'reader',
          requiredSeconds: 1_800,
          requiredQualifiedPages: 11,
          verifiedSeconds: 600,
          verifiedQualifiedPages: 4,
        },
      })
    );

    assert.match(copy.statusLabel, /Reader in progress · cooldown active/);
    assert.equal(copy.showChoice, false);
    assert.equal(copy.showSelectedObligation, true);
    assert.match(copy.progressLabel, /20 min 00 sec active reading/);
    assert.match(copy.progressLabel, /7 qualified pages remaining/);
    assert.match(copy.cooldownLabel, /Cooldown 30 min 00 sec remaining/);
    assert.match(copy.nextAction, /cooldown timer continues independently/);
  });

  test('complete evidence while the timer is active does not hide the cooldown', () => {
    const copy = deriveRestorativeCardCopy(
      view({
        phase: 'restorative-complete-cooldown-active',
        gateSatisfied: true,
        selectedProvider: 'meditation',
        cooldownRemainingSeconds: 600,
        obligation: {
          kind: 'meditation-session',
          provider: 'meditation',
          requiredSeconds: 1_800,
          verifiedSeconds: 1_800,
        },
      })
    );

    assert.match(copy.statusLabel, /Restorative complete · cooldown active/);
    assert.match(copy.cooldownLabel, /Cooldown 10 min 00 sec remaining/);
    assert.match(copy.nextAction, /Wait for the separate cooldown timer/);
  });

  test('cooldown elapsed with an unfinished obligation is not labelled complete', () => {
    const copy = deriveRestorativeCardCopy(
      view({
        phase: 'meditation-in-progress',
        selectedProvider: 'meditation',
        cooldownRemainingSeconds: 0,
        obligation: {
          kind: 'meditation-session',
          provider: 'meditation',
          requiredSeconds: 1_800,
          verifiedSeconds: 300,
        },
      })
    );

    assert.match(copy.statusLabel, /cooldown elapsed, obligation pending/);
    assert.match(copy.cooldownLabel, /Cooldown elapsed · obligation pending/);
    assert.match(copy.nextAction, /Finish the selected session/);
    assert.doesNotMatch(copy.statusLabel, /^Restorative complete/);
  });

  test('an actual carried gate keeps a plain carried label without an internal id', () => {
    const now = 1_700_000_000_000;
    const gate: ActiveRestorativeGate = {
      gateId: 'gate-internal-only',
      groupId: 'social',
      attentionDayId: 'ad-20261031-0830',
      dailyCooldownOrdinal: 4,
      createdAt: now - 3_600_000,
      cooldownEndsAt: now + 600_000,
      requirementKind: 'restorative-choice',
      selectedProvider: 'meditation',
      providerSessionId: 'opaque-session-id',
      status: 'in-progress',
      requiredMeditationSeconds: 1_800,
      requiredRestorativeReadingSeconds: 1_800,
      requiredRestorativeQualifiedPages: 11,
    };
    const status = deriveRestorativeStatus({
      groupId: 'social',
      gate,
      cooldownEndsAt: gate.cooldownEndsAt,
      now,
      attentionDayId: 'ad-20261101-0830',
      currentDateKey: '2026-11-01',
      acceptedEvidenceDateKeys: ['2026-11-01', '2026-10-31'],
      meditationSubstitutionsUsed: 0,
      meditationEvidence: {
        sessionId: 'opaque-session-id',
        protocolVersion: 1,
        status: 'ACTIVE',
        requiredQualifiedSeconds: 1_800,
        completedQualifiedSeconds: 300,
        completedAtEpochMs: null,
        lastUpdatedAtEpochMs: now,
        sessionKind: 'COOLDOWN_RESTORATIVE',
        sourceCooldownId: 'gate-internal-only',
        sourceRhythmicDayId: 'ad-20261031-0830',
      },
    });
    const copy = deriveRestorativeCardCopy(status);

    assert.equal(status.carriedObligation, true);
    assert.equal(status.providerSwitchAllowed, false);
    assert.equal(copy.showChoice, false);
    assert.match(copy.carriedLabel ?? '', /^Carried obligation/);
    assert.match(copy.carriedLabel ?? '', /not new debt today/);
    assert.doesNotMatch(copy.carriedLabel ?? '', /gate-internal-only|opaque-session-id|ad-20261031/);
    assert.match(copy.statusLabel, /cooldown active/);
  });

  test('a selected provider stays switchable before verified progress', () => {
    const now = 1_700_000_000_000;
    const gate: ActiveRestorativeGate = {
      gateId: 'gate-switchable',
      groupId: 'social',
      attentionDayId: 'ad-20261101-0830',
      dailyCooldownOrdinal: 4,
      createdAt: now - 60_000,
      cooldownEndsAt: now + 600_000,
      requirementKind: 'restorative-choice',
      selectedProvider: 'meditation',
      providerSessionId: 'opaque-switchable-session',
      status: 'in-progress',
      providerLocked: false,
      requiredMeditationSeconds: 1_800,
      requiredRestorativeReadingSeconds: 1_800,
      requiredRestorativeQualifiedPages: 11,
    };
    const status = deriveRestorativeStatus({
      groupId: 'social',
      gate,
      cooldownEndsAt: gate.cooldownEndsAt,
      now,
      attentionDayId: gate.attentionDayId,
      currentDateKey: '2026-11-01',
      acceptedEvidenceDateKeys: ['2026-11-01'],
      meditationSubstitutionsUsed: 0,
      meditationEvidence: null,
    });
    const copy = deriveRestorativeCardCopy(status);

    assert.equal(status.providerSwitchAllowed, true);
    assert.equal(copy.providerSwitchAllowed, true);
    assert.equal(copy.showChoice, true);
    assert.equal(copy.meditationPath.selectable, true);
    assert.equal(copy.readerPath.selectable, true);
    assert.match(copy.nextAction, /switch to the other path/);
  });

  test('provider errors are not mislabelled disconnected or complete', () => {
    const pending = view();
    const notInstalled = describeMeditationPath(pending, { availability: 'not-installed' });
    const unknown = describeMeditationPath(pending, { queryStatus: 'query-failed' });
    const untrusted = describeMeditationPath(pending, { availability: 'untrusted-signature' });
    const availableNoSession = describeMeditationPath(pending, { availability: 'available' });
    const reader = describeReaderPath(pending);
    const readerDenied = describeReaderPath(pending, { availability: 'permission-denied' });
    const readerMissing = describeReaderPath(pending, { queryStatus: 'session-missing' });
    const readerUnknown = describeReaderPath(pending, { queryStatus: 'query-failed' });
    const readerCard = deriveRestorativeCardCopy(pending, undefined, {
      availability: 'untrusted-signature',
    });

    assert.equal(notInstalled.selectable, false);
    assert.match(notInstalled.label, /Not installed/);
    assert.doesNotMatch(notInstalled.label, /disconnected|complete/i);
    assert.match(untrusted.label, /Signature not trusted/);
    assert.match(availableNoSession.label, /Available — no session yet/);
    assert.match(unknown.label, /Check connection/);
    assert.equal(unknown.selectable, true);
    assert.doesNotMatch(unknown.label, /Reader.*available/i);
    assert.match(reader.label, /Not yet started/);
    assert.doesNotMatch(reader.label, /unavailable|disconnected/i);
    assert.match(readerDenied.label, /Permission denied/);
    assert.equal(readerDenied.selectable, false);
    assert.match(readerMissing.label, /Session not found/);
    assert.equal(readerMissing.selectable, true);
    assert.match(readerUnknown.label, /Check connection/);
    assert.match(readerCard.readerPath.label, /Signature not trusted/);
    assert.doesNotMatch(readerDenied.label, /disconnected|complete/i);
  });
});

describe('C3 — multi-group restorative presentation selection', () => {
  // Native allocated ordinals 5/6/7 for different groups at the same instant.
  const sameAllocationAt = 1_760_000_000_000;

  test('a completed gate never masks same-timestamp pending obligations', () => {
    const primary = selectPrimaryRestorativeGate([
      gate({
        groupId: 'sw005-qa-cycle-1',
        createdAt: sameAllocationAt,
        dailyCooldownOrdinal: 5,
        status: 'satisfied',
        selectedProvider: 'meditation',
        satisfiedAt: sameAllocationAt + 1_800_000,
      }),
      gate({
        groupId: 'sw005-qa-cycle-2',
        createdAt: sameAllocationAt,
        dailyCooldownOrdinal: 6,
      }),
      gate({
        groupId: 'sw005-qa-cycle-4',
        createdAt: sameAllocationAt,
        dailyCooldownOrdinal: 7,
      }),
    ]);

    assert.equal(primary?.groupId, 'sw005-qa-cycle-2');
    assert.equal(primary?.status, 'pending-selection');
  });

  test('the next pending obligation becomes primary after the first completes', () => {
    const primary = selectPrimaryRestorativeGate([
      gate({
        groupId: 'sw005-qa-cycle-1',
        createdAt: sameAllocationAt,
        dailyCooldownOrdinal: 5,
        status: 'satisfied',
        selectedProvider: 'meditation',
      }),
      gate({
        groupId: 'sw005-qa-cycle-2',
        createdAt: sameAllocationAt,
        dailyCooldownOrdinal: 6,
        status: 'satisfied',
        selectedProvider: 'meditation',
      }),
      gate({
        groupId: 'sw005-qa-cycle-4',
        createdAt: sameAllocationAt,
        dailyCooldownOrdinal: 7,
      }),
    ]);

    assert.equal(primary?.groupId, 'sw005-qa-cycle-4');
  });

  test('recency is preserved inside a class and ties stay deterministic', () => {
    const olderPending = gate({ groupId: 'sw005-qa-cycle-2', createdAt: sameAllocationAt });
    const newerPending = gate({ groupId: 'sw005-qa-cycle-4', createdAt: sameAllocationAt + 1 });

    assert.equal(selectPrimaryRestorativeGate([olderPending, newerPending])?.groupId, 'sw005-qa-cycle-4');
    assert.equal(selectPrimaryRestorativeGate([newerPending, olderPending])?.groupId, 'sw005-qa-cycle-4');

    const tiedB = gate({ groupId: 'b-group', createdAt: sameAllocationAt });
    const tiedA = gate({ groupId: 'a-group', createdAt: sameAllocationAt });
    assert.equal(selectPrimaryRestorativeGate([tiedB, tiedA])?.groupId, 'a-group');
    assert.equal(selectPrimaryRestorativeGate([tiedA, tiedB])?.groupId, 'a-group');
  });

  test('completed gates are only a fallback when no unfinished gate remains', () => {
    const olderComplete = gate({
      groupId: 'sw005-qa-cycle-1',
      createdAt: sameAllocationAt,
      status: 'satisfied',
      selectedProvider: 'meditation',
    });
    const newerComplete = gate({
      groupId: 'sw005-qa-cycle-2',
      createdAt: sameAllocationAt + 1,
      status: 'satisfied',
      selectedProvider: 'reader',
    });

    assert.equal(selectPrimaryRestorativeGate([olderComplete, newerComplete])?.groupId, 'sw005-qa-cycle-2');
    assert.equal(selectPrimaryRestorativeGate([]), undefined);
  });
});
