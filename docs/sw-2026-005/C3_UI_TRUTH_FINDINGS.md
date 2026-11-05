# C3 UI truth findings (bounded)

SW-2026-005 · C3 · FR-15 · FR-17 · T25

Scope: presentation truth only. No domain, coordinator, store, native
enforcement, permission, dependency, schema or timer change. The existing
snapshot probe at `1dd17ae` remains the native evidence path.

## Observed vs expected (Root physical proof)

| Surface | Observed (actual device) | Expected | Fix |
| --- | --- | --- | --- |
| Today hero | "Open Day" / "Available" / "Use apps freely" with `00:00:00` while native morning requirements `ad-20261022-0800`, `ad-20261102-0800`, `ad-20261103-0800` were pending | Truthful morning-focus state and a route to the bound requirement | Hero consumes the authoritative store `morningMeditation` and applies the same active predicate as `MorningMeditationCard`; press routes to `/touch-grass` |
| Today screen | Correct bound action only reachable via the bottom "Try instead" card | Bound entry point discoverable next to the hero | Render the existing `MorningMeditationCard` under the hero (self-hides once resolved) |
| Native Touch Grass (ROUTINE mode) | "QA has reached its shared allowance" although no cooldown/gate existed; caused by `recoveryActivity` presence | Generic current-restriction copy that points at the bound requirement | ROUTINE fallback no longer claims allowance exhaustion |
| Version identity | installed Routine `1.4.0` / code `8` | Same version, next code | `versionCode` 9, `version` stays `1.4.0`; `package.json` already `1.4.0` (unchanged) |

Nothing above asserts a native enforcement defect. The native hold was real;
the mismatch was presentation. No claim is made about CD4 or any unobserved
native path.

## Exact minimal changes

1. `src/components/RhythmStateHeroCard.tsx`
   - Reads `morningMeditation` from the existing store projection.
   - Active predicate is identical to `MorningMeditationCard`:
     `state === 'morning-meditation-required' || requirement.satisfiedAt === undefined`
     (guarded by `requirement !== undefined`).
   - Applies only when the engine still reports `available`, so genuine
     cooldown/reading/evening states are untouched.
   - Copy states the bound session must be completed; the static value is
     labelled "Required session length" (required duration, not provider
     progress, not a countdown). Press → `/touch-grass`.
2. `app/(tabs)/today.tsx`
   - Imports and renders the existing `MorningMeditationCard` immediately after
     the hero. Same component as Touch Grass; no new query, timer or provider
     flow.
3. `modules/rhythm-device/android/.../RhythmOverlayActivity.kt`
   - ROUTINE fallback replaced with: "{group} is paused by a current Rhythm
     restriction. Open Rhythm Routine to see the bound requirement and continue
     from there."
   - COOLDOWN and PRODUCTIVE_ATTENTION branches unchanged; no intent extra,
     schema, service or enforcement change. `Open Rhythm Routine` still opens
     Routine, which now hosts the bound requirement card.
4. `app.config.ts`
   - `android.versionCode` 8 → 9; `version` remains `1.4.0`.
   - `package.json` verified at `1.4.0`; no edit.
5. This document.

## Requirement mapping

- FR-15 (truthful hierarchy/copy): hero and overlay now state the actual
  morning/current restriction instead of "Available"/"allowance reached".
- FR-17 (visible enforcement truth): UI no longer contradicts the native hold;
  it surfaces the bound requirement and its route.
- T25 (UI vs native truth): display now agrees with the pending morning
  requirement; native evidence remains from the probe/snapshot stream.
- POL-10 (labels are not enforcement proof): no change to enforcement; only the
  labels are corrected.

## Pending checks (Root-owned; not run here)

- `npm run typecheck`, `npm run lint`, `npm test`.
- Android compile of `RhythmOverlayActivity` (copy-only change).
- Screenshot validation: hero shows morning-required copy with a pending
  requirement and routes to Touch Grass; card appears under the hero; overlay
  ROUTINE copy no longer claims allowance exhaustion.
- No evidence yet that hero copy alone changes native blocking; native hold
  remains authoritative.

## C3 follow-up — mixed restorative obligation presentation (code 10)

