# Rhythmic Routine — Pass 03: Restorative-Gate Integration

Status: **Pass 3 and the Pass 05A remediation are implemented.** The Attention
Day rollover/schedule-edit hardening and native stale-gate allocation fix are
automated-test green; the v1.2 Routine migration was also exercised in-place on
the Redmi Note 13 Pro+ 5G without clearing app data. Earlier physical evidence
for the native enforcement blocker and CD4+ provider paths remains recorded
below. Full SW-2026-004 owner acceptance is **on hold** for the remaining
physical matrix rows listed in
`docs/releases/SW-2026-004-CLOSEOUT.md`. No merge, tag, release, or store
submission is part of this handoff.

---

## 1. What changed (policy)

The v1.2 cumulative Reader gate is retired after cooldown 3. The finalized
policy is now implemented and tested:

| Cooldown ordinal | Requirement |
| --- | --- |
| 1–2 | 90-minute separation only (no gate) |
| 3 | separation + **Daily Reader baseline**: 3600 verified sec AND 36 qualified pages (Reader Daily Evidence V2 aggregate) |
| 4+ | separation + **ONE discrete restorative requirement**: Reader **1800 sec + 11 pages** (bound recovery session) **OR** Meditation **1800 qualified sec** (bound COOLDOWN_RESTORATIVE session) |

Hard invariants enforced in code and tests:

- `canReenter = cooldownElapsed && gateSatisfiedOrAbsent` (never OR; gates never
  change `cooldownEndsAt`)
- Meditation satisfies at most **2 cooldown gates per Attention Day**
  (`meditationSubstitutionsUsed`, consumed exactly once per gate on verified
  completion — never on select/launch/start/pause/cancel/fail)
- Morning / Evening / Standalone meditation never consume the cap
- One provider session satisfies exactly one gate (session-id binding)
- Reader and Meditation partial progress can never be combined (provider locks
  on first meaningful progress)
- Provider errors never fail open (deny-by-default, including signature checks)
- No midnight loophole: counters reset at the Attention Day boundary only

## 2. Branch / commits

- Branch: `feat/pass-03-restorative-gates`
- Baseline: `93d3a8d15ef861dc0fa7cac2ba806df927d358e1` (v1.2.0 master, frozen)
- Diff summary: `git diff 93d3a8d..HEAD`
- Untouched refs: `tag v1.2.0`, `release/v1.2.0`, `release/v1.2.0-rc1`

## 3. Attention Day

Schema (`src/domain/rhythm/attentionDay.ts`):

```ts
interface AttentionDay { id: string; startedAt: number; nextBoundaryAt: number }
```

Boundary algorithm (`resolveAttentionDay(now, schedule)`):

1. Use the Morning Window's **END** time (minutes past local midnight).
2. Walk back ≤ 7 days to the most recent boundary whose day is active for the
   window; it opens the Attention Day. Id: `ad-<yyyyMMdd>-<HHmm>`.
3. The next active boundary closes it (`nextBoundaryAt`).
4. No usable Morning Window (disabled / missing endTime / no active day in the
   lookback) → **fallback = local calendar day** (`ad-<yyyy-MM-dd>`),
   deterministic and documented.

Example (buffer ends 07:30): `27 Sep 07:30 … 28 Sep 07:29:59` is one Attention
Day; `28 Sep 07:30` opens the next. Substitution counters and ordinals reset
ONLY at that transition (spec 51 tested).

## 4. ActiveRestorativeGate (final schema)

`src/domain/rhythm/restorativeGate.ts`:

```ts
interface ActiveRestorativeGate {
  gateId: string;                     // deterministic: gate-<attentionDayId>-<groupId>-o<ordinal>
  groupId: string;
  attentionDayId: string;
  dailyCooldownOrdinal: number;
  createdAt: number;
  cooldownEndsAt: number;
  requirementKind: 'none' | 'baseline-reading' | 'restorative-choice' | 'legacy-reading';
  selectedProvider?: 'reader' | 'meditation';
  providerSessionId?: string;         // persisted BEFORE provider launch
  status: 'pending-selection' | 'in-progress' | 'satisfied';
  satisfiedAt?: number;
  requiredReadingSeconds?: number;    // baseline / legacy (aggregate Reader)
  requiredQualifiedPages?: number;
  requiredRestorativeReadingSeconds?: number;  // CD4+ Reader path (per session)
  requiredRestorativeQualifiedPages?: number;
  requiredMeditationSeconds?: number;          // CD4+ Meditation path (1800)
  providerLocked?: boolean;
  meditationSubstitutionConsumed?: boolean;    // substitution idempotency guard
  attentionDateKey?: string;         // LEGACY_READING keeps v1.2 day scoping
}
```

