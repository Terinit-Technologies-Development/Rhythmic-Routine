# SW-2026-005 — Shared-Signer Android QA Harness

Status: A4 harness source/scripts/tests only. Static verification can pass; no
row in this document proves device runtime behaviour. Issue #10 closes only
after the positive/mismatched-signer probes and the cross-app suites run on an
authorized disposable emulator or owner-consented hardware.

## 1. Scope and non-goals

This harness prepares, builds, post-signs, statically verifies and records
provenance for Routine, Reader and Meditation QA APKs plus their
instrumentation APKs under one shared signer. It does not change application
IDs, version codes, production signing permissions, enforcement code, provider
protocols or production Gradle/manifest/plugin files.

Default mode is `plan`. `prepare` only generates Routine's Android project.
`build` is explicit. Device work is a separate default-deny command. Nothing
here installs, uninstalls, clears data, downgrades, resets an AVD, grants
signature permissions, changes settings, kills processes or deletes caches.

## 2. Why the old helpers were unsafe

The previous `build-android-qa.ps1` globally terminated every Java process and
stopped all Gradle daemons, then ran `clean`. The previous verifier composed
shell strings containing the APK path, skipped package-ID validation when
`aapt`/SDK was missing, treated badging failures as warnings, and hardcoded an
old `1.0.1-qa` version. Both are replaced.

The new scripts use argv arrays only (`execFile`, PowerShell
`ProcessStartInfo.ArgumentList` or native array invocation), inspect ZIPs in
Node, and fail closed when any mandatory tool or check is absent.

## 3. Shared signing model

- One keystore lives **outside every repository checkout**.
- `apksigner` receives passwords only as `env:NAME` references. Values stay in
  the child environment and never enter argv, JSON, logs or commits.
- `zipalign -P 16 -f 4` runs before signing.
- Every AUT and instrumentation APK is post-signed with the chosen key to an
  output directory outside all repositories, even when Gradle emitted a
  different default debug signature.
- The verifier re-reads the **actual** certificate digest from each signed APK
  and requires exactly one signer shared by all artifacts. Same keystore path
  is not accepted as proof.
- The manifest records the expected certificate SHA-256, original Gradle APK
  hash, final signed APK hash, source SHA, variant, package, version,
  protocols, test target and ABI/bundle facts. It never records key bytes,
  passwords, raw serials or private certificates.

Generate the key outside the repositories with the platform's normal keytool
workflow. Do not commit it, copy it into a checkout, or reuse a production key.

## 4. Prerequisites

| Item | Requirement |
| --- | --- |
| Android SDK | Installed locally; no automatic download. Pin `--build-tools-version`, normally `36.0.0`. |
| `aapt`, `zipalign`, `apksigner.jar` | Must exist under the pinned build-tools directory. Missing tools fail the run. |
| JDK | JDK 17 or the installed JBR 21; `java` must be callable. |
| Gradle | Installed Gradle 9.3; launcher `lib/gradle-gradle-cli-main-9.3.1.jar`. No `.bat` shell is used. |
| Node | Node 20+ for the harness and tests. |
| Repos | Clean checkouts at explicit full 40-character SHAs. Reader/Meditation roots are explicit; the harness never writes to them. |
| Memory | At least ~3 GiB visible free physical RAM; one native build at a time; no emulator alongside the build. Default heap is 1 GiB and one worker unless the operator explicitly configures otherwise. |

Memory guidance is a run-time headroom check, not a permanent RAM fix. The
harness does not change page files, kill idle provider hosts or promise that a
low-memory machine is repaired. Use `--emulator-running` to force a refusal;
`--allow-low-memory` is an explicit operator override and is reported as a
warning.

### 4.1 Project layouts are explicit

| App | Gradle project | APK output root |
| --- | --- | --- |
| Routine | `<routine>/android` | `<routine>/android/app/build/outputs/apk` |
| Reader | `<reader>` (settings.gradle.kts at repository root) | `<reader>/app/build/outputs/apk` |
| Meditation | `<meditation>` (settings.gradle.kts at repository root) | `<meditation>/app/build/outputs/apk` |

The plan prints each project directory, task, APK path, expected package and
instrumentation target. Build mode probes every task with
`gradle help --task <task>` before running it. A missing test task (for example
`assembleQaStandaloneAndroidTest` because `testBuildType` is still `debug`) is a
blocking, actionable failure. The harness does not edit product Gradle files to
invent a task; use an allocated production patch or the test-only external
scratch project.