### Actual reproduction (Root, code 9, phone)

Fixture groups allocated real native 90-minute cooldowns (ordinals 1/2/3) and a
CD3 `baseline-reading` gate; group 4 then allocated its own cooldown and the
Touch Grass choice card. With `sw005-qa-cycle-3` still unsatisfied and
`sw005-qa-cycle-4` active:

- Headline/timer: `SW005-QA-Cycle-4 Cooldown`, 1h29 — correct for the live
  cooldown.
- Explanation: `Restorative obligation for SW005-QA-Cycle-3: no restorative
  path selected yet. Choose Reader or Meditation…` — group name taken from the
  first raw pending gate (CD3) while the obligation title/progress came from
  the store's primary projection (CD4).
- Card below: CD4 view (30 min + 11 pages / 30 min Meditation, two Meditation
  paths remaining). Persists after settling, not cold-boot-specific.

Expected: headline, group name, provider, phase, provider diagnostics and the
displayed card describe the SAME obligation; a different pending obligation
stays visible as explicitly separate information.

### Cause (source-grounded)

`app/touch-grass.tsx` derived `restorativeGroupId` / `restorativeGroupName` /
`restorativeProvider` from `Object.values(activeRestorativeGates).find(status
!== 'satisfied')` and used `restorativePhase` only when that group matched
`restorativeStatus`, while `RestorativeChoiceCard` and all handlers use
`restorativeStatus` (the store projection = latest-created gate).

### Minimal change

- `app/touch-grass.tsx`
  - Header group/name/provider now come from the same `restorativeStatus`
    projection as the card and handlers; the raw pending-gate scan is a
    fallback only when no projection exists.
  - `restorativePhase` is the projected phase without a group cross-check.
  - A pending gate for a DIFFERENT group is passed as separate information only
    (`otherPendingRestorativeGroupName`); it is never labeled as this card's
    obligation. No policy, gate ordering, provider evidence or handler change.
- `src/domain/rhythm/touchGrassPresentation.ts`
  - New optional input renders the separate-obligation sentence next to, and
    clearly apart from, the presented obligation (all modes, plus the
    restorative-only mode). No mode precedence change.
- `src/domain/rhythm/__tests__/touchGrassPresentation.test.ts`
  - Regression: cooldown header names Cycle-4, explanation names Cycle-4, no
    line claims "Restorative obligation for Cycle-3", and Cycle-3 appears only
    as a separate outstanding obligation.
  - Guard: a `baseline-reading` obligation renders Reader daily-baseline copy
    and never the Reader/Meditation choice.
- `app.config.ts`: `versionCode` 9 → 10, `version` stays `1.4.0`
  (`package.json` already `1.4.0`).

Unchanged: CD3 gate remains enforced natively and is still named; no gate is
reordered, resolved or hidden; cooldown timer facts stay tied to the cooldown
group. The previously corrected Morning hero/card and native ROUTINE fallback
are preserved.

### Checks

- NOT RUN here: `npm test` (new regression cases), `npm run typecheck`,
  `npm run lint`, Android build/signing, device screenshots
  (`c3-cd4-choice-settled`, `c3-cd4-actual-choice-card` equivalents on code 10).
- Root-owned expected screenshots: Cycle-4 headline + Cycle-4 explanation +
  CD4 card + explicit Cycle-3 separate line; no Reader/Meditation wording for
  any CD3 baseline obligation.

## C3 follow-up — completed gate masking pending obligations (code 11)

### Actual failure (clean 2c5 / code 10, real device)

Two genuine 1800 s Meditation sessions consumed the cap (2 of 2). Group 1 /
ordinal 5 completed while 50 minutes of its original cooldown remained, and
group 2 / ordinal 6 plus group 4 / ordinal 7 were still pending. Screenshot
`c3-code10-complete-gate-masks-pending.png` showed only the completed ordinal-5
card and no Reader/Meditation action. Native allocated 5/6/7 at the same
timestamp, so the store's primary projection (sort by `createdAt` descending,
then group id) kept the completed group 1 as the sole primary obligation. Only
Touch Grass hosts provider launch actions, so the pending 6/7 obligations were
unreachable from the UI.

