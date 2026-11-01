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