## 5. Commands

All paths are placeholders. Supply absolute paths at execution time; no product
script contains this workspace's paths.

### 5.1 Plan (default — no writes, no devices)

```powershell
pwsh ./scripts/build-android-qa.ps1 -Mode plan `
  -RoutineRoot <ROUTINE_ROOT> -ReaderRoot <READER_ROOT> -MeditationRoot <MEDITATION_ROOT> `
  -RoutineSha <40_HEX> -ReaderSha <40_HEX> -MeditationSha <40_HEX> `
  -AndroidSdk $env:ANDROID_SDK_ROOT -BuildToolsVersion 36.0.0 `
  -JdkHome $env:JAVA_HOME -GradleHome <GRADLE_9_3_HOME> `
  -GradleUserHome <ISOLATED_CACHE_OUTSIDE_REPOS> `
  -Keystore <KEYSTORE_OUTSIDE_REPOS> -KeyAlias <ALIAS> `
  -ExpectedCertSha256 <64_HEX> -RoutineVersionCode <PINNED_QA_VERSION_CODE> `
  -OutputDir <SIGNED_OUTSIDE_REPOS> -Manifest <MANIFEST_OUTSIDE_REPOS> -Strict
```

`-Strict` makes an unready plan exit non-zero. Without it, the plan still lists
every blocker.

### 5.2 Prepare Routine's native project

```powershell
pwsh ./scripts/build-android-qa.ps1 -Mode prepare -RoutineRoot <ROUTINE_ROOT>
```

This runs `expo prebuild --platform android --no-install` **without** `--clean`.
It does not install dependencies and does not modify product source.

### 5.3 Build, post-sign, verify, write manifest

```powershell
$env:SW005_KS_PASS = Read-Host -Prompt 'Keystore password'
$env:SW005_KEY_PASS = Read-Host -Prompt 'Key password'

pwsh ./scripts/build-android-qa.ps1 -Mode build `
  -RoutineRoot <ROUTINE_ROOT> -ReaderRoot <READER_ROOT> -MeditationRoot <MEDITATION_ROOT> `
  -RoutineSha <40_HEX> -ReaderSha <40_HEX> -MeditationSha <40_HEX> `
  -AndroidSdk $env:ANDROID_SDK_ROOT -BuildToolsVersion 36.0.0 `
  -JdkHome $env:JAVA_HOME -GradleHome <GRADLE_9_3_HOME> `
  -GradleUserHome <ISOLATED_CACHE_OUTSIDE_REPOS> `
  -Keystore <KEYSTORE_OUTSIDE_REPOS> -KeyAlias <ALIAS> `
  -ExpectedCertSha256 <64_HEX> -RoutineVersionCode <PINNED_QA_VERSION_CODE> `
  -OutputDir <SIGNED_OUTSIDE_REPOS> -Manifest <MANIFEST_OUTSIDE_REPOS>
```

Behavior:

1. `git rev-parse HEAD` and `git status --porcelain=v1` must show the exact
   pinned SHA and a clean checkout. The harness never cleans, resets, stashes or
   overwrites a dirty checkout.
2. Apps build serially in the order Routine, Reader, Meditation. Each Gradle
   invocation uses `--no-daemon --no-parallel --max-workers=1`, bounded heap,
   an optional validated isolated Gradle user home, and `java -jar` against the
   Gradle 9.3 launcher.
3. Tasks include the AUT and `assemble*AndroidTest` instrumentation task.
4. Every resulting AUT/test APK is zipaligned, post-signed and verified.
5. A missing bundle, missing native module packaging, wrong package/version,
   missing SDK tool, unsigned/wrong signer, mismatched test target or a
   non-shared signer stops the run.
6. The manifest is written only after provenance checks pass.

`<PINNED_QA_VERSION_CODE>` must come from the actual current Routine configuration
in the reviewed worktree. Do not treat the PRD's proposed code or this document
as the current release version; owner-local builds may be newer.

