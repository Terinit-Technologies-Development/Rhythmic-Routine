# B1 morning enforcement â€” root validation

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

These are local source/JVM checks. Storage concurrency regressions exercise fake-store and pure production seams, not physical SharedPreferences disk failures, Binder timing, process death or reboot. No APK installation, physical T01â€“25, final signing, C2, device readiness or release acceptance is claimed. B2 remains a separate serial lane. Independent pinned-source review is required after this candidate commit.

## Classification publication follow-up â€” SW-2026-005 FR-07/17, POL-08/09, T07/T24

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


## 31 October 2026 â€” R10â€“R13 exhaustion persistence and exact recovery

Root corrected source after independent Terra F1 and subsequent root inspection: exhaustion allocation and its CD4 restorative gate share the canonical atomic persistence bundle; failed recovery keeps the unresolved cooldown witness at expiry; recovery uses persisted immutable Attention Day and exact group/kind/ordinal/creation/gate identity, never the current schedule. New optional cooldown attentionDayId metadata survives native/JS serialization and import. Legacy identity that cannot be established remains unresolved. Existing Emergency Access behavior is preserved under the ownerâ€™s explicit 31 October exception, with mandatory morning focus unchanged.

Actual root checks: 118 native tests across 13 JUnit suites, zero failures/errors/skips; 463 JavaScript tests across 90 suites, zero failures/cancellations/skips (86.386 seconds); typecheck and lint exit 0. Native Gradle task succeeded in 2m03s. Evidence: outputs/rhythmic-sw2026-005/b1-r13-native-tests.txt, b1-r13-native-counts.json, b1-r13-test.txt, b1-r13-typecheck.txt, b1-r13-lint.txt and b1-r13-js-checks.json in the orchestration workspace.

This is tested corrective source, not independent acceptance, installed-service proof or physical acceptance. Formal reviews at the earlier b174 snapshot remain BLOCKED. Independent inspection of the new diff is still required. Confirmed open programme findings include failed lease-write acknowledgements (F3), null morning source omission at the native/JS evidence boundary (F4), failed first-morning creation leaving no hold (F5), stale asynchronous timestamps regressing JS state (F6), misleading morning-only cooldown UI (F7), and Insights substitution projection limitations needing B2 ledger verification (F8). These findings must not be hidden by the passing suites.


## 1 November 2026 â€” R14â€“R16 first-morning persistence failure

When first eligible morning creation cannot commit, the native service retains the exact current-day binding as a process-local fail-closed intent. The effective-restriction predicate, bridge snapshot and diagnostics use the production effective projection. Persisted historical pending obligations remain carried; an exact persisted completion or durable retry supersedes its transient copy. Wrong identity, creation time, kind or source cannot clear a transient failure. Startup reconciles morning requirements before usage admission. Essential/companion reachability and the approved Emergency Access exception remain unchanged; Emergency Access never bypasses morning focus.

Actual root checks after the original OpenCode session completed and was paused: 121 native tests across 13 suites, zero failures/errors/skips; Gradle succeeded in 2m15s. JavaScript: 463 tests across 90 suites, zero failures/cancellations/skips, 73.651 seconds. Typecheck and lint both exit 0. Root diff whitespace check passed. Evidence in the orchestration workspace: outputs/rhythmic-sw2026-005/b1-r16-{native-tests.txt,native-counts.json,test.txt,typecheck.txt,lint.txt,js-checks.json}.

Direct tests exercise production projection/identity helpers, first-creation intent, retry, exact completion, wrong binding, previous-day transient exclusion and persisted pending carry. They do not execute an installed accessibility service or prove physical disk-failure recovery. Process death before a successful durable commit loses the transient copy; startup must rederive the eligible identity. These are tested corrections, not independent B1 acceptance or C2/device readiness. Independent review of this new diff remains required. F3/F4/F6/F7 and B2 substitution-ledger work remain open.


## 1 November 2026 â€” R17â€“R18 explicit-null morning evidence wire identity

