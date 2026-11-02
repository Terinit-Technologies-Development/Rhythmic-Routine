import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

import { buildInstrumentationArgv } from './lib/qa-contract.mjs';

const DEVICE = path.resolve('scripts/sw005/device.mjs');
const CERT = 'a'.repeat(64);
const URI = 'content://com.terinit.rhythmicreader.recovery/sessions/11111111-2222-3333-4444-555555555555';

function run(args) {
  return spawnSync(process.execPath, [DEVICE, ...args], { encoding: 'utf8' });
}

const probeArgs = [
  '--test-apk', path.resolve('fixtures/not-built-androidTest.apk'),
  '--aut-package', 'com.terinit.rhythmicroutine.sw005probe',
  '--test-package', 'com.terinit.rhythmicroutine.sw005probe.test',
  '--runner', 'com.terinit.rhythmicroutine.sw005probe.test/androidx.test.runner.AndroidJUnitRunner',
  '--test-class', 'com.terinit.rhythmicroutine.sw005probe.SharedSignerProbeTest',
  '--provider-package', 'com.terinit.rhythmicreader',
  '--provider-uri', URI,
  '--provider-columns', 'session_id,active_seconds',
  '--expected-cert-sha256', CERT,
];

describe('SW-2026-005 device entry point', () => {
  it('defaults to no-device plan and builds class-filtered argv without package misuse', () => {
    const result = run(['--mode', 'plan', '--variant', 'production', ...probeArgs]);
    assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.device.allowed, false);
    assert.equal(plan.device.rawSerialIncluded, false);
    assert.equal(plan.install.variant, 'production');
    assert.equal(plan.install.apps[0].pkg, 'com.terinit.rhythmicroutine');
    assert.equal(plan.install.apps[0].id, 'routine-production');

    const args = plan.instrumentation.args;
    assert.equal(args[1], '<authorized-serial>');
    assert.ok(args.includes('-e'));
    assert.equal(args[args.indexOf('-e') + 1], 'class');
    assert.equal(args[args.indexOf('-e') + 2], 'com.terinit.rhythmicroutine.sw005probe.SharedSignerProbeTest');
    assert.ok(!args.includes('package'));
    assert.ok(args.includes('providerPackage'));
    assert.ok(args.includes('com.terinit.rhythmicreader'));
    assert.ok(args.includes('providerUri'));
    assert.ok(args.includes('content://com.terinit.rhythmicreader.recovery/sessions/<redacted>'));
    assert.equal(args.at(-1), 'com.terinit.rhythmicroutine.sw005probe.test/androidx.test.runner.AndroidJUnitRunner');
  });

  it('does not authorize execute without the explicit flag and never performs adb work in plan', () => {
    const result = run(['--mode', 'execute', '--serial', 'FIXTURE-SERIAL-123', ...probeArgs]);
    assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.device.allowed, false);
    assert.equal(plan.device.code, 'AUTHORIZATION_REQUIRED');
    assert.ok(!result.stdout.includes('FIXTURE-SERIAL-123'));
    assert.ok(!result.stderr.includes('FIXTURE-SERIAL-123'));
  });

  it('refuses a mismatched-signer run before adb unless a positive baseline exists', () => {
    const result = run([
      '--mode', 'execute',
      '--serial', 'FIXTURE-SERIAL-123',
      '--authorize-device',
      '--device-kind', 'disposable',
      '--probe-expectation', 'mismatch',
      ...probeArgs,
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /baseline-evidence/i);
  });

  it('separates the provider package from the instrumentation target and class filters', () => {
    const invocation = buildInstrumentationArgv({
      adb: 'adb',
      serial: 'SERIAL',
      testPackage: 'com.example.test',
      runner: 'com.example.test/androidx.test.runner.AndroidJUnitRunner',
      testClass: 'com.example.test.ProbeTest',
      providerUri: 'content://com.example.provider/recovery/sessions/abc',
      providerPackage: 'com.example.provider',
      requiredColumns: ['session_id'],
    });
    assert.deepEqual(invocation.args.slice(0, 5), ['-s', 'SERIAL', 'shell', 'am', 'instrument']);
    assert.ok(invocation.args.includes('class'));
    assert.ok(invocation.args.includes('com.example.test.ProbeTest'));
    assert.ok(invocation.args.includes('providerPackage'));
    assert.ok(invocation.args.includes('com.example.provider'));
    assert.ok(!invocation.args.includes('package'));
    assert.ok(invocation.args.includes('requiredColumns'));
    assert.equal(invocation.args.at(-1), 'com.example.test/androidx.test.runner.AndroidJUnitRunner');
  });
});
