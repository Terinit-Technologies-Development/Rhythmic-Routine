# SW-2026-005 — Attention Day and Restorative Contract

**Repository:** `Terinit-Technologies-Development/Rhythmic-Routine`
**Baseline SHA:** `2b20a113ba23a74b328cdc519800ea790897a09e`
**Pass:** R0 — interface freeze; owner policies approved, implementation pending
**Status:** **POLICIES APPROVED 29 Oct 2026. NOT IMPLEMENTED. ENGINEERING REVIEW PENDING.**
**Authoritative policy summary:** `docs/sw-2026-005/OWNER_POLICY_REVIEW.md`
**Companion evidence:** `docs/sw-2026-005/R0_ROUTINE_DEFECT_REGISTER.md`

Nothing in this document authorises a code change by itself. Each clause is either:

- **[CURRENT]** — what the code does today, with file:line references;
- **[PROPOSED]** — engineering detail to be reviewed before implementation; or
- **[HYPOTHESIS]** — plausible but requiring device or dynamic proof.

PD-1, PD-2 and PD-3 are approved policy and are marked **[APPROVED]**. Everything else is mandated by the PRD or is an engineering decision submitted for review.

Where a clause is derived from reading rather than execution it is marked **[CODE-PROVEN]** or **[HYPOTHESIS]** as in the defect register.

---

## 1. Purpose and authority

### 1.1 What this contract fixes

The PRD requires FR-01 (single deterministic Attention Day resolver) and FR-03 (cross-boundary gate semantics) to be frozen before implementation, and FR-11/FR-12 (provider binding and enforcement continuity) to have one agreed shape. This document is the proposed freeze: identities, boundary arithmetic, cross-day lifecycle, provider session rules, the single enforcement predicate, the morning requirement lifecycle, evidence acceptance, and the observability vocabulary.

### 1.1.1 PRD precedence and correction of the first draft

The programme PRD is authoritative over this document. This revision corrects one substantive error in the first R0 draft:

- **Withdrawn:** the earlier draft proposed replacing CD3's Reader V2 calendar-day evidence with Attention-Day-scoped evidence. That was outside approved scope. **FR-08 and POL-03 explicitly preserve Reader V2 calendar evidence with the existing accepted-day semantics**, and this contract now does the same.
- **Corrected distinction:** *obligation lifetime* (gate identity, ordinal, cooldown end, substitution consumption) is Attention-Day scoped and must survive clock transitions; *evidence date scope* (which calendar aggregate may qualify CD3) stays calendar-based and is unchanged by this programme. These are separate axes and must not be collapsed.
- **Also corrected:** a valid cross-midnight routine window is a supported configuration (T04). Only a non-`HH:MM` value is malformed.

Everything below that is tagged `[PROPOSED]` is engineering detail for review. Approved policy is tagged `[APPROVED]` and must not be reopened.

### 1.2 Authority (POL-01)

| Fact | Authority | Consumers |
| --- | --- | --- |
| Routine windows, risk groups, allowances, cooldowns, ordinals, requirements | Routine | Routine UI, Android enforcement |
| Attention Day identity and boundary | **Routine** (must be identical in TS and Kotlin) | both layers, Insights projection |
| Morning requirement identity and satisfaction | Routine (identity) + Meditation (completion evidence) | enforcement, UI |
| Reader daily aggregate (CD3) | Reader `DailyEvidenceProvider` V2 | Routine |
| Reader bound recovery session (CD4+) | Reader `RecoveryStatusProvider` V1 | Routine |
| Meditation bound session (CD4+, morning) | Meditation `MeditationStatusProvider` V1 | Routine |
| Enforcement decision | Routine Android service (single predicate) | OS intervention |

Reader and Meditation never grant access, never shorten a cooldown, and never decide Routine policy. `[PROPOSED]` This contract treats any companion value as *evidence*, never as *authorisation*.

### 1.3 Current violations of the authority split (evidence)

- JS computes a restriction union (`restrictions.ts:44–217`) that Android does not use as its authority; Android's `APPLY_RESTRICTIONS` path only re-checks accessibility (`RhythmDeviceModule.kt:418–422`) while sync always writes `setBaseRestrictions([])` (`NativeRhythmSyncProvider.ts:459–464`). `[CODE-PROVEN]`
- Android re-derives its own Attention Day (`NativeAttentionExchange.kt:269–301`) instead of consuming Routine's, so the "single resolver" is currently two resolvers. `[CODE-PROVEN]`

---

## 2. Terms and identities

| Term | Definition | Current implementation |
| --- | --- | --- |
| **Attention Day** | The behavioural day that begins at the Morning Buffer boundary and ends at the next such boundary. Owner of cooldown ordinals, restorative gates, substitution cap. | `attentionDay.ts:24–31`, `AttentionDay { id, startedAt, nextBoundaryAt }` |
| **Attention Day id** | `ad-<yyyyMMdd>-<HHmm>` of the opening boundary instant, in the device's local zone at the time the id is minted. | `attentionDay.ts:38–46`; Kotlin `NativeAttentionExchange.kt:257–260` |
| **Gate id** | `gate-<attentionDayId>-<groupId>-o<ordinal>`; deterministic, one per cooldown instance. | `restorativeGate.ts:133–139`; Kotlin `RestorativeEnforcement.kt:109–110` |
| **Provider session id** | Opaque id bound to one gate + one provider before launch. Reused by retries **and by switching back to that provider**. | minted in `usePrototypeStore.ts:1388`; stored on gate `restorativeGate.ts:53` |
| **Morning session id** | `morning-<attentionDayId>`; deterministic, one per Attention Day. | `morningMeditation.ts:43–45` |
| **Cooldown ordinal** | 1-based count of cooldowns triggered in the Attention Day, all groups combined. | `attentionExchange.ts:314–343` |
| **Ordinal → requirement** | 1–2 `none`; 3 `baseline-reading`; 4+ `restorative-choice`; migrated `legacy-reading`. | `restorativeGate.ts:87–92`; Kotlin `NativeAttentionExchange.kt:186–193` |
| **Separation-only** | Cooldown timer running with a restorative requirement; timer is the only active block. | `restorativeGate.ts:375–376` |

`[PROPOSED]` Identities above are frozen for this programme. Changing the id *format* invalidates every persisted gate, so it must not change without a migration.

---

## 3. Attention Day resolver

### 3.1 Boundary clock

**[APPROVED — PD-1] AD-1.** The Attention Day boundary is the Morning Buffer **end wall-clock time**, applied to **every civil day**, including days on which the morning window is not scheduled and days on which the window is disabled.

Rationale, and why the alternatives are worse:

| Option | Consequence |
| --- | --- |
| **A. Same clock time every day (recommended)** | One boundary per civil day; Friday→Monday stretching is impossible; risk-group accounting always belongs to one behavioural day; no fabricated morning obligation on inactive days (obligation is gated separately, §8). |
| B. Boundary only on active days, midnight otherwise | Two different reset rules in one week; disabling a weekend window silently resets ordinals and substitutions at midnight inside what users perceive as one evening — reintroduces the POL-05 loophole the Attention Day exists to close. |
| C. Boundary only on active days, otherwise stretch | Current behaviour (`attentionDay.ts:90–106`); produces a 72-hour day (DEF-01); rejected. |

**AD-2.** "Inactive" means the *restriction window* does not fire. It does **not** mean the behavioural day stops advancing. This separation is the core of POL-07/FR-04 and is the user-visible fix for defect A.