The production native evidence converter now preserves the intentional null cooldown source for morning sessions. Its mandatory identity-presence argument comes directly from the native parser; legacy or partial columns and explicit fallback metadata-unavailable results cannot gain fabricated identity. The frozen seven-column protocol remains compatible. Direct parser-to-converter regressions cover complete/partial/legacy/fallback cases, and Kotlin conversion and JavaScript parsing consume one shared wire fixture. Coordinator diagnostics require identity metadata before claiming provider-verified satisfaction.

Actual root checks: 128 native tests across 14 suites, zero failures/errors/skips; 467 JavaScript tests across 91 suites, zero failures/cancellations/skips (70.001 seconds); typecheck and lint exit 0. Native repaired run succeeded in 4m05s. Evidence: orchestration outputs/rhythmic-sw2026-005/b1-r18b-{native-tests.txt,native-counts.json,test.txt,typecheck.txt,lint.txt,js-checks.json}.

The first R18 native attempt failed before tests because a generated Expo plugin JAR lacked its implementation class. That failure is preserved separately. Root rebuilt only generated plugin outputs, verified the implementation class was restored, then ran all tests freshly; no product or dependency source repair was needed. Actual Expo null serialization and installed cross-app IPC remain device-gate work. These checks are not independent B1 acceptance. F3 lease-write acknowledgements, F6 delayed-response state regression, F7 UI and B2 work remain open.


## 1 November 2026 â€” R19â€“R23 lease acknowledgement and failure-state recovery

Native lease start/end now return actual accepted-persistence results, with scheduler side effects after successful commit inside the canonical snapshot lock. A shared production seam has JVM failure/success/idempotency tests. The JavaScript provider preserves false, thrown and unavailable outcomes; coordinator lease acknowledgements precede explicit start/end and group-deletion reducer mutations. State operations use one serialized queue. Remaining lease effects execute before history/restriction effects; rejected transitions restore their prior runtime while retaining tracked native effects that actually committed. This is not a claim of cross-system atomicity for arbitrary storage failures.

The error surface survives both disabled-mode and partner-approved failure, and retry requests fresh authorization. If a native lease was acknowledged but later local projection fails, the message reports uncertainty instead of falsely saying access was never granted. Startup readiness is required at public mutation/lifecycle entrypoints, with a distinct internal bootstrap reconciliation path. Root authored public-entrypoint regressions and corrected type narrowing and a private bootstrap guard while the original native engineer was paused; these manual interventions are part of this change.

Actual final root checks: 475 JavaScript tests across 92 suites, zero failures/cancellations/skips (59.973 seconds); typecheck and lint both exit 0 with no warnings. Eight focused provider/coordinator/store/startup/failure-path tests also pass. Evidence uses b1-r23b-* and b1-r23-postack-{before,after}.txt in the orchestration output directory. Earlier failed checks are retained, including the reproduced cooldown loss on rejected group deletion and misleading post-acknowledgement error text.

Android: 133 tests across 15 suites, zero failures/errors/skips, fresh Gradle run in 3m45s (b1-r22c-native-tests.txt/native-counts.json). R23 changed only TypeScript; all 38 recorded Kotlin/test/Gradle/package inputs remain identical, verified in b1-r23-native-input-verification.json and again before commit. The shared native fixture and Android configuration have no additional diff. Native tests are reused on that explicit scope, not represented as a new R23 Android execution.

Independent review of the new diff is still required. Real installed-service disk faults, rendered UI, multi-effect partial native persistence and cross-app physical acceptance are not proved by these seams. The existing configuration-preference ordering remains visible in the source; no broad distributed-transaction guarantee is claimed. F6 delayed evidence ordering, F7 morning-only UI, B2/B3 and the C gates remain open. The owner's approved Emergency Access exception under existing Accountability remains, with compulsory morning focus and Essential safety unchanged.


## 1 November 2026 â€” R24â€“R25 delayed morning evidence

Morning observations now revalidate the current immutable requirement and full provider identity after awaiting the query, and apply valid evidence at receipt time. Missing cooldown-source metadata cannot masquerade as explicit null. Diagnostics pair the displayed requirement with its own satisfaction state. Deferred production-coordinator regressions cover rejected wrong binding, serialized queued work, old carried completion and a still-pending current obligation without cap debit.