Gate policy functions: `requirementKindForCooldownOrdinal`,
`createRestorativeGateForOrdinal`, `evaluateRestorativeGate` (fail-closed),
`selectGateProvider`/`lockGateProvider`, `deriveRestorativeStatus` (status UX),
`isMeditationPathAllowed` (cap), `migrateLegacyReadingGate`.

## 5. Migration

- **Migration version**: `RESTORATIVE_MIGRATION_VERSION = 2`
  (`src/domain/rhythm/types.ts`, `normalizePersistedRuntime`).
- **Legacy `activeReadingGates` migration**: every persisted v1.2 gate becomes a
  `LEGACY_READING` Restorative Gate with its **original** numbers
  (`legacy-gate-<groupId>` deterministic id, `attentionDateKey` day scoping,
  aggregate Reader evidence semantics). A seeded `90 min / 47 pages` gate
  (actually `5400 sec / 47 pages` for ordinal 4) stays `5400/47` until it
  naturally completes/expires — never converted to `1800/11` mid-cycle.
- **Idempotency (spec 42)**: repeated initialization never duplicates gates,
  allocates ordinals, regenerates ids, or resets substitutions (tested by
  running the migration twice and comparing state).
- **Morning rollout (spec 27)**: `MorningMeditationMigrationState
  { migratedAt, migrationAttentionDayId, enforceableFromAttentionDayId? }`.
  Upgrades are enforceable only from the FIRST Attention Day strictly AFTER the
  migration day (update at 14:00 never locks the current day); fresh installs
  enforce from their own day. Missing migration state never enforces.

## 6. Morning Meditation Required

- State machine (`src/domain/rhythm/morningMeditation.ts`):
  `overnight-protected → morning-buffer → morning-meditation-required →
  available` (`resolveMorningMeditationState`).
- **Session identity**: Routine-authoritative and deterministic per Attention
  Day: `sessionId = morning-<attentionDayId>` (`morningMeditationSessionId`).
  App restart/reconciliation never creates duplicate obligations.
- Trust: only the exact bound `MORNING_REQUIRED` session
  (`status === 'COMPLETED'`, `completedQualifiedSeconds >= 1800`) satisfies the
  morning. Morning completion never consumes a cooldown substitution.
- **Morning Focus enforcement** (`computeEffectiveRestrictions`,
  `RestrictionReasonType 'morning-meditation'`): Essential apps and the official
  companion allowlist (`OFFICIAL_COMPANION_PACKAGES` = Meditation + Routine) stay
  reachable; all other nonessential and Risk apps are held. The reason survives
  Access Lease suppression (leases cannot trivially bypass the focus).
- Native side: `RhythmEnforcementService.hasMorningFocusHold` (managed packages
  held, companions and unmanaged system/essential apps untouched).

## 7. Meditation IPC (authoritative contract, as implemented)

| Item | Value |
| --- | --- |
| Activity/component | `com.terinit.rhythmicmeditation.app.MainActivity` (singleTask; `onCreate`/`onNewIntent`) |
| Intent action | `com.terinit.rhythmicmeditation.action.START_MEDITATION_RECOVERY` |
| Payload | `extra_request_payload` Bundle: `session_id`, `protocol_version` (=1), `session_kind` (`MORNING_REQUIRED` \| `COOLDOWN_RESTORATIVE`), `required_qualified_seconds`, `created_at_epoch_ms`, `expires_at_epoch_ms?`, `source_cooldown_id?`, `source_risk_group_id?`, `source_rhythmic_day_id?` |
| Signature permission | `com.terinit.rhythmicmeditation.permission.STATUS_ACCESS` (signature-level) |
| Provider authority | `com.terinit.rhythmicmeditation.status` (read-only; session id via `selectionArgs[0]` or URI path; columns `sessionId, protocolVersion, status, requiredQualifiedSeconds, completedQualifiedSeconds, completedAtEpochMs, lastUpdatedAtEpochMs`) |
| Protocol | version 1 |
| Trust config | Kotlin `CompanionTrust.verify` — Meditation's signing certs must equal Routine's own signer (deny-by-default, no debug bypass, no package-name-only trust). Meditation side configures Routine in `AppContainer.callerTrustPolicy`. |

Kotlin client: `MeditationContract.kt`, `MeditationStatusProviderClient.kt`,
`CompanionTrust.kt`; TS bridge `modules/rhythm-device/src/RhythmDeviceModule.ts`
(`isMeditationAvailable`, `startMeditationRecoverySession`,
`queryMeditationStatus`) and `src/platform/NativeMeditationBridge.ts`.

