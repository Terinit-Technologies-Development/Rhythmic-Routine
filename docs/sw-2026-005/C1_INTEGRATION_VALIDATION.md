# SW-2026-005 — C1 cross-app integration validation

Status: **C1 source/contract mapping only. NOT a test execution record and NOT
programme acceptance.** No APK build, installation, ADB command, device setting,
version change or physical check was performed in this turn. Root executes the
commands in §7 separately.

This document consolidates the accepted A1 / B1 / B2 / B3 lineage and the
accepted A4 QA harness onto the integration tree. It records:

- the exact accepted inputs;
- the cross-repository IPC/contract surface Routine consumes;
- the migration and native/JS parity test mapping that already exists;
- the commands Root must run for a real C1 result;
- open, concrete PRD-required integration gaps and evidence limits.

Policy is unchanged. PD-1/PD-2/PD-3, POL-01…POL-10, the frozen numbers
(90 min, 3600 s / 36 pages, 1800 s / 11 pages, Meditation cap 2, 1800 s
morning) and Reader V2 calendar-day evidence semantics remain authoritative.

---

## 1. Evidence boundary

| Fact | Status |
| --- | --- |
| Source inspection of this integration worktree | Done in this turn (READ only, except §9). |
| Routine JS / native tests in this turn | **NOT RUN.** |
| Reader / Meditation companion tests in this turn | **NOT RUN.** |
| Fresh consolidated Android native suite | **NOT RUN.** The B2 162-test run is prior lane evidence only. |
| Real same-signature Routine↔Reader↔Meditation IPC | **NOT RUN.** |
| APK / QA artifact build, signer verification, install, ADB, settings | **NOT RUN.** |
| Physical T01–T25 | **NOT RUN.** |
| Companion source at the supplied paths | **Not re-read as a sibling worktree.** Root supplied immutable contract context at `.expo/c1-companion-contract-context.txt` (Meditation `e62eef9…` and Reader `2ad1573…`, five files with per-file SHA-256). No sibling permission was expanded. Companion reviews were not restarted; only the relevant contract pieces were used. |

This is deliberate: no test result, native runtime pass, `ENFORCED` state,
issue #8/#13 closure or DEVICE READY claim is made here.

---

## 2. Accepted inputs

### 2.1 Integration and lane inputs

| Input | Identity | Use in C1 |
| --- | --- | --- |
| Clean integration baseline | `a85455a8d8365eb81bf713d5a56e96a3a5a268b5` | Starting tree for the consolidation; package.json conflict resolved to preserve **both** the application and `scripts/sw005/*.test.mjs` globs. |
| A1 boundary contract | `30747783b66e8969ae4aadfafa6e60281f9239ed` | B1 candidate baseline; approved daily boundary / civil-day arithmetic. |
| B1 accepted lane baseline | `973b6c0fea509ba763c1334d5d6fb5b2c2c00c84` | B2 baseline; morning vertical slice. |
| B1 corrective source | `1a66e33` (as recorded in `B1_ROOT_VALIDATION.md` R38) | Retained F23 lock-order correction and later morning/recovery corrections. |
| B2 accepted lane baseline | `fec321b728c1b0dab384982d970bc528f3800191` | B3 baseline; CD3/CD4 evidence, stable provider bindings, durable completion ledger. |
| B2 owning-day/selection correction | `de600d6` (as recorded in `B2_ROOT_VALIDATION.md`) | Carried-gate owning-day cap and selection entry point. |
| B3 final source | `8b5bd2de41246d94a3276f27d42d0494faca6e72` | UI clarity, truthful readiness, pre-progress provider switch. Exact accepted B3 source. |
| A4 QA harness | `5be216c4530da84e6d7a2014b9585a27a7247567` | Signer probe project, harness tests, APK/DEX verification, default-deny device entry point. |
| Meditation companion | `e62eef9cdd14834e3874c342865b8454eb953e2a` | Reviewed companion source; root-provided contract context available at `.expo/c1-companion-contract-context.txt` (not a sibling permission expansion). |
| Reader companion | `2ad157345cc8b58ff80a4846134fe3227c799fd8` | Reviewed companion source; root-provided contract context available at `.expo/c1-companion-contract-context.txt`. |

Per-lane counts quoted in the lane documents (B1 R38: 159 native / 514 JS;
B2: 162 native / 522–528 JS; B3: 539 JS; A4: 483 JS) are **prior evidence**,
not re-executed or re-qualified here.

