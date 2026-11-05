import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { deriveEmergencyAccessPresentation } from '../emergencyAccessPresentation';

describe('F19 — Emergency Access copy is bounded to the lease power', () => {
  test('morning focus remains blocking and no temporary-access/override promise is made', () => {
    const view = deriveEmergencyAccessPresentation({
      morningFocusActive: true,
      durationMinutes: 10,
      groupName: 'Social Feeds',
    });

    assert.equal(view.morningFocusActive, true);
    assert.equal(view.preservesMorningFocus, true);
    assert.match(view.message, /cooldown and reading or meditation task/);
    assert.match(view.message, /Morning focus is still active/);
    assert.match(view.message, /managed apps stay blocked/);
    assert.doesNotMatch(view.message, /temporary access|override|unlock/i);
    assert.match(view.actionLabel, /Request emergency access/);
  });

  test('without morning, copy keeps the group scope and preserves the morning requirement', () => {
    const view = deriveEmergencyAccessPresentation({
      morningFocusActive: false,
      durationMinutes: 10,
      groupName: 'Social Feeds',
    });

    assert.match(view.message, /cooldown and reading or meditation task/);
    assert.match(view.message, /Morning meditation remains required whenever morning focus is active/);
    assert.match(view.message, /Social Feeds/);
    assert.doesNotMatch(view.message, /all apps|unrestricted|Routine windows.*never|CD3|CD4|bound|lease/i);
    assert.equal(view.actionLabel, 'Grant 10-Min Emergency Access');
  });
});