Root corrected two test-fixture assumptions while the original engineer was paused: model an already-enforcing historical migration, and compare the final diagnostic against canonical display ordering after all obligations complete. Earlier failed/cancelled attempts are preserved. Final focused run: 6 tests pass, zero failures/cancellations/skips. Final full run: 477 tests pass, zero failures/cancellations/skips (63.613 seconds); typecheck and lint exit 0. Evidence: b1-r25c-{focused,test,typecheck,lint}.txt and b1-r25c-js-checks.json. All 38 recorded native input hashes remain identical; 133 native tests are reused on that explicit scope, not claimed as a fresh Android run.

Independent review remains pending. No installed-device or Binder acceptance is claimed. A separate native path currently drops identity-metadata availability before morning qualification; it remains open for the next corrective pass along with detailed query diagnostics, morning-only UI and later programme gates.


## 1 November 2026 — R26–R27 query outcomes and native identity qualification

The additive detailed query API preserves query-time failure classification, identity-column availability and explicit-null morning source. Existing provider V1 and legacy query API remain supported; ambiguous legacy null is not declared a positively missing session. A shared native detailed mapper is exercised directly and used by the Expo module. Native morning reconciliation retains the complete query result outside the persistence lock, then requires available outcome and complete metadata before exact-binding qualification inside the accepted-snapshot operation. The older trusted raw-evidence adapter has no remaining service caller.

A real parser regression filters values to actual returned columns: a partial nine-column row has null source and appears complete to the old raw predicate, while the result-aware path rejects it. Valid ten-column explicit-null completion succeeds. Legacy seven columns, wrong identity/day/kind/source and failed result with evidence cannot satisfy. JavaScript bridge and coordinator reject failed outcomes even if contradictory completion evidence is attached; malformed modern success is corrupt.

Root checked actual production seams after the original engineer completed and paused. Fresh Android: 135 tests, 15 suites, zero failures/errors/skips, build success in 1m20s; b1-r27-native-tests.txt and b1-r27-native-counts.json (39 native input hashes). Focused JavaScript: nine pass, zero failures/cancellations/skips, b1-r27b-focused.txt. Full JavaScript: 485 pass, 94 suites, zero failures/cancellations/skips, 64.076 seconds, b1-r27b-test.txt. Final typecheck and lint both exit0/no warnings, b1-r27c-{typecheck,lint}.txt.

Root interventions while paused: optional-method assertion in tests; additional contradictory-error regression proved the adapter still exposed evidence; root added strict positive-result validation and malformed-success regressions. An unreachable comparison left after narrowing was removed after the full test run, with final type/lint checks; it always evaluated false and changes no emitted result. Earlier failed checks, including that type error and the genuine error-evidence regression, remain saved. No test result was substituted for installed Binder, signature or device acceptance. Independent review remains pending; F7 morning-only UI and later B2/B3/C gates remain open.


## 1 November 2026 — R28 morning-only Touch Grass presentation

Touch Grass consumes a production presentation selector and canonical morning runtime projection. A default risk group no longer fabricates allowance exhaustion, cooldown badge or countdown for a morning-only hold. Actual cooldown and post-timer reading modes retain their separate content; morning coexistence remains visible and Emergency Access wording does not promise a morning bypass. Enforcement and authorization policy are unchanged.

Root focused selector regressions: five pass. Full JavaScript run: 490 tests, 95 suites, zero failures/cancellations/skips (64.705 seconds), b1-r28c-test.txt. Final typecheck and lint exit0/no warnings, b1-r28e-{typecheck,lint}.txt. Root corrected a redundant narrowed selector condition while the engineer was paused, then replaced a render-time clock call caught by lint with the existing countdown-hook value. The latter UI wiring change is covered by final static checks, not represented as a repeated full suite or rendered test. Earlier failed checks remain saved; one attempted edit failed decoding before mutation and its checks re-exposed the same lint issue.

All 39 native input hashes match fresh R27 evidence (135 tests across 15 suites); reuse verification b1-r28-native-input-verification.json. No new Android run is claimed for this UI-only change. Physical rendering, installed enforcement and independent review remain pending; this commit is not B1 or programme acceptance. B2/B3 and C gates remain required.


