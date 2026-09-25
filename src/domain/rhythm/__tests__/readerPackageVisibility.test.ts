import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ensureRhythmicReaderPackageVisibility } from '../../../../plugins/withRhythmScreenTime';

describe('Android Reader package visibility config', () => {
  it('adds only the Reader package query and preserves existing query declarations', () => {
    const manifest = {
      manifest: {
        queries: [
          {
            intent: [{ action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }] }],
          },
        ],
      },
    };

    ensureRhythmicReaderPackageVisibility(manifest);
    ensureRhythmicReaderPackageVisibility(manifest);

    assert.deepEqual(manifest.manifest.queries, [
      {
        intent: [{ action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }] }],
        package: [{ $: { 'android:name': 'com.terinit.rhythmicreader' } }],
      },
    ]);
  });

  it('preserves an existing singleton package entry and avoids duplicates', () => {
    const manifest = {
      manifest: {
        queries: {
          package: [{ $: { 'android:name': 'com.example.existing' } }],
        },
      },
    };

    ensureRhythmicReaderPackageVisibility(manifest);
    ensureRhythmicReaderPackageVisibility(manifest);

    assert.deepEqual(manifest.manifest.queries, [{
      package: [
        { $: { 'android:name': 'com.example.existing' } },
        { $: { 'android:name': 'com.terinit.rhythmicreader' } },
      ],
    }]);
  });
});
