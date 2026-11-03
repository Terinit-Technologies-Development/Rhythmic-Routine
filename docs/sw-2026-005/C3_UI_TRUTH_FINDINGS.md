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
