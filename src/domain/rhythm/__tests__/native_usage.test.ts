import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { NativeUsageProvider } from '../../../platform/native/NativeUsageProvider';

describe('NativeUsageProvider — Cursor Robustness & Deduplication', () => {
  test('processRawUsageEvents eliminates duplicate events at interval boundaries', () => {
    const provider = new NativeUsageProvider();

    const emittedEvents: any[] = [];
    provider.onActivityEvent((e) => {
      emittedEvents.push(e);
    });

    const batch1 = [
      { packageName: 'com.twitter.android', timestamp: 1000, eventType: 'foreground' },
      { packageName: 'com.twitter.android', timestamp: 15000, eventType: 'background' },
    ];

    // First batch query
    const res1 = provider.processRawUsageEvents(batch1);
    assert.equal(res1.length, 2);
    assert.equal(emittedEvents.length, 2);

    // Second batch query contains the boundary event from previous query + new event
    const batch2 = [
      { packageName: 'com.twitter.android', timestamp: 15000, eventType: 'background' }, // Duplicate boundary event
      { packageName: 'com.instagram.android', timestamp: 18000, eventType: 'foreground' }, // Fresh event
    ];

    const res2 = provider.processRawUsageEvents(batch2);
    assert.equal(res2.length, 1);
    assert.equal(res2[0].appId, 'com.instagram.android');
    assert.equal(emittedEvents.length, 3);
  });
});