**AD-3.** The boundary source is the **first** `morning-buffer` window in configuration order whose `endTime` is a valid `HH:MM`. `startTime` is not used by the resolver. `[CURRENT]` `attentionDay.ts:48–56` already selects the first window, but additionally requires `enabled !== false`. Under the PD-1 recommendation that condition is removed, so a disabled window still supplies the boundary clock; if PD-1 resolves to B or C it stays, and the sentinel must still be normalised against `routine.ts:29` (which treats `undefined` as disabled). Either way, do not leave two sentinels for the same field.

**AD-4.** No valid boundary source anywhere (no morning window, `endTime` missing/unparseable) → fall back to **local midnight**. Fallback must be deterministic and reported (FR-02), never silent. `[CURRENT]` fallback exists (`attentionDay.ts:115–123`) but is silent; Kotlin has the same silent fallback (`NativeAttentionExchange.kt:282`).

### 3.2 Boundary construction (clock semantics)

**[PROPOSED] AD-5.** Build the boundary instant from a **local civil date + wall-clock time**, in the device's current zone. Never add elapsed milliseconds to local midnight.

- Current TS: `boundaryAt()` = local midnight + `minutes*60000` (`attentionDay.ts:63–67`) → on a spring-forward day 07:30 becomes 08:30 local; on a fall-back day 07:30 becomes 06:30 local. `[CODE-PROVEN (arithmetic)]`
- Current Kotlin: same elapsed-minutes addition (`NativeAttentionExchange.kt:355–365`). `[CODE-PROVEN (arithmetic)]`
- Therefore TS and Kotlin **agree with each other and both disagree with the configured clock**. Parity tests must compare against the configured wall clock, not merely TS-vs-Kotlin, or the bug will pass parity.

**[PROPOSED] AD-6.** DST resolution:
- **Gap** (the wall time does not exist, e.g. 02:30 on a spring-forward day): resolve **forward** to the first existing instant.
- **Overlap** (the wall time occurs twice, e.g. 01:30 on a fall-back day): resolve to the **earlier** offset.
- Record the resolved instant and the zone offset in any audit snapshot.
- Consequence: on two days per year the boundary is at most one hour from the nominal clock time. That is acceptable and deterministic; inventing minutes is not.

**AD-7.** Day selection must step **civil days**, not 24-hour periods.

- Current TS steps `now - back*DAY_MS` (`attentionDay.ts:91`). **Dynamically reproduced** (`America/New_York`, Monday 9 March 2026 00:30): the resolver opens the day at **Sat 7 Mar 07:30** and reports an end of **Sun 8 Mar 08:30**, so `startedAt <= now < nextBoundaryAt` is **false**.
- Current Kotlin steps with `Calendar.add(DAY_OF_YEAR, -1)` (`NativeAttentionExchange.kt:355–365`), so the two authorities are predicted to return **different ids** (`ad-20260307-0730` vs `ad-20260308-0730`) in that scenario. This part remains a static prediction.
- `[PROPOSED]` Both must enumerate civil dates (`LocalDate.minusDays(n)` in Kotlin; equivalent local-date arithmetic in TS), then construct the boundary per AD-5. Assert the invariant `startedAt <= now < nextBoundaryAt` as a resolver postcondition.
- Classification: the TS failure is **DYNAMICALLY_REPRODUCED**; the Kotlin divergence and the exact end instant remain **CODE-PROVEN / predicted** until the native suite runs.

**AD-8.** `nextBoundaryAt` must be the **next** boundary strictly after `now`, computed by civil-date stepping and AD-5, with a hard fallback of the next local midnight (never `+24h`). `[CURRENT]` TS fallback uses `startedAt + DAY_MS` (`attentionDay.ts:122`) while Kotlin uses next local midnight (`NativeAttentionExchange.kt:300`); they diverge by one hour on DST days. `[CODE-PROVEN]`

### 3.3 Active days and enabled flags

**[PROPOSED] AD-9.** `activeDays` governs **restriction windows only** and never the boundary clock. The `[]` row is not a new policy choice: FR-02 already fixes it as "no active routine days".

| Value | Restriction windows (`routine.ts` / `isProtectedByRoutine`) | Attention Day boundary |
| --- | --- | --- |
| `[1..5]` | fires Mon–Fri only | every civil day at the configured clock time |
| `[]` | **never fires** (FR-02) | every civil day at the configured clock time |
| `enabled: false` | never fires | still advances (boundary clock is policy metadata, not a restriction) |
| `enabled` absent | treat as `true` after normalisation, in both modules | advances |

The current contradiction — `attentionDay.ts:59` returns `true` for `[]` (all days) while `routine.ts:41` returns `false` (no days) — is removed by making the boundary independent of `activeDays`, not by re-deciding what `[]` means. FR-02 decides `[]`; AD-9 removes the boundary's dependence on it. `[CODE-PROVEN]` for the contradiction.

**[PROPOSED] AD-10.** Only a **malformed** time value (`"7:30"`, `"24:00"`, `""`, non-string) is invalid. It must be treated as "no usable boundary" (AD-4) and **reported** with the window id and raw value. This is distinct from a valid cross-midnight window (AD-11): coercion is a defect because it *invents* `00:00`, not because midnight is disallowed. `[CURRENT]` Kotlin `parseTime()` coerces unparseable values to 0 in the restriction path (`RhythmEnforcementService.kt:1774`), so a malformed start silently becomes a midnight start and can make an otherwise same-day window look cross-midnight. `[CODE-PROVEN]`

**[PROPOSED] AD-11 (cross-midnight windows are supported).** A window whose `endTime < startTime` is a **valid** configuration and must keep working (T04). It is not malformed and must not be rejected or rewritten at load.

- **Window membership** keeps the existing `start > end` branch (`routine.ts:45–62`; Kotlin `RhythmEnforcementService.kt:1718–1719`): the evening part belongs to the start day, the morning part to the following civil day.
- **Boundary ownership** is defined solely by the end clock time: the boundary instant is `endTime` on each civil day, and the Attention Day it opens is named for **that** civil day. No ambiguity arises, because the boundary is a clock time, not a window-membership test.
- **Morning eligibility** for a cross-midnight buffer follows the civil day on which the boundary falls (the morning the user wakes into). This is recorded as remaining ambiguity R1 in §14 so it is stated rather than assumed silently; it does not require a fourth owner decision unless the owner objects.

Example, accepted: Morning Buffer `23:00 → 07:00`, active Mon–Fri. Monday's buffer runs Mon 23:00 → Tue 07:00. The boundary at Tue 07:00 opens `ad-<Tue>-0700`; Monday's restrictions were governed by `ad-<Mon>-0700`. Nothing is rejected.

### 3.4 Resolver postconditions (testable)

For any `(now, schedule)` and any zone:

1. `startedAt <= now < nextBoundaryAt`.
2. `nextBoundaryAt - startedAt` is between 22 and 26 hours (inclusive) — never 72.
3. `id === attentionDayIdForBoundary(startedAt)`.
4. `resolveAttentionDay(t, schedule).id === resolveAttentionDay(t + 1ms, schedule).id` unless a boundary lies in `(t, t+1ms]`.
5. TS and Kotlin produce the **same id and the same `nextBoundaryAt`** for the same `(now, schedule, zone)`.
6. For Mon–Fri schedules, Saturday and Sunday each have their own id, and `id(Sat) < id(Sun) < id(Mon)`.

Postcondition 2 fails today for the weekend schedule and was **dynamically reproduced** (31 Oct 2026, `Africa/Johannesburg`: 72 h). Postcondition 1 fails today on the DST case and was **dynamically reproduced** (`containsNow = false`). Postcondition 5 fails today across DST (static prediction). Postcondition 6 fails today for Mon–Fri schedules. Currency: only the two named JS cases are `DYNAMICALLY_REPRODUCED`; the rest remain static until the native suite runs.

