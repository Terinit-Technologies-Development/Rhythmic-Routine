import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, test } from 'node:test';
import {
  hasMeditationIdentityMetadata,
  parseMeditationSessionEvidence,
} from '../meditationEvidence';
import {
  createMorningMeditationRequirement,
  isMorningEvidenceForRequirement,
  isMorningMeditationSatisfied,
} from '../morningMeditation';

const numericKeys = new Set([
  'protocolVersion',
  'requiredQualifiedSeconds',
  'completedQualifiedSeconds',
  'completedAtEpochMs',
  'lastUpdatedAtEpochMs',
]);

function fixtureWire(): Record<string, unknown> {
  const file = path.resolve(
    __dirname,
    '../../../../modules/rhythm-device/test-fixtures/meditation-wire-morning-null.txt'
  );
  const wire: Record<string, unknown> = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.includes('=')) continue;
    const separator = line.indexOf('=');
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    wire[key] = value === 'null' ? null : numericKeys.has(key) ? Number(value) : value;
  }
  return wire;
}

const morningWire = fixtureWire();

describe('R17 — native evidence wire identity', () => {
  test('explicit null morning sourceCooldownId survives production JS parsing', () => {
    const evidence = parseMeditationSessionEvidence(morningWire);
    assert.ok(evidence);
    assert.equal(evidence!.sessionKind, 'MORNING_REQUIRED');
    assert.equal(evidence!.sourceCooldownId, null);
    assert.equal(evidence!.sourceRhythmicDayId, 'ad-20260928-0830');
    assert.equal(hasMeditationIdentityMetadata(evidence), true);

    const requirement = createMorningMeditationRequirement('ad-20260928-0830', 1800, 1);
    assert.equal(isMorningMeditationSatisfied({ requirement, evidence }), true);
  });

  test('cooldown identity remains non-null and exact', () => {
    const evidence = parseMeditationSessionEvidence({
      ...morningWire,
      sessionId: 'cooldown-session',
      sessionKind: 'COOLDOWN_RESTORATIVE',
      sourceCooldownId: 'gate-social-o4',
    });
    assert.ok(evidence);
    assert.equal(evidence!.sourceCooldownId, 'gate-social-o4');
    assert.equal(hasMeditationIdentityMetadata(evidence), true);
    const requirement = createMorningMeditationRequirement('ad-20260928-0830', 1800, 1);
    assert.equal(isMorningMeditationSatisfied({ requirement, evidence }), false);
  });

  test('legacy seven-column wire is never upgraded into identity metadata', () => {
    const legacy = {
      sessionId: 'morning-ad-20260928-0830',
      protocolVersion: 1,
      status: 'COMPLETED',
      requiredQualifiedSeconds: 1800,
      completedQualifiedSeconds: 1800,
      completedAtEpochMs: 1790243200000,
      lastUpdatedAtEpochMs: 1790243260000,
    };
    const evidence = parseMeditationSessionEvidence(legacy);
    assert.equal(hasMeditationIdentityMetadata(evidence), false);
    const requirement = createMorningMeditationRequirement('ad-20260928-0830', 1800, 1);
    assert.equal(isMorningMeditationSatisfied({ requirement, evidence }), false);
  });

  test('missing cooldown field is not treated as verified explicit null', () => {
    const requirement = createMorningMeditationRequirement('ad-20260928-0830', 1800, 1);
    const missingCooldown: Record<string, unknown> = { ...morningWire };
    delete missingCooldown.sourceCooldownId;
    const parsed = parseMeditationSessionEvidence(missingCooldown);
    assert.equal(hasMeditationIdentityMetadata(parsed), false);
    assert.equal(isMorningEvidenceForRequirement(requirement, parsed), false);
    assert.equal(isMorningMeditationSatisfied({ requirement, evidence: parsed }), false);

    const forgedIdentity = {
      ...parseMeditationSessionEvidence(morningWire)!,
      sourceCooldownId: undefined,
    };
    assert.equal(isMorningEvidenceForRequirement(requirement, forgedIdentity), false);
  });

  test('wrong or incomplete morning identity cannot satisfy', () => {
    const requirement = createMorningMeditationRequirement('ad-20260928-0830', 1800, 1);
    for (const wire of [
      { ...morningWire, sessionId: 'wrong-session' },
      { ...morningWire, sessionKind: 'COOLDOWN_RESTORATIVE' },
      { ...morningWire, sourceRhythmicDayId: 'ad-20260927-0830' },
      { ...morningWire, sourceCooldownId: 'cd-1' },
      { ...morningWire, completedQualifiedSeconds: 1799 },
      { ...morningWire, status: 'PAUSED' },
      { ...morningWire, requiredQualifiedSeconds: 1200 },
    ]) {
      const evidence = parseMeditationSessionEvidence(wire);
      assert.equal(isMorningMeditationSatisfied({ requirement, evidence }), false);
    }
  });
});
