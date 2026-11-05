# C3 native snapshot probe (read-only)

SW-2026-005 · T07 · T20 · T25 · C3 evidence aid

Test-only source:
`qa/sw005/signer-probe/app/src/androidTest/kotlin/com/terinit/rhythmicroutine/sw005probe/NativeSnapshotProbeTest.kt`
(class `NativeSnapshotProbeTest`, method `readOnlyNativeSnapshot`).

## Scope

- Reads the already-persisted Routine native projection through public read
  accessors only: `RestorativeEnforcement.load(context)`,
  `RestorativeEnforcement.toJson(snapshot)`,
  `RhythmEnforcementService.loadCooldownPolicies`,
  `loadCurrentAttentionReadingGates`, `loadAttentionDayState`,
  `getLocalDateKey`, plus direct reads of `RhythmNativePolicyKeys.PREFS`.
- No writes, reset, seeding, reconciliation pass, activity launch, provider
  query, permission grant, accessibility toggle or new exported component.
- Emits exactly one compact JSON object through the instrumentation status
  Bundle under key `SW005_NATIVE_SNAPSHOT` (status code 2), so it appears in
  `adb` instrumentation output as `INSTRUMENTATION_STATUS: SW005_NATIVE_SNAPSHOT=…`.
- Normal JUnit assertion: `targetContext.packageName == com.terinit.rhythmicroutine`.

## What is emitted

| Field | Content |
| --- | --- |
| `marker`, `nowEpochMs`, `localDateKey`, `targetPackage` | provenance |
| `service` | `serviceRunning`, `serviceInstancePresent`, and `lastForegroundPackage` / `lastInterventionPackage` / `nextRoutineBoundaryAt` when present |
| `attentionDay` | `id`, `nextBoundaryAt`, `startedAt` as persisted (computed fallback only if the projection lacks it) |
| `morningMeditation`, `morningRequirements`, `morningMigration` | whitelisted keys only (`attentionDayId`, `sessionId`, `requiredQualifiedSeconds`, `createdAt`, `satisfied`, `satisfiedAt`, `sourceRhythmicDayId`, `sessionKind`, `sourceCooldownId`, `expiresAtEpochMs`; migration: `migratedAt`, `migrationAttentionDayId`, `enforceableFromAttentionDayId`) |
| `classification` | `essentialCount`, `managedCount`, `hasEssentialProjection`, `hasManagedProjection`, plus `essential`/`managed` booleans for `com.block.juggle` and `com.android.settings` only |
| `routineSchedule` | `rawPresent` and windows limited to `id`, `type`, `startTime`, `endTime`, `enabled`, `activeDays`, plus `protectedGroupIds` **only if** a writer actually stores that key |
| `cooldownRowCount`, `gateRowCount` | row counts |
| `currentDayCooldowns`, `currentDayGates` | identity-level rows (`groupId`, `attentionDateKey`, ordinal, `endsAt`/`cooldownEndsAt`, `requirementKind`) filtered to the current local date key |

Deliberately never emitted: managed/essential package inventory, companion
inventory, usage/usage history, evidence rows, `allRiskPackages`, session
activity data.

## Build / placement caveat

The source references public Kotlin APIs of the `rhythm-device` module, so it
compiles only where that module is on the test classpath and the instrumentation
target is `com.terinit.rhythmicroutine` (Routine's own androidTest target).
If the standalone signer-probe app is instrumented instead, the AUT is
`com.terinit.rhythmicroutine.sw005probe`, the package assertion fails and the
probe cannot read Routine's private SharedPreferences. That failure is
intentional: an empty probe-app store must never be reported as Routine state.
Root owns the exact build/run wiring and device execution.

## Process-lifecycle caveat

Instrumentation itself may start or restart the target process. This probe
therefore claims **only** that its method is policy read-only. It does not claim
zero process-lifecycle effects. In particular, a fresh process implies
`serviceInstancePresent=false` and absent `lastForegroundPackage` /
`lastInterventionPackage` even when the persisted policy is unchanged; read
`service.serviceInstancePresent` before interpreting those absences.

## Not an acceptance result

A successful run is one snapshot of persisted native truth. It is not proof of
morning enforcement, not proof of a gate outcome, and not a T07/T20/T25 PASS.
No physical acceptance is inferred from this probe; Root decides attribution
after combining it with the screenshot-only clean retest.