---

## 4. Schedule changes, rollover and reconciliation

### 4.1 Current behaviour (evidence)

- `RhythmEngine.updateConfiguration` (`:162–183`): if `routineWindows` changed, it keeps the **current Attention Day id** but overwrites `attentionDayNextBoundaryAt` with the **new schedule's** next boundary (`:178–182`). The persisted day can therefore end earlier than the schedule it was created under.
- `events.ts:79–89` trusts the persisted day while `nextBoundaryAt > now`; once it passes, `resolveAttentionDay` wins and `evaluateRestorativeGate` treats every non-legacy gate with a different `attentionDayId` as stale and **drops it** (`restorativeGate.ts:343–348`).
- Kotlin's `loadAttentionDayState` (`RhythmEnforcementService.kt:915–922`) mirrors this: a projected `attentionDay` wins while `nextBoundaryAt > now`.
- No before/after snapshot or audit event exists for a schedule change anywhere in the inspected code (FR-16 violation). `[CODE-PROVEN]`

**Reachable failure:** disable the Morning Buffer mid-evening while a CD4 gate is open and its cooldown has elapsed. The new schedule's boundary is local midnight, so the persisted day ends at midnight, the id changes, and the gate is dropped as stale → access opens with the obligation unresolved. `[CODE-PROVEN]` This is the FR-03 "changing schedule during an obligation silently unlocks an app" failure.

**Second failure (identity drift):** a schedule edit that changes the boundary clock does not change the *id formula*, but changes what the id resolves to on the next day. Gates created under the old clock remain under the old id; new gates use the new one. Without an audit, a disputed transition cannot be reconstructed.

Both failures are the subject of **PD-2**. The recommended rules are SC-1 (freeze and clamp), SC-2 (immutable gate identity) and SC-4 (audit), below.

### 4.2 Proposed rules

**[PROPOSED] SC-1 (freeze the open day — PD-2).** A schedule change must not shorten or move the currently open Attention Day. On save:

```
attentionDayId            := unchanged (persisted id wins while open)
attentionDayNextBoundaryAt := max(persistedNextBoundaryAt, newScheduleNextBoundaryAt)
```

The new schedule takes effect at the next boundary. Consequence: disabling the morning window tonight cannot reset the day before its old boundary; it takes effect tomorrow.

**[PROPOSED] SC-2 (identity is immutable).** A gate's `gateId`, `attentionDayId`, `dailyCooldownOrdinal`, `createdAt`, `cooldownEndsAt` and `providerSessionId` never change as a result of a schedule edit. Only configuration-derived fields (windows, protected groups, allowance minutes) may change.

**[PROPOSED] SC-3 (no silent drop).** A gate may only leave the store by (a) being satisfied or (b) its risk group being deleted by the user (`events.ts:777–801`). There is no approved expiry rule: a boundary, clock change or schedule edit is never a reason to drop a gate.

**[PROPOSED] SC-4 (audit).** Every schedule change, rollover, rehydration, restart and clock/zone change that alters the open Attention Day or a gate must append one history event:

```
{
  type: 'attention-transition',
  cause: 'schedule-edit' | 'boundary' | 'restart' | 'clock-change' | 'zone-change' | 'migration',
  before: { attentionDayId, nextBoundaryAt, gateIds, cooldownsTriggered, meditationSubstitutionsUsed },
  after:  { ...same shape... },
  timestamp
}
```

No session contents, no personal data. This is required by FR-16 and is the only way to litigate a disputed transition.

**[PROPOSED] SC-5 (restart/rehydration).** On cold start the engine must reconcile in this order: load persisted → normalise → resolve Attention Day per §3 → apply SC-1 → restore gates → re-derive evidence requirements (CD4+/morning from *bound provider ids*; CD3 from the **accepted calendar date keys**, re-queried if the cached entry does not cover them — see SC-8) → compute restrictions → persist → sync native. `[CURRENT]` `RhythmEngine` constructor (`:37–116`) restores gates and counters but never re-derives evidence; `morningMeditation` is dropped (§8.4). `[CODE-PROVEN]`

**[PROPOSED] SC-6 (clock/zone change).** A manual clock or zone change may reassign the current `attentionDayId` (it is a function of local time). When it does:
- do not clear satisfied gates;
- keep `cooldownsTriggered` and `meditationSubstitutionsUsed` in an **additive per-Attention-Day ledger map keyed by the day id**. A new id starts a new entry; it never resets, mutates or clears an existing entry. A carried gate keeps its owning-day entry and cap consumption, and a late completion is charged once to that original day (POL-05, PD-2);
- do not award credit for time that "passed" during the change;
- append SC-4.
`[HYPOTHESIS]` that any current path awards phantom credit; not reproduced here. This closes FINDING-03.

### 4.3 Cross-midnight: two separate axes

Local midnight is a *calendar* key change. This contract separates two things the first draft conflated.

**[PROPOSED] SC-7 (obligation lifetime — never reset at midnight).** Midnight may roll `DailyAppUsage`/`GroupAllowanceUsage` date keys, but it must never:
- change the `attentionDayId`;
- reset `cooldownsTriggered` or `meditationSubstitutionsUsed`;
- drop an `activeRestorativeGate`;
- drop an `activeReadingGate` whose obligation is still open;
- reset a risk group's allowance cycle while an unsatisfied CD3/CD4 obligation exists.

**[PROPOSED] SC-8 (evidence date scope — unchanged, FR-08 / POL-03).** CD3 qualification remains **Reader Daily Evidence V2 on the calendar day**, with the existing accepted-day semantics: a CD3 gate may be qualified by trusted evidence for the current local date key **or** the gate's creation date key (`restorativeGate.ts:297–304`, `:365–370`). This programme does not re-scope CD3 evidence to the Attention Day, does not accept V1 session evidence for CD3, and does not accept "Reader was open" time. Kotlin must mirror the **same** accepted-key rule rather than requiring `gate.attentionDateKey == today` (`NativeAttentionExchange.kt:530`, `:539`).

Consequence of SC-7 + SC-8 together: a CD3 gate opened at 23:50 and expiring at 01:20 stays open, stays charged to the same Attention Day and ordinal, and can be qualified by the **creation-date** aggregate (or the current-date aggregate once one exists). It is not silently completed and the allowance cycle is not reset. That is the correct reading of "existing accepted-day semantics" across midnight.

**Current violations (all CODE-PROVEN):**

| Location | Violation | Axis |
| --- | --- | --- |
| `events.ts:100–104` | `activeReadingGates` filtered by calendar `attentionDateKey`, so the open gate disappears at 00:00 | SC-7 |
| `events.ts:109–111` | cached daily evidence dropped when its `dateKey` differs, so the accepted creation-date aggregate is no longer available to qualify the gate | SC-7 (cache), SC-8 (must re-query accepted keys) |
| `RhythmEnforcementService.kt:975–984` | reading gates filtered to `attentionDateKey == today` | SC-7 |
| `NativeAttentionExchange.kt:569–571` | expiry of a cooldown created "yesterday" → `COMPLETE_RESTRICTED_CYCLE`, dropping the gate **and** resetting the cycle | SC-7 |
| `NativeAttentionExchange.kt:530`, `:539` | gate evaluation requires `attentionDateKey == today`, which is narrower than the existing accepted-day semantics | SC-8 |
| `RhythmEnforcementService.kt:617–618` | native snapshot exports only today's reading gates | SC-7 |

