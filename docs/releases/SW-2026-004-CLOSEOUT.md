# SW-2026-004 — Three-app qualification closeout

- **Date:** 2026-09-30
- **Device:** Xiaomi Redmi Note 13 Pro+ 5G (`23129RN51X`), Android 16 / API 36,
  ADB serial `P7J7TGKNAY8DKJ5P`
- **Scope:** Rhythmic Routine + Rhythmic Reader + Rhythmic Meditation as one
  Android ecosystem.

## Final status

**HOLD — the target-device qualification matrix is incomplete. The CD3 Reader
baseline, CD4 Reader recovery launch, CD4 Meditation launch from Routine, and
physical reboot/time-change, provider-failure, and battery/Insights checks are
not all verified end-to-end on the target device.**

Automated checks are green and both Routine and Reader v1.2 state migrations
were exercised through in-place package replacement. Earlier physical results
remain documented in the linked handoffs. This closeout does not authorize a
merge, tag, release, store submission, or production promotion.

## Policy and ownership verified in code/tests

| Area | Qualified behavior |
| --- | --- |
| Cooldowns | CD1–2 require separation only; CD3 requires 90 minutes plus 3600 Reader seconds / 36 pages; CD4+ requires 90 minutes plus one restorative choice: Reader 1800 seconds / 11 pages or Meditation 1800 qualified seconds. |
| Re-entry | `canReenter = cooldownElapsed && restorativeGateSatisfiedOrAbsent`; restorative completion does not alter `cooldownEndsAt`. |
| Legacy migration | Existing v1.2 cumulative Reader gates are retained as `LEGACY_READING` with their original numbers (including 5400 / 47); they are not converted into new 1800 / 11 requirements. |
| Ownership | Routine owns cooldown policy, enforcement, and gate metrics; Reader owns outward-attention evidence; Meditation owns restorative-session evidence. |
| Attention Day | Ordinals/substitution count carry through midnight until the saved Morning-Buffer boundary; schedule edits preserve the active day and use the new schedule at the next effective boundary. JS and native regressions cover rollover, edits, stale snapshots, and allocation idempotency. |

## Automated verification

| Repository | Final checks |
| --- | --- |
| Rhythmic Routine | `npm test`: **420 / 420**, 82 suites; `npm run typecheck`; `npm run lint`; `:rhythm-device:testDebugUnitTest` (**76 test methods**, successful forced rerun); `:rhythm-device:compileDebugKotlin`; `:app:processReleaseMainManifest`; ARM64 and ARMv7 `:app:assembleDebug` — all passed. |
| Rhythmic Reader | `test`, `assembleDebug`, `lintDebug` — passed; **106 / 106** unit tests. |
| Rhythmic Meditation | `:app:testDebugUnitTest`, `:app:assembleDebug`, `:app:lintDebug` — passed; **175 / 175** unit tests. |
| Instrumentation | A final `:app:connectedDebugAndroidTest` attempt on the Redmi ran **0 tests**: Gradle's default debug key did not match the already-installed shared QA signer (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`). Previous recovery-intent/cursor instrumentation results and the physical cold-start provider query are recorded in the Pass 03/04 handoffs. |

## In-place upgrade evidence

### Routine v1.2 → current working tree

- Baseline source: `93d3a8d15ef861dc0fa7cac2ba806df927d358e1`; APK package
  `com.terinit.rhythmicroutine`, versionCode `4`, versionName `1.2.0`.
- Baseline and current APKs were built for the device's `armeabi-v7a` ABI and
  verified with the same signer SHA-256
  `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`.
- Used `adb install -r` for baseline and current builds; no uninstall or
  `pm clear` was used. A representative baseline persisted CD4 state was set
  directly in the app-private store: ordinal 4, active legacy gate 5400 / 47,
  and a fixed cooldown end. This fixture does not claim a completed reading
  session.
- After loading the updated JS bundle, the persisted state showed a
  `LEGACY_READING` gate, `in-progress`, the same 5400 / 47 values, ordinal 4,
  daily count 4, and unchanged `cooldownEndsAt`. Native projection retained the
  gate. A force-stop/relaunch preserved the same gate ID, values, status,
  ordinal, and cooldown end. The Attention-Day ID and next boundary were also
  populated.

### Reader v1.2 → current working tree

- Baseline source: `3515dcb2865b59c7d0ac96b8e64a496d9c693dfa`; APK package
  `com.terinit.rhythmicreader`, versionCode `2`, versionName `1.2.0`.
- Baseline/current installs used `adb install -r`, same package metadata, and
  the same signer SHA-256 as above; no uninstall or clear-data was used.
- The test PDF was imported through the document picker on the baseline. A
  representative active legacy session was seeded in the private Room database
  with the 5400 / 47 requirements, 1,800,000 ms progress, and one qualified
  page row. After update, `PRAGMA integrity_check` returned `ok`; Room remained
  at schema 4; the book, daily evidence rows, active V1 session, original
  requirements/progress, and qualified-page row were preserved.
- Full data and limitations are in
  [`Rhythmic-Reader/docs/SW-2026-004-READER-UPGRADE.md`](../../../Rhythmic-Reader/docs/SW-2026-004-READER-UPGRADE.md).