Static native-module proof for Routine verifies packaged `classes*.dex`
class_defs (not string constants or referenced type_ids), requiring exact
definitions `Lexpo/modules/rhythmdevice/RhythmDeviceModule;`,
`Lexpo/modules/rhythmdevice/RhythmEnforcementService;` and generated registry
`Lexpo/modules/ExpoModulesPackageList;`. Each DEX header/checksum/signature and
index bounds are validated. Long unrelated metadata strings are legal and are
not treated as corrupt. Native runtime remains `NOT RUN`; an unrelated `.so`,
a bare string, or a registry class alone is never module reachability proof.
Synthetic DEX unit fixtures populate only parser-relevant fields and are not
SDK/device acceptance evidence; Root's real SDK/APK checks remain separate.

Signed files are `<artifact-id>.signed.apk`; aligned intermediates are kept for
audit. Gradle logs are in `<output>/logs/`. Both contain no password values.

### 5.4 Verify one Routine APK

```powershell
node ./scripts/verify-android-qa-apk.mjs <APK> `
  --variant qa --sdk $env:ANDROID_SDK_ROOT --build-tools-version 36.0.0 `
  --expected-cert-sha256 <64_HEX> --expected-version-code <PINNED_QA_VERSION_CODE>
```

Exit code 1 means a mandatory static check failed. There is no “warn then pass”
path. Use `--variant production` only to check the release package
`com.terinit.rhythmicroutine`; never install QA and production Routine on one
authority device without resolving ambiguity.

## 6. Manifest fields (required)

- `program`, `schemaVersion`, `generatedAt`
- `toolchain.buildToolsVersion`, `maxHeapMb`, `maxWorkers`
- `signing.expectedCertSha256`, non-secret alias label, `passwordSource`
- per repo: `sourceSha`, `dirty: false`, variant, application ID, protocols
- per artifact: role (`aut`/`test`), app, variant, package, version name/code,
  source SHA, **original APK SHA-256**, **final signed APK SHA-256**, signer
  certificate SHA-256, ABI list, embedded-bundle flag, test target, check rows
- `runtimeChecks`: all `NOT RUN` until a real device run
- explicit limitations list

`checkManifestProvenance` rejects missing hashes, dirty sources, multiple
signers, orphan test targets, claimed runtime passes and secret-shaped fields.

## 7. Installation and recovery (operator-gated, never automatic)

Obtain owner authorization before using any device. `device.mjs` defaults to
plan and prints commands; it does not execute them.

| Action | Command shape | Data effect |
| --- | --- | --- |
| Verify/update | `adb -s <serial> install -r <id>.signed.apk` | Preserves app data when the platform accepts the update. |
| Clean install | uninstall named package, then install | **Deletes that package's local data.** Only on a disposable emulator or with explicit owner consent. |
| Rollback | `adb -s <serial> install -r -d <id>.signed.apk` | Preserves data where the platform permits a lower versionCode. Never assume success; verify installed version and signer afterwards. |

Install plans are generated from `--variant qa|production`. QA Routine is
`com.terinit.rhythmicroutine.qa`; production Routine is
`com.terinit.rhythmicroutine`. Reader/Meditation IDs are unchanged. A plan does
not verify install artifacts or imply acceptance; only execute-time APK/signer
checks do that. Never install QA Routine and production Routine together on the
authority device.

Install order for the three-app smoke path: Routine, Reader, Meditation, then
the instrumentation APK that targets the exact AUT. Confirm package IDs:
`com.terinit.rhythmicroutine.qa`, `com.terinit.rhythmicreader`,
`com.terinit.rhythmicmeditation`.

## 8. Connected instrumentation and signer probes

Plan is default and performs no ADB call. Execute requires all of: exact
serial, `--authorize-device`, disposable/owner-consented classification,
expected provider certificate SHA-256, exact AUT/test package, runner, test
class, provider package and a validated `content://` URI. Owner hardware also
requires `--device-kind owner-consented --owner-consent-token <C2_REFERENCE>`.

```powershell
node ./scripts/sw005/device.mjs --mode plan --variant qa `
  --test-apk <test.apk> `
  --aut-package com.terinit.rhythmicroutine.sw005probe `
  --test-package com.terinit.rhythmicroutine.sw005probe.test `
  --runner com.terinit.rhythmicroutine.sw005probe.test/androidx.test.runner.AndroidJUnitRunner `
  --test-class com.terinit.rhythmicroutine.sw005probe.SharedSignerProbeTest `
  --provider-package com.terinit.rhythmicreader `
  --provider-uri "content://com.terinit.rhythmicreader.recovery/sessions/<uuid>" `
  --provider-columns <required columns> `
  --expected-cert-sha256 <shared-provider-cert-sha256>
