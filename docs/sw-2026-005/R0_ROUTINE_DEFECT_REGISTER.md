# SW-2026-005 — R0 Routine Defect Register

**Repository:** `Terinit-Technologies-Development/Rhythmic-Routine`
**Worktree:** isolated clean feature worktree, branch `codex/sw-2026-005-r0`
**Baseline SHA:** `2b20a113ba23a74b328cdc519800ea790897a09e` (canonical `master`)
**Pass:** R0 — baseline, reproducibility and interface freeze (read-only)
**Prepared by:** OpenCode primary engineer (DeepSeek V4.1 Flash)
**Date:** 29 October 2026
**Status:** EVIDENCE ONLY. No production code, tests, package files, policy settings, signing files or Git refs were modified. No owner approval is implied by anything in this document.

---

## 1. Scope, method and limits

### 1.1 What this pass did

Static, source-level investigation of DEF-01..DEF-07 and the FR contracts they touch, using file reads only. For every claim below the document records:

- the exact file and line range that establishes the behaviour;
- whether the finding is **DYNAMICALLY_REPRODUCED** (executed against canonical source; exact input/output recorded),
  **CODE-PROVEN** (established by reading control flow, no execution needed),
  **CODE-PROVEN (arithmetic)** (a property of the date/time arithmetic, numeric confirmation pending a harness),
  or **HYPOTHESIS** (needs device/dynamic proof);
- the reachable failure, i.e. the concrete user-visible path through production call sites;
- a minimal reproduction that an implementer can run without a device where possible;
- the existing tests that cover (or, worse, *encode*) the behaviour, and the tests that are missing;
- the FR and T mappings from the PRD.

### 1.2 Supplied baseline facts (not independently re-executed in this pass)

| Item | Value | Provenance |
| --- | --- | --- |
| HEAD | `2b20a113ba23a74b328cdc519800ea790897a09e` | supplied |
| Branch | `codex/sw-2026-005-r0`, isolated feature worktree | supplied |
| Working tree | clean at start | supplied |
| `npm test` | 423 passed, 0 failed, 0 skipped, 64s | supplied |
| `npm run typecheck` | PASS (exit 0) | supplied |
| `npm run lint` | PASS (exit 0) | supplied |
| `npm run prebuild` | PASS | supplied |
| Reader native tests | **106 unit tests PASS**, 0 failures / 0 errors / 0 skips, exit 0, 10m13s, independent Gradle home + explicit Java 17 path | supplied |
| Routine native tests | **80 tests PASS**, 0 failures / 0 errors / 0 skips; cold native build 21m4s | supplied |
| Meditation native tests | **177 tests PASS**, 0 failures / 0 errors / 0 skips | supplied |
| Physical / signing acceptance | **none performed** | supplied |
| Earlier Gradle failure | `Settings_gradle` `NoSuchMethodError` was environmental and mitigated; not a current blocker | supplied |
| Android folder | generated/untracked, absent in this clean worktree | supplied |
| `modules/rhythm-device` | tracked native source | supplied |
| Untracked Android SDK sources | not available to this pass | consequence |

### 1.2.1 Independent verification received during R0 (separate from this pass's static reads)

The following were produced outside this pass but on the same canonical baseline and are authoritative for the claims they cover. They do **not** constitute physical/device proof.

| Item | Result | Classification unlocked |
| --- | --- | --- |
| JS reproduction, weekend boundary, `Africa/Johannesburg`, Saturday **31 October 2026** | resolves Friday 07:30 → Monday 07:30, **72 h**, `containsNow = true` but the day spans two inactive days | **DYNAMICALLY_REPRODUCED** for DEF-01 weekend case |
| JS reproduction, DST boundary, `America/New_York`, Monday **9 March 2026 00:30** | resolves **Sat 7 Mar 07:30 → Sun 8 Mar 08:30**, `containsNow = false` | **DYNAMICALLY_REPRODUCED** for DEF-01 DST case |
| Repo-wide symbol search (`rg`) by the root operator | `createMorningMeditationRequirement`, `buildMorningMeditationRequest`, `queryRecoveryStatus` have **no production callers beyond their definitions**; other occurrences are tests | upgrades DEF-02/DEF-03 from scoped to **repo-wide confirmed** |
| Native baseline | all suites green: Routine JS **423**, Routine native **80**, Reader **106**, Meditation **177**; zero failures/errors/skips; Routine native cold build 21m4s. No physical or signing acceptance | Kotlin statements below are now test-backed for their suites; device behaviour remains unproven |


All four baseline suites pass, so any red in a lane is a regression. **No physical or signing acceptance has been performed**, and the Kotlin claims below still describe source behaviour, not device behaviour.

### 1.3 Tool-constrained limits of this pass

This R0 turn was restricted to exact relative-path file reads. Deliberately **not** performed in this pass:

- no repository-wide `grep`/`glob`, no directory-wide symbol index, no shell;
- no Git commands (baseline facts taken as supplied);
- no network, no APK inspection, no device;
- no access to the original local checkout with unrelated uncommitted work.

The two no-caller findings that matter were subsequently closed **repo-wide** by the root operator (§1.2.1), so DEF-02 and DEF-03 are no longer scoped claims. Everything else below that says "no caller" is still scoped to the inspected production modules; the exact search that would close it is named. The inspected production set was:

```
src/application/RhythmCoordinator.ts
src/application/bootstrapRhythm.ts
src/application/reconcileRhythm.ts
src/domain/rhythm/{attentionDay,routine,events,RhythmEngine,morningMeditation,
                   restorativeGate,restrictions,recovery,meditationEvidence,
                   attentionExchange,types}.ts
src/platform/NativeRhythmSyncProvider.ts
src/platform/NativeMeditationBridge.ts
src/platform/PlatformServices.ts
src/platform/native/NativeRestrictionProvider.ts
src/store/usePrototypeStore.ts
src/types/domain.ts
src/components/RestorativeChoiceCard.tsx
modules/rhythm-device/index.ts
modules/rhythm-device/src/{RhythmDeviceModule,RhythmDevice.types}.ts
modules/rhythm-device/android/src/main/java/expo/modules/rhythmdevice/
  {RhythmEnforcementService,RestorativeEnforcement,AttentionInsightProvider,
   NativeAttentionExchange,MeditationStatusProviderClient,MeditationContract,
   RhythmDeviceModule}.kt
```

Tests read: `pass03_attention_day.test.ts`, `pass03_morning_meditation.test.ts`, `pass03_restorative_gates.test.ts`, `restrictions.test.ts`.

### 1.4 Out of scope for this register

Reader and Meditation repositories; installed-APK truth; physical validation; issue #8/#10/#13 root cause at the Meditation end; release engineering; Gradle results. Those remain R0 gaps listed in §6.

---

## 2. Summary register

| ID | Title | Classification | Severity (proposed) | Live failure today? |
| --- | --- | --- | --- | --- |
| DEF-01 | Inactive-day Attention Day resolution | **DYNAMICALLY_REPRODUCED** (two named JS cases) + CODE-PROVEN (remaining variants) | P0 | Yes — Attention Day spans Fri→Mon whenever weekends are inactive; existing test asserts it |
| DEF-02 | Morning enforcement defined but not wired | CODE-PROVEN (wiring, repo-wide confirmed) | P0 | Yes — no requirement is ever created, persisted or enforced |
| DEF-03 | Reader CD4+ session evidence never queried | CODE-PROVEN (wiring, repo-wide confirmed) | P0 | Yes — a completed Reader session cannot clear the gate |
| DEF-04 | Restorative hold omitted from both enforcement paths | CODE-PROVEN | P0 | Yes — after cooldown expiry an unresolved CD4 gate does not block |
| DEF-05 | Provider selection not idempotent; no lifecycle refresh | CODE-PROVEN + hypothesis | P0/P1 | Yes for re-tap/rebind; device confirmation pending for background flows |
| DEF-06 | #13 connection warning taxonomy | HYPOTHESIS (Routine-side cause proven) | P1 | Yes on the Routine side: a valid empty projection is indistinguishable from unavailable |
| DEF-07 | Legacy surface drift and unobservable sync failures | CODE-PROVEN | P1 | Yes — `sync` failures are silent to the engine; `applyRestrictions` reports capability, not effect |
| R0-N1 | CD3 obligation discarded at local midnight | CODE-PROVEN | P0 | Yes — proven in both JS and Kotlin paths |
| R0-N2 | `morningMeditation` is stripped by the engine | CODE-PROVEN | P0 | Yes — persistence plumbing exists but is bypassed |
| R0-N3 | Native reset leaves signature caches populated | CODE-PROVEN (mechanism) | P1 | After in-process "reset local state" |
| R0-N4 | Native snapshot omits restorative/morning truth | CODE-PROVEN | P1 | Yes — JS can never import a native-created CD4 gate or morning hold |
| R0-N5 | Reader status query has no signer/permission check | CODE-PROVEN (absence) | P1 | Exploitability hypothesis |
| R0-N6 | Meditation `SESSION_MISSING`/`CORRUPT` collapse to `unavailable` | CODE-PROVEN | P2 | Yes — diagnostics lose the distinction FR-14 requires |

