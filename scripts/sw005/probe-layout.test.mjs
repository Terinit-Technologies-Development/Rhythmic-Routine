import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve('qa/sw005/signer-probe');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

// Static source/build-shape checks only. These do NOT prove compilation or
// runtime; Root must actually assemble and inspect both APKs.
describe('SW-2026-005 signer probe project shape (static only)', () => {
  it('places both test classes in the standard app androidTest source set', () => {
    const positive = read('app/src/androidTest/kotlin/com/terinit/rhythmicroutine/sw005probe/SharedSignerProbeTest.kt');
    const negative = read('app/src/androidTest/kotlin/com/terinit/rhythmicroutine/sw005probe/MismatchedSignerProbeTest.kt');
    assert.match(positive, /class SharedSignerProbeTest/);
    assert.match(negative, /class MismatchedSignerProbeTest/);

    for (const name of ['SharedSignerProbeTest.kt', 'MismatchedSignerProbeTest.kt']) {
      assert.equal(fs.existsSync(path.join(ROOT, 'src/androidTest/kotlin/com/terinit/rhythmicroutine/sw005probe', name)), false);
    }
  });

  it('pins AGP 9.1 built-in Kotlin without a separate Kotlin plugin or kotlinOptions', () => {
    const rootBuild = read('build.gradle.kts');
    const appBuild = read('app/build.gradle.kts');
    assert.match(rootBuild, /com\.android\.tools\.build:gradle:9\.1\.0/);
    assert.doesNotMatch(rootBuild, /kotlin-gradle-plugin/);
    assert.doesNotMatch(appBuild, /org\.jetbrains\.kotlin\.android/);
    assert.match(appBuild, /compilerOptions\s*\{/);
    assert.match(appBuild, /JvmTarget\.JVM_17/);
    assert.doesNotMatch(appBuild, /kotlinOptions/);
    assert.match(appBuild, /testInstrumentationRunner\s*=\s*"androidx\.test\.runner\.AndroidJUnitRunner"/);
  });

  it('uses AndroidX and bounded serial Gradle defaults', () => {
    const properties = read('gradle.properties');
    assert.match(properties, /^android\.useAndroidX=true$/m);
    assert.match(properties, /^org\.gradle\.parallel=false$/m);
    assert.match(properties, /^org\.gradle\.workers\.max=1$/m);
    assert.match(properties, /^org\.gradle\.daemon=false$/m);
    assert.match(properties, /Xmx1024m/);
  });

  it('declares exact signature permissions and visibility on the targetContext AUT', () => {
    const mainManifest = read('app/src/main/AndroidManifest.xml');
    const testManifest = read('app/src/androidTest/AndroidManifest.xml');
    const declared = (xml, pattern) =>
      [...xml.replace(/<!--[\s\S]*?-->/g, '').matchAll(pattern)].map((match) => match[1]).sort();

    const mainPermissions = declared(mainManifest, /<uses-permission\b[^>]*android:name="([^"]+)"/g);
    assert.deepEqual(mainPermissions, [
      'com.terinit.rhythmicmeditation.permission.STATUS_ACCESS',
      'com.terinit.rhythmicreader.permission.RECOVERY',
    ].sort());
    assert.ok(!mainPermissions.includes('android.permission.INTERNET'));
    assert.ok(!mainPermissions.includes('android.permission.QUERY_ALL_PACKAGES'));

    const mainQueries = declared(mainManifest, /<package\b[^>]*android:name="([^"]+)"/g);
    assert.deepEqual(mainQueries, [
      'com.terinit.rhythmicreader',
      'com.terinit.rhythmicmeditation',
      'com.terinit.rhythmicroutine',
      'com.terinit.rhythmicroutine.qa',
    ].sort());

    assert.deepEqual(declared(testManifest, /<uses-permission\b[^>]*android:name="([^"]+)"/g), []);
    assert.deepEqual(declared(testManifest, /<package\b[^>]*android:name="([^"]+)"/g), []);
  });

  it('keeps the bounded standard npm test command covering harness tests', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
    assert.match(packageJson.scripts.test, /--test-concurrency=1/);
    assert.match(packageJson.scripts.test, /src\/domain\/__tests__\/\*\.test\.ts/);
    assert.match(packageJson.scripts.test, /src\/domain\/rhythm\/__tests__\/\*\.test\.ts/);
    assert.match(packageJson.scripts.test, /src\/domain\/insights\/__tests__\/\*\.test\.ts/);
    assert.match(packageJson.scripts.test, /scripts\/sw005\/\*\.test\.mjs/);
  });

  it('passes the configured projection instead of always querying null', () => {
    const positive = read('app/src/androidTest/kotlin/com/terinit/rhythmicroutine/sw005probe/SharedSignerProbeTest.kt');
    const negative = read('app/src/androidTest/kotlin/com/terinit/rhythmicroutine/sw005probe/MismatchedSignerProbeTest.kt');
    for (const source of [positive, negative]) {
      assert.match(source, /takeIf\s*\{\s*it\.isNotEmpty\(\)\s*\}\?\.toTypedArray\(\)/);
      assert.match(source, /query\(providerUri,\s*projection,/);
    }
    assert.match(positive, /columnCount\s*>\s*0/);
    assert.match(positive, /getColumnIndex\(column\)\s*>=\s*0/);
    assert.match(positive, /zero rows|empty-valid|default shape|neutral/i);
  });
});