Reachable failure (unchanged): CD3 allocated 23:50, cooldown ends 01:20 → at 00:00 the gate stops being current, at 01:20 the cycle completes and the allowance resets. The 60 min / 36-page baseline is never charged. `[CODE-PROVEN]` The remedy is to preserve the gate and its accepted-date evidence, **not** to widen evidence scope.

---

## 5. Restorative gate lifecycle

### 5.1 States

```
none ──(ordinal 1–2)──────────────────────────────> separation only

pending-selection ──(select)──> in-progress ──(verified evidence)──> satisfied
        │                            │
        │                            └──(progress>0)──> provider locked (id frozen)
        └──(no selection, cooldown elapsed)──> still pending-selection, holds group
```

`[CURRENT]` The state machine exists (`restorativeGate.ts:44–74`, `:314–512`) and is correct. It is not enforced (§7). `[CODE-PROVEN]`

`[PROPOSED]` Provider bindings are tracked per gate: one persistent id per provider, each **ACTIVE** or **INACTIVE** (PD-3). A gate may hold an inactive binding alongside the active one; "no provider selected" (`pending-selection`) is distinct from "a provider was selected and is now inactive".

### 5.2 One gate per cooldown instance

**[PROPOSED] GL-1.** Exactly one gate exists per `(attentionDayId, groupId, ordinal)`, with the deterministic id. Repeated allocation of the same cooldown is idempotent: the existing gate is reused, and a `satisfied` gate is never downgraded. `[CURRENT]` Implemented on both sides (`events.ts:576–594`; `RestorativeEnforcement.kt:311–334`); preserve it.

**[PROPOSED] GL-2 (gate store keyed by gate identity).** The authoritative store is keyed by **`gateId`**, one entry per `(attentionDayId, groupId, ordinal)`. A derived index may map `groupId → current-day gate` for UI convenience, but that index must never overwrite, evict or alias a carried gate: when a new day allocates ordinal 1 for a group that still carries an unsatisfied gate, both entries coexist and the predicate evaluates both. Any legacy `Map<groupId, gate>` state is migrated additively to the gate-keyed store (engineering, with review); no carried obligation may be lost in the migration. This also makes per-gate completions and the real substitution ledger representable (§12.2, R6). This closes FINDING-04.

**[PROPOSED] GL-3.** A gate with `requirementKind === 'none'` must never be created. `[CURRENT]` correct (`restorativeGate.ts:153–154`; Kotlin `NativeAttentionExchange.kt:477`).

### 5.3 Cross-boundary expiry

**[APPROVED — PD-2, 29 October 2026] GL-4 (carry until satisfied).** An unsatisfied gate remains enforceable across any number of boundaries until it is satisfied or the user deletes the risk group (existing explicit deletion behaviour). No new silent expiry, grace deadline or abandonment shortcut exists. It keeps its original `attentionDayId`, and its owning-day ledger entry (ordinal and substitution cap) is retained per SC-6; late completion is charged once to that day. It is evaluated against that day's identity, not the new day's.

Rationale: FR-12 says "never unlock solely due to a provider query error"; the same logic applies to a clock event. Dropping at a boundary converts a policy day change into an unlock. The discard alternatives (grace deadline, drop at boundary, drop-if-no-progress) are not approved and must not be implemented. This closes FINDING-05.

**[PROPOSED] GL-5.** `RestorativeGatePhase` must add an explicit `carried-over` phase so the UI cannot claim "today's requirement" for a previous day's gate (FR-15).

**[PROPOSED] GL-6.** Satisfaction is permanent for the gate instance. A later sync, restart or boundary must never clear it (POL-09), and a boundary may never drop an **unsatisfied** gate (GL-4). `[CURRENT]` correct for same day (`restorativeGate.ts:349–355`, `RestorativeEnforcement.kt:326–331`); the day-change drop at `restorativeGate.ts:343–348` is a defect to remove.

### 5.4 Evidence never shortens the timer

**[PROPOSED] GL-7.** `canReenter = cooldownElapsed && gateSatisfiedOrAbsent`. No evidence path may write `cooldownEndsAt`, and no cooldown path may mark a gate satisfied. `[CURRENT]` correct in the pure layer (`restorativeGate.ts:23–31`, `:349–355`), violated in practice only because the predicate is not consulted.

### 5.5 Reason union and double-charging

**[PROPOSED] GL-8.** The enforcement reason set is a union: `routine`, `routine-overnight`, `daily-allowance`, `cooldown`, `reading-quota`, `restorative-gate`, `morning-meditation`. The `reading-quota` (legacy Reader V2 hold) and `restorative-gate` for the **same** CD3 obligation must not be enforced as two independent obligations.

Recommended unification: for `baseline-reading`, the restorative gate is the sole authority and `reading-quota` is retired for new allocations. Evidence qualification is unchanged: CD3 still uses the accepted calendar date keys (SC-8). `[CURRENT]` both reasons exist (`restrictions.ts:122–148`; Kotlin `gatePresent` + `hasRestorativeHold`), and the Kotlin baseline hold additionally requires a current reading gate (`RhythmEnforcementService.kt:1669–1672`), which double-conditions the same obligation.

---

## 6. Provider binding and idempotency

**[PROPOSED] PV-1 (one id per gate+provider — mandated by FR-11, not an owner decision).** The session id is minted once per `(gateId, provider)` and persisted **before** launch. Re-selecting the same provider returns the existing id and does not mint a new one.

`[CURRENT]` violated: `usePrototypeStore.ts:1388` mints a new UUID on every selection; `events.ts:433–438` unconditionally overwrites `providerSessionId`. `[CODE-PROVEN]`

**[PROPOSED] PV-2 (in-flight guard).** Selection + launch is a single serialised operation keyed by `(gateId, provider, sessionId)`. While it is in flight the UI must disable both provider actions. A second invocation with the same key returns the same result; with a different key it is rejected as concurrent.

`[CURRENT]` no guard; both buttons remain enabled (`RestorativeChoiceCard.tsx:108–121`, `:133–146`). `[CODE-PROVEN]`

**[APPROVED — PD-3] PV-3 (switch before meaningful progress).** The controlling invariant is FR-11: one stable id per (gate, provider), progress from different providers never combines, and a session satisfies at most one gate. Approved rules for the binding being left:

- exactly one persistent id per `(gateId, provider)`, minted on first selection and persisted; switching **back** reactivates the original id and never mints a second one;
- a binding is **ACTIVE** (current selection) or **INACTIVE** (previously selected); INACTIVE is not abandoned or terminal;
- before any switch, reconcile the ACTIVE binding; switch only if verified meaningful progress is absent; if reconciliation is unavailable, unknown or errored, treat progress as **not proven zero** and refuse the switch;
- only the ACTIVE binding's exact bound evidence may satisfy the gate; never combine;
- a completion from an INACTIVE binding cannot satisfy while inactive, is retained for reconciliation, and is never assigned to another gate;
- the UI must state that only the selected path can count, and that switching back resumes the same session.

These rules are approved policy; FR-11 remains authoritative if a conflict is ever found.

**[PROPOSED] PV-4 (lock after progress).** "Meaningful progress" = `activeSeconds > 0` OR `qualifiedPages > 0` (Reader) OR `completedQualifiedSeconds > 0` (Meditation) for the **ACTIVE** binding's exact session. Once verified, provider **and** session id are frozen for the life of the gate and no switch is offered. `[CURRENT]` the lock exists (`restorativeGate.ts:437–450`, `:494–505`, `:253–256`) but is applied to whichever id currently occupies the gate, so the binding state must be added; preserve the lock semantics.