The R0-N items are new findings discovered while tracing DEF-01..07; they are not scope creep, they are the mechanism by which the DEF items become reachable.

**Classification vocabulary.** `DYNAMICALLY_REPRODUCED` = executed against the canonical source and the exact case is recorded (§1.2.1). `CODE-PROVEN` = established by reading control flow; no execution needed. `CODE-PROVEN (arithmetic)` = a property of date/time arithmetic, numeric confirmation pending. `HYPOTHESIS` = needs device or dynamic proof. "DYNAMICALLY_REPRODUCED" is still *not* physical proof: no device, no APK, no enforcement path was exercised.

---

## 3. DEF-01 — Inactive-day Attention Day resolution

**Classification:** **DYNAMICALLY_REPRODUCED** for (i) the weekend stretch and (ii) the DST `containsNow = false` case — see §3.1.1 for the exact executed inputs and outputs. CODE-PROVEN for the empty-array contradiction, the `enabled` sentinel contradiction and the TS/Kotlin civil-day divergence. **T:** T01, T02, T03, T04, T05, T06, T23. **FR:** FR-01, FR-02, FR-03, FR-08, FR-12, FR-16.

### 3.1 Evidence

`src/domain/rhythm/attentionDay.ts`

| Lines | Behaviour |
| --- | --- |
| 48–56 | `findMorningBuffer` accepts the first `morning-buffer` with `enabled !== false` and a non-empty `endTime`. `startTime` is never consulted. |
| 58–61 | `isBufferActiveOnDay` returns **`true` when `activeDays` is empty**. |
| 90–96 | Backward walk `back = 0..7`, accepting the first boundary whose civil day passes `isBufferActiveOnDay`. |
| 100–106 | Forward walk `forward = 1..7`, same predicate, to choose `nextBoundaryAt`. |
| 107–111 | `nextBoundaryAt ?? startedAt + DAY_MS`. |
| 115–123 | Fallback: local midnight, `nextBoundaryAt = startedAt + DAY_MS`. |
| 63–67 | `boundaryAt()` = local midnight of `base` **plus `minutes*60000` elapsed ms** (not a wall-clock construction). |
| 91 | The candidate civil day is obtained from `now - back*DAY_MS` — **elapsed-ms** step, not a calendar step. |

`src/domain/rhythm/routine.ts`

| Lines | Behaviour |
| --- | --- |
| 29 | `if (!window.enabled) return false` — so `enabled: undefined` is treated as **disabled** here. |
| 41, 52, 58 | `window.activeDays.includes(currentWeekday)` — empty array means **no active day**. |

**Contradiction 1 (weekday stretch).** With `activeDays = [1..5]` and `endTime = "07:30"`, on Saturday `resolveAttentionDay` rejects Sat and Sun and settles on **Friday 07:30**; the forward walk settles on **Monday 07:30**. The Attention Day is therefore 72 hours long, spans both weekend days, and carries one cooldown ordinal and one substitution ledger across them. This is exactly defect A in the PRD.

**Contradiction 2 (empty array).** `attentionDay.ts:59` treats `activeDays: []` as "every day"; `routine.ts:41` treats it as "no days". Two modules disagree about the same persisted value. With `[]`, the boundary algorithm produces a normal 07:30–07:30 day while routine restrictions never fire — a silent split-brain between the behavioural day and the restriction schedule.

**Contradiction 3 (`enabled` sentinel).** `attentionDay.ts:52` tests `enabled !== false`, so `undefined` **enables** the boundary source; `routine.ts:29` makes `undefined` **disable** the window. Persisted/migrated schedules that omit the field are read two different ways.

**Contradiction 4 (DST, primary path).** `boundaryAt` adds elapsed minutes to local midnight. On a spring-forward day the 07:30 boundary is *actually* 08:30 local; on a fall-back day it is *actually* 06:30 local. TS and Kotlin share this arithmetic (see §3.2), so they agree with each other but both disagree with the configured clock time.

**Contradiction 5 (DST, day selection — TS/Kotlin divergence).** The backward walk uses `now - back*DAY_MS`, which is not a civil-day step across a DST transition. Concrete scenario, `America/New_York`:

- DST starts Sunday 8 March 2026 (02:00 → 03:00), so 8 March is a 23-hour day.
- Evaluate at Monday 9 March 2026, 00:30 EDT.
- `back = 0` → candidate Mon 09 07:30, which is in the future → rejected.
- `back = 1` → `now - 24h` = **Saturday 7 March 23:30 EST**, not Sunday. `boundaryAt` therefore opens the day at **Sat 7 March 07:30**.
- The returned `AttentionDay` is `ad-20260307-0730`; the harness-reported end is **Sun 8 March 08:30**, so **`now` is not inside `[startedAt, nextBoundaryAt)`** — `containsNow = false` (reproduced, §3.1.1).
- Kotlin (`NativeAttentionExchange.kt:355–365`) steps the civil day with `Calendar.add(DAY_OF_YEAR, -daysBack)` and is therefore predicted, statically, to return `ad-20260308-0730`.

So on this path the two authorities disagree about the day identity, which is the identity that derives gate ids. That is a duplicate/mismatched-gate hazard, not merely a cosmetic boundary offset.

**Contradiction 6 (fallback next boundary).** `attentionDay.ts:122` uses `startedAt + DAY_MS`; `NativeAttentionExchange.kt:300` uses `boundaryAt(now, 0, -1)` = next **local** midnight. On DST days the two fallbacks differ by one hour.

### 3.1.1 Dynamically reproduced cases (exact inputs and outputs)

These two cases were executed against canonical source outside this pass and are the only DEF-01 claims promoted to `DYNAMICALLY_REPRODUCED`. They are JS-domain evidence only: no device, no APK, no native enforcement.

| # | Input | Observed | Meaning |
| --- | --- | --- | --- |
| R-01 | `Africa/Johannesburg`, Saturday **31 Oct 2026**, Morning Buffer `endTime = 07:30`, `activeDays = [1..5]` (Mon–Fri) | Attention Day opens **Fri 30 Oct 07:30** and closes **Mon 2 Nov 07:30**; span **72 h**; both weekend days resolve to the same id | The PRD's defect A is real in the current resolver, not a reading artefact |
| R-02 | `America/New_York`, Monday **9 Mar 2026 00:30**, same window shape (active every day) | opens **Sat 7 Mar 07:30**, ends **Sun 8 Mar 08:30**, `containsNow = false` | The resolver can return a day that does not contain `now`; gate identity derived from that day is not anchored to the present |

Note on R-02: the harness-reported end instant (Sun 08:30) is recorded verbatim. The specific end minute depends on how the forward candidate's civil date is normalised; A1 must pin both the id and the end instant in a regression test rather than inheriting this document's arithmetic.

**What the reproductions do not establish:** that a user saw a specific lock/unlock, that Android produced the same ids, or that any restriction was applied. Those remain T01–T05/T22 work.

### 3.2 Kotlin parity (both wrong, and differently wrong)

`modules/.../NativeAttentionExchange.kt`

| Lines | Behaviour |
| --- | --- |
| 269–283 | `resolveAttentionDayId`: identical 0..7 back-walk; **no `activeDays` guard beyond `isActiveOnDay`**. |
| 286–301 | `resolveAttentionDayState`: forward walk; fallback `boundaryAt(now, 0, -1)`. |
| 355–365 | `boundaryAt`: `Calendar` civil step, then `+ minutesIntoDay * 60_000` (same elapsed-minutes defect). |
| 370–378 | `isActiveOnDay`: `if (window.activeDays.isEmpty()) return true`. |
| 257–260 | `attentionDayIdForBoundary` uses `SimpleDateFormat(..., Locale.US)` with the default zone. |