These are app-state migration checks on the same package/signer. The app
version metadata is intentionally still v1.2.0 / the baseline versionCode in
these working-tree builds; no release version bump or distribution is included
in this qualification.

## Device evidence already recorded

- Routine’s native enforcement/capability blocker, production-equivalent
  ordinal allocation, and CD4+ Reader/Meditation provider paths are documented
  in `PASS_03_RESTORATIVE_GATES.md`, including persisted-state comparison and
  unchanged cooldown end after bound Meditation completion.
- Meditation’s 30-minute screen-off session, exact 1800-second completion,
  process-death recovery, essential interruption, active-session FGS lifecycle,
  quiet notification, and service stop-on-completion are documented in
  `Rhythmic-Meditation/docs/PASS_04_HANDOFF.md`.
- Reader's baseline picker/import UI was exercised; the seeded active legacy
  session was validated by database state, not by completing a 5400 / 47
  reading run.
- A Routine prototype control-panel attempt confirmed the production-path QA
  rows are displayed, but tapping those rows did not reliably invoke the
  actions. This leaves the specific Routine-triggered CD3/CD4 UI flows open.

## Manifest, IPC, FGS, and UX audit

- Routine preview and attention-insight providers are exported only behind the
  Reader/Meditation signature read/write permissions. The accessibility
  service is protected by `BIND_ACCESSIBILITY_SERVICE`; the overlay Activity is
  non-exported. The current release merged manifest includes the signature
  providers and excludes DevLauncher components.
- Reader's exported recovery-entry Activity requires its signature permission;
  status/evidence providers enforce signature read (and write where applicable)
  permissions.
- Meditation's exported status provider requires its signature permission.
  Its session FGS is `specialUse`, non-exported, and requested with the
  foreground-service permissions. Meditation requests neither `WAKE_LOCK` nor
  `INTERNET`; timing remains outside the service.
- A device-side unprivileged query to Meditation's status provider was denied
  with `SecurityException`. Other deliberate missing-provider/untrusted-signer
  physical scenarios remain outstanding; fail-closed paths have automated
  coverage.
- Stale cumulative CD4 copy was not found in current Routine UI strings. The
  on-device Routine quota card displayed the migrated 47-page legacy gate and
  previewed the next cooldown as 30 minutes / 11 pages.
- Insights source/empty-data rules and substitution projections are covered by
  automated tests. A multi-day physical truth/absence sample and quantitative
  battery-delta measurement were not collected.

## Remaining acceptance matrix

| Scenario | Evidence | Remaining work |
| --- | --- | --- |
| CD3 Reader daily baseline UI and evidence | Policy/rendering tests; Reader preview V2 physical path previously checked | Trigger ordinal 3 through Routine and verify 3600 / 36 on the device. |
| CD4 Reader restorative flow | Bound-session requirement and persistence tests; Routine allocation/UI branch partly exercised in earlier runs | Trigger CD4 Reader path through Routine, complete/bind it on the device, and verify 1800 / 11 without accepting aggregate daily evidence. |
| CD4 Meditation launch from Routine | Exact bound Meditation completion and provider reconciliation physically recorded; UI trigger path remained automation-limited | Run the end-to-end Routine launch for the target gate on the final working-tree build. |
| Concurrent Risk Groups | Native/JS idempotency and allocation tests | Physical simultaneous/near-simultaneous exhaustion is not recorded. |
| Reboot, wall-clock/time-zone changes, schedule edits | Persisted-state and Attention-Day unit coverage; app restart was exercised | Physical reboot/time-change/schedule-edit matrix remains open. |
| Missing/incompatible providers and bad signer | Fail-closed automated tests; one signature-denial check physically recorded | Exercise absence and mismatched-signer cases on-device. |
| Standalone Reader/Meditation | Standalone code paths and local-metrics rules tested; Reader opened independently | Verify both with companion packages absent/disabled. |
| FGS and battery | Active-service screen-off pass and no-wake-lock manifest/source audit | Capture quantitative battery delta; rerun lifecycle rows if final FGS source changes. |
| Insights truth under missing/multi-day data | Aggregation and omission rules tested | Verify a multi-day physical source set and unavailable-source rendering. |

## Test artifact custody and repository state

Device-private-data archives and logs are retained outside the repository under
`C:\Users\Xcerpt\AppData\Local\Temp\opencode\sw-2026-004\device-backup-final`
and `C:\Users\Xcerpt\AppData\Local\Temp\opencode\sw-2026-004`. Routine and
Reader private data were restored from their original archives after evidence
capture. The connected-test setup left Meditation absent after its signer-
mismatch failure, so the current debug APK was reinstalled with the shared
ecosystem debug key and its pre-test archive restored. The restored Meditation
database passes `PRAGMA integrity_check`; it contains both prior sessions,
including bound session `67ec1d42-27dc-492e-9216-df70c28a25ce` at 1800/1800
completed seconds, plus its interval rows. A cold launch rendered the restored
Morning Meditation Required state. All three installed APKs were verified with
the same signer SHA-256
`fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`. No
release, tag, store submission, production promotion, or merge was performed.