```

The provider package is passed as `-e providerPackage`, never as AndroidJUnit's
`-e package` test filter. The class is selected with `-e class`. Positive and
mismatch runs use different test classes and separate invocations. Execute
first proves the provider package is installed and declares the expected
authority; a missing provider/wrong URI cannot masquerade as signature denial.
The mismatch run also requires `--baseline-evidence` from a passing positive run
for the same URI hash, AUT, test package and shared certificate.

Raw serials and full session/date URIs are never printed or written to
evidence; only a device alias/hash and provider URI SHA-256 are recorded. Zero
executed tests, failures, crashes or `shortMsg` exit non-zero.

## 9. Same-signer and mismatched-signer probes

`qa/sw005/signer-probe/` is a complete test-only scratch Android project
pinned to AGP 9.1.0 built-in Kotlin, Gradle 9.3.1, JDK 17 toolchain and SDK 36,
with its own Gradle settings, standard `app/src/androidTest/kotlin` sources,
real `AndroidJUnitRunner`, exact existing signature permissions (Reader
`RECOVERY`, Meditation `STATUS_ACCESS`) and exact package visibility on the AUT
`targetContext` manifest, no network and no broad permission. It is never
included in product Gradle/module builds.

- positive class: `...SharedSignerProbeTest` signed with the shared provider key;
  the provider must be installed, declare the URI authority and return a valid
  cursor/schema. Configured `--provider-columns` are passed as the explicit
  projection; no columns intentionally tests the provider's default shape; zero
  rows remain valid neutral output;
- negative class: `...MismatchedSignerProbeTest` signed with a disposable
  mismatched key, using the same URI/projection shape; `SecurityException` is
  required only after the positive baseline and installed-target/authority
  checks pass.

Build/run instructions, exact classes, URIs and baseline flow are in
`qa/sw005/signer-probe/README.md`. Static shape tests do not prove compilation;
Root must assemble both APKs and verify both test classes in DEX. Fixture
existence is **not** runtime acceptance.

## 10. Run order and fallback

1. Static: `npm test` now includes the harness tests via the `scripts/sw005/*.test.mjs` glob, retaining `--test-concurrency=1`, plus Routine/Reader/Meditation unit suites. Root may also run the explicit `node --test` list.
2. Plan with `-Strict`.
3. Serial build on the machine with visible RAM headroom; one app at a time.
4. Verify manifest and hashes; confirm all APKs share one signer.
5. Only if a device is genuinely authorized: install/update, check package and
   signer, run the probes and existing suites, then record redacted evidence.

If memory is tight, stop only idle provider hosts you own, keep one build at a
time, and do not start an emulator alongside a build. Preserve existing
emulator user data; prefer a new isolated QA AVD if one is needed. Do not
request the owner's phone before the C2 DEVICE READY handoff.

## 11. Issue #10 checklist

- [x] App-under-test and instrumentation APK post-signed with one shared key
      outside source output directories.
- [x] Gradle default debug signer cannot silently replace the shared-signer
      install: signed artifacts are verified by actual certificate digest.
- [x] Keystore/configuration documented; private material never committed.
- [x] Clean install/update/rollback commands with data-preservation warnings,
      operator-gated and not auto-executed.
- [x] Recovery/provider suite rerun path provided with zero-test refusal and
      signer-matched test APK.
- [x] Emulator/device memory guidance and lower-memory serial fallback.
- [x] Production signature permissions untouched.
- [ ] Positive and mismatched-signer probes executed on a disposable/consented
      device — **NOT RUN**.
- [ ] Cross-app recovery/provider suites rerun with nonzero executed tests —
      **NOT RUN**.
- [ ] T19/T22 and owner acceptance — **NOT RUN**.

## 12. Explicitly unproven

- No installed-device enforcement proof (`ENFORCED`), no morning/CD4 runtime
  proof, no #8/#13 closure, no C2 DEVICE READY claim.
- No claim that static native-library presence means the `rhythm-device` module
  is actually reachable at runtime.
- No hardware/Android 16 upgrade or rollback execution.
- No provider/gate/ordinal/counter seeding; the harness never fabricates
  completion evidence.