The two implementations currently agree on the weekday stretch (both 72h) and on empty-array-as-all-days. They diverge on civil-day stepping across DST and on the fallback's next boundary. Any fix must land in both files in the same integration order, otherwise gate ids split.

### 3.3 Reachable failure

1. User configures Morning Buffer Mon–Fri 06:30–07:30 and disables weekend windows (the field complaint).
2. Friday evening the 4th cooldown of the Attention Day is allocated: `gateId = gate-ad-YYYYMMDD-0730-<group>-o4`, ordinal 4, substitution ledger at 1.
3. All of Saturday and Sunday resolve to the **same** `attentionDayId`. Weekend risk-group exhaustion increments the *Friday* ordinal (`allocateCooldownRequirement` +1 per exhaustion) and consumes further substitution slots from the same ledger.
4. Monday 07:30 the day finally rolls. A user who did CD4 work on Saturday can be told on Monday that their obligation belongs to a day that no longer exists; a user who did nothing on the weekend has an obligation whose ordinal may be 6–8 rather than 4.
5. The reverse also holds: because the id does not change, `evaluateRestorativeGate` (`restorativeGate.ts:343–348`) does **not** consider the gate stale, so it is enforced — but against the wrong day's counters.

### 3.4 Minimal reproduction

Executed by the root operator against canonical source (§3.1.1); reproduced here so A1 can adopt it verbatim as a regression test.

```ts
// R-01 — weekend stretch. TZ=Africa/Johannesburg
const morning: RoutineWindow = {
  id: 'morning-buffer', name: '', type: 'morning-buffer',
  startTime: '06:30', endTime: '07:30',
  activeDays: [1, 2, 3, 4, 5],            // Mon–Fri only
  protectedGroupIds: [], enabled: true, tagline: '', description: '',
};
const sat = new Date(2026, 9, 31, 12, 0, 0, 0).getTime();   // Sat 31 Oct 2026
resolveAttentionDay(sat, [morning]);
// OBSERVED: { id: 'ad-20261030-0730', startedAt: Fri 30 Oct 07:30,
//             nextBoundaryAt: Mon 2 Nov 07:30 }            -> 72 h span
// REQUIRED by FR-01: Saturday's own boundary; id 'ad-20261031-0730'
```

```ts
// R-02 — DST day selection. TZ=America/New_York
const mon = new Date(2026, 2, 9, 0, 30, 0, 0).getTime();    // Mon 9 Mar 2026 00:30
const day = resolveAttentionDay(mon, [{ ...morning, activeDays: [1,2,3,4,5,6,7] }]);
// OBSERVED: startedAt = Sat 7 Mar 07:30, nextBoundaryAt = Sun 8 Mar 08:30
//           startedAt <= mon < nextBoundaryAt  ==>  FALSE
// REQUIRED: a day id whose range contains `now`
```

Empty-array probe (static, not yet executed — classification remains CODE-PROVEN):

```ts
resolveAttentionDay(noon, [{ ...morning, activeDays: [] }]).id  // boundary exists
isInsideWindow(noon, { ...morning, activeDays: [] })            // false
```

### 3.5 Existing tests: cover vs. encode vs. miss

- **ENCODES THE DEFECT.** `src/domain/rhythm/__tests__/pass03_attention_day.test.ts:227–235` — test *"incomplete active days fall back deterministically"* asserts that Sunday 27 Sep 2026 resolves to `ad-20260925-0730` with `nextBoundaryAt` Monday 07:30. This green test **is** the Friday→Monday stretch. Any FR-01 fix necessarily changes this assertion; that is an approved-behaviour change and needs the owner decision in §5.
- **MISSES empty `activeDays`.** No test asserts the empty-array interpretation, and none compares `attentionDay` against `routine` for the same value.
- **MISSES DST entirely.** All timestamps are constructed with `new Date(y, m, d, h, min)` in the host zone; there is no DST transition, no zone override, no 23h/25h day.
- **MISSES cross-midnight `endTime`.** `parseBoundaryMinutes` accepts `00:00`–`23:59`, so an `endTime` earlier than `startTime` is silently interpreted as a same-day boundary.
- **Covers only the happy path** for 23:59→00:01 and 07:29→07:30 (`:50–63`), which T03 will re-use.

---

## 4. DEF-02 — Morning enforcement defined but not wired

**Classification:** CODE-PROVEN (wiring); the absence of a production caller for `createMorningMeditationRequirement` / `buildMorningMeditationRequest` is **repo-wide confirmed by `rg`** (§1.2.1), not merely scoped to the inspected set. **T:** T07, T08, T09, T10, T24, T25. **FR:** FR-05, FR-06, FR-07, FR-12, FR-16, FR-17.

### 4.1 The pure layer exists and is correct

`src/domain/rhythm/morningMeditation.ts`

| Lines | Behaviour |
| --- | --- |
| 43–45 | `morningMeditationSessionId(attentionDayId) = "morning-" + attentionDayId` — deterministic, restart-safe by construction. |
| 47–56 | `createMorningMeditationRequirement` — pure factory. |
| 64–75 | Satisfaction requires the exact bound session. |
| 100–109 | Lifecycle resolution; fail-closed once `enforceable`. |
| 129–140 | Migration floor (`migrationAttentionDayId`, `enforceableFromAttentionDayId`). |

`src/platform/NativeMeditationBridge.ts:89–103` builds a protocol-correct `MORNING_REQUIRED` payload (session_kind, 1800 s, `source_rhythmic_day_id`). The wire contract itself is sound: `MeditationContract.kt:75–93` validates kind, seconds and created-at; `MeditationContract.kt:33` defines `SESSION_KIND_MORNING_REQUIRED`.

### 4.2 Nothing calls the pure layer

- `src/application/RhythmCoordinator.ts` does not import `morningMeditation` at all. Its lifecycle entry points are `initialize` (`:196–242`), `handleAppResume` (`:509–537`), `reconcilePlatformActivation` (`:461–503`), `reconcile` (`:431–451`), and `refreshDailyEvidence` (`:544–584`). None creates, refreshes or evaluates a morning requirement.
- `src/store/usePrototypeStore.ts:41–44` imports only `buildCooldownMeditationRequest` and `nativeMeditationBridge`; `launchMeditationForGate` (`:1393–1406`) always sends `session_kind: 'COOLDOWN_RESTORATIVE'`.
- `buildMorningMeditationRequest` has **no production importer**. Repo-wide `rg` by the root operator confirmed that both `buildMorningMeditationRequest` and `createMorningMeditationRequirement` occur only at their definitions (plus tests); there is no hidden production call site outside the modules read here.
- `src/domain/rhythm/events.ts:1034` merely forwards an existing value:
  `...(currentRuntime.morningMeditation ? { morningMeditation: currentRuntime.morningMeditation } : {})`.
  Nothing ever assigns it, so the branch is dead.

### 4.3 The engine would discard the requirement even if it were created

This is the part not visible from `events.ts` alone, and it blocks FR-05 independently of DEF-02's missing creator.

| Location | Behaviour |
| --- | --- |
| `types.ts:126–140` | `RhythmRuntime.morningMeditation?: MorningMeditationRuntimeState` is declared. |
| `types.ts:162–163` | `PersistedRuntime.morningMeditation?` is declared. |
| `types.ts:436–438` | `normalizePersistedRuntime` **restores** `raw.morningMeditation`. |
| `RhythmEngine.ts:86–116` | The restored-branch object literal does **not** copy `normalized.morningMeditation`. |
| `RhythmEngine.ts:117–129` | The fresh-state branch does not initialise it either. |
| `RhythmEngine.ts:200–234` | `getRuntime()` builds a new object and does **not** include `morningMeditation`. |
| `RhythmEngine.ts:270–309` | `toPersistedRuntime()` does **not** write `morningMeditation`. |

