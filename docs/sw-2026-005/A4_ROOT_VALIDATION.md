# SW-2026-005 A4 source qualification

Root independently validated this harness on Windows on 29 October 2026. This qualifies source and packaging checks; same-signer IPC, mismatched-signer denial, native enforcement and physical T01–T25 acceptance remain pending.

- Standard `npm test`: 483 tests passed, zero failures/cancellations/skips, 179.713 seconds. This includes 445 existing TypeScript tests and 38 harness tests. The test script preserves all existing globs and limits concurrency to one.
- `npm run typecheck` and `npm run lint`: exit0.
- Separate harness execution: 38 passed, zero failures/skips, 2.756 seconds.
- Real SDK36 D8 reference-only fixture: one unrelated class definition, none of the three required native/registry classes defined. The parser correctly rejects it as module proof.
- Existing owner APK format check: all four DEX files parsed, including legitimate long metadata. Required module/service/generated-registry definitions were found. That historical APK is not claimed to match this source or prove runtime reachability.
- Scratch signer-probe build: JBR21, installed Gradle9.3.1, SDK36, AGP9.1.0, JVM17 target, one worker, 1 GiB heap, no parallel build. `:app:assembleDebug :app:assembleDebugAndroidTest` passed in 2m07s; all 62 tasks executed. No device was accessed.
- Real AAPT inspection confirmed AUT signature-permission declarations and instrumentation targeting `com.terinit.rhythmicroutine.sw005probe` with `androidx.test.runner.AndroidJUnitRunner`. DEX inspection confirmed definitions for both `SharedSignerProbeTest` and `MismatchedSignerProbeTest` in the test APK.
- Follow-up real Meditation instrumentation APK exposed that SDK36 `aapt dump badging` omits instrumentation name/targetPackage. The harness now parses `aapt dump xmltree <apk> AndroidManifest.xml` as the authoritative instrumentation source for test APKs, retains badging fallback only for legacy fixtures, and rejects missing/mismatched target or runner. A representative real-output fixture is covered through the parser/evaluation path; this is parser regression evidence, not physical-provider acceptance.

The scratch build used ordinary debug signing. These are not yet the shared-signer positive/negative acceptance artifacts. Before runtime testing, sign and verify the intended pair with the expected shared certificate, prepare a separate mismatched pair, and follow the explicit device-consent and positive-baseline requirements.

Original failed evidence is retained in the controller's execution ledger. Root corrected removal of two obsolete, comment-only source placeholders after interrupting the worker's unnecessary alternate-tool discovery. The worker's semantic manifest assertion repair was retained; it inspects declarations rather than matching permission names in comments. The probe's compiled active Kotlin/build/manifest source remained unchanged by that cleanup.

Root evidence files: `a4-r2-real-dex-checks.json`, `a4-probe-r4-build.txt`, `a4-r4-probe-artifact-inspection.json`, `a4-r5-harness-tests.txt`, `a4-r5-npm-test.txt`, `a4-r5-typecheck.txt`, `a4-r5-lint.txt`. Independent pinned review remains a separate gate.

## Root validation — real SDK manifest correction, 2 November 2026

All 10 focused APK inspection tests pass. Full standard npm suite: 485 tests, 92 suites, zero failures/cancellations/skips, 59.505 seconds; typecheck and lint exit0. Evidence a4-sdk-manifest-r1-* in controller ledger. Actual fresh Meditation AUT/test APK and Reader AUT built from the accepted companion commits; initial verification rejected the valid test target because SDK36 badging omitted it. After this correction, actual manifest inspection verifies AndroidJUnitRunner and target com.terinit.rhythmicmeditation, and SDK post-sign verification confirms all three APKs use the expected shared QA certificate. c1-signed-companions-manifest.json records APK/source hashes and exact versions. These are pre-version-bump C1 emulator artifacts, not C2 phone-ready builds. No APK was installed and no Binder/physical acceptance is claimed.
