# SW-2026-005 A4 source qualification

Root independently validated this harness on Windows on 29 October 2026. This qualifies source and packaging checks; same-signer IPC, mismatched-signer denial, native enforcement and physical T01–T25 acceptance remain pending.

- Standard `npm test`: 483 tests passed, zero failures/cancellations/skips, 179.713 seconds. This includes 445 existing TypeScript tests and 38 harness tests. The test script preserves all existing globs and limits concurrency to one.
- `npm run typecheck` and `npm run lint`: exit0.
- Separate harness execution: 38 passed, zero failures/skips, 2.756 seconds.
- Real SDK36 D8 reference-only fixture: one unrelated class definition, none of the three required native/registry classes defined. The parser correctly rejects it as module proof.
- Existing owner APK format check: all four DEX files parsed, including legitimate long metadata. Required module/service/generated-registry definitions were found. That historical APK is not claimed to match this source or prove runtime reachability.
- Scratch signer-probe build: JBR21, installed Gradle9.3.1, SDK36, AGP9.1.0, JVM17 target, one worker, 1 GiB heap, no parallel build. `:app:assembleDebug :app:assembleDebugAndroidTest` passed in 2m07s; all 62 tasks executed. No device was accessed.
- Real AAPT inspection confirmed AUT signature-permission declarations and instrumentation targeting `com.terinit.rhythmicroutine.sw005probe` with `androidx.test.runner.AndroidJUnitRunner`. DEX inspection confirmed definitions for both `SharedSignerProbeTest` and `MismatchedSignerProbeTest` in the test APK.

The scratch build used ordinary debug signing. These are not yet the shared-signer positive/negative acceptance artifacts. Before runtime testing, sign and verify the intended pair with the expected shared certificate, prepare a separate mismatched pair, and follow the explicit device-consent and positive-baseline requirements.

Original failed evidence is retained in the controller's execution ledger. Root corrected removal of two obsolete, comment-only source placeholders after interrupting the worker's unnecessary alternate-tool discovery. The worker's semantic manifest assertion repair was retained; it inspects declarations rather than matching permission names in comments. The probe's compiled active Kotlin/build/manifest source remained unchanged by that cleanup.

Root evidence files: `a4-r2-real-dex-checks.json`, `a4-probe-r4-build.txt`, `a4-r4-probe-artifact-inspection.json`, `a4-r5-harness-tests.txt`, `a4-r5-npm-test.txt`, `a4-r5-typecheck.txt`, `a4-r5-lint.txt`. Independent pinned review remains a separate gate.