Chain: create → `dispatch` keeps it only in the reducer's `nextRuntime` → `RhythmCoordinator.syncNativeState` reads `engine.getRuntime()` → field absent → `NativeRhythmSyncProvider.ts:439–447` sees `runtime.morningMeditation?.requirement` undefined → sends `morningMeditation: null` → `RestorativeEnforcement.kt:176–187` parses nothing → `morningFocusActive` is false (`RestorativeEnforcement.kt:65–66`). Restart persistence is equally broken because `toPersistedRuntime` omits the field.

So there are **three independent disconnects**, each sufficient on its own: no creator, no runtime projection, no persistence.

### 4.4 Restriction composition omits the morning flag

- `restrictions.ts:29–30` declares `morningMeditationActive`.
- `restrictions.ts:150–160` adds a `morning-meditation` reason to every non-essential, non-companion app.
- `restrictions.ts:193–210` deliberately lets that reason survive lease suppression.
- `events.ts:971–984` calls `computeEffectiveRestrictions(...)` with `{ isOvernight, groupAllowanceUsage, activeReadingGates, currentDateKey }` — **no `morningMeditationActive`**, and no gate options either (§5).

The predicate in `restrictions.ts` is therefore correct and unreachable from production.

### 4.5 Native enforcement omits the morning hold

- `RestorativeEnforcement.kt:1683–1696` `hasMorningFocusHold`: requires `morningFocusActive`, `morningMeditation.attentionDayId == currentAttentionDayId`, excludes companions, and is limited to *managed* packages (base-restricted set + risk group packages). The comment explicitly promises Essential/system apps are untouched.
- `RhythmEnforcementService.kt:1734–1744` `isEffectivelyRestricted` consults `base || isProtectedByRoutine`, `isRestrictedByCooldown`, `gatePresent` (reading gate only), `accessLeaseActive` — **not** `hasMorningFocusHold`, and not `hasGroupAttentionHold`.
- `NativeAttentionExchange.kt:633–638` is the single predicate and has no parameter for either hold.

`hasMorningFocusHold` is referenced nowhere in the enforcement path inspected. Exact closure search: `hasMorningFocusHold(` across `modules/` (expected: definition plus at most a preview UI).

### 4.6 Reachable failure

1. Morning Buffer ends at 07:30 on an eligible weekday.
2. Nothing creates `morning-<dayId>`; no native projection; no focus.
3. `resolveRhythmState` (`routine.ts:196–230`) returns `available` at 07:30; no cooldown, no gate → no restriction.
4. Every managed app opens. There is no observable difference between "morning obligation satisfied" and "morning feature absent".

This is the PRD's defect B in its purest form: the policy is documented, unit-tested and enforced nowhere.

### 4.7 Minimal reproduction

```ts
const engine = new RhythmEngine(config, null, Date.now());
engine.dispatch({ type: 'SYNC_MEDITATION_EVIDENCE', evidence: null as never, timestamp: Date.now() });
// no event exists that creates a morning requirement:
// dispatch({type:'CLOCK_TICK'}) at 09:00 leaves getRuntime().morningMeditation === undefined
```

Persistence probe: construct a `PersistedRuntime` with `morningMeditation: { requirement: {...} }`, pass it to `new RhythmEngine(...)`, then assert `engine.getRuntime().morningMeditation` — it is `undefined` today, and `engine.toPersistedRuntime()` drops it again.

### 4.8 Existing tests

- `pass03_morning_meditation.test.ts:113–263` exercises `createMorningMeditationRequirement`, `isMorningMeditationSatisfied`, `resolveMorningMeditationState`, `deriveMorningEvidenceView`.
- `:165–183` calls `computeEffectiveRestrictions` **directly** with `morningMeditationActive: true`. That proves the leaf, not the wiring.
- `:229–254` proves lease-vs-morning at the leaf.
- **Misses:** no `RhythmEngine` involvement, no `processRhythmEvent` involvement, no persistence round-trip, no native projection, no `isEffectivelyRestricted` test, no evidence that the requirement is created at the buffer-end transition.
- Consequence: the suite is green while the feature is inert. This is the exact "helpers tested directly do not prove installed-device enforcement" gap in the PRD.

---

## 5. DEF-03 — Reader CD4+ session evidence is not consumed

**Classification:** CODE-PROVEN (wiring); the absence of any production caller of `queryRecoveryStatus` is **repo-wide confirmed by `rg`** (§1.2.1). **T:** T13, T15, T18. **FR:** FR-09, FR-11, FR-12, FR-14.

### 5.1 The pieces exist and are correct

| Location | Behaviour |
| --- | --- |
| `recovery.ts:31–41` | `RecoveryProviderClient` with `queryRecoveryStatus`. |
| `recovery.ts:72–87` | `NativeRecoveryProviderClient.queryRecoveryStatus` maps the native row; any throw → `null`. |
| `types.ts:241–245` | `SYNC_READER_SESSION_EVIDENCE` event. |
| `events.ts:419–422` | Reducer caches the evidence. |
| `restorativeGate.ts:464–505` | Exact-session verification: `sessionId === gate.providerSessionId`, `protocolVersion === 1`, `status === 'COMPLETE'`, `activeSeconds >= 1800`, `qualifiedPages >= 11`. |
| `RhythmDeviceModule.kt:494–522` | Native bridge `queryRecoveryStatus` reads `content://com.terinit.rhythmicreader.recovery/sessions/<id>`. |

### 5.2 The query is never issued

- `src/store/usePrototypeStore.ts:1408–1431` `launchReaderForGate` constructs `new NativeRecoveryProviderClient()` and calls **only** `startRecoverySession`. The client is then discarded. `queryRecoveryStatus` is never called.
- `RhythmCoordinator` has exactly one evidence-refresh method, `refreshDailyEvidence` (`:544–584`), which calls `dailyReadingEvidenceClient.query(dateKey)` — Reader **Daily Evidence V2**, not the bound V1 recovery session.
- `RhythmCoordinator.handleAppResume` (`:509–537`) refreshes native state, usage events and daily evidence. It does not query a recovery session.
- No `dispatch({ type: 'SYNC_READER_SESSION_EVIDENCE' ... })` exists in the inspected set.
- Repo-wide `rg` by the root operator confirmed `queryRecoveryStatus` has no production caller at all — its only non-definition occurrences are tests. This closes the claim; it does **not** prove anything about the installed device.

### 5.3 Reachable failure

1. CD4+ gate is allocated; user selects Reading; `providerSessionId` is bound; Reader's `RecoveryEntryActivity` is launched with the bound id.
2. User completes 30 min / 11 pages. Reader persists a COMPLETE row.
3. Routine never queries it. `nextReaderSessionEvidence` stays `undefined`.
4. `evaluateRestorativeGate` (`restorativeGate.ts:464–505`) finds `boundSession === null` → returns `reader-unavailable` (or `separation-only` while the timer runs) → gate not satisfied.
5. `deriveRestorativeStatus` keeps `gateSatisfied: false` (`restorativeGate.ts:590–607`); the card says "Reading unavailable — please retry" (`RestorativeChoiceCard.tsx:60–61`) even though Reader did the work.
6. The user is locked out after the cooldown by an obligation they already discharged — the PRD's defect C.

Note the double failure mode: the gate is unwinnable *and* (via DEF-04) not even enforced natively. Today the user is not blocked, which masks the defect in casual testing and makes it a trap for the fix: wiring the query alone leaves DEF-04 as a fail-open; wiring DEF-04 alone makes the gate permanently unwinnable.

### 5.4 Minimal reproduction

```ts
// Provider side simulated at the boundary the reducer consumes:
engine.dispatch({ type: 'SYNC_READER_SESSION_EVIDENCE',
  evidence: { sessionId: 'bound-1', protocolVersion: 1, status: 'COMPLETE',
              activeSeconds: 1800, qualifiedPages: 11, completedAtEpochMs: now },
  timestamp: now });
// gate bound to 'bound-1' becomes satisfied — proving the reducer works
// and that the missing piece is the *caller*, not the rule.
```

Static negative: construct the store, call `launchReaderForGate`, observe that no `SYNC_READER_SESSION_EVIDENCE` dispatch occurs (spy on `coordinator.dispatch`).

### 5.5 Tests

- `pass03_restorative_gates.test.ts:410–436` proves a Reader session satisfies exactly one gate — **at the leaf**.
- `pass03_restorative_gates.test.ts:378–408` proves partial progress locks the provider.
- **Misses:** no test asserts that `launchReaderForGate` or any lifecycle hook issues a status query; no coordinator-level test; no `SYNC_READER_SESSION_EVIDENCE` round-trip through `RhythmEngine`.

