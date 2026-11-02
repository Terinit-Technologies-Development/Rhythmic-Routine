# Routine-targeted probe overlay (TEST ONLY)

Purpose: run the existing read-only `SharedSignerProbeTest` under the real
installed `com.terinit.rhythmicroutine.qa` application identity, using the
existing reviewed Routine QA APK as the AUT. No dummy probe AUT is installed or
substituted for Routine.

The overlay does **not** modify Routine source, Gradle files, manifests,
versions, dependencies or the signed APK. It injects a test-only androidTest
variant configuration at invocation time.

## Exact build

Use the existing generated Routine integration Android project (the directory
containing `settings.gradle.kts` and `:app`) and the installed Gradle 9.3.1/JDK:

```powershell
java -jar <GRADLE_9_3_1>/lib/gradle-gradle-cli-main-9.3.1.jar `
  --no-daemon --no-parallel --max-workers=1 `
  --project-dir <ROUTINE_ROOT>/android `
  --init-script <A4_ROOT>/qa/sw005/routine-probe-overlay/routine-probe.init.gradle `
  -Psw005ProbeSrc=<A4_ROOT>/qa/sw005/signer-probe/app/src/androidTest/kotlin `
  :app:assembleQaStandaloneAndroidTest
```

Expected build output (verify the actual path if AGP changes it):

`<ROUTINE_ROOT>/android/app/build/outputs/apk/androidTest/qaStandalone/app-qaStandalone-androidTest.apk`

Expected identities:

- AUT/targetPackage: `com.terinit.rhythmicroutine.qa`
- test package: `com.terinit.rhythmicroutine.qa.test`
- runner: `androidx.test.runner.AndroidJUnitRunner`
- runner component: `com.terinit.rhythmicroutine.qa.test/androidx.test.runner.AndroidJUnitRunner`
- class filter: `com.terinit.rhythmicroutine.sw005probe.SharedSignerProbeTest`

The overlay sets `testBuildType=qaStandalone`, the runner, standard
`androidx.test`/JUnit test dependencies, and the existing probe Kotlin source
directory during `:app` project evaluation, before AGP reads the runner. It does
not add production dependencies or permissions.

The property is scoped to the intended Routine root. Included React/Expo plugin
builds evaluate the same init script without `-Psw005ProbeSrc`; they are left
untouched rather than failed for the absent property.

## Sign and install

Post-sign the built test APK with the same shared QA certificate that signs the
installed Routine QA AUT. Use an external keystore and environment password
references; never place passwords in argv or logs. A test APK signed with a
different key will not be a valid same-signer probe.

Install sequence for an already installed, same-signed Routine QA AUT:

```powershell
adb -s <exact-authorized-serial> install -r -t <signed-androidTest.apk>
```

Do not reinstall or replace the reviewed Routine QA APK merely to run this test.
The existing AUT must remain the Root-recorded APK 583 artifact.

## Run positive probe

Use the device entry point only after explicit authorization:

```powershell
node scripts/sw005/device.mjs --mode execute --serial <exact-serial> `
  --authorize-device --device-kind disposable `
  --test-apk <signed-androidTest.apk> `
  --aut-package com.terinit.rhythmicroutine.qa `
  --test-package com.terinit.rhythmicroutine.qa.test `
  --runner com.terinit.rhythmicroutine.qa.test/androidx.test.runner.AndroidJUnitRunner `
  --test-class com.terinit.rhythmicroutine.sw005probe.SharedSignerProbeTest `
  --provider-package com.terinit.rhythmicroutine.qa `
  --provider-uri "content://com.terinit.rhythmicroutine.qa.attention-insight/attention-day/current" `
  --expected-cert-sha256 <shared-qa-cert-sha256> `
  --evidence-out <absolute-positive-baseline.json>
```

The positive run requires at least one executed test, zero failures, exact
installed provider authority, and the expected shared signer. This is the
genuine Routine→Meditation positive prerequisite only when the requested
provider URI is an existing Meditation provider contract; the Routine attention
insight positive proves Routine identity/IPC separately.

## Reader prerequisite

A freshly installed Reader provider can return `null` until the Reader app has
completed one ordinary launch. Launch Reader normally once, then rerun the
Reader recovery positive. No Reader code change is justified by that lifecycle
behavior.

## Meditation reality and negative limitation

Meditation's existing `SameSignerCallerTrustPolicy` accepts only actual
Routine/QA package identity plus same certificate. A generic probe package
returns a null cursor after normal launch by design; do not alter the allowlist
or trust policy. The real positive Routine→Meditation provider call still needs
to be demonstrated separately; the existing Meditation
`CompanionProviderIntegrationTest` PASS3 is retained evidence but is not a
substitute for that exact caller path.

For the Routine-targeted test APK, a wrong-key test APK is expected to be
rejected by Android instrumentation installation/execution **before any test
code runs**. That platform rejection is not a provider-level
`SecurityException` and must not be recorded as a mismatched-signer IPC PASS.
`validateProbeBaseline` continues to require exact AUT/test identity and is not
weakened. The generic mismatched AUT/test pair remains the available negative
path for Routine/Reader signature-level denial. No new negative framework is
added here by design.

## Provenance / limitations

Static source shape and this overlay configuration do not prove compilation,
test execution or provider acceptance. Root must compile the overlay, verify
the actual test package/target/runner and signer, install the test APK, run the
class-filtered positive, and preserve raw output. No C2, #10, phone or physical
acceptance is claimed.
