# SW-2026-004 — Internal Android release and qualification closeout

- **Date:** 2026-10-05
- **Device:** Xiaomi Redmi Note 13 Pro+ 5G (`23129RN51X`), Android 16 / API 36,
  ADB serial `P7J7TGKNAY8DKJ5P`
- **Scope:** Rhythmic Routine + Rhythmic Reader + Rhythmic Meditation as one
  Android ecosystem.

## Final product status

**INTERNAL ANDROID RELEASE — OWNER ACCEPTED — KNOWN QA DEBT TRACKED**

The Rhythmic Routine, Rhythmic Reader, and Rhythmic Meditation Android ecosystem
is accepted for normal internal/personal use. Core automated validation and
substantial physical-device qualification have passed. Remaining physical
certification, observability, and QA-infrastructure work is tracked in the
follow-up issues below and is not release-blocking unless it exposes a
reproducible correctness defect.

This classification does not claim full Android certification, production
proof across OEMs, Play Store qualification, public-store release, medical or
addiction-treatment status, or uncircumventable enforcement. Distribution is
direct Android APK only; the source repositories and attached GitHub Release
assets are public, with the APKs intended for internal/personal use.

## Known qualification boundary

Primary physical qualification device: **Xiaomi Redmi Note 13 Pro+ 5G**, Android
16 / API 36. The qualification record below is retained as captured; incomplete
rows are not represented as completed.

Remaining physical/extended qualification includes:

- full CD3 and CD4 physical acceptance matrix;
- extended reboot and wall-clock/time-change permutations;
- broader OEM certification;
- long-horizon battery observation;
- multi-day Insights qualification; and
- a repeatable shared-signer instrumentation harness.

## Known QA / Follow-up Certification

These Routine issues remain open and track post-release qualification work:

- [#8 — QA: complete physical end-to-end restorative gate acceptance matrix](https://github.com/Terinit-Technologies-Development/Rhythmic-Routine/issues/8)
- [#9 — Diagnostics: preserve auditable Attention-Day allocation provenance](https://github.com/Terinit-Technologies-Development/Rhythmic-Routine/issues/9)
- [#10 — QA infrastructure: make shared-signer cross-app Android instrumentation repeatable](https://github.com/Terinit-Technologies-Development/Rhythmic-Routine/issues/10)
- [#11 — QA: complete extended Android resilience and long-horizon certification](https://github.com/Terinit-Technologies-Development/Rhythmic-Routine/issues/11)

## Historical qualification decision (2026-10-03)

At the end of the focused physical qualification pass, the status was **HOLD**
because the owner had paused the fresh CD3 Reader run and the fresh CD4 Reader
and Routine reboot-persistence rows were incomplete. The initial post-boundary
capture found stale state; a later ordinary Routine JS startup reconciled native
and JS to `ad-20261002-0800`, counter 0, and the UI previewed ordinal 1. Native
enforcement diagnostics were healthy. Fresh ordinals 1–3 were then allocated
through the production-equivalent QA path. Reader V2 retained 794 / 3600 active
seconds and 1 / 36 qualified pages for 2026-10-02; its 2026-10-03 row was 0 / 0.

A fresh Routine-bound CD4 Meditation acceptance passed on 2026-10-03: the Videos
ordinal-4 gate was bound to a real 1800 / 1800 session, reconciled as satisfied,
consumed exactly one substitution, and retained its original cooldown end. The
CD3 Reader, CD4 Reader, and fresh Routine reboot-persistence rows remain
incomplete. The historical HOLD remains part of the evidence record; owner
acceptance changes the release classification, not those test outcomes.

The release commits, tags, validation, APK metadata, and release URLs are
recorded in the release and device-deployment records below.

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
| Rhythmic Routine | `npm test`: **423 / 423**, 82 suites; `npm run typecheck`; `npm run lint`; `:rhythm-device:testDebugUnitTest` (**80 / 80 test methods**); debug compile/build; release manifest and signed `:app:assembleRelease` — passed. The release manifest contains no Expo DevLauncher components and the APK embeds `assets/index.android.bundle`. |
| Rhythmic Reader | `test`, `assembleDebug`, `assembleRelease`, `assembleDebugAndroidTest`, and `lint` — passed; **106 / 106** unit tests. |
| Rhythmic Meditation | `:app:testDebugUnitTest`, `:app:assembleDebug`, `:app:assembleRelease`, `:app:assembleDebugAndroidTest`, and `:app:lint` — passed; **177 / 177** unit tests. |
| Instrumentation | A final `:app:connectedDebugAndroidTest` attempt on the Redmi ran **0 tests**: Gradle's default debug key did not match the already-installed shared QA signer (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`). Previous recovery-intent/cursor instrumentation results and the physical cold-start provider query are recorded in the Pass 03/04 handoffs. |

The table above records the qualification-run baseline captured before release
versioning. Final release validation and signed artifact metadata are recorded
in [the device-deployment manifest](SW-2026-004-DEVICE-DEPLOYMENT.md).

Final Routine verification on 2026-10-01: `npm test` **423 / 423** across 82
suites, typecheck, lint, `:rhythm-device:testDebugUnitTest` (80 test methods),
`:rhythm-device:compileDebugKotlin`, and `:app:assembleDebug` for
`armeabi-v7a` all passed. The latest debug APK was installed in place with
`adb install -r`; the private SQLite file remained present and no clear-data or
uninstall was used.

## Conservative recovery baseline (pre-boundary)

- Captured 2026-10-01 12:25 SAST (`Africa/Johannesburg`) on the Redmi. Routine
  branch `feat/pass-03-restorative-gates`, HEAD
  `6e3706d75a0bf5ec62038a9662a7b8653ffb81c9`; the working tree has existing
  uncommitted changes. Installed package metadata is versionCode 4 / versionName
  1.2.0, ARMv7 debug APK SHA-256
  `3c64c76bdc15788e3e587339efc68637830443c9693760efecb8a0f26498680b`.
- Attention Day `ad-20261001-0800` began 2026-10-01 08:00 SAST; saved next
  boundary is 2026-10-02 08:00 SAST (`1790920800000`). Native and JS both show
  cooldownsTriggered 3, highest requirements 3600 seconds / 36 pages, and no
  active cooldown, Reader gate, or Restorative gate. The Reading Quota screen
  shows 0 minutes / 0 pages, `3 used today`, and `Next cooldown · #4`.
- Both stores contain group-usage records with cycle revisions. Music is
  exhausted at 2322 seconds / 2322513 ms with cycleRevision 1 in JS/native, but
  its persisted `exhaustedAt` differs: native `1790807646648` (00:34:06 SAST)
  and JS `1790850292763` (12:24:52 SAST). Preserve these records as-is; they do
  not independently establish Attention-Day allocation provenance. No separate
  allocation-event ledger was found in the captured Routine runtime/native
  stores.
- At the 12:25 SAST pre-boundary capture, Accessibility was disabled
  (`accessibility_enabled=0`, `enabled_accessibility_services=null`) and no
  Routine service was bound. At 13:54 SAST the owner enabled Routine through
  Android Settings; read-only verification at 13:55 showed
  `accessibility_enabled=1`, the exact Routine service enabled and bound, and
  no crashed service. Usage Access is granted (`GET_USAGE_STATS: allow`). The
  supplementary permission/service capture is preserved alongside the
  pre-boundary artifacts. The post-boundary reconciliation and native-health
  checks were later completed before the fresh QA allocations below.
- Raw files and a compact summary are preserved under
  `C:\Users\Xcerpt\AppData\Local\Temp\opencode\sw-2026-004\pre-boundary-20261001-1222`:
  app SQLite, native preferences, device/package metadata, accessibility and
   activity-service diagnostics, logcat, UI hierarchy, Reading Quota screenshot,
   and `snapshot-summary.json`.
- The controlled readable document for the fresh CD3 gate is at
  `C:\Users\Xcerpt\AppData\Local\Temp\opencode\sw-2026-004\reader-control-document\Alice-Reader-QA.pdf`.
  It contains 188 pages from Project Gutenberg eBook 11; source and PDF hashes
  are recorded in `manifest.json`. It was copied to the device and imported
  through Reader’s document picker on 2026-10-02; see the fresh acceptance
  evidence below. Import alone is not reading evidence.

## Natural-boundary first capture (2026-10-02)

- The saved boundary was 08:00 SAST (`Africa/Johannesburg`), expected new day
  `ad-20261002-0800`. The scheduled watcher did not capture: its log contains
  only the start entry from 2026-10-01. The first available read-only snapshot
  was taken at **09:02 SAST**, before opening or resuming Routine, and is
  preserved under
  `C:\Users\Xcerpt\AppData\Local\Temp\opencode\sw-2026-004\post-boundary-20261002-0800\first-observed-0900`.
- Native Attention Exchange still reports ID `ad-20261001-0800`,
  `cooldownsTriggered=3`, maxima 3600 seconds / 36 pages, and dateKey
  `2026-10-02`. JS still reports the same old ID, counter and maxima, but
  dateKey `2026-10-01`. Native `attention_day_json` is absent; the embedded
  Attention Day in `restorative_gates_json` is still `ad-20261001-0800` with
  the expired 08:00 boundary. No fresh `ad-20261002-0800` baseline is proven.
- Native cooldowns are `[]`, Reader gates `{}`, and restorative gate list `[]`;
  JS cooldown, Reader-gate and Restorative-gate maps are also empty. The UI did
  not show Reading Quota or a next-cooldown preview because the display was
  asleep/locked (black SystemUI screenshot), so `Next cooldown · #1` was not
  verified.
- Native group-usage ledger has 2026-10-02 date keys and zero usage, retaining
  cycle revisions entertainment 0, music 1, QA 2, social 2, videos 2. JS
  remains on 2026-10-01 with Music usage 2325 seconds and cycleRevision 1.
- Routine process was alive (PID 7400), but its `DevLauncherActivity` was
  STOPPED and the device was sleeping; therefore no ordinary resume or JS/native
  reconciliation was triggered. I did not wake/unlock the device, launch
  Routine, or manually reconcile.
- Native enforcement prerequisites observed read-only: Usage Access `allow`,
  Accessibility enabled and bound/recognized with no crashed service, and five
  Risk-group policies/packages persisted. Restriction Capability `ENFORCED` and
  live Risk enforcement were not established in this capture. The enabled
  Accessibility setting alone is not treated as proof of enforcement health.
- At this first capture, the after-resume reconciliation was still pending, so
  this snapshot alone was not a PASS or final rollover-defect determination.
  The subsequent normal JS startup, native-health check, and gated allocation
  sequence are recorded in the following section.

## Post-boundary reconciliation and fresh acceptance setup (2026-10-02)

- After the owner woke/unlocked the Redmi, Routine was resumed through its
  installed Expo development client and the project’s LAN Metro bundle. The
  ordinary JS startup path reconciled native and JS to Attention Day
  `ad-20261002-0800`, `cooldownsTriggered=0`, zero required seconds/pages, and
  empty cooldown, Reader-gate, and Restorative-gate maps. The Today screen
  previewed `Next cooldown · #1`. The capture is under
  `C:\Users\Xcerpt\AppData\Local\Temp\opencode\sw-2026-004\post-boundary-20261002-0800\after-working-js-resume-1123`.
- Routine Settings diagnostics then showed RhythmDevice `AVAILABLE`, Usage
  Access `GRANTED`, Accessibility `BOUND / RECOGNISED`, Restriction Capability
  `ENFORCED`, five projected Risk policies/packages, and policy sync `OK`. The
  service was enabled/bound with no crashed service. The diagnostic UI capture
  is under `C:\Users\Xcerpt\AppData\Local\Temp\opencode\sw-2026-004\post-boundary-20261002-0800\enforcement-diagnostics-ui`.
- Fresh allocation provenance was established sequentially through Routine’s
  existing QA action, which seeds only the allowance boundary and re-enters
  production exhaustion logic. Native and JS readbacks agreed after each
  allocation:

  | Attention-Day ordinal | Risk Group | Production result |
  | --- | --- | --- |
  | 1 | Social Feeds | `requirementKind=none`; fresh `ad-20261002-0800` allocation. |
  | 2 | Entertainment | `requirementKind=none`; counter advanced to 2. |
  | 3 | QA | `baseline-reading`, 3600 active Reader seconds / 36 qualified pages; fresh gate `gate-ad-20261002-0800-qa-o3`. |

  Per-allocation readbacks are preserved in
  `C:\Users\Xcerpt\AppData\Local\Temp\opencode\sw-2026-004\qa-sequence\ordinal-1-social`,
  `ordinal-2-entertainment`, and `ordinal-3-qa`. The earlier
  `ad-20261001-0800` ordinal-3 record remains provenance-unverified and is not
  reused or retroactively certified.
- At 11:56 SAST, an attempt to launch the protected QA package
  `com.block.juggle` was intercepted by native enforcement and opened Routine’s
  Touch Grass intervention. The screen stated “QA has reached its shared
  allowance” and directed productive attention in Reader. Screenshot and UI
  hierarchy are in `C:\Users\Xcerpt\AppData\Local\Temp\opencode\sw-2026-004\qa-sequence\cd3-risk-block-check`.
- The controlled 188-page `Alice-Reader-QA.pdf` was pushed to Downloads and
  imported through Reader’s normal document picker. Device hash matched the
  prepared PDF SHA-256
  `4993d71ed21106321dbd7bdddc70eba9e97e9e0a01499a25a7d967cab17ea812`. Reader’s
  separate Daily Evidence V2 table reported 794 active seconds and one
  dwell-qualified page (`pageIndex=0`) for 2026-10-02 at the 12:11 SAST paused
  snapshot. The persisted book was at page index 2 of 188. This does not meet
  the 3600 / 36 target and is not a CD3 PASS.
- The owner chose “Not now” for the remaining physical reading. Reader was
  backgrounded with Android Home at 12:11 SAST so its active tracker would stop;
  no counter, gate, timestamp, or database row was manually edited. The exact
  paused Reader snapshot is under
  `C:\Users\Xcerpt\AppData\Local\Temp\opencode\sw-2026-004\qa-sequence\paused-at-owner-request-1200`.
- Reader still contains historical Recovery Session V1
  `334979dc-ea61-4caf-a939-88c32c980014` (1800 seconds / 11 pages). No new V1
  session was bound to the ordinal-3 baseline gate, and V1 progress is not
  counted toward CD3. The Routine/native gate remains ordinal 3, selected
  provider Reader, `in-progress`, with cooldown end `1790939117211` and the
  3600 / 36 requirement.
- At 12:13 SAST, native Reader evidence and native Attention-Day/gate state
  still showed the values above. Routine’s persisted JS evidence snapshot was
  392 seconds / 1 page from its last Reader sync, while the native/provider
  snapshot was 794 seconds / 1 page. This was captured while Reader had been
  foregrounded since that last sync; the next ordinary Routine resume must
  reconcile and verify the updated V2 snapshot before CD3 can be accepted.
  The read-only Routine capture is under
  `C:\Users\Xcerpt\AppData\Local\Temp\opencode\sw-2026-004\qa-sequence\routine-state-paused-1212`.

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

These are app-state migration checks on the same package/signer. Those
qualification builds intentionally retained the v1.2.0 baseline versionName
and versionCode; the separate v1.3.0 internal release metadata is listed in the
release record.

## Focused physical acceptance progress (2026-10-02; updated 2026-10-03)

| Required row | Result and captured evidence | Remaining work / status |
| --- | --- | --- |
| Routine-triggered CD3 Reader | Fresh QA ordinal 3 on `ad-20261002-0800`; native enforcement physically intercepted the protected QA app. Reader V2 has 794 / 3600 active seconds and 1 / 36 qualified pages for 2026-10-02, and 0 / 0 for 2026-10-03. | **HOLD.** Routine normally resumed and synced the 2026-10-03 projection, but neither accepted date meets 3600 / 36. Owner paused the physical reading run. Do not count the historical V1 session. |
| Routine-triggered CD4 Reader | Historical launch/binding check remains: Videos ordinal 4 gate `gate-ad-20260930-0800-videos-o4` was bound to session `334979dc-ea61-4caf-a939-88c32c980014`; both private databases carried the ID and the 1800 / 11 requirement. | A fresh CD4+ Restorative Choice gate, exact Reader session binding, Daily Evidence isolation, and reboot persistence are still required. The historical gate/session is not fresh provenance. |
| Routine-triggered CD4 Meditation | **PASS — fresh physical acceptance 2026-10-03.** Videos ordinal-4 gate `gate-ad-20261002-0800-videos-o4` bound to session `9a359f71-22fc-4215-8904-5e332c3f791e`; Meditation recorded `COMPLETED`, 1800 / 1800. Routine reconciled it as satisfied and incremented substitutions 0 → 1; cooldown end remained `1790986672549`. | Closed for the fresh CD4 Meditation acceptance. The separate Reader and Routine reboot rows remain open. |
| Routine reboot persistence | Earlier reboot evidence exists for the historical CD4 Reader session only. | Fresh reboot-persistence scenario for a valid newly allocated CD4 Reader gate remains required. |

### Fresh CD4 Meditation follow-up (2026-10-03)

- Routine's visible QA control seeded only the Videos allowance boundary and
  entered the production exhaustion transition. It created ordinal 4 for
  Attention Day `ad-20261002-0800` at `00:47:52.549 SAST`, with gate
  `gate-ad-20261002-0800-videos-o4` and cooldown end
  `1790986672549` (`02:17:52.549 SAST`). The baseline substitution count was 0.
- Through Routine's normal Touch Grass UI, the on-screen Meditation choice
  launched session `9a359f71-22fc-4215-8904-5e332c3f791e`. The Meditation Room
  row is protocol 1, `COOLDOWN_RESTORATIVE`, `COMPLETED`, 1800 / 1800, bound to
  the exact gate ID and Attention Day. Its single interval is
  `172242277 → 174042277` elapsed-realtime milliseconds (**1,800,000 ms**);
  interruption and pause counts are both 0, and the database integrity check
  returned `ok`.
- Meditation completed at `01:23:02.133 SAST`. Returning through the completion
  screen's `Open Rhythmic Routine` handoff caused ordinary Routine foreground
  reconciliation. The gate became `satisfied`, the exact provider session ID
  remained attached, and `meditationSubstitutionConsumed=true`; JS substitution
  usage advanced exactly once, 0 → 1. `cooldownsTriggered` stayed 4, Attention
  Day stayed `ad-20261002-0800`, and the gate/cooldown still carries the original
  end timestamp `1790986672549`. Routine's screen showed “Restorative
  requirement complete · Cooldown remains active” and 52 minutes remaining.
- Read-only snapshots, screen captures, and a 52-sample qualification log (51
  ACTIVE samples then COMPLETED at 1800 seconds, no poll errors) are preserved
  under `C:\Users\Xcerpt\AppData\Local\Temp\opencode\meditation-session-20261003\`.
  The artifact hashes are listed in `acceptance-manifest.json`; final Routine,
  Reader, and Meditation snapshot SHA-256 values are respectively
  `7df78d18703918e965bad84ef2a28348ac1d0d33a6398fe07e6cfd623f984a76`,
  `cf3e943c1a2c32b5a4a456a44e05667febd294352bb262fb1481896836e6d754`, and
  `a7092a74b21d5069ea47e8fb51eb1be621d0485f79864335c8d38bc06554d2b2`.
- This closes only the fresh CD4 Meditation row. CD3 Reader, CD4 Reader, and
  fresh Routine reboot persistence remain open; no counters, gates, ordinals,
  timestamps, or evidence were manually altered.

The Routine preview selector was narrowed to gates with the matching
requirement kind, with mixed-kind regression coverage. The Reader bridge call
was also corrected to pass the five recovery arguments positionally; its
regression test passed, and the on-device CD4 Reader launch then succeeded.
JS cold-start reconciliation and native gate projection now reject pre-boundary
gates even when only one side of the Reader/Restorative projection remains;
explicit `LEGACY_READING` gates keep their local-date semantics. Focused JS and
native regressions cover the boundary and orphan-gate cases. The updated build
reconciled the new Attention Day on the Redmi; fresh production-path allocations
1–3 and the current ordinal-3 gate are recorded above. At that evidence capture,
the source changes were uncommitted; their release commits are recorded in the
deployment manifest.

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

## Non-blocking follow-up QA

Battery deltas, multi-day Insights, exhaustive provider-absence combinations,
OEM coverage, and extended timezone/wall-clock matrices remain follow-up QA;
they are outside this focused four-row acceptance pass.

## Test artifact custody and repository state

Device-private-data archives and logs are retained outside the repository under
`C:\Users\Xcerpt\AppData\Local\Temp\opencode\sw-2026-004\device-backup-final`
and `C:\Users\Xcerpt\AppData\Local\Temp\opencode\sw-2026-004`. The original
pre-test backups and prior Meditation restore/verification records remain in
those locations. The 2026-10-02 boundary, enforcement, allocation, physical
block, Reader V2, and paused-state captures are individually referenced above
and grouped under `C:\Users\Xcerpt\AppData\Local\Temp\opencode\sw-2026-004`.
Reader was paused through Android Home at the owner’s request; no app data was
cleared and no counters, gates, timestamps, or ordinals were manually changed.
All three APKs installed during the qualification were verified with the same
signer SHA-256
`fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`. At the
2026-10-03 evidence-capture point, no release, tag, store submission, production
promotion, or merge had been performed; later release state is recorded in the
device-deployment manifest.