---

## 6. DEF-04 — Restorative hold omitted from both enforcement paths

**Classification:** CODE-PROVEN. **T:** T12, T13, T14, T17, T18, T24. **FR:** FR-02, FR-12, FR-13.

### 6.1 The reason exists; the composition omits it (JS)

| Location | Behaviour |
| --- | --- |
| `restrictions.ts:27–28` | `RestrictionOptions.activeRestorativeGates`. |
| `restrictions.ts:136–148` | Adds `restorative-gate` for every risk app in a group whose gate is unsatisfied **and** whose `cooldownEndsAt <= now`. Comment states the invariant `canReenter = cooldownElapsed && gateSatisfiedOrAbsent`. |
| `restrictions.ts:199–211` | Lease suppression applies; `morning-meditation` survives, `restorative-gate` does not. |
| `events.ts:971–984` | The only production call passes `isOvernight`, `groupAllowanceUsage`, `activeReadingGates`, `currentDateKey`. **`activeRestorativeGates` is absent.** |

Consequence inside JS: `nextRestorativeGates` is fully computed (`events.ts:825–848`), correctly reconciled, persisted (`RhythmEngine.ts:287–289`), synced to native (`NativeRhythmSyncProvider.ts:420–438`) — and never consulted when computing restrictions. `restrictions.ts:136–148` is dead code in production.

### 6.2 The native predicate omits it too (Kotlin)

| Location | Behaviour |
| --- | --- |
| `RestorativeEnforcement.kt:75–83` | `hasRestorativeHold(groupId, currentAttentionDayId)` exists and is correct. |
| `RhythmEnforcementService.kt:1658–1673` | `hasGroupAttentionHold` exists; for `baseline-reading` it additionally requires a current reading gate. |
| `RhythmEnforcementService.kt:127–137` | On foreground: `hasGroupAttentionHold` is used only to decide whether to start **usage accounting** and whether to reconcile the reading gate. |
| `RhythmEnforcementService.kt:144` | `startGroupUsage` bails when a hold exists → **the allowance ledger does not even accumulate**. |
| `RhythmEnforcementService.kt:1734–1744` | `isEffectivelyRestricted` = `(base || routine || cooldown || readingGate) && !lease`. No restorative hold, no morning hold. |
| `RhythmEnforcementService.kt:536` | `presentIntervention` re-checks the same predicate before showing Touch Grass. |
| `NativeAttentionExchange.kt:633–638` | The shared predicate has four parameters; neither hold can be expressed. |

**Reachable failure (exact):** after a CD4+ cooldown expires with an unsatisfied gate:
- the cooldown timer is deleted at expiry (`RhythmEnforcementService.kt:407–415`),
- `gatePresent` is false because a `restorative-choice` gate creates **no** `NativeReadingGate` (`NativeAttentionExchange.kt:446–478`: baseline → reading gate; restorative-choice → restorative gate only),
- so `isEffectivelyRestricted` is false → no overlay, the app opens;
- simultaneously `hasGroupAttentionHold` is true, so `startGroupUsage` is skipped and no allowance is consumed.

The result is the worst combination: the obligation is silently unenforced *and* the user's allowance stops being metered, so the next exhaustion arrives later than it should. DEF-04 is therefore not only a bypass, it corrupts the allowance ledger's meaning.

### 6.3 Why this masks DEF-03 and DEF-05

Because the gate is not enforced, a user who fails to complete Reader or Meditation is not blocked. Any fix to DEF-03/DEF-05 that lands before DEF-04 changes the observed behaviour from "silent no-op" to "permanent lockout". The PRD's instruction that B1/B2 be one integrated vertical slice is therefore technically necessary, not merely organisational.

### 6.4 Minimal reproduction

TS (no device):

```ts
const gate = createRestorativeGateForOrdinal({ groupId:'social', attentionDayId: DAY,
  dailyCooldownOrdinal: 4, createdAt: now - 2*3600_000, cooldownEndsAt: now - 3600_000 })!;
const { effectiveAppIds } = computeEffectiveRestrictions([], {}, riskGroups, apps, now, {},
  { activeRestorativeGates: { social: gate }, currentDateKey: '2026-10-29' });
// leaf: contains every 'social' risk app (proves restrictions.ts:141 works)
// production equivalent (events.ts:971): passes no gates, so the same state yields []
```

The two calls differing is the whole defect: the leaf is right, the wiring is absent.

Kotlin (static): with a persisted restorative gate `{requirementKind:"restorative-choice", status:"in-pending", attentionDayId:current}` and no cooldown/reading gate, `isEffectivelyRestricted` returns `false` for a package in that group. Assert by invoking the companion function with a fabricated `Context` in a Robolectric/unit test once the native suite executes.

### 6.5 Tests

- `restrictions.test.ts` (198 lines) has **no** `activeRestorativeGates` and **no** `morningMeditationActive` case. Its three tests cover routine/cooldown union, multi-group cooldowns and essential exclusion.
- `pass03_restorative_gates.test.ts` proves `deriveRestorativeStatus` never reports complete when unsatisfied (`:148–211`) — presentation truth, not enforcement.
- **Missing:** a `processRhythmEvent` test asserting `APPLY_RESTRICTIONS` contains group apps after cooldown expiry with an unsatisfied gate; a Kotlin test on `isEffectivelyRestricted`; a parity test asserting the two predicates agree.

---

## 7. DEF-05 — Session selection / refresh lifecycle

**Classification:** CODE-PROVEN for rebind/idempotency; HYPOTHESIS for background/stale-response flows. **T:** T15, T16, T21, T25. **FR:** FR-09, FR-10, FR-11, FR-16.

### 7.1 A new session id every selection

`src/store/usePrototypeStore.ts:1381–1391`

```ts
selectRestorativeProvider: async (groupId, provider) => {
  await RhythmCoordinator.getInstance().dispatch({
    type: 'SELECT_RESTORATIVE_PROVIDER', groupId, provider,
    providerSessionId: generateRecoverySessionId(),   // <- new UUID every call
    timestamp: Date.now(),
  });
}
```

`src/domain/rhythm/events.ts:424–440` accepts the rebind whenever the gate is not satisfied and the provider is not locked:

```ts
const selected = selectGateProvider(gate, event.provider, { meditationAllowed });
if (selected !== gate && selected.selectedProvider === event.provider) {
  nextRestorativeGates[event.groupId] = { ...selected, providerSessionId: event.providerSessionId };
}
```

`selectGateProvider` (`restorativeGate.ts:236–250`) returns a **new** object even when `gate.selectedProvider === provider`, so `selected !== gate` is true and the id is overwritten.

**Reachable failure (re-tap):** user taps "Begin Meditation" → gate bound to `S1`, Meditation opens with `S1`. The tap handler is `onPress={async () => { await onSelectProvider('meditation'); await onBeginProvider('meditation'); }}` (`RestorativeChoiceCard.tsx:115–118`). A second tap (impatience, or a double-tap before the first launch resolves) rebinds the gate to `S2` and launches `S2`. The user completes `S1`; `evaluateRestorativeGate` compares `evidence.sessionId (S1)` to `gate.providerSessionId (S2)` → no credit. Thirty minutes are lost and the UI reports "Meditation unavailable".

Also note the buttons are **not** disabled while an in-flight selection exists (`RestorativeChoiceCard.tsx:108–121`, `133–146` derive disabled only from `gateOpen`, the substitution cap and provider availability). There is no in-flight guard, no debounce and no serialization.

### 7.2 Switch-before-progress semantics are undefined for identity

Repeat selection of the **same** provider is not ambiguous — FR-11 requires one stable id, so the current re-mint is simply a defect. The **switch** is PD-3, approved 29 October 2026 (`OWNER_POLICY_DECISIONS.md`): one persistent id per (gate, provider); bindings ACTIVE/INACTIVE rather than abandoned; switching back reactivates the original id; a switch is allowed only after reconciliation proves no progress (unknown ⇒ refuse); only the active binding's exact evidence counts.

The code implements exactly one half of the surrounding rule:

- **Lock after progress:** correct. `restorativeGate.ts:437–450` and `:494–505` call `lockGateProvider` on any credited progress; `:243` refuses later switches.
- **Before progress:** `selectGateProvider` allows the switch (`:236–250`) and `pass03_restorative_gates.test.ts:369–376` asserts it. What is **not** defined is what happens to the abandoned provider's session: the old id is discarded with no record, and if that provider had already started a native session (launch succeeded but evidence had not yet been polled) the user can complete it and receive nothing. That is the same failure as §7.1 but reached through the documented switch path.

### 7.3 No centralized refresh

- `RhythmCoordinator.handleAppResume` (`:509–537`) does not query Meditation or Reader session status.
- `refreshMeditationEvidence` exists (`usePrototypeStore.ts:1433–1446`) but is a **store action**, not a lifecycle hook. Its only plausible caller is a screen returning from Touch Grass / Meditation; it is not invoked by the coordinator, the clock, or resume. (PRD wording: "depends substantially on the Touch Grass screen return".)
- `dispatch` refreshes only daily reading evidence (`:318–320`), and only when the cached date key is stale.
- There is no bounded ongoing reconciliation for an open gate with a selected provider.

**Consequence:** after a process death or a backgrounding during the session, completion is only discovered if the user happens to revisit the specific screen and that screen calls the store action. FR-09/FR-10 require resume, cold start and bounded reconciliation; none of the three is implemented for either provider.

### 7.4 Wrong group / wrong attention day

`SELECT_RESTORATIVE_PROVIDER` looks up `nextRestorativeGates[event.groupId]` only. If the UI passes a stale `groupId` (e.g. the card was rendered for the previous group because `projectPrimaryRestorativeStatus` picks `max createdAt`, `usePrototypeStore.ts:222–247`), the event silently no-ops (`events.ts:429 if (!gate) break`) and the UI proceeds to launch with no binding → `launchMeditationForGate` returns false (`:1396`). There is no user-visible error path; the button appears to do nothing.

### 7.5 Tests

- `pass03_restorative_gates.test.ts:340–366` proves substitution consumption is idempotent **given a stable gate**; it cannot catch id regeneration because it constructs ids by hand.
- `:313–338` explicitly models "a fresh attempt is a NEW provider session bound to the same gate" — i.e. the test endorses new ids on retry, without asserting that the **old** session is invalidated or that a live old session cannot be orphaned.
- **Missing:** repeat-selection test asserting `providerSessionId` is unchanged for the same provider; concurrent-selection test; resume/cold-start refresh test; stale-group test.

---

## 8. DEF-06 — Existing #13 connection warning

**Classification:** HYPOTHESIS for the exact device trigger; the Routine-side ambiguity is CODE-PROVEN. **T:** T19, T25. **FR:** FR-14, FR-18.

### 8.1 What Routine publishes

`AttentionInsightProvider.kt`

| Lines | Behaviour |
| --- | --- |
| 26–30 | Authority/contract: `PATH = "attention-day"`, `PROTOCOL_VERSION = 1`, URI `…/attention-day/<dayId>`. |
| 94–127 | `query`: returns **`null`** for wrong path, non-null selection/args/sort, blank day id, query/fragment, unknown or duplicate projection. |
| 118–124 | Returns a **valid cursor with zero rows** when `requestedDayId != currentDayId`. |
| 110–115 | Current day comes from `loadAttentionDayState` (publication-side), and gates are filtered by `loadCurrentAttentionRestorativeGates`. |
| 125 | `setNotificationUri`. |

So there are three distinct responses a client cannot separate without instrumentation:

1. `null` — provider missing, authority not exported to the caller, permission denied, path/projection mismatch;
2. **empty cursor** — provider healthy, but the caller asked for a day that is not the current Attention Day (stale widget state, cached day, or a race across the 07:30 boundary);
3. one row — current day.

If the Meditation-side client maps "null or zero rows" to `null` → "Routine not connected" (PRD DEF-06), then case 2 produces a false disconnected report on a same-signed, correctly installed pair. That is the most likely #13 mechanism and it is consistent with the report being tied to a *specific* installation state rather than to signing.

Two further Routine-side truths that affect what Insights shows:

- **`meditationSubstitutionsUsed` is derived, not published.** `AttentionInsightProvider.kt:85–87` computes it as the count of *satisfied meditation gates for the day*. `RestorativeEnforcement.kt:59` stores gates in a `Map<String, …>` keyed by **groupId** (`:149 gates[groupId] = …`), so at most **one** gate per group survives. A group that completed two meditation restoratives in one day therefore reports `used = 1`. The canonical ledger `meditationSubstitutionsUsed` exists only in JS (`attentionExchange.ts:44–48`) and is **not** part of `NativeDailyAttentionExchangeState` (`NativeAttentionExchange.kt:69–76`) nor of the attention-state JSON (`RhythmEnforcementService.kt:1546–1553`). Native cannot publish the real ledger.
- **Zero-row is not distinguishable by design.** The contract has no "neutral" row and no status column. FR-14 requires distinguishing `usable/empty current-day projection` from `unknown session`/`provider exception`; the current wire shape cannot express it without an additive field or a different empty representation.

### 8.2 What cannot be concluded here

- Whether Meditation's `ContentResolverAttentionInsightClient` returns `null` on zero rows: the Meditation repository was out of scope for this pass.
- Whether the historical #13 device had a mismatched signature, a denied `STATUS_ACCESS` permission, a stale cached day, or a real zero-row current-day answer.
- Whether the provider is currently exported with the correct `android:permission` and `android:exported` in the generated manifest (which is untracked in this worktree).

These are exactly the three instrumentation facts the PRD asks for: **authority, URI, signed permission, cursor shape**. Recommend a diagnostics payload of `{authority, pathDayId, currentDayId, rowCount, projectionOk, queryExceptionClass}` — no personal data.

### 8.3 Minimal reproduction

Provider-level (Robolectric/unit, once Gradle is unblocked): query `attention-day/<yesterday>` and assert `cursor.count == 0` while `attention-day/<today>` returns 1. Client-level (Meditation repo): feed an empty cursor and assert the reported state is `neutral-empty`, not `disconnected`.

### 8.4 Tests

No Routine test in the inspected set covers `AttentionInsightProvider` query shape, projection rejection or the day-mismatch empty cursor. `pass03_ui_insights.test.ts` exists but was not read in this pass; it must be checked before claiming coverage.

---

## 9. DEF-07 — Legacy surface drift and unobservable enforcement readiness

**Classification:** CODE-PROVEN for the diagnostic/sync behaviour; UI-text drift is PRD-reported and structurally supported, not re-verified here. **T:** T20, T23, T25. **FR:** FR-14, FR-15, FR-17.

### 9.1 Sync failures are recorded and then swallowed

Three layers, in order:

1. `NativeRhythmSyncProvider.ts:275–589` wraps all stages in one `try`; on failure it records `{success:false, failedStage, error}` (`:580–588`). `requireNativeSave` (`:85–93`) correctly fails closed on a non-`true` native ack.
2. `RhythmCoordinator.syncNativeState` (`:283–293`) wraps the call in `try { … } catch { /* Platform sync boundary */ }` — the throw never reaches the caller and the provider's diagnostics are never read.
3. `RhythmCoordinator.status` is set once at `initialize` (`:201–207`) and `getStatus()` (`:879–884`) returns that frozen value. Nothing updates health after a projection failure, so a device whose native policy stopped updating continues to report the bootstrap health.

`getLastSyncDiagnostics()` (`NativeRhythmSyncProvider.ts:230–232`) exists and is not called anywhere in the inspected set. Closure search: `getLastSyncDiagnostics|lastSyncDiagnostics` across `src/`.

### 9.2 Two native writes claim success without proof

`RhythmDeviceModule.kt`

| Lines | Behaviour |
| --- | --- |
| 171–194 | `setRiskGroupPolicies` → `saveRiskGroupPolicies` (SharedPreferences `.apply()`, no result) then `return true` unconditionally. |
| 241–247 | `setRoutineSchedule` → `saveRoutineSchedule` (`.apply()`) then `return true` unconditionally. |
| 1762–1765 | `saveRoutineSchedule` uses `.apply()`. |
| 196–206 | `setAttentionExchangePolicy` correctly returns `commit()`. |
| 151–158 | `setBaseRestrictions` correctly returns `commit()`. |
| 1163–1656 | `persistAttentionMutation` correctly returns `commit()`. |