Trusted completion (spec 19): `status === 'COMPLETED'` for the **exact bound
session id**, `completedQualifiedSeconds >= requiredQualifiedSeconds` (1800),
`protocolVersion === 1` — never launch/ACTIVE/wall-clock/return/Intent result.

## 8. Cooldown 3 / Cooldown 4+ implementations

- **CD3 (Reader baseline)**: `baseline-reading` gate, `3600/36`, satisfied from
  Reader Daily Evidence V2 aggregate for the gate's accepted date keys (gate
  creation date key + evaluation date key — preserves v1.2 semantics across the
  Attention Day boundary). Can be satisfied BEFORE the cooldown ends; the
  cooldown still runs the full 90 minutes.
- **CD4+ Reader**: `restorative-choice` + `selectedProvider='reader'` + bound
  `providerSessionId` created via the existing Reader recovery-session protocol
  (`startRecoverySession`, 1800 sec / 11 pages requested for that session).
  Verified per session: `status === 'COMPLETE'`, `activeSeconds >= 1800`,
  `qualifiedPages >= 11`. `R4` can never satisfy `G5`.
- **CD4+ Meditation**: `selectedProvider='meditation'` + bound
  `providerSessionId` persisted on the gate BEFORE launch
  (`SELECT_RESTORATIVE_PROVIDER` engine event), then
  `startMeditationRecoverySession` with `session_kind=COOLDOWN_RESTORATIVE`,
  `required_qualified_seconds=1800`, `source_cooldown_id=gateId`,
  `source_risk_group_id=groupId`, `source_rhythmic_day_id=attentionDayId`.
  Verified through the status provider.

## 9. Meditation substitution counter

- Lives in `DailyAttentionExchangeState.meditationSubstitutionsUsed`
  (Attention-Day-scoped, resets only at the Morning-Buffer boundary).
- Consumed **exactly once** per gate, only when the bound session transitions to
  verified `COMPLETED` satisfying its gate (`meditationSubstitutionConsumed`
  guard + `consumeMeditationSubstitution` cap). Select/launch/start/pause/
  cancel/fail never consume.
- Cap (2/day) blocks both the offer (`selectGateProvider(..., meditationAllowed)`)
  and satisfaction (`evaluateRestorativeGate` refuses beyond the cap).
- CD6+ meditation is unavailable; Reader remains.

## 10. Restriction reasons & native snapshot

- New reasons: `'restorative-gate'` (unsatisfied gate after its timer) and
  `'morning-meditation'` (Morning Focus). Union semantics preserved; Access
  Lease suppression does NOT clear `morning-meditation`.
- Native snapshot (`NativeRhythmSyncProvider.setAttentionExchangeState`) now
  sends additive fields (v1.2 native ignores unknown keys):
  `attentionDay`, `activeRestorativeGates` (gateId/group/attentionDay/ordinal/
  kind/provider/status/requirements — no private history),
  `morningMeditation { attentionDayId, sessionId, requiredQualifiedSeconds,
  satisfied }`, `officialCompanionPackages`.
- Native persistence (`RestorativeEnforcement.kt`, SharedPreferences
  `rhythm_native_policy` → `restorative_gates_json`) survives JS/app process
  death. Enforcement hooks: `hasGroupAttentionHold` (cooldown OR same-day gate
  OR unsatisfied restorative gate) and `hasMorningFocusHold`.
- Reader v1.2 compatibility preserved: `activeReadingGates` keeps being
  projected (compat view) for quota UI / Reader preview; final Reader alignment
  is Pass 4.

## 11. Accountability (spec 45)

New protected operations (partner approval required when accountability is on;
policies themselves are FIXED — no new user-facing settings):
`disable-morning-meditation`, `reduce-morning-requirement`,
`disable-restorative-gate`, `increase-meditation-substitution-max`,
`reset-attention-day`, `reset-restorative-gate`,
`change-essential-classification`.

## 12. Test results

| Suite | Before | After | Result |
| --- | --- | --- | --- |
| Routine JS (`npm test`) | 355 tests / 67 suites | **405 tests / 77 suites** | 0 failures |
| Routine native (`:rhythm-device:testDebugUnitTest`) | 14 tests | **41 tests** | 0 failures |
| Meditation regression (`:app:test`) | 91 tests | **91 tests** | 0 failures (Pass 2 baseline not regressed) |
| `npm run typecheck` / `npm run lint` | clean / 4 pre-existing errors | **clean / 0 errors 0 warnings** | pass |
| `:rhythm-device:compileDebugKotlin`, `:app:assembleDebug` (both repos) | — | pass | |

