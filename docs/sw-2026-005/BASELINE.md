# SW-2026-005 baseline

R0 in progress, 29 October 2026. Read with EXECUTION_LEDGER.md, TEST_MATRIX.md and RISK_REGISTER.md. No production changes accepted.

## Source and version inventory

| App | Canonical revision | Default | Canonical version/code | Preserved local dirty version/code |
|---|---|---|---|---|
| Routine | 2b20a113ba23a74b328cdc519800ea790897a09e | master | 1.3.0 / 5 | 1.3.2 / 7 |
| Reader | 01d74fefa89791c6cb5dbd0696de835ed027acb0 | master | 1.3.0 / 3 | clean source, 1.3.0 / 3 |
| Meditation | 4afdc0a852b53f3ce581ae3c08927a6a3a19718d | main | 1.0.0 / 2 | 1.0.1 / 3 |

Fresh fetches match the PRD. Original source branches, tags, status and remotes are captured in the three original-baseline.txt inventories. No open PRs. Existing repos are public. No remote mutation, merge or tag performed. Local worktrees use codex/sw-2026-005-r0 branches. Installed owner APK truth is NOT VERIFIED; no phone requested or accessed.

The newer uncommitted version declarations must not be overwritten or ignored when allocating release codes. Provisional minimum candidates, subject to any later-discovered installed/newer builds: Routine1.4.0/code8; Reader unchanged1.3.0/code3 or1.3.1/code4 if changed; Meditation1.0.2/code4 if changed. No version files changed in this assignment.

## Verified checks

| Source | Command / result | Evidence |
|---|---|---|
| Routine baseline | npm test: 423 pass,0 failed,0 skipped,82 suites; exit0 | routine-baseline-test.txt |
| Routine baseline | npm run typecheck: exit0 | routine-baseline-typecheck.txt |
| Routine baseline | npm run lint: exit0 | routine-baseline-lint.txt |
| Routine baseline | Expo Android prebuild --no-install: exit0, no package.json change | routine-baseline-prebuild.txt |
| Reader baseline | :app:testDebugUnitTest:106 pass,0 failed/errors/skipped; exit0,10m13s cold build | reader-explicit-toolchain-unit.txt; reader-unit-summary.json |
| Meditation baseline | :app:testDebugUnitTest:177 pass,0 failed/errors/skipped; exit0,5m31s | meditation-clean-home-native-unit.txt; meditation-unit-summary.json |
| Routine baseline | native module suite IN PROGRESS | routine-clean-home-native-unit.txt |
| Toolkit recovery fix7d72a3e | full65 tests pass,0 failed/skipped; exit0 | engiorch-recovery-suite.txt |

Baseline tests do not certify required new behaviour. Independent canonical-source reproductions confirm a72h weekend day and a DST interval excluding now (attention-day-baseline-reproductions.json). Complete requirement mapping remains open in TEST_MATRIX.md.

## Environment

Windows11, Node24.13.0; OpenCode2.0.26; Codex0.152.1; Antigravity1.4.10. JBR21 runs Gradle9.3.1; installed Microsoft JDK17 supplied explicitly for compiler/test toolchain. Android SDK D:/UserData/Xcerpt/Android/Sdk. Native builds use one worker and1024MiB heap, in-process Kotlin. No broad process termination.

Existing shared Gradle script compilation fails with Settings_gradle constructor NoSuchMethodError. Fresh independent home D:/Caches/sw005-gradle-clean2 plus official checksum-verified Gradle distribution and explicit Java17 path works. Existing caches and all original repository work preserved. First isolated attempt sharing modules-2 still failed, so do not reuse that home as the working mitigation or claim exact offending artifact identified.

Routine dependencies are a node_modules junction to the existing installed tree; lockfile root app version differs, dependency entries match. This is baseline verification with reused dependencies, not fresh-install proof. Generated Android source is ignored and local. Existing Android build helper kills every Java process; it has not been invoked.

## Provider results and limits

OpenCode DeepSeekV4.1Flash actually investigated source, wrote R0 documents and resumed the same durable native history after interruptions and controller restarts. Its first contract draft drifted from FR-08 and is being corrected in that same conversation. Drafts are not accepted policy or implementation.

Codex GPT-6.1Terra(high) actual review turn failed HTTP400 model_not_found for this ChatGPT account. Exact native error saved. No substitute GPT5.6 review claimed. Authorized Antigravity Gemini3.8FlashHigh initialization worked, but initial toolkit-review turn exceeded180s and remains UNKNOWN. No verdict or automated repeat of that uncertain turn.

## Remaining R0 work

Complete Meditation and Routine native baselines, review companion contracts and existing dirty patches, reconcile #8/#10/#13, finalize source-backed defect/compatibility register and file ownership, obtain the three policy decisions requested in OWNER_POLICY_REVIEW.md, and independently review the contract. Later physical/signing/release gates remain mandatory.