So the two stages that define *what* is enforced are exactly the two that cannot prove persistence, while `requireNativeSave` believes them. FR-17 ("every native write acknowledges real persistence") is satisfied for three stages and violated for two.

### 9.3 `applyRestrictions` reports capability, not effect

- `NativeRestrictionProvider.ts:13–34`: `applyRestrictions(appIds)` calls `RhythmDeviceModule.applyShieldRestrictions(appIds)`; on `true` it reports `{status:'applied'}` and records the ids in an in-memory `Set`.
- `RhythmDeviceModule.kt:418–422`: `applyShieldRestrictions` ignores its argument and returns `checkAccessibilityPermission(context)` — i.e. **true whenever the accessibility service is enabled**, regardless of any app being restricted.
- `NativeRhythmSyncProvider.ts:459–464`: the Android sync path deliberately writes `setBaseRestrictions([])`, with the comment that native alone evaluates routines/cooldowns/allowances.

Net effect on Android: the engine's `APPLY_RESTRICTIONS` effect does not write any native restriction set; it merely re-confirms accessibility availability and records ids in JS. Actual enforcement is entirely `isEffectivelyRestricted`. That is a legitimate architecture (single canonical predicate) but it makes DEF-04 a total bypass rather than a partial one, because the JS-side union is not the enforcement authority on Android.

Also note `NativeRestrictionProvider.getCapability()` (`:78–131`) does compute honest capability from module availability + accessibility permission; the problem is the *effect* report, not the capability report.

### 9.4 Reader-only surface drift

`RhythmEnforcementService.kt:494–517` and `:566–587` build `NativeOverlayAttentionInfo` from reading-gate concepts only (`mode` is `COOLDOWN` / `PRODUCTIVE_ATTENTION` / `ROUTINE`; ordinal and required seconds/pages come from `NativeReadingGate`). A CD4+ `restorative-choice` gate has **no** reading gate (§6.2), so the overlay cannot name the selected provider, the Meditation path, or the substitution count. `EXTRA_*` keys (`:537–561`) carry only reading fields. Structurally, Touch Grass must render Reader-shaped copy for a choice gate; the PRD's observed Reader-only wording is consistent with this.

The `RestorativeChoiceCard` itself is truthful (`:40–69`, `:89–159`), including the explicit "Meditation paths remaining N of 2" and "Neither meditation nor reading shortens the cooldown" (`:167–169`). So DEF-07's UI drift is **overlay/Touch Grass**, not the choice card.

### 9.5 Tests

No test in the inspected set asserts: that a failed sync changes reported health; that `getLastSyncDiagnostics` is surfaced; that `setRiskGroupPolicies`/`setRoutineSchedule` return a persistence result; that `applyRestrictions`' `applied` status corresponds to a native restriction; or that Touch Grass wording matches the gate kind. T20 and T25 have no automated proxy.

---

## 10. Additional code-proven findings discovered while tracing DEF-01..07

### R0-N1 — A CD3 obligation is discarded at local midnight (P0)

Both authorities scope reading gates to the **calendar** day, while the policy day is the Morning Buffer boundary.

JS:
- `events.ts:100–104` rebuilds `nextReadingGates` keeping only `gate.attentionDateKey === currentDateKey`.
- `events.ts:109–111` drops `readingEvidence` when its `dateKey !== currentDateKey`.
- `restorativeGate.ts:297–304` + `:365–370`: baseline gates accept evidence for `[currentDateKey, createdAt dateKey]`, but the cached evidence object has just been cleared, so it cannot satisfy until a new-day sync arrives — and that sync reports the **new** calendar day's aggregate (0 s / 0 pages at 00:05).

Kotlin:
- `RhythmEnforcementService.kt:975–984` `loadCurrentAttentionReadingGates` filters `gate.attentionDateKey == today`.
- `NativeAttentionExchange.kt:569–571`: at cooldown expiry, `if (cooldown.attentionDateKey != today) return COMPLETE_RESTRICTED_CYCLE`, which removes the reading gate and resets the group cycle ledger (`RhythmEnforcementService.kt:411–415`, `:1184–1190`).
- `RhythmEnforcementService.kt:1467–1487` retains `attentionDateKey` for the cooldown record but the gate lookup no longer matches.

Reachable failure: CD3 cooldown allocated 23:50, expires 01:20. At 00:00 the gate stops being "current"; at 01:20 the expiry decision sees a stale date and completes the restricted cycle. The user's allowance is reset and the 60 min / 36 pages baseline is never charged. This is a fail-open inside a single behavioural day — the "midnight reset loophole" POL-05 forbids for substitutions, applied here to obligation lifetime (FR-03), not to evidence scope (FR-08 fixes that separately).

Note the JS and Kotlin mechanisms differ (JS drops the gate from `activeReadingGates`; Kotlin drops the current-gate filter and then completes the cycle), so a fix must address both.

**Scope constraint (FR-08 / POL-03).** CD3 qualification stays **Reader Daily Evidence V2 on the calendar day, with the existing accepted-day semantics** — the JS gate already accepts `[currentDateKey, gate-creation dateKey]` (`restorativeGate.ts:297–304`, `:365–370`). The defect is that the *gate and its cached accepted-date evidence are destroyed* at midnight, not that evidence should be re-scoped to the Attention Day. Any remedy must keep the obligation alive and keep or re-query the accepted calendar-date evidence; substituting Attention-Day evidence for CD3 would exceed approved policy and is explicitly not proposed here.

Test coverage: `pass03_attention_day.test.ts:50–63` proves 23:59→00:01 keeps the **Attention Day id**, which is true; no test asserts that an active CD3 gate survives that same transition.

### R0-N2 — `morningMeditation` is stripped by the engine (P0)

Folded into DEF-02 §4.3 but listed separately because it is the single cheapest false assumption to make during implementation: the persistence schema and the native projection both already support the field, so a fix that only adds the creator will appear to work in-process and fail after restart.

### R0-N3 — In-process reset leaves sync signature caches populated (P1)

`NativeRhythmSyncProvider.ts:216–222` holds six `last*Signature` fields. `usePrototypeStore.ts:683–712` (`executeResetLocalState`) calls `resetEnforcementState()` (which clears native prefs), `storage.clearAll()`, `coordinator.destroy()`, then `coordinator.initialize()`. `PlatformServices` is a module-level singleton (`PlatformServices.ts:26–33`), so the same sync-provider instance survives `destroy()`. `forceReproject()` (`NativeRhythmSyncProvider.ts:234–243`) is never called on this path.

Because `riskPolicies` and `routineSchedule` are derived from configuration that the reset does not change, their signatures still match and **those two stages are skipped**, leaving native with no package lists — while the stages that do run (`attention-state`, `cooldowns`) push an empty runtime. The user ends with native enforcement configured for nothing.

Classification: mechanism is code-proven; whether this reset action is user-reachable in a stable build is a policy/product fact to confirm. Recommendation: call `forceReproject()` after any native reset, and treat "native policy count = 0 while JS expects > 0" as a health failure (the mismatch probe at `:251–271` already exists and would detect it on the next sync — but not if the stage is skipped, because the probe runs *inside* the risk-policies stage before the signature check at `:489–495`… it does run, so a later 30 s-bounded sync would heal it. Recommendation stands: heal immediately, not after a bounded delay).

### R0-N4 — The native snapshot omits restorative and morning truth (P1)

`RhythmDeviceModule.kt:599–659` `attentionExchangeSnapshot` returns `attentionStateInitialized`, `dateKey`, counters, `attentionDay`, `cooldowns`, `readingGates`, `groupUsage`, `activeAccessLeases`, `updatedAt`, `foregroundGroupId`, `evidence`. The TypeScript type declares `activeRestorativeGates`, `morningMeditation` and `officialCompanionPackages` as optional (`RhythmDevice.types.ts:203–207`), but the Kotlin producer never sets them.

Consequence: if native allocates a CD4 gate while JS is absent, JS can only reconstruct it by re-deriving from the cooldown ordinal (`events.ts:503–596`). That derivation requires `cooldown.attentionDateKey === currentDateKey` (`:515`), so a native CD4 gate created before midnight is invisible to JS after midnight, and native's morning state can never be observed by JS at all. Any parity test must assert snapshot symmetry, not just that JS can send the fields.