New Routine JS suites (49 tests): `pass03_restorative_gates` (requirement
model incl. the explicit "ordinal 4 ≠ 5400/47" regression, cooldown/gate truth
table ×2 paths, substitution M1/M2/cap/M1↛G5/cancelled/idempotency, provider
locking, fail-closed provider trust, legacy 5400/47 preservation),
`pass03_attention_day` (spec 51 boundary table, midnight no-loophole,
fallbacks), `pass03_morning_meditation` (lifecycle, identity, focus
enforcement, lease-proofing, rollout migration), `pass03_restorative_migration`
(spec 41/54 idempotent migration, parallel Risk Groups, discrete CD4 gate).

Old tests updated only where they asserted the obsolete cumulative escalation
(2 policy tables + 2 quota views + persistence fixture shape) — no behavioral
regressions in cooldowns, restrictions, accountability, native ledger, or
persistence beyond the intended policy change.

## 13. Device validation (spec 55) — INCOMPLETE, BLOCKED

Device: **Xiaomi Redmi Note 13 Pro+ 5G** (`23129RN51X`), Android 16/API 36.
Routine was installed from the current development build for this branch;
Reader and Meditation were also installed. The user enabled Routine's
Accessibility Service and Usage Access during the session. Android reported
`GET_USAGE_STATS: allow`, the enabled accessibility component was
`com.terinit.rhythmicroutine/expo.modules.rhythmdevice.RhythmEnforcementService`,
and `dumpsys accessibility` showed it bound. However, Routine's Settings UI
continued to report **Screen Time & Shielding Authorization: DENIED** and
**Restriction Capability: FOUNDATION ONLY**.

The device test classified **Block Blast!** (`com.block.juggle`) as Risk in
Social Feeds. SQLite preferences confirmed both the Risk classification and
group membership were persisted. After relaunching Routine, its native policy
snapshot still contained `risk_group_policies_json: []`,
`routine_schedule_json.allRiskPackages: []`, and a cooldown with an empty
`packageNames` list. Launching Block Blast! produced no Routine intervention.
This establishes a native projection/enforcement integration blocker; it does
not establish successful live enforcement.

The debug state switcher displayed a Social cooldown, but the persisted daily
attention state remained at `cooldownsTriggered: 0`, and the native cooldown
had no attention-day ordinal or gate requirements. This is not valid evidence
for CD1–CD6 behavior.

Before Pass 3 enforcement ships, resolve the contradictory permission status
and ensure the saved Risk-app policy reaches the native snapshot. Then install
**Routine Pass 3 + Reader v1.2.0 + Meditation af4c894+** with compatible
signing identity and record results for:

A. Morning Buffer → Meditation Required (nonessential blocked; Essential +
   Meditation + Routine reachable) · B. Screen-off meditation continues
   qualifying · C. Essential interruption pauses safely and keeps focus/cooldown
   · D. CD3 Reader baseline (3600/36) · E. CD4 Meditation (M1 → G4, used = 1)
   · F. CD4 Reader (bound session R4) · G. CD5 second Meditation (used = 2)
   · H. CD6 cap exhausted (Reader only) · I. Cooldown complete before gate
   (stays blocked) · J. Gate complete before cooldown (stays blocked) ·
   K. Routine restart with active gate (ids stable) · L. Meditation process
   recovery (checkpointed time only).

Meditation-side session QA (screen-off qualification, force-stop recovery,
Essential interruption, and foreground-service behavior) is recorded in
`Rhythmic-Meditation/docs/PASS_04_HANDOFF.md`; the narrow active-session
foreground service was required by device evidence and verified there. Those
provider-session results do not close the Routine policy-projection and
enforcement blocker above. Provider-runtime problems must never be fixed by
weakening gate verification.

## 14. Known limitations

- **Release blocker — native device projection is not verified.** On the tested
  device the app's saved Risk assignment did not appear in native policy
  storage, and the app reported enforcement as `foundation-only` despite the
  Android Accessibility Service being enabled and bound. Morning Focus,
  restorative-gate holds, and intervention UX therefore remain unverified on
  hardware until this sync/status discrepancy is resolved and the device matrix
  passes.
- Meditation Focus treats "managed" packages (risk groups + base restrictions)
  as restricted; unmanaged system/essential apps are untouched on the native
  side (JS-side union uses the Essential classification explicitly).
- `attentionDay.startedAt/nextBoundaryAt` are sent as `0` placeholders in the
  native payload (id is authoritative); fill when native needs boundary times.
- Provider availability states surface as `unavailable` at the TS bridge (the
  Kotlin layer distinguishes not-installed/untrusted/incompatible/missing/
  corrupt internally).