Root-provided C1 companion facts (not Routine IPC and not this worker's run):
Meditation `219 PASS` at `e62eef9…` (evidence `2cb2304d-5e9f-4422-a505-bc5e75cfb6e0`);
Reader `114 PASS` at `2ad1573…` (evidence `9e23d146-cf20-4da0-bade-44855caed09e`).
The worker's earlier coordinator Meditation regression passed 3 coordinator
tests with 0 failures (659.769 ms). The combined `577` baseline/static result
predates these changes and must not be relabelled as a new-tree pass.

### 2.2 Canonical programme baselines and policy documents

| Item | Identity |
| --- | --- |
| Programme PRD | SW-2026-005 v1.0, 27 October 2026 (owner handoff) |
| Approved policy | `OWNER_POLICY_REVIEW.md`, 29 October 2026 |
| Policy detail | `OWNER_POLICY_DECISIONS.md` (PD-1/PD-2/PD-3) |
| Engineering contract | `ATTENTION_DAY_AND_RESTORATIVE_CONTRACT.md` |
| Interface freeze | `INTERFACE_CONTRACT.md` |
| Companion identity limitation | `MEDITATION_PROTOCOL_COMPATIBILITY.md` |
| QA harness | `SHARED_SIGNER_QA.md`, `A4_ROOT_VALIDATION.md` |
| Companion contract context | `.expo/c1-companion-contract-context.txt` — five files from Meditation `e62eef9…` and Reader `2ad1573…`, each with SHA-256; ignored context only, never compiled or committed. |
| Canonical PRD source baselines | Routine `2b20a113ba23a74b328cdc519800ea790897a09e`; Reader `01d74fefa89791c6cb5dbd0696de835ed027acb0`; Meditation `4afdc0a852b53f3ce581ae3c08927a6a3a19718d` |

### 2.3 Version state in this bounded turn

| Item | Value |
| --- | --- |
| Routine `package.json` / `app.config.ts` | `1.3.0`; Android `versionCode 5` |
| Routine application ID | `com.terinit.rhythmicroutine`; QA variant `com.terinit.rhythmicroutine.qa` |
| Reader application ID | `com.terinit.rhythmicreader` (unchanged) |
| Meditation application ID | `com.terinit.rhythmicmeditation` (unchanged) |

**No version, versionCode, signing, package-ID or Gradle product source was
changed in this turn.** The R0 note that the owner-local worktree may carry
`1.3.2 / 7` remains relevant for C4; this integration tree is `1.3.0 / 5`.

---

## 3. Cross-repository contract surface

### 3.1 Ownership and trust

| Fact | Authority | Integration consequence |
| --- | --- | --- |
| Schedule, Attention Day, ordinals, cooldowns, allowances, gates, re-entry | Routine | Reader/Meditation never grant access. |
| Reader daily aggregate (CD3) | Reader Daily Evidence **V2** | Routine reads only; accepted calendar-date keys are unchanged. |
| Reader bound recovery session (CD4+) | Reader Recovery **V1** | Routine must query the exact bound session id. |
| Meditation bound session (CD4+ and morning) | Meditation Status **V1** | Exact id, protocol, status, qualified seconds **and** additive kind/source identity. |
| Enforcement decision | Routine Android service | One effective predicate; JS is a projection/reconciliation layer on Android. |
| Signer trust | Both consumers | Package + actual signer equality; missing/denied/unknown never satisfies. |

> **Read scope:** the values below are the shapes Routine's production
> consumers and the frozen contract require. They were not re-derived from the
> companion source in this turn (`external_directory` denial, §8.3). The A4
> probes are the runtime check for provider-side authority/column parity.

### 3.2 Routine → Reader

| Surface | Exact integration value | Routine consumer / rule |
| --- | --- | --- |
| Daily evidence authority | `content://com.terinit.rhythmicreader.evidence/daily/<yyyy-MM-dd>` | `DailyReadingEvidenceProviderClient.query()` and `RhythmEnforcementService.queryDailyReadingEvidence()`. |
| Daily evidence protocol | `2` | Required columns: `protocolVersion`, `dateKey`, `verifiedActiveSeconds`, `qualifiedPages`, `updatedAtEpochMs`. Wrong version/date/sign is incompatible, not satisfied. |
| Recovery status authority | `content://com.terinit.rhythmicreader.recovery/sessions/<sessionId>` | `RhythmDeviceModule.queryRecoveryStatus()` → `NativeRecoveryProviderClient.queryRecoveryStatus()`. |
| Recovery status columns | `sessionId`, `protocolVersion`, `status`, `activeSeconds`, `qualifiedPages`, `completedAtEpochMs` | Reducer accepts only `sessionId === gate.providerSessionId`, protocol `1`, status `COMPLETE`, `activeSeconds >= 1800`, `qualifiedPages >= 11`. The additive `queryRecoveryStatusDetailed` preserves trust/permission/incompatible/session-missing/corrupt/provider-error; the legacy nullable method is unchanged. |
| Recovery launch | action `com.terinit.rhythmicreader.action.START_RECOVERY`; component `com.terinit.rhythmicreader.integration.rhythmic.RecoveryEntryActivity` | Extras: `recovery.session_id`, `recovery.protocol_version` (1), `recovery.required_seconds`, `recovery.required_pages`, `recovery.created_at`, `recovery.expires_at`. Launches the bound entry flow, not Reader's generic main screen. |
| Signature permission | `com.terinit.rhythmicreader.permission.RECOVERY` | Declared in `modules/rhythm-device/android/src/main/AndroidManifest.xml`; package visibility via `<queries>`. |

CD3 uses the **V2 aggregate**; it must never be satisfied by a V1 session.
CD4+ uses the **V1 exact session**; it must never be satisfied by the V2
aggregate.

### 3.3 Routine → Meditation

| Surface | Exact integration value | Routine consumer / rule |
| --- | --- | --- |
| Status authority | `content://com.terinit.rhythmicmeditation.status/sessions/<sessionId>` | `MeditationStatusProviderClient.query()` / `queryStatus...`. |
| Base protocol | `1`; seven required columns `sessionId`, `protocolVersion`, `status`, `requiredQualifiedSeconds`, `completedQualifiedSeconds`, `completedAtEpochMs`, `lastUpdatedAtEpochMs` | Missing base columns → `PROTOCOL_INCOMPATIBLE`. |
| Additive identity | `sessionKind`, `sourceCooldownId`, `sourceRhythmicDayId` | Requested explicitly; identity is available only when **all three** are returned. Missing/partial/legacy metadata cannot satisfy a morning or cooldown gate. |
| Launch | action `com.terinit.rhythmicmeditation.action.START_MEDITATION_RECOVERY`; component `com.terinit.rhythmicmeditation.app.MainActivity`; extra `extra_request_payload` | `activity.startActivityForResult(...)` so Android can attest Routine's package to Meditation's deny-by-default caller check. |
| Request keys | `session_id`, `protocol_version`, `session_kind` (`MORNING_REQUIRED` or `COOLDOWN_RESTORATIVE`), `required_qualified_seconds`, `created_at_epoch_ms`, optional `expires_at_epoch_ms`, `source_cooldown_id`, `source_risk_group_id`, `source_rhythmic_day_id` | Kotlin validates required fields and kind; optional fields are omitted when absent/malformed. |
| Morning identity | `sessionId = morning-<attentionDayId>`, kind `MORNING_REQUIRED`, source cooldown **explicit null**, source day = `attentionDayId` | Morning completion never debits the cooldown substitution cap. |
| Cooldown identity | Stable `sessionId` per `(gateId, provider)`, kind `COOLDOWN_RESTORATIVE`, `sourceCooldownId = gateId`, source day = gate's owning Attention Day | `isVerifiedCooldownMeditationCompletion()` requires exact id + kind + cooldown source. |
| Signature permission | `com.terinit.rhythmicmeditation.permission.STATUS_ACCESS` | Declared in the module manifest and probe AUT manifest. |

`MeditationEvidenceWire` emits the three identity columns only when the
provider actually supplied them; `sourceCooldownId` is emitted as an explicit
null for morning. `MeditationDetailedResultWire` preserves
`queryStatus`/`availability`/`identityMetadataAvailable` so the coordinator can
reject a failed result even if contradictory evidence is attached.

### 3.4 Routine → Meditation Insights (issue #13 surface)

| Surface | Exact integration value | Status |
| --- | --- | --- |
| Attention insight authority | `${applicationId}.attention-insight`; QA variant `com.terinit.rhythmicroutine.qa.attention-insight` | `AttentionInsightProvider`. |
| Path | `attention-day/<attentionDayId>`; additive selector `attention-day/current` | `current` resolves to Routine's persisted current day; no guessed calendar day. |
| Projection permission | `com.terinit.rhythmicmeditation.permission.STATUS_ACCESS` | Declared on the provider. |
| Columns | `protocolVersion`, `attentionDayId`, `cooldownsTriggered`, `restorativeGatesCreated`, `restorativeGatesSatisfied`, `readerRestorativeCompletions`, `meditationRestorativeCompletions`, `meditationSubstitutionsUsed`, `meditationSubstitutionsRemaining` | Completion counts come from the durable ledger unioned with still-satisfied gates by `gateId`. |
| Neutral vs unavailable | Healthy provider + non-current requested day → valid **zero-row** cursor; wrong path/projection/selection → `null`. | The Meditation contract context confirms typed `EMPTY_CURRENT_DAY`/`CURRENT_PROJECTION_UNAVAILABLE`/denial/malformed/protocol/transport outcomes and use of `current`; zero rows are not “Routine disconnected”. Real IPC still NOT RUN. |

### 3.5 Manifest and package visibility

The module manifest declares:

- `PACKAGE_USAGE_STATS`;
- Reader `RECOVERY` and Meditation `STATUS_ACCESS`;
- `<queries>` for `com.terinit.rhythmicreader` and
  `com.terinit.rhythmicmeditation`;
- Routine providers `attention-preview`, `attention-insight` and
  `evening-signal` with the corresponding signature read/write permissions.

`app.config.ts` lists PACKAGE_USAGE_STATS and Reader RECOVERY explicitly; the
Meditation permission is supplied by the library module manifest. A4's real
AAPT inspection confirmed the AUT signature-permission declarations and
instrumentation target, so the merged-manifest path is the relevant one.

---

## 4. Migration and native/JS parity mapping

### 4.1 Attention Day

| Concern | JS | Kotlin |
| --- | --- | --- |
| Boundary source | `resolveAttentionDayClock()`: first `morning-buffer` with valid `HH:MM` end, independent of `enabled`/`activeDays` | `NativeAttentionExchangeLogic.resolveAttentionDayClock()`: same order and validation. |
| Civil-day arithmetic | `civilDateAfter()` / `boundaryAt()` using the Date civil constructor | `civilDateAfter()` via `Calendar.DAY_OF_YEAR`; `resolveLocalCivilTime()` mirrors JS gap/overlap resolution. |
| Empty `activeDays` | Boundary still advances; restriction window never fires | Same. |
| Fallback | Local civil midnight, reported via `issue` | Local civil midnight, reported via `attentionDayClockIssue()`. |
| Identity | `ad-<yyyyMMdd>-<HHmm>` | Same `SimpleDateFormat("yyyyMMdd-HHmm")` formula. |
| Gate identity | `gate-<attentionDayId>-<groupId>-o<ordinal>` | `RestorativeEnforcement.gateIdFor()`. |
| Morning identity | `morning-<attentionDayId>` | `MorningEnforcement.sessionId()` / `requirement()`. |

Existing tests:

- JS: `src/domain/rhythm/__tests__/pass04_attention_day_policy.test.ts`
  (weekend independence, 23:59→00:01, Sunday→Monday, empty/disabled windows,
  DST 23 h/25 h, fallback, `startedAt <= now < nextBoundaryAt`).
- Kotlin: `NativeAttentionExchangeLogicTest.kt`
  (`inactive weekend days keep their own daily clock boundary`,
  `midnight does not reset a morning clock Attention Day`,
  `disabled and empty-activeDays windows still configure the accounting clock`,
  `malformed morning clocks fall back to midnight...`,
  `the first usable configured morning clock wins`,
  `spring and fall DST days use civil calendar boundaries`,
  `gap and overlap boundary clocks match JavaScript civil-time semantics`,
  `the same instant resolves deterministically after a timezone change`) and
  `RoutineScheduleUpdateOrderTest.kt`
  (`first configured morning clock wins at the same boundary instant`,
  semantic-order parser test).
- The JS and Kotlin suites encode equivalent cases separately; there is no
  single shared cross-language golden input file for Attention Day (unlike the
  Meditation wire fixture). This is a parity-maintenance limitation, not
  evidence of a behavioural difference: both implementations are visibly
  constructed from the same rules. A future parity test must pin a fixed zone
  and compare id, `startedAt` and `nextBoundaryAt` against one input table.

### 4.2 In-place migration

| Migration | JS | Kotlin |
| --- | --- | --- |
| v1.2 active reading gate → `legacy-reading` | `normalizePersistedRuntime()` / `migrateLegacyReadingGate()` keeps original numbers (e.g. 5400 s / 47 pages) and `legacy-gate-<group>` id. | Native recovery rebuilds a missing CD4 gate from immutable cooldown metadata; legacy timers remain debt-free. |
| Restorative migration version | `RESTORATIVE_MIGRATION_VERSION` + idempotent normalizer | `RestorativeEnforcement.fromJson()` / `reconcileIncoming()`; satisfied gates are never downgraded. |
| Durable completion ledger | Additive `meditationCompletions`, keyed by `gateId`; absent legacy shape is preserved. | Additive `restorativeCompletions`; JSON round-trip; union by `gateId`; morning never enters it. |
| Numeric-only pre-B2 history | Recorded B2 limitation: not reconstructed into per-gate rows. | Same limitation; upgrade/migration qualification remains for C1/C3, not a new legacy hardening project. |
| Schedule edit during a gate | Persisted day wins while open; next boundary is clamped to the later boundary; gate identity/timer are immutable. | Native pin (`ATTENTION_DAY_PIN_JSON`) + schedule reconciliation; same order of morning reconcile then foreground recheck. |

Existing tests:

- `pass03_restorative_migration.test.ts` — v1.2 5400/47 preservation, legacy id,
  no silent conversion to 1800/11.
- `group_allowance_migration.test.ts` — allowance model migration.
- `b2_restorative_workflow.test.ts` — carried gate, owning-day cap, late
  completion, wrong binding, repeat receipt.
- Kotlin `RestorativeReconciliationTest.kt` — deterministic identity,
  native/JS convergence, satisfied never downgraded, carried gate survives.
- Kotlin `NativeAttentionExchangeLogicTest.kt` — completed historical gate
  permits a new cycle; unfinished carried gate blocks; legacy timers remain
  debt-free; restart reconciliation preserves native state.
- Kotlin `B2LedgerTest.kt` — history replacement, JSON round-trip,
  per-day counting/deduplication, morning exclusion.

### 4.3 Native snapshot and enforcement projection

| Concern | Integration point | Existing coverage |
| --- | --- | --- |
| Native snapshot import | `RhythmCoordinator.createNativeAttentionImportEvent()` / `createNativeMorningProjection()` | `native_usage.test.ts`, `nativeMorningImport.test.ts`, `coordinator.test.ts`. |
| Morning requirement import | Independent of `attentionStateInitialized`; additive `morningRequirements` retained | `nativeMorningImport.test.ts`, `morningRefreshLifecycle.test.ts`, Kotlin `MorningEnforcementTest.kt`. |
| Native/JS wire identity | Shared fixture `modules/rhythm-device/test-fixtures/meditation-wire-morning-null.txt` consumed by both JS and Kotlin | `meditationWire.test.ts`, Kotlin `MeditationEvidenceWireTest.kt` (`shared golden fixture matches actual production converter`). |
| Effective restriction union | `events.ts` passes `activeRestorativeGates` and `morningMeditationActive`; Kotlin predicate takes `morningHold`/`restorativeHold` | `restrictions.test.ts`, Kotlin `RestorativeEnforcementTest.kt`, `NativeAttentionExchangeLogicTest.kt`, `RestorativeProjectionTest.kt`. |
| Provider failure taxonomy | `MeditationStatusProviderClient` / `MeditationDetailedResultWire`; additive `ReaderRecoveryStatusProviderClient` / `ReaderRecoveryDetailedResultWire` | `MeditationStatusProviderClientTest.kt`, `MeditationEvidenceWireTest.kt`, `meditationBridgeOutcome.test.ts`, `ReaderRecoveryStatusProviderClientTest.kt`, `b2_restorative_coordinator.test.ts`, `restorativePresentation.test.ts`. |
| Readiness truth | `deriveNativePolicyReadiness()` requires module + running service + verified authorization + acknowledged sync | `nativePolicyReadiness.test.ts`, `nativeRestrictionCapability.test.ts`. |

### 4.4 Contract test mapping by PRD row

| PRD row | Existing deterministic coverage | Limit |
| --- | --- | --- |
| T01 / T02 / T03 / T04 / T05 | JS `pass04_attention_day_policy.test.ts`; Kotlin `NativeAttentionExchangeLogicTest.kt` weekend/midnight/disabled/empty/malformed/DST/gap/overlap/zone-change tests | Both suites cover the cases, but there is no shared cross-language golden input file and no device clock/zone change. |
| T06 | `pass03_restorative_migration.test.ts`, `b2_restorative_workflow.test.ts`, Kotlin `RestorativeReconciliationTest.kt`, `NativeAttentionExchangeLogicTest.kt` | No real in-place APK upgrade. |
| T07 / T08 / T09 / T10 | `pass06_morning_enforcement.test.ts`, `morningRefreshLifecycle.test.ts`, `nativeMorningImport.test.ts`, Kotlin `MorningEnforcementTest.kt`, `MeditationEvidenceWireTest.kt` | No installed accessibility service, process death or reboot. |
| T11 / T12 / T13 / T14 | `pass03_restorative_gates.test.ts`, `b2_restorative_workflow.test.ts`, `c1_cd3_carry.test.ts`, `b2_restorative_coordinator.test.ts` (Reader and Meditation lifecycle queries), Kotlin `RestorativeEnforcementTest.kt`, `C1Cd3CarryTest.kt`, `NativeAttentionExchangeLogicTest.kt`, `MeditationStatusProviderClientTest.kt`, `ReaderRecoveryStatusProviderClientTest.kt` | Provider completion is simulated at the seam; no real Reader/Meditation session. |
| T15 / T16 | `pass03_restorative_gates.test.ts`, `b2_restorative_workflow.test.ts`, `restorativePresentation.test.ts` | No real double-tap/launch race or rendered card state. |
| T17 / T18 | `restrictions.test.ts`, `c1_cd3_carry.test.ts`, Kotlin `C1Cd3CarryTest.kt`, `RestorativeEnforcementTest.kt`, `MeditationStatusProviderClientTest.kt`, `ReaderRecoveryStatusProviderClientTest.kt`, `b2_restorative_coordinator.test.ts`, `nativeRestrictionCapability.test.ts` | Reader V1 taxonomy is implemented in source; real same-signer IPC remains NOT RUN. |
| T19 | Kotlin `B2LedgerTest.kt` (`AttentionInsightProvider.deriveValues`), QA harness plan/tests | No same-signed cross-app IPC; Meditation client not re-read. |
| T20 | `nativePolicyReadiness.test.ts`, `nativeRestrictionCapability.test.ts`, `pass04b_runtime_packaging.test.ts` | No installed intervention or real risk-package test. |
| T21 | `b2_restorative_workflow.test.ts`, `engine.test.ts`, `persistence.test.ts`, Kotlin `B2LedgerTest.kt` | No physical restart/reboot or real SharedPreferences fault. |
| T22–T25 | A4 harness source; `restorativePresentation.test.ts`, `touchGrassPresentation.test.ts`, `nativePolicyReadiness.test.ts` | **NOT RUN** on hardware; screenshots from B3 cover only web Settings/default morning route. |

---

## 5. Migration/native-JS parity cases that must remain green

The following cases are the minimum C1 parity set. They are already encoded
where noted and must not be replaced by TS-only or Kotlin-only assertions.

| Case | Required agreement | Existing anchor |
| --- | --- | --- |
| P1/P2 | Weekday boundary id/start/end; 07:29 vs 07:30 | JS `pass04_attention_day_policy`; Kotlin resolver test. |
| P3/P4 | `activeDays: []` and `enabled: false` advance accounting but never restrict | JS policy test; Kotlin clock/restriction tests. |
| P5 | 23:59→00:01 keeps the same Attention Day/counters | JS policy test; Kotlin `attention-day ordinal survives midnight...`. |
| P6/P7/P8 | Spring-forward/fall-back/gap/overlap resolve identically | JS policy test; Kotlin `spring and fall DST days...`, `gap and overlap boundary clocks...`, `the same instant resolves deterministically after a timezone change`. |
| P9 | No usable clock → local-midnight boundary in both | JS policy test; Kotlin resolver fallback. |
| P10 | `gate-<day>-<group>-o<ordinal>` identical | JS `deterministicGateId`; Kotlin `gateIdFor`; `RestorativeReconciliationTest`. |
| P11 | Effective predicate truth table including restorative + morning + lease | JS `restrictions.test.ts`, `pass06_morning_enforcement`; Kotlin `RestorativeEnforcementTest` / `NativeAttentionExchangeLogicTest`. |
| P12 | Native snapshot round-trip carries `attentionDay`, `activeRestorativeGates`, `morning*`, companions | JS import tests; Kotlin `RestorativeProjectionTest` / `B2LedgerTest`. |
| P13 | Meditation wire: ten columns with explicit-null morning, seven-column legacy, partial identity | Shared fixture; JS `meditationWire.test.ts`; Kotlin `MeditationEvidenceWireTest`. |
| P14 | Reader V2: dateKey/protocol/threshold; wrong date or version fails. Reader V1: exact id/protocol/status and typed failure taxonomy | JS `readingEvidence.test.ts`, `c1_cd3_carry.test.ts`, `recovery.test.ts`; Kotlin `NativeAttentionExchangeLogicTest`, `C1Cd3CarryTest`, `ReaderRecoveryStatusProviderClientTest`. |

---

## 6. What C1 can currently claim

C1 source integration is **coherent at the seams that were reviewed**:

- the Attention Day boundary is implemented as the approved daily clock in both
  TS and Kotlin;
- morning requirements are deterministic, persisted, imported and enforced in
  both layers;
- CD4+ Reader and Meditation evidence is queried on cold start, resume and the
  bounded reconciliation clock, not only from a screen;
- provider identity, thresholds, caps, carry semantics and native/JS gate
  identity are represented in the reducer and native projection;
- unfinished CD3 reading gates retain identity/timer across calendar
  boundaries in JS and Kotlin, while Reader V2 evidence remains current-date OR
  creation-date and is never pooled;
- Reader CD4+ status now has an additive typed query path for trust, permission,
  incompatibility, missing/corrupt session and provider failure, while the
  legacy raw result remains compatible;
- the shared Meditation wire fixture is consumed by both languages;
- the A4 harness can plan, build, post-sign and statically reject missing
  module/signer/package facts once Root runs it.

It **cannot** claim:

- that the consolidated tree passes the current JS/native suites;
- that a same-signed device pair returns a valid cursor;
- that the accessibility service actually enforces the holds;
- that issue #13 is closed;
- that any T07–T25 physical row passed;
- that APKs are release-ready.

---

## 7. Required Root commands (not run here)

Use the actual absolute paths/toolchain from the reviewed worktree. Do not copy
placeholder secrets or paths into Git evidence.

### 7.1 Routine JS (from `D:/Terinit/SW-2026-005/integration`)

```powershell
npm test
npm run typecheck
npm run lint
git diff --check
```

Focused check for the C1 regressions (does not replace the full suite):

```powershell
npx tsx --test --test-concurrency=1 `
  src/domain/rhythm/__tests__/c1_cd3_carry.test.ts `
  src/domain/rhythm/__tests__/recovery.test.ts `
  src/domain/rhythm/__tests__/restorativePresentation.test.ts `
  src/application/__tests__/b2_restorative_coordinator.test.ts
```

The `npm test` script must retain both application and harness globs:
`src/domain/__tests__/*.test.ts`, `src/domain/rhythm/__tests__/*.test.ts`,
`src/domain/insights/__tests__/*.test.ts`,
`src/application/__tests__/*.test.ts`, and `scripts/sw005/*.test.mjs`, with
`--test-concurrency=1`.

### 7.2 Routine generated Android project and native unit suite

```powershell
npx expo prebuild --platform android --no-install
```

A4 explicitly uses `prepare` **without** `--clean`; do not use the
`android:prebuild` script (`--clean`) for a consolidation check unless the
intent is a regenerated project.

```powershell
java -jar <GRADLE_9_3_1_HOME>/lib/gradle-gradle-cli-main-9.3.1.jar `
  --no-daemon --no-parallel --max-workers=1 `
  -Dorg.gradle.jvmargs=-Xmx1024m `
  --project-dir android :rhythm-device:testDebugUnitTest
```

Use the official Gradle 9.3.1 launcher and JDK 17 (or JBR 21 with a JDK 17
toolchain), as recorded in B1/A4. Record the actual test/suite counts from the
XML; do not reuse the B2 162-test count as a fresh result.

### 7.3 Reader / Meditation native unit suites

From each companion root (read-only except Gradle output):

```powershell
./gradlew --no-daemon --no-parallel --max-workers=1 :app:testDebugUnitTest
```

Then, only when a signed/instrumented artifact is authorized:

```powershell
./gradlew --no-daemon --no-parallel --max-workers=1 :app:assembleDebug :app:assembleDebugAndroidTest
```

Do not edit companion worktrees from this integration task.

### 7.4 QA harness plan (no device, no writes)

```powershell
pwsh ./scripts/build-android-qa.ps1 -Mode plan `
  -RoutineRoot <ROUTINE_ROOT> -ReaderRoot <READER_ROOT> -MeditationRoot <MEDITATION_ROOT> `
  -RoutineSha <40_HEX> -ReaderSha <40_HEX> -MeditationSha <40_HEX> `
  -AndroidSdk $env:ANDROID_SDK_ROOT -BuildToolsVersion 36.0.0 `
  -JdkHome $env:JAVA_HOME -GradleHome <GRADLE_9_3_HOME> `
  -GradleUserHome <ISOLATED_CACHE_OUTSIDE_REPOS> `
  -Keystore <KEYSTORE_OUTSIDE_REPOS> -KeyAlias <ALIAS> `
  -ExpectedCertSha256 <64_HEX> -RoutineVersionCode <CURRENT_REVIEWED_CODE> `
  -OutputDir <SIGNED_OUTSIDE_REPOS> -Manifest <MANIFEST_OUTSIDE_REPOS> -Strict
```

`-RoutineVersionCode` must come from the reviewed tree. This turn does **not**
authorize `5 → 6` or any other bump.

### 7.5 QA build and single-APK verification (only when authorized)

```powershell
$env:SW005_KS_PASS = Read-Host -Prompt 'Keystore password'
$env:SW005_KEY_PASS = Read-Host -Prompt 'Key password'

pwsh ./scripts/build-android-qa.ps1 -Mode build `
  -RoutineRoot <ROUTINE_ROOT> -ReaderRoot <READER_ROOT> -MeditationRoot <MEDITATION_ROOT> `
  -RoutineSha <40_HEX> -ReaderSha <40_HEX> -MeditationSha <40_HEX> `
  -AndroidSdk $env:ANDROID_SDK_ROOT -BuildToolsVersion 36.0.0 `
  -JdkHome $env:JAVA_HOME -GradleHome <GRADLE_9_3_HOME> `
  -GradleUserHome <ISOLATED_CACHE_OUTSIDE_REPOS> `
  -Keystore <KEYSTORE_OUTSIDE_REPOS> -KeyAlias <ALIAS> `
  -ExpectedCertSha256 <64_HEX> -RoutineVersionCode <CURRENT_REVIEWED_CODE> `
  -OutputDir <SIGNED_OUTSIDE_REPOS> -Manifest <MANIFEST_OUTSIDE_REPOS>
```

```powershell
node ./scripts/verify-android-qa-apk.mjs <APK> `
  --variant qa --sdk $env:ANDROID_SDK_ROOT --build-tools-version 36.0.0 `
  --expected-cert-sha256 <64_HEX> --expected-version-code <CURRENT_REVIEWED_CODE>
```

### 7.6 Same-signature IPC / instrumentation

Plan only until an authorized device exists. Positive-first, mismatch-second.

```powershell
node ./scripts/sw005/device.mjs --mode plan --variant qa `
  --test-apk <test.apk> `
  --aut-package com.terinit.rhythmicroutine.sw005probe `
  --test-package com.terinit.rhythmicroutine.sw005probe.test `
  --runner com.terinit.rhythmicroutine.sw005probe.test/androidx.test.runner.AndroidJUnitRunner `
  --test-class com.terinit.rhythmicroutine.sw005probe.SharedSignerProbeTest `
  --provider-package com.terinit.rhythmicreader `
  --provider-uri "content://com.terinit.rhythmicreader.recovery/sessions/<REAL_BOUND_UUID>" `
  --provider-columns sessionId,protocolVersion,status,activeSeconds,qualifiedPages,completedAtEpochMs `
  --expected-cert-sha256 <SHARED_CERT_SHA256>
```

Meditation equivalent (real bound session only):

```powershell
--provider-package com.terinit.rhythmicmeditation `
--provider-uri "content://com.terinit.rhythmicmeditation.status/sessions/<REAL_BOUND_SESSION>" `
--provider-columns sessionId,protocolVersion,status,requiredQualifiedSeconds,completedQualifiedSeconds,completedAtEpochMs,lastUpdatedAtEpochMs,sessionKind,sourceCooldownId,sourceRhythmicDayId
```

Routine Insights probe:

```powershell
--provider-package com.terinit.rhythmicroutine.qa `
--provider-uri "content://com.terinit.rhythmicroutine.qa.attention-insight/attention-day/current" `
--provider-columns protocolVersion,attentionDayId,cooldownsTriggered,restorativeGatesCreated,restorativeGatesSatisfied,readerRestorativeCompletions,meditationRestorativeCompletions,meditationSubstitutionsUsed,meditationSubstitutionsRemaining
```

Execution additionally requires `--mode execute`, the exact serial,
`--authorize-device`, the device classification and (for owner hardware)
`--owner-consent-token`; the mismatched-signer run requires a passing positive
baseline. Never fabricate a session id or seed provider completion evidence.
No execute command is run or implied by this document.

---

## 8. Actual PRD-required integration gaps

These were the two concrete PRD-required gaps recorded before the corrective
turn. Both have now received the smallest source correction requested by Root.
Execution, native build and device/IPC evidence remain **NOT RUN** here.

### 8.1 Reader CD4+ typed observability/trust — source closed, execution pending (FR-09/FR-14/FR-17, T18/T25)

The legacy `RhythmDeviceModule.queryRecoveryStatus()` remains unchanged for
existing callers. The new additive path is:

- Kotlin `ReaderRecoveryStatusProviderClient.query()` verifies the Reader
  package with `CompanionTrust`, requests the explicit V1 projection, validates
  exact session id, protocol `1`, known status and non-negative counters, and
  classifies not-installed, untrusted-signature, permission-denied,
  protocol-incompatible, session-missing, corrupt, query-failed and unavailable.
- `ReaderRecoveryDetailedResultWire` maps that result to
  `queryStatus`/`availability`/`evidence`.
- `RhythmDeviceModule.queryRecoveryStatusDetailed` exposes it additively;
  the fallback shim returns `unavailable` and never fabricates evidence, while
  the client keeps the raw legacy path for older native modules.
- `NativeRecoveryProviderClient.queryRecoveryStatusResult()` normalizes the
  result and rejects wrong-id/corrupt rows.
- `RhythmCoordinator` uses the detailed result when available, exposes typed
  reader diagnostics, and dispatches `SYNC_READER_SESSION_EVIDENCE` only for
  available, exact-session evidence.
- `usePrototypeStore.refreshReaderEvidence()` and the existing read-only
  `ReaderProviderDiagnostic` presentation path display the typed reason.

Tests: Kotlin `ReaderRecoveryStatusProviderClientTest`; JS
`recovery.test.ts`, `b2_restorative_coordinator.test.ts` and
`restorativePresentation.test.ts`. Real same-signature IPC is still pending.

### 8.2 CD3 reading-gate lifetime — source closed, execution pending (PD-2/SC-7, FR-12/T06)

The source now carries unfinished CD3 reading gates across calendar and
Attention-Day boundaries while keeping Reader V2 evidence calendar-scoped:

- JS `events.ts` no longer filters `activeReadingGates` by current date on
  restore/import; `reconcileReadingGate()` retains an unfinished gate and
  accepts trusted V2 evidence for the current date **or** the gate's creation
  date, one aggregate at a time.
- `attentionExchange.deriveAttentionGateStatus()` evaluates a carried gate
  instead of treating it as absent.
- `restrictions.ts` applies the `reading-quota` hold to an unfinished gate
  regardless of its creation date; Essential exclusion and lease behavior are
  unchanged.
- `RhythmEngine` rehydration no longer drops non-current-date reading gates.
- Kotlin `NativeAttentionExchangeLogic.evaluateGate()` accepts current-date or
  creation-date evidence independently; `gateForCooldown()`,
  `decideCooldownExpiry()`, `reconcileIncomingState()` and
  `reconcileMidnightRollover()` retain unfinished gates and keep the new day's
  counters independent.
- `RhythmEnforcementService` retains/reconciles carried gates, queries both
  accepted dates, includes carried gates in the effective hold/snapshot, and
  no longer gates the baseline hold on a current-date reading gate.
- The pre-lock Reader observation predicate again covers ordinal-gated
  cooldowns as well as carried explicit gates. `reconcileIncomingState` keeps
  the accepted native snapshot authoritative on the same day/Attention Day, so
  a stale JS snapshot cannot append phantom gates; only genuine native
  unfinished gates carry across the boundary.

Tests: JS `c1_cd3_carry.test.ts`; Kotlin `C1Cd3CarryTest`; updated
`NativeAttentionExchangeLogicTest` expectations. No numeric historical-ledger
reconstruction, new threshold, schema or abandonment path was added.

### 8.3 Companion source context / exact parity

Root supplied immutable contract context at
`.expo/c1-companion-contract-context.txt` for Meditation `e62eef9…` and Reader
`2ad1573…`, with per-file SHA-256. No sibling worktree permission was expanded
and the prior companion reviews were not restarted. The context confirms the
Meditation `attention-day/current` selector and typed unavailable reasons, and
the Reader recovery/evidence provider authorities. Exact provider-side column
parity still requires the A4 probes or a full source diff; the context is not
compiled, imported or treated as runtime evidence.

### 8.4 Issue #13 / neutral projection

Routine's provider supports `attention-day/current` and a zero-row neutral
answer for a healthy provider. The supplied Meditation contract context
(`e62eef9…`) confirms the A2 client exposes a typed
`AttentionInsightQueryResult` with `EMPTY_CURRENT_DAY`,
`CURRENT_PROJECTION_UNAVAILABLE`, denial, malformed/protocol and transport
reasons, and uses the `current` selector. That is source-contract evidence, not
IPC proof. Real same-signature IPC is still **NOT RUN**; #13 must not be marked
closed from this document.

### 8.5 Fresh execution and physical gates

The consolidated tree has not been executed in this turn. The prior B2
162-native-test result is source-lane evidence only. C1 is not complete until
Root runs §7.1–§7.3, and C2/C3 remain blocked on signed artifacts, same-signer
IPC and owner-authorized hardware.

### 8.6 Version/release truth

This tree remains `1.3.0 / 5`. R0 recorded an owner-local `1.3.2 / 7`; C4 must
use the actual latest monotonic code, not the PRD's provisional number. No
version change is authorized by this turn.

---

## 9. Changes made in this bounded turn

| File | Change |
| --- | --- |
| `docs/sw-2026-005/C1_INTEGRATION_VALIDATION.md` | Accepted-input/source metadata and the two gap statuses updated. |
| `src/domain/rhythm/attentionExchange.ts` | Carry-aware `reconcileReadingGate`/`deriveAttentionGateStatus`; current OR creation-date V2 evidence, never pooled. |
| `src/domain/rhythm/events.ts` | Restore/import no longer drops non-current-date reading gates or creation-date cached evidence. |
| `src/domain/rhythm/restrictions.ts` | Unfinished carried reading gate keeps its `reading-quota` hold; Essential/lease behavior unchanged. |
| `src/domain/rhythm/RhythmEngine.ts` | Rehydration retains carried reading gates. |
| `src/domain/rhythm/recovery.ts` | Additive typed `queryRecoveryStatusResult` and taxonomy; legacy raw method unchanged. |
| `src/application/RhythmCoordinator.ts` | Reader detailed query, typed diagnostics, exact-session dispatch only. |
| `src/domain/rhythm/restorativePresentation.ts` | Reader diagnostic presentation states. |
| `src/components/RestorativeChoiceCard.tsx` | Pass-through for Reader diagnostics. |
| `src/store/usePrototypeStore.ts` | Reader diagnostic read model and `refreshReaderEvidence`. |
| `app/touch-grass.tsx` | Reader/Meditation provider-return refresh and diagnostic display. |
| `modules/rhythm-device/android/.../NativeAttentionExchange.kt` | Gate carry, evidence date acceptance, expiry/reconciliation, counter isolation, native snapshot authority. |
| `modules/rhythm-device/android/.../RhythmEnforcementService.kt` | Carried-gate reconcile, dual-date queries, snapshot/hold enforcement, ordinal-gated pre-lock observation, no current-date baseline condition. |
| `modules/rhythm-device/android/.../RhythmDeviceModule.kt` | Additive `queryRecoveryStatusDetailed`; snapshot retains carried gates. |
| `modules/rhythm-device/android/.../ReaderRecoveryStatusProviderClient.kt` | New trust/projection/session/protocol validated Reader V1 client and detailed wire map. |
| `modules/rhythm-device/src/RhythmDeviceModule.ts` | Fallback detailed Reader query returns `unavailable` only. |
| `src/domain/rhythm/__tests__/c1_cd3_carry.test.ts` | New JS CD3 carry/hold/evidence regressions. |
| `modules/.../test/.../C1Cd3CarryTest.kt` | New Kotlin CD3 carry/evidence regressions. |
| `modules/.../test/.../ReaderRecoveryStatusProviderClientTest.kt` | New Kotlin Reader taxonomy/parser regressions. |
| `src/application/__tests__/b2_restorative_coordinator.test.ts` | Reader typed denial/complete lifecycle regressions (and the earlier Meditation regression retained). |
| `src/domain/rhythm/__tests__/recovery.test.ts` | Detailed Reader client mapping regression. |
| `src/domain/rhythm/__tests__/restorativePresentation.test.ts` | Reader diagnostic UI-copy regression. |
| `modules/.../test/.../NativeAttentionExchangeLogicTest.kt` | Old midnight-drop expectations updated to carry semantics. |

No policy number, provider wire version, versionCode, signing, Gradle product,
companion worktree, device setting or canonical-owner source was changed.
`npm test`, native Gradle, APK/signing, same-signer IPC and all physical rows
remain **NOT RUN** by this worker; Root executes them after the pause.

---

## 10. Scoped risks

| Risk | Control |
| --- | --- |
| Passing JS unit tests are mistaken for installed enforcement | §1 and §6 keep static/runtime/device claims separate. |
| Reader V1 `null` is read as “Reader unavailable” or “no obligation” | Legacy raw method remains fail-closed; typed detailed path is additive and §8.1 marks execution pending. |
| A stale native snapshot clears a newer JS completion | B1/B2 serialization/rebase and `meditationCompletions` retention tests; still needs a fresh full run. |
| CD3 carry source correction ships as device-verified | §8.2 marks source implemented, execution/native/device pending. |
| Carried CD3 gate inflates the new day's counters | Kotlin `withGateRequirements`/snapshot filters current-date gates; JS tests assert independent counters. |
| Same-signer probe passes statically but fails at runtime | A4 requires actual signer digests, installed authority and a real positive baseline; not run here. |
| Companion context is mistaken for a full source review | §8.3 records the five-file hashed context and its limits. |
| Version drift or accidental downgrade | §2.3/§8.6; no version files touched. |

**Recommendation:** treat C1 as **source-mapped, pending fresh Root execution
and C2 same-signer qualification**. Do not describe this document as C1 pass,
issue #13 closure, device readiness or release acceptance.

## Root execution — 2 November 2026

Actual before/after production reproduction: an unfinished CD3 gate with no evidence was dropped on the next date before this change and is retained afterward. Focused carry/Reader/coordinator/presentation:31 tests pass. One older JS test required midnight to clear the gate; Root aligned that single expectation with approved PD2/SC7/SC8 while retaining new-day counter and unchanged-timer checks, and adding exact gate/cache retention assertions. Focused Attention Exchange:15 pass. Full combined JS589 tests/111 suites, zero failures/cancellations/skips,67.300seconds; typecheck/lint exit0.

Fresh generated Android project prepared without clean; package.json unchanged. First native run compiled and executed176 tests but failed2 existing regressions: pre-lock observation omitted ordinal-based cooldowns, and stale JS gates were appended to authoritative native state. Original C1 engineer corrected only these and strengthened the existing stale-snapshot fixture with positive requirements. Fresh native rerun:176 tests/21 suites, zero failures/errors/skips; Gradle1m24s. No JS/TS/JSON inputs changed after the589-test run; source timestamp proof is retained in controller evidence. SDK deprecation/JSONObject-nullability warnings and optional expo-system-ui styling advisory are deferred; they did not fail execution.

Accepted A4 manifest correction d1102c48372c397d01ff62e7811910b7bf089da7 is consolidated here with its original independent own485-test PASS. Root C1 logs are c1-gapfix-r1b-*, c1-gapfix-r2-native-tests.txt, c1-native-r2-summary.json and c1-cd3-carry-{before,after}.json. These are automated source results, not installed IPC, accessibility intervention, physical-device acceptance, or C2 readiness. Independent C1 review and C1 runtime/C2-C4 remain required.