Expected: an unfinished obligation is always the actionable primary; completed
gates are a fallback only when nothing is outstanding.

### Minimal change (presentation selection only)

- `src/domain/rhythm/restorativePresentation.ts`
  - Added the pure selector `selectPrimaryRestorativeGate(gates)`: unfinished
    (`status !== 'satisfied'`) ahead of completed, then the existing recency
    (`createdAt` descending) and stable `groupId` tie-break inside each class.
    No mutation of any gate, cooldown, ledger, provider/session identity,
    timer, cap or query contract.
- `src/store/usePrototypeStore.ts`
  - `projectPrimaryRestorativeStatus` now calls that same tested selector
    instead of its local `createdAt`-only sort. This is the only production
    caller changed; presentation/handlers keep using the resulting
    `restorativeStatus`.
- `src/domain/rhythm/__tests__/restorativePresentation.test.ts`
  - Reproduction with completed ordinal 5 and pending 6/7 at the same
    `createdAt`: pending wins; after the first pending completes the remaining
    pending becomes primary; recency and group-ID tie-break stay deterministic
    in both input orders; completed fallback applies only when no unfinished
    gate remains.
- `app.config.ts`: `versionCode` 10 → 11, `version` stays `1.4.0`
  (`package.json` already `1.4.0`).

Protocols, permissions, schemas, native Kotlin, timers, substitution cap and
installed state are unchanged. The earlier 2c5 header/card truth fix and its
explicit other-obligation copy are preserved.

### Checks

- NOT RUN here (Root): full JS suite (`npm test` incl. the new cases),
  `npm run typecheck`, `npm run lint`, Android build/signing/install,
  screenshot validation on code 11.
- Root-owned expected: with 5 complete and 6/7 pending, Touch Grass presents
  the ordinal-6 obligation with its provider actions, then ordinal 7 after 6
  completes; completed 5 is shown only when no pending gate remains.



## Source-review boundary and actual Root checks

This is a bounded source correction plus the read-only snapshot probe, not
physical programme acceptance. EngiOrch source stream
36ecc317-acae-48c2-9c7f-4ff0f8f050ba covers this patch. Full physical T01–T25,
D4, VC-09 and VC-11 remain in unaccepted stream
55523699-9623-4219-880d-a989f4d04051. No PRD criterion is removed from the goal.
A source PASS here cannot accept G4 or G5.

Root independently ran the exact product-source patch before commit:
590 JavaScript tests PASS, typecheck PASS, lint PASS,176 native tests PASS
(21 suites, zero failures/errors/skips). Command receipts:
c3-ui-r1-js-checks.json and c3-ui-native-r1.json in the programme evidence
folder. Product source hashes remained unchanged through those checks.
This review-boundary documentation was appended after checks; no product code
changed. Actual screenshot checks of the updated APK remain pending.

The owner limits work to explicit PRD behavior, material regressions and highly
critical defects. Extra edge cases are deferred. Existing Accountability-
authorized Emergency Access bypass of cooldown/CD3/CD4 is an explicit owner
exception approved31 October; mandatory morning focus remains enforced.
That policy and the previously approved carry/boundary/switching decisions are
unchanged by this presentation patch. Do not reopen unrelated policy or add
production-hardening work to this correction.

### Root validation of the multi-group correction — 3 November 2026

Root ran592 JavaScript tests, typecheck and lint against the exact product
patch; all PASS. Evidence is c3-ui-multigroup-r1-js-checks.json and its three
command logs in the programme evidence directory. Source hashes stayed fixed
during checks. This documentation-only result was appended afterward.
No Kotlin/native policy source changed from the code9 candidate whose176
native tests passed. Independent review and actual code10 screenshot checks
remain pending; source checks do not accept full C3 physical behavior.

Root actual verification (3 November, 18:35 SAST): full596 JavaScript tests pass, typecheck and lint exit0; all product hashes remained stable throughout checks. Evidence c3-pending-card-r1-js-checks.json and matching three logs. Native Kotlin source is unchanged; prior176 native checks remain applicable. Independent same-reviewer source acceptance and physical code11 retest are pending.

