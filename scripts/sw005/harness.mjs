#!/usr/bin/env node
/**
 * SW-2026-005 A4 shared-signer QA harness.
 *
 * Modes:
 *   plan     Validate paths/toolchain/signing/repos and print the plan. No writes.
 *   prepare  Generate the Routine Android project via Expo prebuild (no --clean).
 *   build    Build routine/reader/meditation serially, zipalign, sign with the
 *            shared QA key, verify every APK, and write the provenance manifest.
 *
 * This CLI never installs anything and never selects a device. Device actions
 * live in scripts/sw005/device.mjs behind an explicit default-deny gate.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';

import {
  APP_PROFILES,
  PROTOCOLS,
  PROGRAM_ID,
  assertAbsolutePath,
  assertNonEmptyString,
  buildApksignerSignArgs,
  buildApksignerVerifyArgs,
  buildGradleInvocation,
  buildZipalignArgs,
  checkManifestProvenance,
  evaluateMemoryPreflight,
  hydrateManifest,
  isPathInside,
  parseArgv,
  validateCertSha256,
  validateKeystorePlacement,
  validatePasswordEnvName,
  validatePinnedSha,
  validateRepoState,
} from './lib/qa-contract.mjs';
import {
  evaluateArtifact,
  parseAaptBadging,
  parseAaptXmltreeInstrumentation,
  parseApksignerOutput,
  readZipEntries,
  summarizeApkEntries,
} from './lib/apk-inspect.mjs';
import { summarizeDex } from './lib/dex-inspect.mjs';
import { applyArtifactOverrides, planAppBuild } from './lib/project-layout.mjs';

const execFileAsync = promisify(execFile);

const ALLOWED_ARGS = [
  'mode',
  'config',
  'routine-root',
  'reader-root',
  'meditation-root',
  'routine-sha',
  'reader-sha',
  'meditation-sha',
  'apps',
  'gradle-home',
  'gradle-launcher-jar',
  'jdk-home',
  'sdk',
  'gradle-user-home',
  'build-tools-version',
  'max-heap-mb',
  'architectures',
  'keystore',
  'key-alias',
  'ks-pass-env',
  'key-pass-env',
  'expected-cert-sha256',
  'routine-version-code',
  'output-dir',
  'manifest',
  'allow-low-memory',
  'emulator-running',
  'strict',
  'json',
  'help',
];

function sha256File(filePath) {
  const hash = createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function loadConfig(configPath) {
  if (!configPath) return {};
  const resolved = path.resolve(configPath);
  const parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Harness config must be a JSON object');
  }
  return parsed;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function resolveSettings(args) {
  const config = loadConfig(args.config);
  const env = process.env;

  const roots = {
    routine: firstDefined(
      args['routine-root'],
      config.routineRoot,
      env.SW005_ROUTINE_ROOT,
      process.cwd()
    ),
    reader: firstDefined(args['reader-root'], config.readerRoot, env.SW005_READER_ROOT),
    meditation: firstDefined(args['meditation-root'], config.meditationRoot, env.SW005_MEDITATION_ROOT),
  };

  const shas = {
    routine: firstDefined(args['routine-sha'], config.routineSha, env.SW005_ROUTINE_SHA),
    reader: firstDefined(args['reader-sha'], config.readerSha, env.SW005_READER_SHA),
    meditation: firstDefined(args['meditation-sha'], config.meditationSha, env.SW005_MEDITATION_SHA),
  };

  const apps = String(firstDefined(args.apps, config.apps?.join(','), 'routine,reader,meditation'))
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  for (const app of apps) {
    if (!['routine', 'reader', 'meditation'].includes(app)) {
      throw new Error(`Unknown app in --apps: ${app}`);
    }
  }

  const signingConfig = config.signing ?? {};
  const settings = {
    mode: args.mode ?? 'plan',
    apps,
    roots,
    shas,
    androidSdk: firstDefined(args.sdk, config.androidSdk, env.ANDROID_SDK_ROOT, env.ANDROID_HOME),
    gradleHome: firstDefined(args['gradle-home'], config.gradleHome, env.SW005_GRADLE_HOME),
    gradleLauncherJar: firstDefined(args['gradle-launcher-jar'], config.gradleLauncherJar),
    jdkHome: firstDefined(args['jdk-home'], config.jdkHome, env.JAVA_HOME),
    gradleUserHome: firstDefined(args['gradle-user-home'], config.gradleUserHome, env.SW005_GRADLE_USER_HOME),
    buildToolsVersion: firstDefined(
      args['build-tools-version'],
      config.buildToolsVersion,
      env.SW005_BUILD_TOOLS_VERSION
    ),
    maxHeapMb: Number(firstDefined(args['max-heap-mb'], config.maxHeapMb, 1024)),
    architectures: String(firstDefined(args.architectures, config.architectures?.join(','), 'arm64-v8a'))
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    signing: {
      keystore: firstDefined(args.keystore, signingConfig.keystore, env.SW005_KEYSTORE),
      keyAlias: firstDefined(args['key-alias'], signingConfig.keyAlias, env.SW005_KEY_ALIAS),
      keystorePassEnv: firstDefined(
        args['ks-pass-env'],
        signingConfig.keystorePassEnv,
        'SW005_KS_PASS'
      ),
      keyPassEnv: firstDefined(args['key-pass-env'], signingConfig.keyPassEnv, 'SW005_KEY_PASS'),
      expectedCertSha256: firstDefined(
        args['expected-cert-sha256'],
        signingConfig.expectedCertSha256,
        env.SW005_EXPECTED_CERT_SHA256
      ),
    },
    outputDir: firstDefined(args['output-dir'], config.outputDir, env.SW005_SIGNED_APK_DIR),
    manifestPath: firstDefined(args.manifest, config.manifestPath, env.SW005_MANIFEST),
    routineVersionCode: Number(
      firstDefined(args['routine-version-code'], config.routineVersionCode, env.SW005_ROUTINE_VERSION_CODE)
    ),
    allowLowMemory: args['allow-low-memory'] === true,
    emulatorRunning: args['emulator-running'] === true,
    strict: args.strict === true,
    json: args.json === true,
    configArtifacts: config.artifacts ?? {},
    configLayouts: config.layouts ?? {},
  };
  return settings;
}

function resolveToolchain(settings) {
  const blockers = [];
  const toolchain = {};

  try {
    toolchain.androidSdk = assertAbsolutePath(settings.androidSdk, 'Android SDK');
    if (!fs.existsSync(toolchain.androidSdk)) blockers.push(`Android SDK does not exist: ${toolchain.androidSdk}`);
  } catch (error) {
    blockers.push(error.message);
  }

  if (toolchain.androidSdk && fs.existsSync(toolchain.androidSdk)) {
    const buildToolsRoot = path.join(toolchain.androidSdk, 'build-tools');
    let version = settings.buildToolsVersion;
    if (!version) {
      blockers.push('build-tools version must be pinned explicitly (--build-tools-version)');
    } else {
      const buildToolsDir = path.join(buildToolsRoot, version);
      const aapt = path.join(buildToolsDir, process.platform === 'win32' ? 'aapt.exe' : 'aapt');
      const zipalign = path.join(buildToolsDir, process.platform === 'win32' ? 'zipalign.exe' : 'zipalign');
      const apksignerJar = path.join(buildToolsDir, 'lib', 'apksigner.jar');
      toolchain.buildToolsVersion = version;
      toolchain.buildToolsDir = buildToolsDir;
      toolchain.aapt = aapt;
      toolchain.zipalign = zipalign;
      toolchain.apksignerJar = apksignerJar;
      for (const [label, file] of [
        ['aapt', aapt],
        ['zipalign', zipalign],
        ['apksigner.jar', apksignerJar],
      ]) {
        if (!fs.existsSync(file)) blockers.push(`${label} is missing from build-tools ${version}: ${file}`);
      }
    }
  }

  try {
    if (settings.jdkHome) {
      const javaExe = path.join(settings.jdkHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
      if (!fs.existsSync(javaExe)) throw new Error(`Java executable not found: ${javaExe}`);
      toolchain.javaExe = javaExe;
    } else {
      toolchain.javaExe = process.platform === 'win32' ? 'java.exe' : 'java';
    }
  } catch (error) {
    blockers.push(error.message);
  }

  try {
    const launcher =
      settings.gradleLauncherJar ??
      (settings.gradleHome
        ? path.join(settings.gradleHome, 'lib', 'gradle-gradle-cli-main-9.3.1.jar')
        : null);
    if (!launcher) {
      blockers.push('Gradle 9.3 launcher jar not supplied (--gradle-launcher-jar or --gradle-home)');
    } else {
      toolchain.gradleLauncherJar = assertAbsolutePath(launcher, 'Gradle launcher jar');
      if (!fs.existsSync(toolchain.gradleLauncherJar)) {
        blockers.push(`Gradle launcher jar does not exist: ${toolchain.gradleLauncherJar}`);
      }
    }
  } catch (error) {
    blockers.push(error.message);
  }

  if (settings.gradleUserHome) {
    try {
      toolchain.gradleUserHome = assertAbsolutePath(settings.gradleUserHome, 'isolated Gradle user home');
    } catch (error) {
      blockers.push(error.message);
    }
  }

  return { toolchain, blockers };
}

function validateSigning(settings, repoRoots, requireSecrets) {
  const blockers = [];
  const signing = {};
  const env = process.env;

  try {
    signing.keystore = validateKeystorePlacement(settings.signing.keystore, repoRoots);
    if (!fs.existsSync(signing.keystore)) {
      blockers.push(`Keystore does not exist: ${signing.keystore}`);
    } else {
      const realKeystore = fs.realpathSync(signing.keystore);
      const realRoots = repoRoots.map((root) => {
        try {
          return fs.realpathSync(root);
        } catch {
          return root;
        }
      });
      validateKeystorePlacement(realKeystore, realRoots);
    }
  } catch (error) {
    blockers.push(error.message);
  }

  try {
    signing.keyAlias = assertNonEmptyString(settings.signing.keyAlias, 'key alias');
  } catch (error) {
    blockers.push(error.message);
  }

  try {
    signing.keystorePassEnv = validatePasswordEnvName(settings.signing.keystorePassEnv, 'keystore password env');
    signing.keyPassEnv = validatePasswordEnvName(settings.signing.keyPassEnv, 'key password env');
    if (requireSecrets && !env[signing.keystorePassEnv]) {
      blockers.push(`Environment variable ${signing.keystorePassEnv} is not set`);
    }
    if (requireSecrets && !env[signing.keyPassEnv]) {
      blockers.push(`Environment variable ${signing.keyPassEnv} is not set`);
    }
  } catch (error) {
    blockers.push(error.message);
  }

  try {
    signing.expectedCertSha256 = validateCertSha256(
      settings.signing.expectedCertSha256,
      'expected certificate SHA-256'
    );
  } catch (error) {
    blockers.push(error.message);
  }

  return { signing, blockers };
}

function repoRoots(settings) {
  return settings.apps
    .map((app) => settings.roots[app])
    .filter(Boolean)
    .map((root) => path.resolve(root));
}

async function run(command, args, options = {}) {
  try {
    const result = await execFileAsync(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
      timeout: options.timeoutMs ?? 45 * 60 * 1000,
    });
    return { code: 0, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  } catch (error) {
    const stdout = error.stdout ?? '';
    const stderr = error.stderr ?? '';
    throw new Error(
      `Command failed (${error.code ?? 'unknown'}): ${command} ${args.join(' ')}\n${String(stderr || stdout).slice(-4000)}`
    );
  }
}

async function readRepoState(settings, app) {
  const root = path.resolve(settings.roots[app]);
  if (!fs.existsSync(root)) {
    return { ok: false, rows: [{ id: `${app}-root`, status: 'FAIL', detail: `repository root missing: ${root}` }] };
  }
  if (!fs.existsSync(path.join(root, '.git'))) {
    return { ok: false, rows: [{ id: `${app}-git`, status: 'FAIL', detail: `not a git checkout: ${root}` }] };
  }
  const headResult = await run('git', ['-C', root, 'rev-parse', 'HEAD']);
  const statusResult = await run('git', ['-C', root, 'status', '--porcelain=v1']);
  return {
    root,
    head: headResult.stdout.trim(),
    status: statusResult.stdout,
    rows: validateRepoState({
      id: app,
      pinnedSha: settings.shas[app],
      head: headResult.stdout.trim(),
      statusPorcelain: statusResult.stdout,
    }).rows,
  };
}

function appBuildPlan(settings, app) {
  const plan = planAppBuild(app, {
    root: settings.roots[app],
    layoutOverrides: settings.configLayouts[app] ?? {},
    routineVersionCode: settings.routineVersionCode,
    architectures: settings.architectures,
  });
  return applyArtifactOverrides(plan, settings.configArtifacts[app] ?? []);
}

async function collectFacts(artifactPath, spec, tools) {
  const exists = fs.existsSync(artifactPath);
  const facts = {
    exists,
    sizeBytes: exists ? fs.statSync(artifactPath).size : 0,
    aaptAvailable: Boolean(tools.aapt && fs.existsSync(tools.aapt)),
    aaptVersion: tools.buildToolsVersion,
    apksignerAvailable: Boolean(tools.apksignerJar && fs.existsSync(tools.apksignerJar)),
  };
  if (!exists) return facts;

  try {
    const buffer = fs.readFileSync(artifactPath);
    const entries = readZipEntries(buffer);
    facts.packaging = summarizeApkEntries(entries);
    if (spec.requireDexModule) facts.dex = summarizeDex(buffer, entries);
  } catch (error) {
    facts.entriesError = error.message;
  }

  if (facts.aaptAvailable) {
    try {
      const result = await run(tools.aapt, ['dump', 'badging', artifactPath]);
      facts.badging = parseAaptBadging(result.stdout);
    } catch (error) {
      facts.badgingError = error.message;
    }

    if (spec.role === 'test') {
      // Current SDK badging omits instrumentation element data. The binary
      // manifest is authoritative when it is available.
      facts.manifestInstrumentationChecked = true;
      try {
        const result = await run(tools.aapt, ['dump', 'xmltree', artifactPath, 'AndroidManifest.xml']);
        facts.manifestInstrumentation = parseAaptXmltreeInstrumentation(result.stdout);
      } catch (error) {
        facts.manifestInstrumentation = null;
        facts.manifestInstrumentationError = error.message;
      }
    }
  }

  if (facts.apksignerAvailable) {
    try {
      const result = await run(tools.javaExe, [
        '-jar',
        tools.apksignerJar,
        ...buildApksignerVerifyArgs({ apksignerJar: tools.apksignerJar, apk: artifactPath }),
      ]);
      facts.signer = parseApksignerOutput(result.stdout);
    } catch (error) {
      facts.signerError = error.message;
    }
  }
  return facts;
}

async function verifyAndRecord(artifactPath, spec, tools) {
  const normalised = {
    ...spec,
    minSizeBytes: spec.minSizeBytes ?? Math.round((spec.minSizeMb ?? 1) * 1024 * 1024),
  };
  const facts = await collectFacts(artifactPath, normalised, tools);
  const evaluation = evaluateArtifact(normalised, facts);
  return { facts, ...evaluation };
}

async function runBuild(settings, resolved) {
  const { toolchain, signing, repoStates } = resolved;
  const outputDir = assertAbsolutePath(settings.outputDir, 'signed APK output dir');
  if (!settings.manifestPath) throw new Error('--manifest is required in build mode');
  const manifestPath = assertAbsolutePath(settings.manifestPath, 'manifest path');
  for (const root of repoRoots(settings)) {
    if (isPathInside(outputDir, root)) throw new Error('Signed APK output must be outside every repository');
    if (isPathInside(manifestPath, root)) throw new Error('Manifest must be outside every repository');
  }
  fs.mkdirSync(path.join(outputDir, 'logs'), { recursive: true });

  const builtArtifacts = [];
  const commands = [];
  const buildEnv = { ...process.env };
  delete buildEnv[signing.keystorePassEnv];
  delete buildEnv[signing.keyPassEnv];
  for (const app of settings.apps) {
    const root = repoStates[app].root;
    const appPlan = appBuildPlan(settings, app);
    const projectDir = appPlan.projectDir;
    if (!fs.existsSync(projectDir)) {
      throw new Error(
        `${app} native project missing at ${projectDir}; expected layout projectSubdir="${appPlan.layout.projectSubdir}". ` +
          `Routine must be prepared; Reader/Meditation Gradle projects are expected at repository root.`
      );
    }
    const specs = appPlan.artifacts;
    const tasks = appPlan.tasks;

    for (const task of tasks) {
      const probe = buildGradleInvocation({
        javaExe: toolchain.javaExe,
        launcherJar: toolchain.gradleLauncherJar,
        projectDir,
        task: 'help',
        gradleUserHome: toolchain.gradleUserHome,
        maxHeapMb: settings.maxHeapMb,
        maxWorkers: 1,
        architectures: settings.architectures,
        extraArgs: ['--task', task],
      });
      try {
        await run(probe.command, probe.args, {
          cwd: root,
          env: buildEnv,
          timeoutMs: 10 * 60 * 1000,
        });
      } catch {
        throw new Error(
          `${app} Gradle task "${task}" is not available. Do not assume it from a buildType string. ` +
            `Configure an explicit testBuildType/Runner via an allocated production patch or a test-only external init/scratch harness.`
        );
      }
    }

    const invocation = buildGradleInvocation({
      javaExe: toolchain.javaExe,
      launcherJar: toolchain.gradleLauncherJar,
      projectDir,
      task: tasks[0],
      gradleUserHome: toolchain.gradleUserHome,
      maxHeapMb: settings.maxHeapMb,
      maxWorkers: 1,
      architectures: settings.architectures,
      extraArgs: tasks.slice(1),
    });

    process.stderr.write(`[sw005] building ${app} serially: ${tasks.join(' ')}\n`);
    const result = await run(invocation.command, invocation.args, {
      cwd: root,
      env: buildEnv,
      timeoutMs: 120 * 60 * 1000,
    });
    commands.push({ id: `${app}-gradle`, command: invocation.command, args: invocation.args });
    fs.writeFileSync(
      path.join(outputDir, 'logs', `${app}-gradle.log`),
      `${JSON.stringify({ command: invocation.command, args: invocation.args })}\n${result.stdout}\n${result.stderr}`,
      'utf8'
    );

    for (const spec of specs) {
      const apkPath = spec.apkPath ?? path.resolve(root, spec.apkRelative);
      if (!fs.existsSync(apkPath)) throw new Error(`Expected ${spec.id} APK missing: ${apkPath}`);
      builtArtifacts.push({ spec, apkPath, root });
    }
  }

  const signedArtifacts = [];
  for (const built of builtArtifacts) {
    const { spec, apkPath } = built;
    const originalSha = sha256File(apkPath);
    const aligned = path.join(outputDir, `${spec.id}.aligned.apk`);
    const signed = path.join(outputDir, `${spec.id}.signed.apk`);

    await run(toolchain.zipalign, buildZipalignArgs({ inputApk: apkPath, outputApk: aligned }));
    const signArgs = buildApksignerSignArgs({
      apksignerJar: toolchain.apksignerJar,
      keystore: signing.keystore,
      keyAlias: signing.keyAlias,
      keystorePassEnv: signing.keystorePassEnv,
      keyPassEnv: signing.keyPassEnv,
      inputApk: aligned,
      outputApk: signed,
    });
    // Password values stay in the child environment; only env:NAME references are in argv.
    await run(toolchain.javaExe, ['-jar', toolchain.apksignerJar, ...signArgs]);

    const verification = await verifyAndRecord(
      signed,
      { ...spec, expectedSignerSha256: signing.expectedCertSha256, requireExpectedSigner: true },
      toolchain
    );
    if (!verification.ok) {
      const failures = verification.rows.filter((row) => row.status === 'FAIL');
      throw new Error(`${spec.id} verification failed: ${failures.map((row) => `${row.id}: ${row.detail}`).join('; ')}`);
    }
    const failedFingerprint = verification.rows.find(
      (row) => row.id === 'signer-fingerprint' && row.status !== 'PASS'
    );
    if (failedFingerprint) throw new Error(`${spec.id} signer fingerprint mismatch`);

    signedArtifacts.push({
      spec,
      signedPath: signed,
      originalSha,
      finalSha: sha256File(signed),
      facts: verification.facts,
      checks: verification.rows,
    });
  }

  const signerSet = new Set(
    signedArtifacts.map((artifact) => artifact.facts.signer?.certSha256?.[0] ?? '(missing)')
  );
  if (signerSet.size !== 1) throw new Error('Signed artifacts do not share exactly one certificate');

  const repoRecords = settings.apps.map((app) => {
    const state = repoStates[app];
    const aut = signedArtifacts.find((artifact) => artifact.spec.app === app && artifact.spec.role === 'aut');
    return {
      id: app,
      sourceSha: state.head,
      dirty: false,
      branch: null,
      variant: aut?.spec.variant ?? null,
      applicationId: aut?.facts.badging?.packageName ?? APP_PROFILES[app].qa.applicationId,
      protocols: PROTOCOLS[app],
    };
  });

  const artifactRecords = signedArtifacts.map(({ spec, originalSha, finalSha, facts, checks }) => ({
    id: spec.id,
    role: spec.role,
    app: spec.app,
    variant: spec.variant,
    sourceRepoId: spec.sourceRepoId,
    sourceSha: repoStates[spec.app].head,
    packageName: facts.badging?.packageName,
    versionName: facts.badging?.versionName,
    versionCode: facts.badging?.versionCode,
    protocols: PROTOCOLS[spec.app],
    originalApkSha256: originalSha,
    finalApkSha256: finalSha,
    signerCertSha256: facts.signer?.certSha256?.[0],
    abis: facts.packaging?.abis ?? [],
    nativeDexClasses: (spec.requireDexClasses ?? [])
      .filter((requirement) => (facts.dex?.definedClasses ?? []).includes(requirement.descriptor))
      .map((requirement) => requirement.descriptor),
    nativeAutolink: (facts.dex?.definedClasses ?? []).includes(spec.requireDexRegistration)
      ? [spec.requireDexRegistration]
      : [],
    embeddedBundle: facts.packaging?.hasBundle === true,
    testTargetAppId: spec.role === 'test' ? facts.badging?.instrumentation?.targetPackage : null,
    checks,
  }));

  const manifest = hydrateManifest({
    generatedAt: new Date().toISOString(),
    repos: repoRecords,
    artifacts: artifactRecords,
    signing: {
      expectedCertSha256: signing.expectedCertSha256,
      keystoreAlias: signing.keyAlias,
    },
    toolchain: {
      buildToolsVersion: toolchain.buildToolsVersion,
      maxHeapMb: settings.maxHeapMb,
      maxWorkers: 1,
    },
    commands: commands.map((command) => ({
      id: command.id,
      command: command.command,
      args: command.args,
      log: `${outputDir}/logs/${command.id}.log`,
    })),
    notes: [
      'All AUT and instrumentation APKs were post-signed with the same shared QA key.',
      'Original Gradle-signed APK hashes and final signed hashes are both recorded.',
    ],
  });

  const provenance = checkManifestProvenance(manifest);
  if (!provenance.ok) {
    throw new Error(
      `Manifest provenance failed: ${provenance.rows
        .filter((row) => row.status === 'FAIL')
        .map((row) => `${row.id}: ${row.detail}`)
        .join('; ')}`
    );
  }
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return { manifest, manifestPath, signedArtifacts };
}

async function main() {
  const args = parseArgv(process.argv.slice(2), ALLOWED_ARGS);
  if (args.help) {
    process.stdout.write(
      [
        'Usage: node scripts/sw005/harness.mjs --mode plan|prepare|build [options]',
        '',
        'Default mode is plan. Build requires --routine-sha/--reader-sha/--meditation-sha,',
        '--sdk, --build-tools-version, --jdk-home, --gradle-home (or launcher jar),',
        '--keystore (outside repos), --key-alias, --expected-cert-sha256,',
        '--ks-pass-env/--key-pass-env, --output-dir and --manifest.',
        '',
        'Password values are read from environment variables and never printed.',
      ].join('\n') + '\n'
    );
    return;
  }

  if (!['plan', 'prepare', 'build'].includes(args.mode ?? 'plan')) {
    throw new Error(`Unsupported mode: ${args.mode}`);
  }

  const settings = resolveSettings(args);

  if (settings.mode === 'prepare') {
    const routineRoot = path.resolve(settings.roots.routine);
    if (!fs.existsSync(path.join(routineRoot, 'package.json'))) {
      throw new Error(`Routine repository root is not usable: ${routineRoot}`);
    }
    const expoCli = path.join(routineRoot, 'node_modules', 'expo', 'bin', 'cli');
    if (!fs.existsSync(expoCli)) {
      throw new Error(`Expo CLI not found at ${expoCli}; install dependencies with npm ci first`);
    }
    process.stderr.write('[sw005] preparing Routine Android project (no --clean, no install)\n');
    const prepareEnv = { ...process.env };
    delete prepareEnv[settings.signing.keystorePassEnv];
    delete prepareEnv[settings.signing.keyPassEnv];
    const result = await run(process.execPath, [expoCli, 'prebuild', '--platform', 'android', '--no-install'], {
      cwd: routineRoot,
      env: prepareEnv,
    });
    process.stdout.write(result.stdout);
    return;
  }

  const { toolchain, blockers: toolchainBlockers } = resolveToolchain(settings);
  const roots = repoRoots(settings);
  const { signing, blockers: signingBlockers } = validateSigning(
    settings,
    roots,
    settings.mode === 'build'
  );
  const blockers = [...toolchainBlockers, ...signingBlockers];
  const warnings = [];

  const repoStates = {};
  for (const app of settings.apps) {
    if (!settings.shas[app]) {
      blockers.push(`${app} pinned SHA is required (--${app}-sha or SW005_${app.toUpperCase()}_SHA)`);
      continue;
    }
    try {
      validatePinnedSha(settings.shas[app], `${app} pinned SHA`);
    } catch (error) {
      blockers.push(error.message);
      continue;
    }
    if (!fs.existsSync(path.resolve(settings.roots[app]))) {
      blockers.push(`${app} repository root does not exist: ${settings.roots[app]}`);
      continue;
    }
    repoStates[app] = await readRepoState(settings, app);
    blockers.push(...repoStates[app].rows.filter((row) => row.status !== 'PASS').map((row) => row.detail));
  }

  if (settings.outputDir) {
    try {
      assertAbsolutePath(settings.outputDir, 'signed APK output dir');
      for (const root of roots) {
        if (isPathInside(settings.outputDir, root)) blockers.push('signed APK output must be outside every repository');
      }
    } catch (error) {
      blockers.push(error.message);
    }
  } else if (settings.mode === 'build') {
    blockers.push('--output-dir is required in build mode');
  }

  if (toolchain.gradleUserHome) {
    for (const root of roots) {
      if (isPathInside(toolchain.gradleUserHome, root)) {
        blockers.push('isolated Gradle user home must be outside every repository');
        break;
      }
    }
  }

  if (!settings.manifestPath && settings.mode === 'build') blockers.push('--manifest is required in build mode');
  if (settings.manifestPath) {
    try {
      assertAbsolutePath(settings.manifestPath, 'manifest path');
      for (const root of roots) {
        if (isPathInside(settings.manifestPath, root)) blockers.push('manifest must be outside every repository');
      }
    } catch (error) {
      blockers.push(error.message);
    }
  }
  if (!Number.isInteger(settings.maxHeapMb) || settings.maxHeapMb < 1024 || settings.maxHeapMb > 8192) {
    blockers.push('--max-heap-mb must be an integer between 1024 and 8192');
  }
  if (!Array.isArray(settings.architectures) || settings.architectures.length === 0) {
    blockers.push('at least one native architecture is required');
  }
  if (settings.apps.includes('routine') && (!Number.isInteger(settings.routineVersionCode) || settings.routineVersionCode <= 0)) {
    blockers.push('Routine QA versionCode must be pinned for verification (--routine-version-code)');
  }

  const memory = evaluateMemoryPreflight({
    totalBytes: os.totalmem(),
    freeBytes: os.freemem(),
    emulatorRunning: settings.emulatorRunning,
    allowLowMemory: settings.allowLowMemory,
  });
  if (!memory.ok) blockers.push(...memory.rows.filter((row) => row.status === 'FAIL').map((row) => row.detail));
  if (settings.allowLowMemory && memory.rows.some((row) => row.status === 'WARN')) {
    warnings.push('Low-memory override accepted; builds remain serial and one at a time.');
  }

  const buildPlans = Object.fromEntries(
    settings.apps.map((app) => [
      app,
      settings.roots[app] ? appBuildPlan(settings, app) : null,
    ])
  );
  const plannedCommands = [];
  for (const app of settings.apps) {
    const appPlan = buildPlans[app];
    if (!appPlan) continue;
    try {
      const invocation = buildGradleInvocation({
        javaExe: toolchain.javaExe,
        launcherJar: toolchain.gradleLauncherJar,
        projectDir: appPlan.projectDir,
        task: appPlan.tasks[0],
        gradleUserHome: toolchain.gradleUserHome,
        maxHeapMb: settings.maxHeapMb,
        maxWorkers: 1,
        architectures: settings.architectures,
        extraArgs: appPlan.tasks.slice(1),
      });
      plannedCommands.push({ app, kind: 'gradle', command: invocation.command, args: invocation.args });
    } catch (error) {
      plannedCommands.push({ app, kind: 'gradle', error: error.message });
    }
  }

  const plan = {
    program: PROGRAM_ID,
    mode: settings.mode,
    ready: blockers.length === 0,
    blockers,
    warnings,
    apps: settings.apps,
    repos: settings.apps.map((app) => ({
      id: app,
      root: settings.roots[app],
      pinnedSha: settings.shas[app] ?? null,
      head: repoStates[app]?.head ?? null,
      clean: repoStates[app]?.status != null ? repoStates[app].status.trim() === '' : null,
      build: buildPlans[app]
        ? {
            projectDir: buildPlans[app].projectDir,
            projectSubdir: buildPlans[app].layout.projectSubdir,
            tasks: buildPlans[app].tasks,
            taskEvidence: buildPlans[app].taskEvidence,
            artifacts: buildPlans[app].artifacts.map((artifact) => ({
              id: artifact.id,
              role: artifact.role,
              variant: artifact.variant,
              task: artifact.task,
              apkPath: artifact.apkPath,
              expectedPackage: artifact.expectedPackage,
              testTargetAppId: artifact.testTargetAppId ?? null,
            })),
          }
        : null,
    })),
    plannedCommands,
    toolchain: {
      androidSdk: toolchain.androidSdk ?? null,
      buildToolsVersion: toolchain.buildToolsVersion ?? null,
      javaExe: toolchain.javaExe ?? null,
      gradleLauncherJar: toolchain.gradleLauncherJar ?? null,
      gradleUserHome: toolchain.gradleUserHome ?? null,
      maxHeapMb: settings.maxHeapMb,
      maxWorkers: 1,
    },
    signing: {
      keystore: signing.keystore ?? null,
      keyAlias: signing.keyAlias ?? null,
      expectedCertSha256: signing.expectedCertSha256 ?? null,
      keystorePassEnv: signing.keystorePassEnv ?? null,
      keyPassEnv: signing.keyPassEnv ?? null,
      passwordValuesIncluded: false,
    },
    memory: memory.rows,
    deviceActions: 'NONE (plan/prepare/build never install, uninstall, grant or select a device)',
    runtimeChecks: 'NOT RUN until an explicitly authorized device run',
  };

  if (settings.mode === 'plan') {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    if (settings.strict && !plan.ready) process.exitCode = 1;
    return;
  }

  if (blockers.length > 0) {
    process.stderr.write(
      `[sw005] refusing ${settings.mode}: ${blockers.length} blocker(s)\n` +
        blockers.map((blocker) => `  - ${blocker}`).join('\n') +
        '\n'
    );
    process.exitCode = 1;
    return;
  }

  const result = await runBuild(settings, { toolchain, signing, repoStates });
  process.stdout.write(
    `${JSON.stringify(
      {
        status: 'SIGNED_AND_STATICALLY_VERIFIED',
        manifest: result.manifestPath,
        artifacts: result.signedArtifacts.map((artifact) => ({
          id: artifact.spec.id,
          finalApkSha256: artifact.finalSha,
          signerCertSha256: artifact.facts.signer.certSha256[0],
        })),
        runtimeChecks: 'NOT RUN',
      },
      null,
      2
    )}\n`
  );
}

main().catch((error) => {
  process.stderr.write(`[sw005] fatal: ${error.message}\n`);
  process.exitCode = 1;
});
