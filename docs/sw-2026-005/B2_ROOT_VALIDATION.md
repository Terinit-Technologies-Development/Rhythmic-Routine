# B2 required restorative workflow validation

Baseline: reviewed B1 `973b6c0fea509ba763c1334d5d6fb5b2c2c00c84`. EngiOrch stream `a2b581e4-1dae-4e4d-8db8-31856289072a`; persistent OpenCode DeepSeek v4.1 Flash source session `0d4b72f2-dd3c-454f-8db2-015a9ac471b5`. Two implementation turns used the same native history. Root paused the writer before checks.

The change adds exact-bound Reader/Meditation evidence reconciliation on lifecycle and bounded polling, stable per-gate/provider sessions, correct cooldown-Meditation identity qualification, a persisted per-Attention-Day completion ledger and native Insights counting that retains completed gate history. Existing CD3 aggregate evidence and independent cooldown/obligation holds remain. Additive persisted fields preserve old records and their numeric cap count; no provider protocol, policy number, permission or dependency changes are intended.

Actual first validation: 515 tests, 507 pass and eight fail; typecheck exit 2; lint exit 0. Failures included new tests using unsupported Jest globals, optional ledger shape expectations and positive Meditation fixtures missing required kind/source metadata. The same engineer converted tests to node:test/assert, added a sound nullable evidence guard, preserved absent legacy ledger shape, and updated positive fixtures with exact binding metadata while retaining negative assertions. These failures remain in b2-r1 evidence.

Final root results:

- Focused affected domain/coordinator and old regression files: 64 tests, 14 suites, zero failures/cancellations/skips, 1.997 seconds; b2-r2-focused.txt.
- Full npm test: 522 tests, 101 suites, zero failures/cancellations/skips, 67.191 seconds; b2-r2-test.txt. Typecheck and lint exit 0 with no warnings; b2-r2-js-checks.json and corresponding logs.
- Fresh Expo Android preparation: successful, no additional package changes; b2-r2-android-prebuild.txt. Existing system-UI advisory recorded, no dependency added.
- Fresh Android native: 162 tests, 19 suites, zero failures/errors/skips, build success in 4m24s; b2-r2-native-tests.txt and b2-r2-native-counts.json (44 input hashes). Existing compiler/deprecation warnings remain.

The coordinator tests exercise public lifecycle/refresh entry points with injected providers; native ledger tests cover history replacement, JSON roundtrip, per-day counting/deduplication and exclusion of morning completion. Root added the application test-directory glob to npm test so these coordinator regressions run normally. No other root production edit is included in this B2 patch.

Owner scope: this is a PRD research implementation, not an open-ended production-hardening programme. Additional noncritical edge cases are documented/deferred. Independent review must assess explicit requirements and material regressions, including FR-08–FR-13, T06, T10–T18 and T21, without restarting exhaustive unchanged-source inspection.

Independent acceptance remains pending. Tests do not establish installed Binder/signature interaction, accessibility intervention, actual provider session completion or physical persistence/reboot behavior. B3 display verification, C1 cross-repository integration, C2 signed-artifact handoff, C3 physical tests and C4 release preparation remain. No phone modification, PR, merge, protected push, tag or release occurred.

## Approved owning-day correction

The independent reviewer completed all 34 changed ranges plus two requested caller ranges. Its follow-up found that the JS stale-day guard removed an actual unfinished CD4 obligation. Root also reproduced a late old-day completion incrementing both old and current day counts. These contradict approved PD-2, FR-12/FR-16/T06 and POL-05; they are explicit required behavior, not a new edge-case hardening pass. The original formal review remains honestly BLOCKED at 8014eb5 despite its independent 162 native and 522 JavaScript tests passing.

The same engineer retained unfinished non-legacy gates in evaluation and derived status, evaluates their original-day cap, preserves completion history across a boundary, and charges late completion only to the original day. Current-day counters remain independent. New production reducer/ledger tests cover carry, correct late completion, repeated receipt and wrong binding. Legacy Reader V2 calendar evidence scope is unchanged.

Root direct before/after reproduction: carriedGateRetained false→true; current-day count after old completion 1→0; original-day count remains 1. First focused run: 67/68 passed; the remaining older schedule-edit test explicitly expected the unfinished gate to vanish at the next boundary. Root changed that expectation to require the original gate while retaining the new-day zero-counter assertion. Final focused run: 68 tests, 15 suites, zero failures/cancellations/skips (1.742 seconds), b2-r3b-focused.txt. Full run: 526 tests, 102 suites, zero failures/cancellations/skips (66.240 seconds), b2-r3b-test.txt; typecheck/lint exit0 with no warnings. Earlier failed evidence is retained.

All 44 native input hashes match the fresh R2 native run; b2-r3-native-reuse.json explicitly reuses 162 tests/19 suites rather than claiming a new native execution. This correction changes only JavaScript tests/product code and this report. Independent follow-up should inspect this small diff and run the updated JavaScript suite; it need not restart unchanged native/source reviews.

Limits remain: injected reducer/coordinator tests are not installed cross-app evidence. Reconstruction of pre-upgrade numeric-only historical day counts was not added; upgrade/migration qualification remains for the existing C1/C3 scenarios, without a general legacy hardening project. Native projection of a carried completion and actual provider activity require integration/device verification. No whole-programme acceptance is claimed.

## Owning-day provider-selection entry point

Independent follow-up at de600d6 passed 526 JavaScript tests but requested one correction: SELECT_RESTORATIVE_PROVIDER still checked the current day's cap while gate evaluation/display checked its owning day. The same engineer changed that handler to use the gate's day. Two production reducer cases verify both directions: an exhausted current day cannot block an eligible carried gate, and an exhausted owning day cannot be bypassed by a fresh current day. Stable IDs and progress locking remain.

Root results: 12 focused workflow tests across three suites pass (0.311 seconds); full 528 tests/102 suites pass with zero failures/cancellations/skips (68.648 seconds); typecheck and lint exit0/no warnings. Evidence b2-r4-focused.txt and b2-r4-{test,typecheck,lint}.txt/js-checks.json. Only the selection handler/tests and this report changed; the unchanged native result remains the 162-test R2 run with its recorded 44-input verification. No new native execution is claimed. This closes the observed selection mismatch pending actual independent re-review; physical and integration gates remain outstanding.