- Legacy gates keep Reader aggregate evidence; Reader's own preview/quota
  surfaces still reflect v1.2 cumulative wording until Pass 4.

## 15. Exact work remaining for Pass 04 (out of scope here)

- Final Reader alignment: migrate Reader preview/quota surfaces off the
  cumulative escalation wording; Reader recovery-session UI for CD4+ gates
  (1800/11); Reader evidence per bound session exposure.
- Evening Meditation flow and Insights work (beyond the compatibility plumbing
  done here).
- Device validation (spec 55) results + any resulting enforcement tuning,
  including the foreground-service decision on the Meditation side.
- Optional: native overlay/status UX for the eight distinct states (spec 37 is
  fully modeled in `deriveRestorativeStatus`; the Routine screen shows the
  Restorative Choice card + status line).

## 16. Native-enforcement blocker remediation (RELEASE HOLD closure)

### 16.1 Original physical failure (reproduced, commit `48058d7`)

Redmi Note 13 Pro+ 5G (`23129RN51X`), Android 16/API 36: Usage Access granted
and Routine's Accessibility Service enabled/bound, yet Routine reported
restriction capability `FOUNDATION ONLY`, the saved Block Blast! Risk
classification never reached the native policy projection
(`risk_group_policies_json: []`, `allRiskPackages: []`), and launching the Risk
app produced no intervention.

### 16.2 Root cause (two independent defects)

1. **Capability truth defect.** `checkAccessibilityPermission()` relied solely
   on `AccessibilityManager.getEnabledAccessibilityServiceList()`, which this
   HyperOS build does not report through even while `dumpsys accessibility`
   shows the service enabled and bound. Routine therefore reported
   `hasRestrictionPermission=false` → `foundation-only`.
2. **Silent projection-chain failure.** `PlatformNativeRhythmSyncProvider.sync()`
   swallowed every error (`catch {}`); the fallback shim returned `true` for
   native policy writes (false-positive success); projection payloads carried
   `undefined`-valued keys (`attentionDateKey: cooldown.attentionDateKey` after
   a native import dropped metadata, `recoveryActivity.durationSuggestion`)
   whose rejection by the Expo bridge's Kotlin map conversion aborts the whole
   stage chain — **before** `setRiskGroupPolicies` runs; and signature caches
   advanced even when writes were never confirmed, permanently skipping
   re-projection. The classification→policy chain broke silently between
   `RiskGroup.appIds` and `setRiskGroupPolicies`.

### 16.3 Files changed

| Area | Files |
| --- | --- |
| Bridge honesty + diagnostics | `modules/rhythm-device/src/RhythmDeviceModule.ts`, `RhythmDevice.types.ts`, `index.ts` |
| Sync verification + self-healing | `src/platform/NativeRhythmSyncProvider.ts` |
| Capability truth | `src/platform/native/NativePermissionProvider.ts`, `NativeRestrictionProvider.ts` |
| Accessibility detection | `modules/rhythm-device/android/.../RhythmDeviceModule.kt` |
| Projection diagnostics + QA trigger | `RhythmDeviceModule.kt`, `RhythmEnforcementService.kt` (`runQaAllowanceExhaustion`) |
| Gate derivation for native allocations | `src/domain/rhythm/events.ts` (`SYNC_NATIVE_ATTENTION_EXCHANGE`) |
| QA trigger surface | `src/store/usePrototypeStore.ts`, `src/components/DemoStateSwitcher.tsx`, `app/settings.tsx` |
| Regressions | `src/domain/rhythm/__tests__/pass05_blocker_remediation.test.ts`, `pass02_native_ledger.test.ts`, `modules/rhythm-device/android/src/test/.../NativeServiceDetectionTest.kt`, `QaExhaustionAllocationTest.kt` |

### 16.4 Diagnostics added

- `getRhythmNativeModuleDiagnostics()` — `{ available, source: 'native' | 'fallback', loadError? }`;
  Settings shows **Native Module: AVAILABLE / FALLBACK**.
- `NativeSyncDiagnostics` — `{ success, failedStage?, error?, updatedAt }` per
  projection attempt (module / attention-policy / attention-state /
  base-restrictions / risk-policies / cooldowns / routine-schedule). Native
  writes are verified (`saved !== true` throws); signatures advance only on
  confirmed saves.
- `getEnforcementDiagnostics()` — `riskPolicyCount`, `riskPackageCount`,
  `routineRiskPackageCount`, `riskPackageSample` (bounded), plus
  `lastForegroundPackage` / `lastInterventionPackage`.