**[PROPOSED] PV-5 (evidence identity and activation).** Satisfaction requires `evidence.sessionId` to equal the ACTIVE binding's id, protocol version match, status `COMPLETE` (Reader) / `COMPLETED` (Meditation), and both thresholds. No aggregate evidence can satisfy a `restorative-choice` gate, and evidence from an INACTIVE binding is not evaluated until reactivated. `[CURRENT]` the id/threshold rule is correct (`restorativeGate.ts:464–505`); activation is not represented yet.

**[PROPOSED] PV-6 (refresh triggers).** For an open gate with a selected provider, Routine must query the bound status on: app cold start; app resume; return from the provider intent; gate screen focus; and a bounded interval (suggest 60 s while foreground, none while backgrounded). Results are committed through `SYNC_READER_SESSION_EVIDENCE` / `SYNC_MEDITATION_EVIDENCE`, never read inside a component.

`[CURRENT]` no coordinator-level trigger exists; only the store action `refreshMeditationEvidence` (`usePrototypeStore.ts:1433–1446`) and no Reader equivalent at all. `[CODE-PROVEN]`

**[PROPOSED] PV-7 (failure taxonomy on refresh).** A failed query must leave the gate open and set a typed reason (§9), never `satisfied`, never `undefined` silently.

**[PROPOSED] PV-8 (one session, one gate).** A provider session id may satisfy at most one gate. Re-binding a completed session to a new gate must be refused. Evidence retained from an INACTIVE binding stays attached to its own gate and is never reassigned. `[CURRENT]` enforced by id equality; no explicit "already consumed" registry exists, so uniqueness relies on ids never repeating. Acceptable while ids are UUIDs; document it.

---

## 7. The single enforcement predicate

### 7.1 Proposed predicate

**[PROPOSED] EN-1.** One predicate, one implementation per layer, identical semantics. The Essential/companion exemption is the **first statement**, not a prose caveat:

```
isExempt(app) = app.classification == 'essential'
             || app.id in OFFICIAL_COMPANION_PACKAGES     // Meditation + Routine

restricted(app, now):
  if (isExempt(app)) return false                         // POL-08 invariant, unconditional

  morningHold   = morningRequiredForCurrentDay(now) && !morningSatisfied
  morningApplies = morningHold &&
                   (app.classification == 'risk' || app.managed)

  groupHold     = cooldownActive(group)
               || readingGateOpen(group)      // obligation open; evidence calendar-scoped (SC-8)
               || restorativeGateOpen(group)  // any open gate, carried or current (GL-4)
               || groupAllowanceExhausted(group)

  windowHold    = anyActiveWindowProtecting(group)
  overnightHold = overnightProtectionActive && app.classification == 'risk'

  rawHold       = windowHold || overnightHold || groupHold || morningApplies

  leaseSuppresses = activeLease(group) && !morningApplies

  return rawHold && !leaseSuppresses
```

`[PROPOSED]` The exemption list is a closed allowlist: Essential apps and exactly the two official companions (`com.terinit.rhythmicmeditation`, `com.terinit.rhythmicroutine`). It is never derived from a user classification, and it is evaluated before any reason is computed, in both TS and Kotlin. This closes FINDING-02.

**[PROPOSED] EN-2 (lease matrix).** The morning row is mandated by POL-06/T24. The restorative row preserves existing approved behaviour and requires no new policy decision: the gate itself is never cleared by a lease, it merely stops blocking until the lease expires.

| Blocking reason | Emergency lease suppresses? | Rationale |
| --- | --- | --- |
| routine window | yes | deliberate temporary access |
| overnight protection | yes | same |
| cooldown timer | yes | same; timer keeps running |
| reading gate (CD3) | yes | gate persists; no credit awarded |
| restorative gate (CD4+) | yes, for the lease window only | gate persists, is not cleared, and re-holds on expiry (POL-09/FR-12) |
| morning meditation focus | **no** | POL-06/T24: "a normal access lease does not circumvent the morning requirement" |
| essential classification | n/a | never restricted |

`[CURRENT]` JS already implements the morning exception (`restrictions.ts:193–210`); Kotlin does not implement morning at all (§8.3), so if morning were wired through `NativeAttentionExchange.kt:633–638` as-is, a lease **would** bypass it (`&& !accessLeaseActive`). This is a required alignment.

**[PROPOSED] EN-3 (parity and native ownership).** Kotlin `NativeAttentionExchangeLogic.isEffectivelyRestricted` must take explicit reason inputs (`morningHold`, `restorativeHold`) and apply `isExempt` as its first step, covered by the same truth table as JS (§7.2). Native must **not** depend on Routine JS to establish the morning hold: at every evaluation it computes `morningRequiredForCurrentDay` from persisted routine-schedule metadata plus the persisted Attention Day, treats the absence of a verified completion for `morning-<currentAttentionDayId>` as an active hold, and never inherits a prior day's satisfied state. The predicate reads persisted native policy only. Instructions to prefer a live JS projection are non-conforming. This closes FINDING-01 at the predicate level and FINDING-02 in Kotlin.

**[PROPOSED] EN-4 (evaluate on every foreground event).** The predicate is evaluated in `onAccessibilityEvent` before any usage accounting and before presenting the overlay, and re-evaluated on lease expiry, routine boundary, cooldown expiry, and policy sync. `[CURRENT]` re-evaluation points exist (`:108–138`, `:255–272`, `:338–372`, `:378–428`, `:724–740`); the predicate is incomplete, not misplaced. `[CODE-PROVEN]`

**[PROPOSED] EN-5 (restriction effects must be truthful).** When Android is the enforcement authority, `APPLY_RESTRICTIONS` must either (a) perform a native write whose result is checked, or (b) be explicitly reported as "policy evaluated, enforcement by service" and never as `applied`. `[CURRENT]` `applyShieldRestrictions` returns accessibility status (`RhythmDeviceModule.kt:418–422`) and `NativeRestrictionProvider.ts:13–34` reports `applied`. `[CODE-PROVEN]`

### 7.2 Predicate truth table (must be tested in both languages)

| routine | cooldown | readingGate | restorative | morning | lease | expected |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 1 | 0 | 0 | 0 | 0 | 0 | 1 |
| 0 | 1 | 0 | 0 | 0 | 0 | 1 |
| 0 | 0 | 0 | 1 | 0 | 0 | **1** (fails today) |
| 0 | 0 | 0 | 1 | 0 | 1 | 0 — lease window only; gate persists and re-holds |
| 0 | 0 | 0 | 0 | 1 | 0 | **1** (fails today) |
| 0 | 0 | 0 | 0 | 1 | 1 | **1** (mandated by POL-06/T24) |
| 0 | 0 | 0 | 0 | 1 | 0 | essential app ⇒ 0 |

---

## 8. Morning meditation requirement

### 8.1 Identity and creation

**[PROPOSED] MM-1 (native-deterministic creation).** Exactly one requirement per Attention Day: `sessionId = "morning-" + attentionDayId`, `requiredQualifiedSeconds = 1800`, created only on an eligible day (MM-2). Creation is a **native-owned deterministic transition**, not a JS observation: at or after the eligible boundary, `RhythmEnforcementService` computes the requirement from persisted routine-schedule metadata and the persisted Attention Day, mints `morning-<currentAttentionDayId>` if absent, persists it, and activates the hold immediately — with Routine JS never entering the foreground. Routine JS, when it does run, reconciles to the same deterministic identity and may not mint a different one. Creation is idempotent by `sessionId`; duplicate, competing or per-process instances are non-conforming. This closes FINDING-01 at creation.

