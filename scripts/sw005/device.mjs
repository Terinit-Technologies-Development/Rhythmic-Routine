#!/usr/bin/env node
/**
 * SW-2026-005 A4 — default-deny device/probe entry point.
 *
 * Plan is the default and performs NO adb call. Execute requires an exact
 * serial, explicit authorization, disposable/owner-consented classification,
 * expected provider certificate, exact AUT/test package/runner/class and a
 * validated content:// provider URI. Positive and mismatched-signer probes are
 * separate class-filtered runs; the negative run requires a positive baseline.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  assertNonEmptyString,
  buildApksignerVerifyArgs,
  buildInstallPlan,
  buildInstrumentationArgv,
  parseArgv,
  parseProviderAuthorities,
  redactProviderUri,
  resolveDeviceRequest,
  validateCertSha256,
  validateProbeBaseline,
  validateProviderUri,
} from './lib/qa-contract.mjs';
import {
  parseAaptBadging,
  parseApksignerOutput,
  parseInstrumentationOutput,
  statusRow,
} from './lib/apk-inspect.mjs';

const execFileAsync = promisify(execFile);

const ALLOWED = [
  'mode',
  'variant',
  'serial',
  'authorize-device',
  'device-kind',
  'owner-consent-token',
  'adb',
  'sdk',
  'build-tools-version',
  'java',
  'test-apk',
  'aut-package',
  'test-package',
  'runner',
  'test-class',
  'provider-package',
  'provider-uri',
  'provider-columns',
  'expected-cert-sha256',
  'probe-expectation',
  'baseline-evidence',
  'evidence-out',
  'artifacts-dir',
  'verify-apk',
  'help',
];

async function run(command, args, { redact = [] } = {}) {
  try {
    const result = await execFileAsync(command, args, {
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
      timeout: 15 * 60 * 1000,
    });
    return { stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  } catch (error) {
    let message = `Command failed (${error.code ?? 'unknown'}): ${path.basename(command)}\n${String(
      error.stderr || error.stdout
    ).slice(-2000)}`;
    for (const value of redact.filter(Boolean)) message = message.split(value).join('<redacted>');
    throw new Error(message);
  }
}

function toolPaths(settings) {
  if (!settings.sdk || !settings['build-tools-version']) {
    throw new Error('--sdk and --build-tools-version are required for APK preflight');
  }
  const buildTools = path.join(path.resolve(settings.sdk), 'build-tools', settings['build-tools-version']);
  return {
    aapt: path.join(buildTools, process.platform === 'win32' ? 'aapt.exe' : 'aapt'),
    java: settings.java || (process.env.JAVA_HOME
      ? path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
      : 'java'),
    apksignerJar: path.join(buildTools, 'lib', 'apksigner.jar'),
  };
}

function required(settings, name, label) {
  const value = settings[name];
  if (!value) throw new Error(`execute mode requires ${label} (--${name})`);
  return assertNonEmptyString(value, label);
}

async function preflightTestApk(settings, probe) {
  const tools = toolPaths(settings);
  const testApk = path.resolve(probe.testApk);
  for (const [label, file] of [
    ['test APK', testApk],
    ['aapt', tools.aapt],
    ['apksigner.jar', tools.apksignerJar],
  ]) {
    if (!fs.existsSync(file)) throw new Error(`${label} not found: ${file}`);
  }

  const badging = parseAaptBadging((await run(tools.aapt, ['dump', 'badging', testApk])).stdout);
  if (badging.packageName !== probe.testPackage) {
    throw new Error(`Test APK package ${badging.packageName} does not match --test-package ${probe.testPackage}`);
  }
  if (badging.instrumentation?.targetPackage !== probe.autPackage) {
    throw new Error(
      `Test APK targets ${badging.instrumentation?.targetPackage ?? '(none)'}; expected AUT ${probe.autPackage}`
    );
  }

  const signer = parseApksignerOutput(
    (await run(tools.java, ['-jar', tools.apksignerJar, ...buildApksignerVerifyArgs({
      apksignerJar: tools.apksignerJar,
      apk: testApk,
    })])).stdout
  );
  if (!signer.verified || signer.certSha256.length !== 1) {
    throw new Error('Test APK does not verify with exactly one signer');
  }
  if (probe.expectation === 'positive' && signer.certSha256[0] !== probe.expectedSignerSha256) {
    throw new Error('Positive probe test APK is not signed with the expected shared provider key');
  }
  if (probe.expectation === 'mismatch' && signer.certSha256[0] === probe.expectedSignerSha256) {
    throw new Error('Mismatched-signer probe must NOT be signed with the shared provider key');
  }
  return { badging, signerCertSha256: signer.certSha256[0] };
}

async function installedPackages(adb, serial, packageName, redact) {
  const result = await run(adb, ['-s', serial, 'shell', 'pm', 'list', 'packages', packageName], { redact });
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.replace(/^package:/, '').trim())
    .filter(Boolean);
}

async function checkAuthority(adb, serial, provider, redact) {
  const routinePackages = await installedPackages(adb, serial, 'com.terinit.rhythmicroutine', redact);
  const hasQa = routinePackages.includes('com.terinit.rhythmicroutine.qa');
  const hasProduction = routinePackages.includes('com.terinit.rhythmicroutine');
  const providerPackages = await installedPackages(adb, serial, provider.packageName, redact);
  const rows = [
    statusRow(
      'authority-ambiguity',
      hasQa && hasProduction ? 'FAIL' : 'PASS',
      hasQa && hasProduction
        ? 'QA and production Routine coexist; signature authority is ambiguous'
        : 'no QA/production Routine coexistence detected'
    ),
    statusRow(
      'provider-installed',
      providerPackages.includes(provider.packageName) ? 'PASS' : 'FAIL',
      providerPackages.includes(provider.packageName)
        ? `${provider.packageName} installed`
        : `${provider.packageName} is NOT installed`
    ),
  ];

  if (!providerPackages.includes(provider.packageName)) return { ok: false, rows };

  const dumpsys = await run(adb, ['-s', serial, 'shell', 'dumpsys', 'package', provider.packageName], { redact });
  const authorities = parseProviderAuthorities(dumpsys.stdout);
  const authorityOk = authorities.includes(provider.authority);
  rows.push(
    statusRow(
      'provider-authority',
      authorityOk ? 'PASS' : 'FAIL',
      authorityOk
        ? `authority ${provider.authority} declared`
        : `authority ${provider.authority} not found among ${authorities.join(', ') || '(none)'}`
    )
  );
  return { ok: rows.every((row) => row.status === 'PASS'), rows, authorities };
}

function loadBaseline(filePath) {
  const resolved = path.resolve(assertNonEmptyString(filePath, 'baseline evidence path'));
  return JSON.parse(fs.readFileSync(resolved, 'utf8'));
}

function writeEvidence(filePath, evidence) {
  assertNonEmptyString(filePath, 'evidence output path');
  if (!path.isAbsolute(filePath)) throw new Error('evidence output path must be absolute');
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  return resolved;
}

function printPlan(settings, gate, probe) {
  const install = buildInstallPlan({
    variant: settings.variant ?? 'qa',
    adb: settings.adb || 'adb',
    serial: '<authorized-serial>',
    artifactsDir: settings['artifacts-dir'] ? path.resolve(settings['artifacts-dir']) : '<signed-artifacts-dir>',
  });
  const instrumentation = probe
    ? buildInstrumentationArgv({
        adb: settings.adb || 'adb',
        serial: '<authorized-serial>',
        testPackage: probe.testPackage,
        runner: probe.runner,
        testClass: probe.testClass,
        providerUri: probe.providerUri,
        providerPackage: probe.providerPackage,
        requiredColumns: probe.requiredColumns,
      })
    : null;

  process.stdout.write(
    `${JSON.stringify(
      {
        device: {
          requested: Boolean(settings.serial),
          allowed: gate.allowed,
          code: gate.code ?? null,
          alias: gate.deviceAlias ?? null,
          kind: gate.deviceKind ?? null,
          rawSerialIncluded: false,
        },
        probe: probe
          ? {
              expectation: probe.expectation,
              autPackage: probe.autPackage,
              testPackage: probe.testPackage,
              runner: probe.runner,
              testClass: probe.testClass,
              providerPackage: probe.providerPackage,
              providerAuthority: probe.provider.authority,
              providerUriRedacted: redactProviderUri(probe.providerUri),
              providerUriSha256: probe.provider.sha256,
              requiredColumns: probe.requiredColumns,
              expectedSignerSha256: probe.expectedSignerSha256,
            }
          : null,
        guardrails: [
          'Plan mode performs no adb call and does not install, uninstall, grant, downgrade, reset or change settings.',
          'Positive and mismatched-signer probes must run separately with distinct --test-class values.',
          'Mismatched-signer execution requires --baseline-evidence from a passing positive run.',
          'Never install QA and production Routine together on one authority device.',
        ],
        install,
        instrumentation: instrumentation
          ? {
              command: instrumentation.command,
              args: instrumentation.args.map((arg, index) =>
                index === 1 ? '<authorized-serial>' : arg === probe.providerUri ? redactProviderUri(arg) : arg
              ),
              redacted: true,
            }
          : null,
      },
      null,
      2
    )}\n`
  );
}

async function main() {
  const args = parseArgv(process.argv.slice(2), ALLOWED);
  if (args.help) {
    process.stdout.write(
      'Usage: node scripts/sw005/device.mjs --mode plan|execute --variant qa|production ' +
        '--test-apk APK --aut-package PKG --test-package PKG --runner PKG/RUNNER --test-class FQCN ' +
        '--provider-package PKG --provider-uri content://AUTHORITY/... --expected-cert-sha256 HEX ' +
        '[--provider-columns C1,C2] [--probe-expectation positive|mismatch] [--baseline-evidence FILE] ' +
        '[--serial S --authorize-device --device-kind disposable|owner-consented]\n'
    );
    return;
  }

  const mode = args.mode ?? 'plan';
  if (!['plan', 'execute'].includes(mode)) throw new Error(`Unknown device mode: ${mode}`);
  const gate = resolveDeviceRequest({
    mode,
    serial: args.serial,
    authorizeDevice: args['authorize-device'] === true,
    deviceKind: args['device-kind'],
    ownerConsentToken: args['owner-consent-token'],
  });
  const variant = args.variant ?? 'qa';
  if (!['qa', 'production'].includes(variant)) throw new Error(`Unknown variant: ${variant}`);

  let probe = null;
  const hasProbeArgs = ['test-apk', 'aut-package', 'test-package', 'runner', 'test-class', 'provider-package', 'provider-uri'].every(
    (key) => args[key]
  );
  if (hasProbeArgs) {
    const provider = validateProviderUri(required(args, 'provider-uri', 'provider URI'));
    probe = {
      testApk: required(args, 'test-apk', 'test APK'),
      autPackage: required(args, 'aut-package', 'AUT package'),
      testPackage: required(args, 'test-package', 'test package'),
      runner: required(args, 'runner', 'runner component'),
      testClass: required(args, 'test-class', 'test class'),
      providerPackage: required(args, 'provider-package', 'provider package'),
      providerUri: provider.uri,
      provider,
      requiredColumns: args['provider-columns']
        ? String(args['provider-columns']).split(',').map((value) => value.trim()).filter(Boolean)
        : [],
      expectedSignerSha256: args['expected-cert-sha256']
        ? validateCertSha256(args['expected-cert-sha256'], 'expected certificate SHA-256')
        : null,
      expectation: args['probe-expectation'] ?? 'positive',
    };
    if (!['positive', 'mismatch'].includes(probe.expectation)) {
      throw new Error('--probe-expectation must be positive or mismatch');
    }
  }

  if (gate.execute !== true) {
    printPlan(args, gate, probe);
    return;
  }

  if (!probe) throw new Error('execute mode requires the complete probe argument set');
  if (!probe.expectedSignerSha256) {
    throw new Error('execute mode requires --expected-cert-sha256 for the shared provider signer');
  }
  if (probe.expectation === 'mismatch' && !args['baseline-evidence']) {
    throw new Error('mismatched-signer execution requires a passing --baseline-evidence');
  }
  if (probe.expectation === 'mismatch') {
    const baseline = loadBaseline(args['baseline-evidence']);
    validateProbeBaseline(baseline, {
      providerPackage: probe.providerPackage,
      autPackage: probe.autPackage,
      testPackage: probe.testPackage,
      providerUriSha256: probe.provider.sha256,
      expectedSignerSha256: probe.expectedSignerSha256,
    });
  }

  // No adb call happens before this point. Authorization is already resolved.
  const preflight = await preflightTestApk(args, probe);

  const adb = args.adb || 'adb';
  const redact = [gate.serial, probe.providerUri, args['baseline-evidence']].filter(Boolean);
  const authority = await checkAuthority(adb, gate.serial, {
    packageName: probe.providerPackage,
    authority: probe.provider.authority,
  }, redact);
  if (!authority.ok) {
    process.stderr.write(`${JSON.stringify({ authority, status: 'FAIL' }, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }

  const invocation = buildInstrumentationArgv({
    adb,
    serial: gate.serial,
    testPackage: probe.testPackage,
    runner: probe.runner,
    testClass: probe.testClass,
    providerUri: probe.providerUri,
    providerPackage: probe.providerPackage,
    requiredColumns: probe.requiredColumns,
  });
  const result = await run(invocation.command, invocation.args, { redact });
  const parsed = parseInstrumentationOutput(result.stdout);
  if (!parsed.ok) {
    process.stdout.write(`${JSON.stringify({ authority, instrumentation: parsed }, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }

  const evidence = {
    schemaVersion: 1,
    program: 'SW-2026-005',
    generatedAt: new Date().toISOString(),
    status: 'PASS',
    expectation: probe.expectation,
    autPackage: probe.autPackage,
    testPackage: probe.testPackage,
    testClass: probe.testClass,
    runner: probe.runner,
    providerPackage: probe.providerPackage,
    providerAuthority: probe.provider.authority,
    providerUriSha256: probe.provider.sha256,
    expectedSignerSha256: probe.expectedSignerSha256,
    testApkSignerSha256: preflight.signerCertSha256,
    testsRun: parsed.testsRun,
    failures: parsed.failures,
    errors: parsed.errors,
    deviceAlias: gate.deviceAlias,
    deviceSerialSha256: gate.serialSha256,
    rawProviderUriIncluded: false,
    rawSerialIncluded: false,
  };
  if (args['evidence-out']) evidence.evidencePath = writeEvidence(args['evidence-out'], evidence);
  process.stdout.write(`${JSON.stringify({ authority, instrumentation: parsed, evidence }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`[sw005] device fatal: ${error.message}\n`);
  process.exitCode = 1;
});