- Settings separates Native Module / Accessibility Service / Restriction
  Capability / Native Risk Policies / Native Risk Packages / Native Policy
  Sync / Last Foreground / Last Intervention / Daily Cooldown Ordinal, and
  surfaces **"Native policy out of sync"** when JS holds Risk apps while native
  holds none.

### 16.5 QA trigger (dev/debug builds only)

`triggerProductionAllowanceExhaustionForQa(groupId, packageName)` seeds ONLY the
native group usage ledger to its allowance boundary, then enters the same
production transition used when genuine usage reaches the boundary
(`startGroupUsage → exhaustGroup → NativeAttentionExchangeLogic.allocateCooldown`).
It never constructs cooldowns, ordinals, gates, substitution counters, or
evidence; every reported value is read back from production state. Native side
refuses non-debuggable apps (`FLAG_DEBUGGABLE` gate). The old debug cooldown row
is relabeled **"demo UI only — creates NO ordinal and NO restorative gate"**.

### 16.6 Automated regressions

| Suite | Before → after |
| --- | --- |
| Routine JS (`npm test`) | 405 → **414 tests / 82 suites**, 0 failures |
| Routine native (`:rhythm-device:testDebugUnitTest`) | 49 → **62 tests**, 0 failures |
| `npm run typecheck` / `npm run lint` | clean / clean |
| `:rhythm-device:compileDebugKotlin`, `:app:assembleDebug` | pass |

New coverage: fallback write honesty (no false-positive native saves),
bridge payload sanitation, write-verification + failing-stage evidence,
capability truth (module available ∧ Accessibility recognised = enforced;
module unavailable → foundation-only), classification→`setRiskGroupPolicies`
projection without app restart, projection-mismatch self-healing, the
production-equivalent ordinal sequence (1 → 2 → 3 with the 3600/36 baseline gate
at ordinal 3, both JS-import derivation and Kotlin allocation), and
Accessibility service-name normalization (exact service only).

### 16.7 Device results (2026-09-29, rebuilt `app-debug.apk` 12:17)

| # | Check | Result |
| --- | --- | --- |
| A | Native Module | **AVAILABLE** |
| B | Usage Access / Accessibility / Capability | **GRANTED / BOUND · RECOGNISED / ENFORCED** |
| C | Projection | **riskPolicyCount 1→3, riskPackageCount 1→3, sample `com.block.juggle`**, Native Policy Sync **OK**; final native `risk_group_policies_json` = social(`com.block.juggle`), entertainment(`com.netflix.mediaclient`), qa(`com.google.android.youtube`) |
| D | Foreground detection | service observed `com.block.juggle` (intervention fired from its foreground event) |
| E | Enforcement | launching Block Blast! under the real production cooldown raised the **Touch Grass intervention** ("Social Feeds is cooling down · 01:29:26 left"); diagnostics **Last Intervention: com.block.juggle** |
| F | Production-equivalent ordinals | QA trigger 1 (Social) → **"Next cooldown · #2"**, real 90-min cooldown + intervention; trigger 2 (Entertainment) → **"Entertainment is cooling down · 01:29:34"**, "Next cooldown · #3"; trigger 3 (QA group) → **CD3 gate live: "of 60 min" (3600 s) · "of 36 pages"**, "Next cooldown · #4", "3 used today" |

The CD3 requirement card ("Daily reading check-in · 60 min · 36 pages (shared
by Rhythmic Routine)") can only render from a production-allocated cooldown
carrying `dailyCooldownOrdinal = 3` with requirement 3600/36 — the exact
baseline-reading gate.

### 16.8 Block Blast projection evidence

User classification (Risk / Social Feeds) → `RiskGroup.appIds` →
`NativeRhythmSyncProvider` → `setRiskGroupPolicies` → SharedPreferences
(`risk_group_policies_json` contains `com.block.juggle`) →
`RhythmEnforcementService` foreground match → **intervention** (captured on
device). The chain is verified end-to-end.

### 16.9 Pass 05A follow-up status

- **F1 — post-sequence persisted-state anomaly: reverified closed (2026-09-30).**
  Native SharedPreferences and JS SQLite agree on Attention Day
  `ad-20260930-0800`, cooldown ordinal `5`, and gate
  `gate-ad-20260930-0800-music-o5`. After the exact bound Meditation record
  verified, both persist that gate as `satisfied`; JS also persists
  `providerLocked = true`, `meditationSubstitutionConsumed = true`, and
  `meditationSubstitutionsUsed = 1`. The gate retains its original
  `cooldownEndsAt = 1790759904540` (11:18:24.540 local); the Meditation record
  completed at `1790760991914` (11:36:31.914 local), after the full 90-minute
  cooldown had already elapsed. The CD3 daily reading target remains 3600/36.