**[PROPOSED] MM-2 (`morningWindowActive`).** A requirement may only exist when **all** hold:
1. a valid morning window exists;
2. `enabled !== false`;
3. the window's `activeDays` contains the Attention Day's opening weekday;
4. the requirement is enforceable for this day (migration floor, `morningMeditation.ts:129–140`).

This is the mechanical form of POL-07: the boundary advances every day (AD-1), but the **obligation** is fabricated only on eligible days. Disabling Saturday's window removes Saturday's obligation and does not touch Sunday's. The `activeDays` meaning itself is fixed by FR-02 and is not a decision.

For a cross-midnight morning window, item 3 compares against the **civil day on which the boundary falls** (the morning the user wakes into) — recommended, and recorded as remaining ambiguity R1 in §14 rather than an owner decision.

### 8.2 Satisfaction

**[PROPOSED] MM-3.** Satisfied only by the exact bound session: `sessionId` match, protocol 1, status `COMPLETED`, `completedQualifiedSeconds >= required`, and `requiredQualifiedSeconds >= required` (the provider echoed the requirement). `[CURRENT]` correct (`meditationEvidence.ts:86–106`).

**[PROPOSED] MM-4.** Morning completion never increments `meditationSubstitutionsUsed` and never creates or satisfies a cooldown gate. `[CURRENT]` correct by construction, because the substitution ledger is only touched in `events.ts:842–847` for gate evaluation — but this is currently vacuous because no morning requirement exists.

**[PROPOSED] MM-5.** On failure (cancelled, paused at 29:59, expired, wrong id, provider error) the hold remains and the UI states the remaining time. No partial credit toward a later session.

### 8.3 Enforcement

**[PROPOSED] MM-6.** While `morningHold`, restricted: managed nonessential + risk apps. Reachable: Meditation, Routine, Essential, and (if the platform exposes them) system UI. Allowed even with an active lease (EN-2).

**[PROPOSED] MM-7.** The focus is removed only by verified completion or by an explicitly approved exemption. A provider query error removes nothing.

`[CURRENT]` Kotlin has `hasMorningFocusHold` (`RestorativeEnforcement.kt:1683–1696`) but the predicate never calls it (`RhythmEnforcementService.kt:1734–1744`). `[CODE-PROVEN]`

### 8.4 Persistence gap that must be fixed with MM-1

**[PROPOSED] MM-8.** The requirement, its `satisfiedAt`, and the migration state must survive process death. The schema already exists (`types.ts:135–140`, `:162–163`, normaliser at `:436–438`), but the engine does not carry it:

- `RhythmEngine.ts:86–116` does not copy `normalized.morningMeditation`;
- `RhythmEngine.ts:200–234` `getRuntime()` omits it;
- `RhythmEngine.ts:270–309` `toPersistedRuntime()` omits it.

`[CODE-PROVEN]` Consequence: a creator-only fix would work in-process and fail on the first restart. MM-8 is a prerequisite for FR-05 and must be in the same commit as MM-1.

### 8.5 Native projection

**[PROPOSED] MM-9 (native projection is not the source).** Native persists and owns the current requirement (`attentionDayId`, `sessionId`, `requiredQualifiedSeconds`, `satisfied`, `satisfiedAt`) after MM-1. The JS `morningMeditation` projection is **reconciliation only**: native must (a) accept a projection that adds or satisfies for the same day, (b) never accept a projection that clears or downgrades a verified current-day satisfaction, and (c) never let a null/blank/prior-day projection remove the current-day hold. Native evaluates MM-6 from its own persisted state and, on each evaluation path, queries the exact bound session through the Meditation V1 status client; unavailable, unknown, corrupt, incompatible or errored results are typed and **fail closed** (§10), never satisfied and never "no obligation". It must never infer completion from launch, return, ACTIVE state or elapsed time. `[CURRENT]` the wire fields and parser exist (`NativeRhythmSyncProvider.ts:439–447`; `RestorativeEnforcement.kt:176–187`), but the projection is currently always `null` and native cannot mint. This closes the second half of FINDING-01.

---

## 9. Evidence acceptance matrix

FR-06/FR-10 also require binding-grade kind/source validation. See MEDITATION_PROTOCOL_COMPATIBILITY.md: the current seven-column V1 status omits those fields. A coordinated additive metadata projection must preserve prior clients; missing identity metadata cannot satisfy a gate. This is in scope for A2/B1/B2, without changing policy numbers or Reader V2 calendar evidence.

| Requirement kind | Authority | Scope | Exact rule | Current status |
| --- | --- | --- | --- | --- |
| CD1–CD2 | none | — | separation only, 90 min | implemented |
| CD3 `baseline-reading` | Reader Daily Evidence **V2** | **calendar day keys `[current local date, gate creation date]` (FR-08/POL-03 — unchanged by this programme)** | `verifiedActiveSeconds >= 3600 && qualifiedPages >= 36` | rule correct (`restorativeGate.ts:357–404`); gate is destroyed at midnight (SC-7), which is a lifetime defect, not a scope defect |
| CD4+ Reader | Reader Recovery **V1** | exact bound session | `sessionId` match, protocol 1, `COMPLETE`, `>= 1800 s`, `>= 11 pages` | rule correct; **never queried** (DEF-03) |
| CD4+ Meditation | Meditation **V1** | exact bound session | `sessionId` match, protocol 1, `COMPLETED`, `>= 1800 qualified monotonic s`, provider-echoed requirement | rule correct; query only via screen-return store action (DEF-05) |
| Morning | Meditation **V1** `MORNING_REQUIRED` | exact `morning-<dayId>` | same as CD4+ Meditation | rule correct; never created (DEF-02) |
| Migrated legacy | Reader **V2** | calendar day | stored numbers (e.g. 5400/47) | implemented, intentionally preserved |

**[PROPOSED] EV-1.** No evidence may satisfy a requirement of a *different* kind. Specifically: a daily V2 aggregate must never satisfy a `restorative-choice` Reader gate; a V1 session must never satisfy `baseline-reading`; a `COOLDOWN_RESTORATIVE` session must never satisfy the morning; a `MORNING_REQUIRED` session must never consume a substitution.

**[PROPOSED] EV-2.** Provider errors, missing rows, corrupt rows, protocol mismatch and permission denial all resolve to "not satisfied" plus a typed reason. None may resolve to "satisfied" or to "no obligation".

**[PROPOSED] EV-3.** The evidence cache is a projection, never authority: it must be re-queried on the PV-6 triggers, and a stale cache must not clear a satisfied gate (POL-09).

---

## 10. Observability vocabulary

**[PROPOSED] OB-1.** Every provider interaction must resolve to exactly one of these states, surfaced distinctly in diagnostics and in UI copy:

| Code | Meaning | Satisfies? |
| --- | --- | --- |
| `not-installed` | package absent | no |
| `untrusted-signature` | installed, signer mismatch | no |
| `permission-denied` | signature-level read denied | no |
| `protocol-incompatible` | provider present, schema/version mismatch | no |
| `neutral-empty` | provider healthy, **no active gate / not the current day** | no (and not an error) |
| `unknown-session` | provider healthy, no row for this bound id | no |
| `provider-error` | query threw / cursor null / corrupt row | no |
| `in-progress` | valid row, thresholds not met | no |
| `complete` | valid row, thresholds met | yes |