### R0-N5 — Reader status query has no signer or permission check (P1)

`RhythmDeviceModule.kt:494–522` resolves `content://com.terinit.rhythmicreader.recovery/sessions/<id>` with `contentResolver.query(...)` and no `CompanionTrust` verification, in contrast with the Meditation path which calls `CompanionTrust.verify(...)` before launching (`:534`) and inside `MeditationStatusProviderClient.query` (`:62`). `isReaderAvailable` (`:458–472`) only checks `getPackageInfo`, not signature.

Threat: if the genuine Reader is absent, another installed app may be able to register that authority and answer with a COMPLETE row, satisfying a CD4 gate without Reader. Classification: absence of verification is code-proven; exploitability is a hypothesis pending a same-signer/foreign-signer test (T18/T19). Recommendation: route the Reader query through the same `CompanionTrust` check before trusting any row, and return a typed availability instead of `null`.

### R0-N6 — Meditation availability collapses distinct failures (P2)

`MeditationStatusProviderClient.kt:129–137` maps `SESSION_MISSING`, `CORRUPT` and `UNAVAILABLE` all to the string `"unavailable"`, and `query()` returns `null` evidence for each (`:61–75`). `RhythmDeviceModule.kt:550–554` then returns `null` to JS, and `NativeMeditationBridge.ts:128–136` maps `null` to `null`. FR-14 requires `unknown session` to be distinguishable from `provider exception`; today it is not, and the UI cannot tell a user "start the session" from "reinstall Meditation".

---

## 11. Test coverage summary (Routine side)

| Area | Covered at leaf | Covered end-to-end | Encodes a defect |
| --- | --- | --- | --- |
| Attention Day 07:30 boundary, 23:59/00:01 | yes (`pass03_attention_day:50–63`) | no | no |
| Weekend stretch Fri→Mon | — | — | **yes** (`pass03_attention_day:227–235`) |
| Empty `activeDays` parity | no | no | no |
| DST / zone change | no | no | no |
| Morning rules / migration | yes (`pass03_morning_meditation`) | no | no |
| Morning restriction union | leaf only (`:165–183`) | no | no |
| Morning persistence / native projection | no | no | no |
| Restorative gate rules, cap, locking | yes (`pass03_restorative_gates`) | no | no |
| Reader/Meditation evidence consumption | no | no | no |
| Restorative hold in `computeEffectiveRestrictions` | no | no | no |
| Restorative hold in `isEffectivelyRestricted` | no | no | no |
| Repeat selection idempotency | no | no | no |
| Resume/cold-start evidence refresh | no | no | no |
| Native snapshot symmetry | no | no | no |
| Sync failure → health/reporting | no | no | no |
| Insights provider taxonomy | unknown (`pass03_ui_insights` not read) | no | no |

Interpretation: the green 423-test baseline is **not** evidence that DEF-01..07 are absent or fixed. Several suites validate the leaf functions that the production path never calls, and one suite asserts the weekend defect as intended behaviour.

---

## 12. Cross-defect interaction map

```
DEF-02 (no morning requirement)
   └─> no native morningFocusActive ──┐
DEF-04 (predicate omits holds)         ├─> isEffectivelyRestricted == false
   └─> restorative hold ignored ───────┘        │
                                               └─> app opens; no overlay
DEF-03 (no Reader query)  ─┐
DEF-05 (no lifecycle refresh) ├─> gate never satisfied
DEF-07 (§9.3 effect==capability) ──> JS APPLY/CLEAR is cosmetic on Android

DEF-01 (Fri→Mon day) ─┐
R0-N1 (midnight CD3)  ├─> gate lifetime/counters anchored to the wrong boundary
R0-N2 (engine strips) ┘   -> gate identity valid but policy day meaningless
```

Two rules follow for Wave A/B:

1. **DEF-04 must land before or with DEF-03/DEF-05.** Making evidence consumption work without restoring the native hold turns a silent no-op into an unwinnable lockout.
2. **DEF-01/R0-N1 must land before any evidence work that relies on gate identity.** A 72-hour Attention Day makes "exact bound session for the current day" ambiguous for the whole weekend.

**Non-rule, stated to prevent a repeat of the first draft:** R0-N1 does **not** justify widening CD3 evidence to the Attention Day. The obligation's lifetime is Attention-Day scoped; CD3's evidence stays calendar-scoped (FR-08/POL-03).

---

## 13. Owner decisions — approved 29 October 2026 (defect register view)

The authoritative approved summary is `docs/sw-2026-005/OWNER_POLICY_REVIEW.md`; the three decisions are repeated in `OWNER_POLICY_DECISIONS.md`. In register terms:

| ID | Decision | Blocks | Approved policy |
| --- | --- | --- | --- |
| **PD-1** | Does an inactive/disabled morning window still advance the Attention Day at the configured boundary clock, and what is the fallback when no usable boundary exists? | FR-01/02, DEF-01, T01–T05 | Advance every civil day at the configured clock; local-midnight fallback with diagnostic only when no usable boundary exists |
| **PD-2** | Across a boundary, does an unsatisfied gate expire; and what happens to a pending schedule edit and the substitution/cap ledger? | FR-03/12, DEF-01, DEF-04, T06, T17, T21 | Carry the gate until satisfied; pin the day and use the later boundary; per-day ledger keeps the gate's own day, never resets early |
| **PD-3** | What happens to the first provider binding when the user switches before meaningful progress, and if they switch back? | FR-11, DEF-05, T15, T16 | One persistent id per gate+provider; ACTIVE/INACTIVE, not abandoned; switch-back reactivates the original id; reconcile before switching (unknown ⇒ refuse); only the active binding's exact evidence counts |

**Not owner decisions — already fixed by the PRD, do not re-open:**

| Requirement | Source | Who resolves |
| --- | --- | --- |
| `activeDays: []` means no active routine days | FR-02 | Engineer implements; no approval needed |
| A lease never bypasses morning focus | POL-06, T24 | Engineer implements (JS already does; Kotlin must align) |
| Repeat selection reuses one stable provider session id | FR-11 | Engineer implements |
| Exactly one valid Reader **or** Meditation session; no cross-provider combination | POL-04, FR-11 | Already implemented in the reducer; preserve |
| Substitution ledger must be real and truthful, not derived | POL-05, FR-14 | Engineer publishes the additive ledger |
| UI must agree with native enforcement truth | POL-10, FR-15 | Engineer implements |
| Cross-midnight routine windows are valid and must be supported | T04 | Engineer implements; malformed `HH:MM` is the only invalid case |
| CD3 evidence stays Reader V2 calendar evidence with existing accepted-day semantics | FR-08, POL-03 | Engineer implements; **not** an owner choice |

**Engineering-resolvable with review (not deferred, not owner policy):** gate store shape and additive migration (including the FR-16 transition audit ledger), native snapshot symmetry, persistence acks, Reader status verification, Insights ledger publication. These must be delivered within this programme; they are not "out of scope".

---

## 14. R0 gaps and residual uncertainty

| Gap | Impact | How to close |
| --- | --- | --- |
| Routine native, Reader and Meditation suites | Superseded: all suites now pass (Routine native 80, Reader 106, Meditation 177) | Read the R0 baseline as green; any red in a lane is a regression |
| No repo-wide symbol search **in this pass** | DEF-02/DEF-03 no-caller claims were initially scoped | Closed by root `rg` (§1.2.1); remaining "no caller" statements (§7.3, §9.1) are still scoped and name their search |
| No installed APK / manifest inspection | DEF-06 signature/permission cause unproven; `exported`/`permission` unknown | C2 device manifest + `dumpsys package` on the QA build |
| Reader and Meditation repos not inspected | Provider-side qualification/parser causes unproven | Wave A2/A3 read-only passes |
| `pass03_ui_insights.test.ts` not read | Insights coverage unknown | Read in the next pass before claiming coverage |
| Dynamic reproduction coverage | Only the two named JS cases are executed; all other reproductions remain unexecuted | A1/A3 harnesses; T01–T05, T07–T18 |
| Physical device absent | All device-visible claims remain hypotheses | C3 only after C2 green |

**No defect in this register is closed and no fix is implemented.** Policy approval is recorded only in `OWNER_POLICY_REVIEW.md`; it does not authorise device work, merge, tag or release.