- **F2 — CD4+ requirement divergence: resolved.** New native allocations now
  use the discrete Pass 3 table (CD1–2 none, CD3 3600/36 baseline, CD4+
  `RESTORATIVE_CHOICE` with Reader 1800/11 or Meditation 1800 qualified
  seconds). The v1.2 cumulative formula remains only for auditing/migrating
  stored legacy obligations, including ordinal-4 `LEGACY_READING` 5400/47.
  Native/JS reconciliation preserves deterministic gate identity, provider
  binding, Attention Day identity, completed status, and cooldown independence.
- The bound CD5 Meditation session completed and its evidence was verified
  from a cold-started Meditation content-provider process; details are below.
- MIUI reverts Accessibility Services enabled via ADB `settings put`; the
  in-Settings toggle persists. Reinstalling the APK also drops the binding —
  re-enable in Settings after every reinstall during QA.

### 16.10 Pass 05A physical rows 44–46 (complete)

Device: **Xiaomi Redmi Note 13 Pro+ 5G** (`23129RN51X`), Android 16/API 36.
The Routine Accessibility Service is enabled and bound; Usage Access is
granted. Reader and Meditation are installed with the shared Routine debug
signer. Meditation's pre-existing local database was backed up and restored
after reinstall; its prior session history was verified before beginning the
bound recovery run.

| Row | Physical check | Result |
| --- | --- | --- |
| 44 | Production-equivalent CD4+ allocation uses discrete `RESTORATIVE_CHOICE`; native and JS retain one matching deterministic gate and a full 90-minute cooldown. | **PASS** — Music ordinal 5 persisted as `restorative-choice`, `gate-ad-20260930-0800-music-o5`; cooldown start/end stayed `1790754504540` / `1790759904540`. |
| 45 | Bound Reader alternative for CD4+: Reader session evidence is per-session, 1800 seconds / 11 qualified pages; no aggregate Daily Reader Evidence is accepted for CD4+. | **PASS** — ordinal-4 Reader restorative gate and bound-session flow physically displayed 30 minutes / 11 pages; the CD4 screen also showed its 90-minute cooldown. |
| 46 | Bound Meditation alternative: exact gate-bound `COOLDOWN_RESTORATIVE` session, 1800 qualified seconds; provider lock/substitution accounting occurs only on verified completion, and cooldown remains independent. | **PASS** — Meditation SQLite reports the bound session `COMPLETED`, 1800/1800, with matching source gate/day IDs and `PRAGMA integrity_check = ok`. Routine's cold-start status-provider query reconciled the native and JS gates to `satisfied`, locked Meditation, consumed exactly one substitution, and retained the original cooldown end; completion occurred after cooldown expiry. Settings showed Native Policy Sync **OK**, Restriction Capability **ENFORCED**, and daily ordinal 5. |

Physical integration fixes applied during this run:

- Routine launches the bound recovery Activity via `startActivityForResult`,
  allowing Android to attest Routine as the caller while Meditation retains its
  deny-by-default same-signer verification.
- Meditation decodes typed Bundle values without coercing numeric fields via
  `getString()`, then idempotently adopts/starts the exact request session ID in
  its runtime before routing. The active UI and status provider now share the
  same bound session and 1800-second requirement.
- Meditation's status provider uses a lazy `AppContainer`: Android can create
  and query a provider before `Application.onCreate()`, so the first cold-start
  evidence query must not depend on an Activity having initialized app state.
- Routine refreshes that exact Meditation status-provider row when the Touch
  Grass screen resumes, so a completion accrued while Routine is backgrounded
  is reconciled without reissuing a recovery request.
- Meditation's existing local database, WAL, and profile marker were backed up
  before the matching-signer debug APK reinstall and restored before QA.

Pass 05A automated checks on this working tree:

| Check | Result |
| --- | --- |
| Routine JS (`npm test`) | **419 tests / 82 suites**, 0 failures |
| Routine Android native (`:rhythm-device:testDebugUnitTest`) | **71 tests**, 0 failures |
| Routine `:rhythm-device:compileDebugKotlin` | pass |
| Routine `npm run typecheck` / `npm run lint` | pass / pass |
| Meditation `:app:testDebugUnitTest` | **175 tests**, 0 failures |
| Meditation recovery/status-provider instrumentation | **6 recovery-intent + 2 cursor tests passed** before the final lazy-initialization adjustment. The final rerun did not complete: Gradle's default signer conflicted with the QA install on Redmi, and the emulator's test target could not cold-start under memory pressure. The cold-start status-provider query itself passed on Redmi. |
| Meditation `:app:assembleDebug` | pass |
| `git diff --check` (both repositories) | pass |

