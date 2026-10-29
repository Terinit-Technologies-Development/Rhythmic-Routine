# SW-2026-005 signer probe (TEST ONLY)

Complete scratch Android project under `qa/sw005/signer-probe`. It is **not**
included in any product Gradle build, module, manifest or dependency graph.
It requests only existing signature permissions (`Reader RECOVERY`,
`Meditation STATUS_ACCESS`), exact package visibility, no network and no
`QUERY_ALL_PACKAGES`. It never grants permissions or seeds evidence.

## Build (outside all product repositories)

The project is pinned to cached **AGP 9.1.0 with built-in Kotlin**, Gradle
9.3.1, JBR 21/JDK 17 toolchain and SDK 36. There is no separate
`org.jetbrains.kotlin.android` plugin and no `kotlinOptions`; Kotlin compiler
settings use `compilerOptions`. `android.useAndroidX=true` is set in
`gradle.properties`.

Copy this directory to a scratch location outside Routine/Reader/Meditation,
or build it in place without including it in product settings:

```powershell
java -jar <GRADLE_9_3_1>/lib/gradle-gradle-cli-main-9.3.1.jar `
  --no-daemon --no-parallel --max-workers=1 `
  --project-dir qa/sw005/signer-probe :app:assembleDebug :app:assembleDebugAndroidTest
```

Standard Kotlin test sources live at
`app/src/androidTest/kotlin/com/terinit/rhythmicroutine/sw005probe/`.
The obsolete root-level `src/androidTest/kotlin` copies contain no classes.

Artifacts:

- `app/build/outputs/apk/debug/app-debug.apk`
- `app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk`

The runner is the real `androidx.test.runner.AndroidJUnitRunner`; test package
is `com.terinit.rhythmicroutine.sw005probe.test`. Do not use a fictional
`.ProbeRunner`.

The exact Reader `RECOVERY` and Meditation `STATUS_ACCESS` signature
permissions, plus exact package visibility, are declared in the AUT
`app/src/main/AndroidManifest.xml` because the probes use
`InstrumentationRegistry.targetContext`. The androidTest manifest adds no
permissions, queries or network access.

## Sign

Post-sign **both** APKs with the shared provider QA key for the positive probe.
For the negative probe, build again and sign **both** with a disposable
mismatched key. Never use the shared key for the negative run.

## Run positive first, then negative

Positive class: `com.terinit.rhythmicroutine.sw005probe.SharedSignerProbeTest`
Negative class: `com.terinit.rhythmicroutine.sw005probe.MismatchedSignerProbeTest`

If `--provider-columns` is supplied, both probes pass those exact columns as
the ContentResolver projection and assert the returned schema contains them.
With no columns, the probe intentionally queries the provider's default shape
and only requires a non-empty, usable cursor; zero rows remain a valid neutral
response.

Example Reader recovery URI (use the real bound session UUID supplied by the
integration owner; never fabricate one):

`content://com.terinit.rhythmicreader.recovery/sessions/<uuid>`

Reader daily evidence:
`content://com.terinit.rhythmicreader.evidence/daily/<yyyy-mm-dd>`

Routine QA attention insight:
`content://com.terinit.rhythmicroutine.qa.attention-insight/attention-day/current`

Meditation status authority/permission from A2:
`com.terinit.rhythmicmeditation.permission.STATUS_ACCESS`.

```powershell
# Plan only: no adb call, serial is a placeholder.
node scripts/sw005/device.mjs --mode plan --variant qa `
  --test-apk <androidTest.apk> --aut-package com.terinit.rhythmicroutine.sw005probe `
  --test-package com.terinit.rhythmicroutine.sw005probe.test `
  --runner com.terinit.rhythmicroutine.sw005probe.test/androidx.test.runner.AndroidJUnitRunner `
  --test-class com.terinit.rhythmicroutine.sw005probe.SharedSignerProbeTest `
  --provider-package com.terinit.rhythmicreader `
  --provider-uri "content://com.terinit.rhythmicreader.recovery/sessions/<uuid>" `
  --provider-columns <requiredColumn1>,<requiredColumn2> `
  --expected-cert-sha256 <shared-provider-cert-sha256>
```

Execution requires the exact serial, explicit authorization, device class and
(expected) evidence output path. It performs static APK checks, installed
provider/authority checks, then one class-filtered instrumentation run. The
negative run additionally requires a passing positive baseline file.

```powershell
node scripts/sw005/device.mjs --mode execute --variant qa --serial <exact-serial> `
  --authorize-device --device-kind disposable `
  --test-apk <shared-signed-androidTest.apk> `
  --aut-package com.terinit.rhythmicroutine.sw005probe `
  --test-package com.terinit.rhythmicroutine.sw005probe.test `
  --runner com.terinit.rhythmicroutine.sw005probe.test/androidx.test.runner.AndroidJUnitRunner `
  --test-class com.terinit.rhythmicroutine.sw005probe.SharedSignerProbeTest `
  --provider-package com.terinit.rhythmicreader `
  --provider-uri "content://com.terinit.rhythmicreader.recovery/sessions/<uuid>" `
  --provider-columns <requiredColumn1>,<requiredColumn2> `
  --expected-cert-sha256 <shared-provider-cert-sha256> `
  --evidence-out <absolute-positive-baseline.json>
```

Then repeat with the mismatched-signed test APK, the negative class and
`--probe-expectation mismatch --baseline-evidence <absolute-positive-baseline.json>`.
The negative pass requires: correct installed package, declared authority,
matching positive baseline, and an actual `SecurityException` from the provider
query. Missing provider/wrong URI does not count as denial.

Zero executed tests, failures, crashes or shortMsg always fail. Output contains
only a device alias/hash and redacted provider URI; raw serials and full
session URIs are not logged or written to evidence.