**[PROPOSED] OB-2.** `neutral-empty` and `unknown-session` must never be reported as "Routine disconnected" or "Reader unavailable" (FR-14, #13).

**[PROPOSED] OB-3.** The enforcement readiness surface must report the **last native sync result** (stage + error + timestamp), not a startup-time constant. `[CURRENT]` `RhythmCoordinator.getStatus()` returns a value captured in `initialize` (`:201–207`, `:879–884`) and `syncNativeState` swallows failures (`:283–293`). `[CODE-PROVEN]`

**[PROPOSED] OB-4.** Native writes must return a persistence result; `setRiskGroupPolicies` and `setRoutineSchedule` currently return `true` unconditionally (`RhythmDeviceModule.kt:171–194`, `:241–247`) while the underlying stores use `.apply()`. `[CODE-PROVEN]` These must be `commit()` + returned, so `requireNativeSave` is meaningful.

**[PROPOSED] OB-5.** Diagnostics may contain: authority, URI shape (not contents), requested day id, current day id, row count, column names, resolved provider state code, gate id, ordinal, requirement kind, counts. Must not contain: session content, meditation history, reading content, app inventory beyond a bounded risk sample, device serials.

---

## 11. TS ↔ Kotlin parity checklist

Both implementations must agree on all of the following, and a parity test must assert it for each case:

| # | Case | Must agree on |
| --- | --- | --- |
| P1 | Weekday schedule, Saturday noon | id, `startedAt`, `nextBoundaryAt` |
| P2 | Weekday schedule, Monday 07:29 / 07:30 | id before/after |
| P3 | `activeDays: []` | boundary still advances; restrictions never fire |
| P4 | `enabled: false` window | boundary advances; restrictions never fire |
| P5 | 23:59 → 00:01 | same id, same counters |
| P6 | Spring-forward day, boundary 07:30 | same resolved instant |
| P7 | Fall-back day, boundary 07:30 | same resolved instant |
| P8 | DST transition at 00:30 next day | same id (currently differs) |
| P9 | Fallback (no valid window) | same `nextBoundaryAt` (currently differs by 1 h on DST days) |
| P10 | Gate id for the same `(day, group, ordinal)` | identical string |
| P11 | Enforcement predicate truth table (§7.2) | identical booleans |
| P12 | Native snapshot round-trip | `attentionDay`, `activeRestorativeGates`, `morningMeditation`, `officialCompanionPackages` all present |

P6–P9 and P12 currently fail; P1–P2 pass with the 72-hour caveat; P11 fails because Kotlin lacks the two holds. `[CODE-PROVEN]`

---

## 12. Owner policy decisions — APPROVED 29 October 2026

All three policies were explicitly approved by the owner on 29 October 2026. The authoritative approved summary is `docs/sw-2026-005/OWNER_POLICY_REVIEW.md`. They are recorded here as frozen policy, not as options. Engineering review of implementation detail remains pending and is handled in §12.2.

| ID | Decision | Approved policy |
| --- | --- | --- |
| **PD-1** | **Daily boundary on inactive or disabled days, and the no-boundary fallback** | Configured morning-end clock every civil day, including inactive/disabled windows; no valid clock ⇒ local midnight; inactive windows create no morning/evening restriction and no morning obligation; risk-group rules remain independent; calendar arithmetic handles DST |
| **PD-2** | **Cross-boundary gate expiry, pending schedule edits, and cap/ledger semantics** | Carry an unfinished gate until verified completion, retaining identity, timer, evidence rules and owning-day ledger; schedule edits cannot end the day early or clear a gate; pin the day and use the later of persisted and proposed boundaries for the one-time transition; new days get their own counters; late completion charged once to the original day; Reader V2 calendar evidence preserved; carried obligations shown explicitly; no new silent expiry/abandonment |
| **PD-3** | **Provider switch before meaningful progress** | One stable session id per gate/provider including switch-back; unselected bindings INACTIVE, not destroyed; only the selected provider can satisfy; evidence never combines; reconcile before switching and treat unknown as not proven zero; lock on verified progress; retry/double-tap reuses the same binding |

**PD-1, PD-2 and PD-3 are approved and authorise bounded implementation and tests only.** Device installation, protected merges, tags and publication remain later owner gates. Engineering review of the implementation is still required (§12.2); that is not a policy reopening. This closes FINDING-05.

### 12.1 Not owner decisions — already fixed by the PRD

| Requirement | Source | Note |
| --- | --- | --- |
| `activeDays: []` means no active routine days | FR-02 | The boundary's independence from `activeDays` follows from PD-1; the `[]` meaning itself is not open |
| A lease never bypasses morning focus | POL-06, T24 | Mandated; Kotlin must be aligned to JS |
| Repeat selection reuses one stable provider id | FR-11 | Mandated; current re-mint is a defect |
| Exactly one valid Reader **or** Meditation completion satisfies a gate; no combination | POL-04, FR-11 | Already correct in the reducer |
| The substitution ledger must be real, not derived from satisfied gates | POL-05, FR-14 | Engineering implements the additive ledger |
| UI must match enforcement truth | POL-10, FR-15 | Engineering implements |
| CD3 uses Reader V2 calendar evidence with existing accepted-day semantics | FR-08, POL-03 | **Explicitly preserved**; the earlier Attention-Day-scope proposal is withdrawn |
| Cross-midnight routine windows are valid and supported | T04 | Only non-`HH:MM` values are malformed |
| 90-minute cooldown; 3600/36; 1800/11; meditation cap 2; 1800 morning | POL-02–POL-05 | Frozen policy numbers |

### 12.2 Engineering-resolvable with review — required in this programme

These are **not** deferred and **not** owner policy. The engineer decides the mechanism, documents it, and submits it for review:

- **Storage shape and additive migration**, including a gate-keyed store, a per-Attention-Day ledger map (ordinal + substitution cap + owning day), a per-gate history record, per-(gate, provider) binding id and ACTIVE/INACTIVE state, so per-gate completions and the FR-16 transition audit are representable. A `Map<gateId, …>` migration is permitted if additive and reversible.
- **The FR-16 audit ledger** (before/after snapshot per schedule change, boundary, restart, clock/zone change). This is a requirement, not an optional extra.
- **DST gap/overlap resolution** (recommended: gap → first valid instant, overlap → earlier offset) and civil-day stepping.
- **Native snapshot symmetry** (`attentionDay`, `activeRestorativeGates`, `morningMeditation`, companion allowlist).
- **Persistence acknowledgements** (`commit()` + returned result for every native policy write).
- **Reader status verification** before trusting a recovery row.
- **Refresh orchestration** on cold start, resume, provider return and bounded interval.
- **UI truth for carried gates** (which day, which remaining evidence, which provider).

---

## 13. Test obligations derived from this contract

| Contract clause | Test | PRD row |
| --- | --- | --- |
| AD-1, AD-9 (PD-1) | weekend schedule: separate id Sat and Sun; no Fri→Mon span | T01 |
| AD-9, AD-2 | Sat/Sun windows inactive: no window restriction; allowance + cooldown still function | T02 |
| AD-5–AD-8 | Sunday→Monday, Fri→Sat, 23:59→00:01 | T03 |
| AD-4, AD-9, AD-10 | empty `activeDays`, malformed time, disabled window, cross-midnight | T04 |
| AD-5–AD-8 | 23 h / 25 h day, zone change, manual clock change | T05 |
| SC-1–SC-4 | mid-gate schedule edit + in-place upgrade preserves gate/ordinal/cap/end | T06 |
| SC-7, SC-8, R0-N1 | CD3 gate survives midnight, keeps its calendar accepted-day evidence, and is charged to the right Attention Day | T03, T12 |
| MM-1, MM-8, MM-9 | eligible boundary mints exactly one id **without Routine JS foreground**; restart/reboot recreates the same id | T07, T09 |
| MM-3, MM-5 | 29:59 cancelled/paused/expired/wrong-session keeps hold; 30:00 releases | T08 |
| MM-8, SC-5 | force-stop, screen off, resume, process death, reboot | T09 |
| MM-4 | morning release consumes no substitution | T10 |
| GL-1 | CD1/CD2 separation only | T11 |
| EV-1, table §9 | CD3 3600 s + 36 pages; one short dimension fails | T12 |
| EV-1, PV-5 | CD4 Reader exact bound session; V2 aggregate alone fails | T13 |
| EV-1, PV-5 | CD4 Meditation exact bound session; wrong id/protocol/partial fails | T14 |
| PV-1, PV-2 | re-tap / return / relaunch reuses one binding | T15 |
| PV-3, PV-4 | switch before progress allowed; switch-back reactivates the same id; late inactive evidence not counted; after progress locked | T16 |
| GL-7 | activity before timer expiry; cooldown before activity | T17 |
| OB-1, OB-2 | missing provider, bad signature, denied IPC, unknown session, malformed | T18 |
| OB-1, OB-2 | same-signed neutral projection reads as connected; #13 closed | T19 |
| EN-5, OB-3, OB-4 | native module missing / simulated success never reports ENFORCED | T20 |
| GL-1, GL-4, SC-5 | multi-group, import, restart: no loss, no cross-group leakage | T21 |
| AD-5–AD-8, OB-4 | Android 16/API 36, in-place upgrade, versionCode monotonic | T22 |
| all | existing JS + native suites stay green | T23 |
| EN-2, MM-6 | adversarial essential exercise, lease, spoof attempt | T24 |
| OB-1–OB-4, FR-15 | screenshot review: displayed state equals logged native truth | T25 |

---

## 14. Remaining ambiguity, stated precisely

These are not owner decisions and not silently assumed: each is either an engineering choice to be documented in review, or a fact to be verified.

1. **R1 — cross-midnight morning eligibility day.** For a buffer such as `23:00 → 07:00`, does the morning obligation attach to the civil day on which the boundary falls (recommended: yes, "the morning you wake into") or to the weekday on which the window opened? This only differs for windows that end after midnight. If the owner disagrees with the recommended reading it becomes a fourth policy item; otherwise A1 documents it and tests both sides.
2. **R2 — carried gate and the new day's ordinal.** Approved PD-2 settles that a carried gate keeps its own day's ledger and that the new Attention Day starts at ordinal 1. If an implementation choice appears to contradict that, PD-2 wins; T21 must assert it.
3. **R3 — carried-gate presentation.** FR-15/PD-2 require truthful display; the exact copy and ordering (carried obligation before today's) is a UI engineering decision with review, not policy.
4. **R4 — Reader status trust.** Whether Routine verifies Reader's signer before trusting a recovery row. Recommended: yes, identical to Meditation. This is a POL-08/FR-14 security requirement, not a product choice.
5. **R5 — reset reachability.** Whether the in-process "reset local state" action is user-reachable in a stable build. If it is, R0-N3 is a P1 blocker; verification is a C2/C3 task.
6. **R6 — per-gate history exposure.** The real substitution ledger and per-gate completions must be published additively (POL-05/FR-14). Whether Insights *displays* per-gate detail is UI scope, not a policy change.
7. **R7 — physical truth.** Every clause marked `[HYPOTHESIS]`, and every `DYNAMICALLY_REPRODUCED` JS result, is still not device-proven. No promotion without C3 evidence.
8. **R8 — companion versions.** No Reader or Meditation change is authorised or required by this contract as written. If Wave A2/A3 proves a provider-side defect, the version question returns at C4.

---

## 15. What this document does not authorise

- It does not itself implement any behaviour change. It *records* the approved PD-1 behaviour, which necessarily replaces the Friday→Monday assertion in `pass03_attention_day.test.ts:227–235`; that test change is in scope and must be reviewed with the implementation.
- It does not authorise implementation without engineering review. The approved policies permit bounded implementation and tests under §16; they do not authorise device work, protected merges, tags or release.
- It does not authorise changing policy numbers (90 min, 3600/36, 1800/11, cap 2, 1800 morning).
- It does not authorise a **destructive** schema migration or any migration without review; additive, reversible migration is explicitly within engineering scope (§12.2).
- It does not authorise a version bump, a merge, a tag, or a release.
- It does not close DEF-01..07. It defines what "closed" would have to mean.

**PD-1, PD-2 and PD-3 are approved (29 October 2026).** Engineering may proceed on the resolver, the enforcement predicate, the gate store and the provider-binding store under those policies, resolving storage shape, additive migration, the FR-16 audit ledger and the remaining engineering items in §12.2 **with review**. This document still does not authorise device work, protected merges, tags or release.

---

## 16. File ownership, compatibility freeze and implementation handoff

### 16.1 Ownership (one writer per file; shared Routine core is serial)

| Lane | Owns | Must not touch |
| --- | --- | --- |
| A1 schedule | `src/domain/rhythm/attentionDay.ts`, boundary parts of `routine.ts`, matching tests; `NativeAttentionExchange.kt` day resolver + Kotlin tests | `events.ts`, `RhythmCoordinator.ts`, `usePrototypeStore.ts`, `RhythmEnforcementService.kt` |
| B1 morning integrator (Routine core) | `events.ts`, `RhythmEngine.ts`, `RhythmCoordinator.ts`, `NativeRhythmSyncProvider.ts`, `usePrototypeStore.ts`; `RhythmEnforcementService.kt` predicate, `RestorativeEnforcement.kt` | Reader/Meditation repos; A1 resolver internals |
| B2 restorative/evidence (after B1) | `restorativeGate.ts`, `recovery.ts`, `meditationEvidence.ts`, `AttentionInsightProvider.kt`, `RhythmDeviceModule.kt`, gate-store migration | Files B1 still holds; no forked `events.ts` |
| A2/A3 companions | Meditation/Reader repos only where a provider-side defect is proven; Routine integration via patches to B1/B2 | Routine shared core without a patch |
| A4 signer QA | test scripts/config/docs only | production source |

### 16.2 Compatibility freeze

- Protocol versions unchanged: Reader recovery **V1**, Reader Daily Evidence **V2**, Meditation **V1**. No silent bump.
- Formats unchanged: `ad-<yyyyMMdd>-<HHmm>`, `gate-<day>-<group>-o<ordinal>`, `morning-<day>`, package names, versionCodes (no release bump here).
- Persisted state changes are **additive and reversible** only (per-day ledger map, gate-keyed store, ACTIVE/INACTIVE bindings, FR-16 audit). No destructive migration.
- TS and Kotlin must pass the same §7.2 truth table and §11 parity cases before merge.
- No new permissions, cloud, telemetry or Essential reclassification.

### 16.3 Handoff order and definition of done

1. Boundary (A1) → 2. Morning, including native mint/persist and fail-closed exact-session query (B1) → 3. Restorative/evidence and gate-keyed store with per-day ledger (B2) → 4. Diagnostics/UI truth → 5. QA harness.

Each commit references `SW-2026-005` and the DEF/FR/T ids; includes its tests and parity case; records command, exit code and counts; and is reviewed before the next lane starts on a shared file. Baseline suites are green (Routine JS 423, Routine native 80, Reader 106, Meditation 177; zero failures), so any red is a regression. **No implementation has started under this contract**; engineering review of the first patch remains pending, and device/signing acceptance is still outstanding.