## 1 November 2026 — R29–R30 failed morning-intent carry and retry

Independent Terra review at 9781485 returned BLOCKED with F11: an actual failed first-creation binding was excluded after its Attention Day and was not merged into later persistence retries. Process-local intents now carry until their exact immutable binding is durably represented. The service queries accepted and held real pending bindings outside the persistence lock, reloads and merges under the canonical lock, then retries accepted persistence. Its production no-op/intent-retention helpers are tested directly. Saving a pending binding clears its transient write failure but never marks the obligation complete. Oldest unfinished obligations remain first, including on inactive next mornings; no historical obligations are fabricated.

Fresh root Android run: 137 tests across 15 suites, zero failures/errors/skips; build succeeded in 3m40s, b1-r30c-native-tests.txt/native-counts.json. Earlier failures remain: R29 expected a saved-but-unfinished first obligation to disappear from oldest-first order; R30 test compilation had JUnit message argument last; root corrected only that test argument while the engineer was paused. R30b failed before tests because a generated Expo plugin JAR again lacked its implementation class. R30c rebuilt generated plugin outputs with incremental compilation disabled, without dependency/product changes.

The only source changes before this documentation were three Kotlin files. Existing 490 JavaScript tests and final typecheck/lint at 9781485 are reused on unchanged JavaScript/package/config inputs, recorded in b1-r30-js-source-reuse-verification.json; no new JS execution is claimed. The tests exercise the exact helper decisions wired into the service, not Android SharedPreferences fault injection. Process death before any durable success still loses RAM-only intent; a prior binding without any persisted witness cannot be reconstructed. That limitation remains explicit for independent and device acceptance. New corrective source still requires review; old BLOCKED and UNKNOWN records remain preserved.


## 1 November 2026 — R31–R33 native expiry, retry and carried-gate corrections

The context and service expiry paths share recovery for a missing restorative gate. Context persistence reloads accepted gates after recovery so its final write does not replace the recovered gate with a stale snapshot. Exhaustion plans against the latest accepted state inside the canonical lock. Failed or thrown commits use the production ExhaustionAttempt/ExhaustionRetryController path to retain a pending hold and schedule one bounded five-second retry per group. The original deadline is retained; current policy is reloaded. Accepted carried gates are used by the effective restriction predicates, with pending same-group bindings protected from replacement and wrong immutable-owner completion. Completed history permits a legitimate new cycle.

Root manual production corrections while the original engineer was paused: use the allocated counter state on a same-day accepted write while preserving a newer global day; preserve civil reporting date/time and monotonic counters; do not clear another group's active usage segment after a delayed retry. Two production-state-selection tests cover same-day advancement and prior-day retry preservation. Root also authored different-ID and wrong-owner carry regressions and corrected old erasure/replacement expectations, JUnit message argument order, a fake scheduler that retained consumed callbacks, and a fixture that asserted a restorative target it had never supplied. Exact valid completion is checked alongside wrong-binding cases.

Fresh final root Android: 153 tests across 16 suites, zero failures/errors/skips; build success in 1m09s, b1-r33c-native-tests.txt/native-counts.json (41 recorded inputs). Earlier failed runs remain: R31 139/1, R32 147/2, R33 151/3 and R33b 153/1, with actual failures and fixture corrections preserved. This is not a claim that every failing test was a product defect. Only eight Kotlin files changed before this documentation. Existing 490 JavaScript tests plus final typecheck/lint are reused on unchanged JavaScript/package/config inputs in b1-r33-js-source-reuse-verification.json; no new JS run is claimed.

The tests exercise production allocation/merge/attempt functions and injected scheduler/commit callbacks wired into the service. They do not execute Android SharedPreferences faults, installed intervention, Binder or a full Android-context cross-day interleaving. The pending-intent process-death-before-durable-acceptance limitation remains. Cross-day retry policy/history and full B2 durable provider ledger still need programme-level verification. New source requires independent review; F17/F18/F21 bridge identity, F22 readiness, F19/F20 UI and all later gates remain open. PRD re-fetch remained byte-identical at 35,340 characters.
