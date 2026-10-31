# B1 morning enforcement — root validation

Candidate builds on accepted boundary contract 30747783b66e8969ae4aadfafa6e60281f9239ed. Morning enforcement now creates deterministic persisted requirements, carries actual unfinished bindings, verifies exact native Meditation identity, and enforces the hold in native and JS decisions with Essential/companion access and lease refusal.

The persistence path uses serialized accepted snapshots and atomic mutation/rebase to protect newer native requirements and verified completion from stale publishers. Provider observations happen before the persistence transaction; mutation re-reads accepted state. Reader observation timing remains subject to installed-service validation. Morning does not debit the cooldown substitution cap.

Root independently ran the following on 30 October 2026, after the source worker completed and paused:

| Check | Result |
| --- | --- |
| Standard `npm test` | 461 tests, 90 suites, zero failures/cancelled/skipped; 91.371 seconds |
| `npm run typecheck` | Exit 0 |
| `npm run lint` | Exit 0 |
| Actual `:rhythm-device:testDebugUnitTest` | 112 tests, 13 suites, zero failures/errors/skipped; build 5m11s |
| `git diff --check` | Exit 0 |

Native invocation used official Gradle 9.3.1, Android Studio JBR, the generated Android project, one worker/no parallel daemon, 1024 MiB heap, in-process Kotlin and a fresh-test init script. The successful run first rebuilt a generated Expo launcher plugin whose jar lacked its implementation class. The preceding R6 attempt failed during project configuration and executed no product tests. No dependency source or global system configuration was changed to repair that generated artifact.

Detailed command logs and fresh XML counts are retained in the orchestration workspace as `outputs/rhythmic-sw2026-005/b1-r7-{native-tests,native-counts,test,typecheck,lint,js-checks}` with the respective `.txt`/`.json` extensions. The earlier R3 full raw log was accidentally overwritten and is explicitly documented as unavailable; its retained terminal compiler excerpt is not a full raw log.

These are local source/JVM checks. Storage concurrency regressions exercise fake-store and pure production seams, not physical SharedPreferences disk failures, Binder timing, process death or reboot. No APK installation, physical T01–25, final signing, C2, device readiness or release acceptance is claimed. B2 remains a separate serial lane. Independent pinned-source review is required after this candidate commit.

## Classification publication follow-up — SW-2026-005 FR-07/17, POL-08/09, T07/T24

Root found that indefinitely unioning historical Essential membership could retain an exemption after deliberate reclassification. Explicit classification projections are now distinguished from missing fields. Native gate/morning persistence preserves the latest accepted classification, while authoritative JS projections can apply forward and reverse reclassification. A promise queue serializes overlapping native sync publications and remains usable after a rejected publication. This repairs projection ownership; it does not change which classifications the owner may select.

Fresh root checks after these changes, with the original OpenCode source session completed and paused:

| Check | Result |
| --- | --- |
| Standard `npm test` | 463 tests, 90 suites, zero failures/cancelled/skipped; 99.071 seconds |
| `npm run typecheck` / `npm run lint` | Both exit 0 |
| Actual `:rhythm-device:testDebugUnitTest` | 115 tests, 13 suites, zero failures/errors/skipped; build 5m24s |
| `git diff --check` | Exit 0 |

Detailed evidence uses the same orchestration output directory with `b1-r9-` prefixes. Added tests cover forward/reverse reclassification, missing projection, a stale native copy after newer classification, serialized overlapping publications and queue recovery. The tests retain the local seam limitations above.

The earlier Gemini review independently executed 112 fresh tests on intermediate f14ff5969201bcfafdf60c9874e8bbf82af89283, but timed out before an authoritative verdict and remains UNKNOWN. That intermediate review is not acceptance of this follow-up. A separately installed Codex build has now passed an actual GPT-6.1 Terra high-effort readiness turn; a distinct independent review of the new checked commit is required.


## 31 October 2026 — R10–R13 exhaustion persistence and exact recovery

Root corrected source after independent Terra F1 and subsequent root inspection: exhaustion allocation and its CD4 restorative gate share the canonical atomic persistence bundle; failed recovery keeps the unresolved cooldown witness at expiry; recovery uses persisted immutable Attention Day and exact group/kind/ordinal/creation/gate identity, never the current schedule. New optional cooldown attentionDayId metadata survives native/JS serialization and import. Legacy identity that cannot be established remains unresolved. Existing Emergency Access behavior is preserved under the owner’s explicit 31 October exception, with mandatory morning focus unchanged.

Actual root checks: 118 native tests across 13 JUnit suites, zero failures/errors/skips; 463 JavaScript tests across 90 suites, zero failures/cancellations/skips (86.386 seconds); typecheck and lint exit 0. Native Gradle task succeeded in 2m03s. Evidence: outputs/rhythmic-sw2026-005/b1-r13-native-tests.txt, b1-r13-native-counts.json, b1-r13-test.txt, b1-r13-typecheck.txt, b1-r13-lint.txt and b1-r13-js-checks.json in the orchestration workspace.

This is tested corrective source, not independent acceptance, installed-service proof or physical acceptance. Formal reviews at the earlier b174 snapshot remain BLOCKED. Independent inspection of the new diff is still required. Confirmed open programme findings include failed lease-write acknowledgements (F3), null morning source omission at the native/JS evidence boundary (F4), failed first-morning creation leaving no hold (F5), stale asynchronous timestamps regressing JS state (F6), misleading morning-only cooldown UI (F7), and Insights substitution projection limitations needing B2 ledger verification (F8). These findings must not be hidden by the passing suites.


## 1 November 2026 — R14–R16 first-morning persistence failure

When first eligible morning creation cannot commit, the native service retains the exact current-day binding as a process-local fail-closed intent. The effective-restriction predicate, bridge snapshot and diagnostics use the production effective projection. Persisted historical pending obligations remain carried; an exact persisted completion or durable retry supersedes its transient copy. Wrong identity, creation time, kind or source cannot clear a transient failure. Startup reconciles morning requirements before usage admission. Essential/companion reachability and the approved Emergency Access exception remain unchanged; Emergency Access never bypasses morning focus.

Actual root checks after the original OpenCode session completed and was paused: 121 native tests across 13 suites, zero failures/errors/skips; Gradle succeeded in 2m15s. JavaScript: 463 tests across 90 suites, zero failures/cancellations/skips, 73.651 seconds. Typecheck and lint both exit 0. Root diff whitespace check passed. Evidence in the orchestration workspace: outputs/rhythmic-sw2026-005/b1-r16-{native-tests.txt,native-counts.json,test.txt,typecheck.txt,lint.txt,js-checks.json}.

Direct tests exercise production projection/identity helpers, first-creation intent, retry, exact completion, wrong binding, previous-day transient exclusion and persisted pending carry. They do not execute an installed accessibility service or prove physical disk-failure recovery. Process death before a successful durable commit loses the transient copy; startup must rederive the eligible identity. These are tested corrections, not independent B1 acceptance or C2/device readiness. Independent review of this new diff remains required. F3/F4/F6/F7 and B2 substitution-ledger work remain open.
