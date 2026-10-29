import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

import { planAppBuild } from './lib/project-layout.mjs';

const HARNESS = path.resolve('scripts/sw005/harness.mjs');
const CERT = 'a'.repeat(64);

function initRepo(root) {
  fs.mkdirSync(root, { recursive: true });
  execFileSync('git', ['init', '-q', root], { stdio: 'ignore' });
  execFileSync(
    'git',
    ['-C', root, '-c', 'user.email=fixture@example.invalid', '-c', 'user.name=fixture', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-q', '-m', 'fixture'],
    { stdio: 'ignore' }
  );
  return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

function touch(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '');
}

describe('SW-2026-005 per-app layouts and full harness plan', () => {
  let temp;
  let roots;
  let shas;

  before(() => {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sw005-layout-'));
    roots = {
      routine: path.join(temp, 'routine'),
      reader: path.join(temp, 'reader'),
      meditation: path.join(temp, 'meditation'),
    };
    shas = Object.fromEntries(Object.entries(roots).map(([app, root]) => [app, initRepo(root)]));
  });

  after(() => {
    if (temp) fs.rmSync(temp, { recursive: true, force: true });
  });

  it('places Routine Gradle under android/ and companion Gradle at repository root', () => {
    const routine = planAppBuild('routine', { root: roots.routine, routineVersionCode: 5 });
    const reader = planAppBuild('reader', { root: roots.reader });
    const meditation = planAppBuild('meditation', { root: roots.meditation });

    assert.equal(routine.projectDir, path.join(roots.routine, 'android'));
    assert.ok(routine.artifacts[0].apkPath.includes(path.join('android', 'app', 'build', 'outputs')));
    assert.equal(reader.projectDir, roots.reader);
    assert.equal(meditation.projectDir, roots.meditation);
    assert.ok(reader.artifacts[0].apkPath.startsWith(path.join(roots.reader, 'app', 'build', 'outputs')));
    assert.equal(reader.artifacts[1].testTargetAppId, 'com.terinit.rhythmicreader');
    assert.equal(routine.artifacts[1].expectedPackage, 'com.terinit.rhythmicroutine.qa.test');
    assert.equal(routine.artifacts[0].requireDexModule, true);
    assert.equal(reader.artifacts[0].requireDexModule, false);
  });

  it('runs the complete plan entrypoint against real-shaped temporary checkouts and emits exact build argv', () => {
    const sdk = path.join(temp, 'sdk');
    const buildTools = path.join(sdk, 'build-tools', '36.0.0');
    touch(path.join(buildTools, 'aapt.exe'));
    touch(path.join(buildTools, 'zipalign.exe'));
    touch(path.join(buildTools, 'lib', 'apksigner.jar'));
    const jdk = path.join(temp, 'jdk');
    touch(path.join(jdk, 'bin', 'java.exe'));
    const gradle = path.join(temp, 'gradle-9.3');
    touch(path.join(gradle, 'lib', 'gradle-gradle-cli-main-9.3.1.jar'));
    const keystore = path.join(temp, 'outside', 'qa shared.p12');
    touch(keystore);
    const output = path.join(temp, 'outside', 'signed output');
    const manifest = path.join(temp, 'outside', 'manifest.json');

    const stdout = execFileSync(
      process.execPath,
      [
        HARNESS,
        '--mode', 'plan',
        '--apps', 'routine,reader,meditation',
        '--routine-root', roots.routine,
        '--reader-root', roots.reader,
        '--meditation-root', roots.meditation,
        '--routine-sha', shas.routine,
        '--reader-sha', shas.reader,
        '--meditation-sha', shas.meditation,
        '--sdk', sdk,
        '--build-tools-version', '36.0.0',
        '--jdk-home', jdk,
        '--gradle-home', gradle,
        '--gradle-user-home', path.join(temp, 'isolated gradle cache'),
        '--max-heap-mb', '1024',
        '--keystore', keystore,
        '--key-alias', 'shared qa',
        '--expected-cert-sha256', CERT,
        '--routine-version-code', '5',
        '--output-dir', output,
        '--manifest', manifest,
        '--allow-low-memory',
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          SW005_KS_PASS: 'fixture-secret-value',
          SW005_KEY_PASS: 'fixture-secret-value',
        },
      }
    );

    const plan = JSON.parse(stdout);
    assert.equal(plan.ready, true, JSON.stringify(plan.blockers));
    const byId = Object.fromEntries(plan.repos.map((repo) => [repo.id, repo]));
    assert.equal(byId.routine.build.projectDir, path.join(roots.routine, 'android'));
    assert.equal(byId.reader.build.projectDir, roots.reader);
    assert.equal(byId.meditation.build.projectDir, roots.meditation);
    assert.ok(byId.routine.build.artifacts[0].apkPath.includes(path.join('android', 'app')));
    assert.ok(byId.reader.build.artifacts[0].apkPath.startsWith(path.join(roots.reader, 'app')));
    assert.equal(byId.routine.build.artifacts[0].expectedPackage, 'com.terinit.rhythmicroutine.qa');
    assert.equal(byId.routine.build.artifacts[1].testTargetAppId, 'com.terinit.rhythmicroutine.qa');

    const readerCommand = plan.plannedCommands.find((command) => command.app === 'reader');
    assert.ok(readerCommand.args.includes(roots.reader));
    assert.ok(!readerCommand.args.includes(path.join(roots.reader, 'android')));
    const routineCommand = plan.plannedCommands.find((command) => command.app === 'routine');
    assert.ok(routineCommand.args.includes(path.join(roots.routine, 'android')));
    for (const command of plan.plannedCommands) {
      assert.ok(command.args.includes('--no-daemon'));
      assert.ok(command.args.includes('--no-parallel'));
      assert.ok(command.args.includes('--max-workers=1'));
      assert.ok(!command.args.includes('--stop'));
      assert.ok(!command.args.includes('clean'));
    }
    assert.ok(!stdout.includes('fixture-secret-value'));
  });
});