The 8 previously passing instrumentation tests cover the recovery Bundle codec
and status cursor schema/rows. After making the content-provider cold-start
safe, the final instrumentation rerun was attempted against the connected
emulator and Redmi: Gradle's default debug certificate was incompatible with
the QA-signed Redmi install, and the emulator later failed to start Meditation
under system memory pressure. The final APK build and 175 unit tests passed;
the cold-start provider query was directly reverified on the Redmi as part of
physical row 46.

#### Persisted-state comparison (F1)

Before completion, and again after the bound Meditation session completed,
native SharedPreferences and JS SQLite runtime state retained the same
Attention Day and gate identity. The final persisted JS state is:

- Attention Day `ad-20260930-0800`; daily cooldown count `5`; highest reading
  target `3600/36`; `meditationSubstitutionsUsed=1`.
- Music gate: `gate-ad-20260930-0800-music-o5`, kind
  `restorative-choice`, status `satisfied`, provider `meditation`,
  `providerLocked=true`, `meditationSubstitutionConsumed=true`, Reader
  alternative `1800/11`, Meditation requirement `1800`, and original
  `cooldownEndsAt=1790759904540`.
- Provider session `67ec1d42-27dc-492e-9216-df70c28a25ce` is saved by
  Meditation as `COOLDOWN_RESTORATIVE` / `COMPLETED`, 1800 required and 1800
  qualified seconds, linked to `gate-ad-20260930-0800-music-o5` and
  `ad-20260930-0800`.
- The native projection carries the same gate identity, provider, and satisfied
  status. JS substitution usage remains `1` after duplicate evidence queries
  and a stale native-allocation re-import; the cooldown end is unchanged.

## 17. Acceptance gate status

**BLOCKER RESOLVED.** All item-21 conditions were observed on the physical
device: `isRhythmNativeModuleAvailable = true`; Usage Access recognised;
Routine Accessibility Service recognised; Restriction Capability = ENFORCED;
Native Risk Policy count > 0 with `com.block.juggle` projected; Accessibility
foreground detection and a real intervention on `com.block.juggle` under an
active restriction; and the production-equivalent path allocated ordinals 1, 2,
3 with the real baseline-reading gate (3600 s / 36 pages) at ordinal 3.

## 18. SW-2026-004 final closeout — 2026-09-30

### In-place Routine v1.2 migration check

- Physical device: Xiaomi Redmi Note 13 Pro+ 5G (`23129RN51X`), Android 16/API
  36, ADB serial `P7J7TGKNAY8DKJ5P`; device ABI is `armeabi-v7a`.
- Installed the baseline APK built from Routine commit
  `93d3a8d15ef861dc0fa7cac2ba806df927d358e1` (versionCode 4, versionName
  `1.2.0`) with `adb install -r`. The current working-tree build used the same
  package/version metadata and signer SHA-256
  `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`.
- Seeded a representative active v1.2 CD4 gate in the app-private persisted
  state after baseline installation: ordinal 4, legacy Reader requirement
  5400 seconds / 47 pages, and a fixed `cooldownEndsAt`. Only fixture fields
  were changed; no uninstall or clear-data operation was used.
- Replaced the baseline APK in-place, loaded the current JS bundle, and
  verified the current runtime and native projection. The gate migrated to
  `LEGACY_READING` / `in-progress` with the same 5400/47 values, ordinal 4,
  daily count 4, and the exact original `cooldownEndsAt`. The current
  Attention-Day identity and future boundary were saved. A force-stop/relaunch
  produced the same gate ID, requirement, status, ordinal, and cooldown end.
- The fixture does not claim to have completed a 5400/47 reading session. The
  original device-data archive is preserved outside the repository and was
  restored after testing.

### Final checks

| Check | Result |
| --- | --- |
| Routine `npm test` | **420 / 420**, 82 suites, 0 failures |
| Routine `npm run typecheck` / `npm run lint` | pass / pass |
| Routine native unit tests / Kotlin compile / release manifest processing | pass (final test count recorded in the closeout report) |
| Routine ARM64 and ARMv7 debug APK builds | pass |
| Reader `test` / `assembleDebug` / `lintDebug` | pass |
| Meditation `:app:testDebugUnitTest` / `assembleDebug` / `lintDebug` | pass |
| Reader and Routine in-place data-retention checks | pass; detailed evidence in the SW-2026-004 closeout and Reader upgrade record |

The consolidated status, manifest/IPC audit, remaining physical matrix, and
owner-acceptance blocker are in `docs/releases/SW-2026-004-CLOSEOUT.md`.
