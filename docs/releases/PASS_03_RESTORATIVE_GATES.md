# Rhythmic Routine — Pass 03: Restorative-Gate Integration

Status: **Pass 3 implemented, tested, and committed on `feat/pass-03-restorative-gates`.**
This document is the Pass 3 handoff (spec section 58). Physical-device
validation (spec 55) was attempted on a Redmi Note 13 Pro+ 5G (Android 16/API
36), but is **incomplete and blocked**: Android reports Usage Access allowed
and Routine's Accessibility Service enabled/bound, while Routine itself reports
restriction authorization denied and capability `foundation-only`. A saved
Risk-app assignment also failed to appear in the native enforcement policy,
and launching that app produced no Routine intervention. Spec 55 is therefore
not passed and enforcement is not ready to ship.

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

### 16.9 Open follow-ups (do not block the acceptance gate; tracked)

- **F1 — post-sequence persisted-state anomaly.** After the trigger sequence,
  the persisted (native + JS) attention state showed a single fresh Social
  cooldown (`dailyCooldownOrdinal: 1`, started 14:45:54) while the captured UI
  minutes earlier showed cooldownsTriggered 3 + the CD3 gate. The ordinal
  sequence itself is proven by the sequential captures; the post-sequence state
  transition (likely an interplay between cooldown-expiry cycle completion,
  `reconcileUsage` re-exhaustion, and native-attention authority import)
  needs one focused re-run using the new failing-stage diagnostics.
- **F2 — CD4+ requirement divergence.** Native
  `NativeAttentionExchangeLogic.requirementForCooldownOrdinal` still uses the
  v1.2 cumulative escalation (ordinal 4 → 5400/47) while Pass 3 policy is the
  discrete 1800/11 restorative choice. Affects only CD4+ (rows 44–46 scope);
  resolve before resuming those rows.
- MIUI reverts Accessibility Services enabled via ADB `settings put`; the
  in-Settings toggle persists. Reinstalling the APK also drops the binding —
  re-enable in Settings after every reinstall during QA.

## 17. Acceptance gate status

**BLOCKER RESOLVED.** All item-21 conditions were observed on the physical
device: `isRhythmNativeModuleAvailable = true`; Usage Access recognised;
Routine Accessibility Service recognised; Restriction Capability = ENFORCED;
Native Risk Policy count > 0 with `com.block.juggle` projected; Accessibility
foreground detection and a real intervention on `com.block.juggle` under an
active restriction; and the production-equivalent path allocated ordinals 1, 2,
3 with the real baseline-reading gate (3600 s / 36 pages) at ordinal 3.
