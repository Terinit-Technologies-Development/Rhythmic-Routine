# SW-2026-005 — Owner Policy Decisions (approved)

**Repository:** `Terinit-Technologies-Development/Rhythmic-Routine`
**Baseline SHA:** `2b20a113ba23a74b328cdc519800ea790897a09e`
**Prepared:** R0 follow-up, 29 October 2026
**Status:** **APPROVED by the owner on 29 October 2026.** `docs/sw-2026-005/OWNER_POLICY_REVIEW.md` is the authoritative approved summary and governs over any inconsistent draft wording here. Implementation and engineering review remain pending.
**PD-3 precedence note:** PD-3 is approved policy; if any clause conflicts with FR-11, FR-11 wins and PD-3 is corrected.

---

## 0. Why exactly three

Everything else raised in the first R0 draft is either already fixed by the PRD or resolvable by the engineer with review. Re-asking the owner for those items would delay G0 without adding information.

**Fixed by the PRD — not decisions (engineer implements):**

- `activeDays: []` = no active routine days (FR-02).
- A lease never bypasses Morning Meditation Focus (POL-06, T24).
- Repeat selection of the same provider reuses one stable session id (FR-11).
- Exactly one valid Reader **or** Meditation completion satisfies a gate; no combination, no cross-gate reuse (POL-04, FR-11).
- The substitution ledger must be real and published, not inferred from satisfied gates (POL-05, FR-14).
- CD3 stays Reader Daily Evidence V2 on the **calendar day** with existing accepted-day semantics (FR-08, POL-03). The earlier Attention-Day-scope suggestion is withdrawn.
- Valid cross-midnight routine windows are supported (T04); only a non-`HH:MM` value is malformed.
- UI must agree with native enforcement truth (POL-10, FR-15).
- Policy numbers are frozen: 90 min, 3600 s/36 pages, 1800 s/11 pages, meditation cap 2, 1800 s morning.

**Engineering-resolvable with review — not deferred, not policy:**

gate storage shape and additive migration; the FR-16 transition audit ledger (required, not optional); DST gap/overlap resolution; native snapshot symmetry; persistence acknowledgements; Reader status verification; refresh orchestration; carried-gate UI. These must be delivered inside this programme.

**Approval status:** all three policies are approved. Any option labelled B or C anywhere in this document is a discarded alternative recorded for context only; it is not approved and must not be implemented.

**Confidence context** (details in `R0_ROUTINE_DEFECT_REGISTER.md` §1.2.1): two DEF-01 cases are now dynamically reproduced on canonical source — Saturday 31 Oct 2026 in `Africa/Johannesburg` yields a 72-hour Friday→Monday day; Monday 9 Mar 2026 00:30 in `America/New_York` yields `containsNow = false`. Repo-wide `rg` confirmed no production callers for the morning factory/request or for `queryRecoveryStatus`. None of this is physical-device proof.

---

## PD-1 — Boundary on inactive/disabled days, and the no-boundary fallback

### What is ambiguous

When a morning window is not scheduled that day (weekend inactive) or is disabled, does the Attention Day still advance at the configured boundary clock? And when no usable boundary exists at all, what is the fallback?

The PRD fixes the *goal* (FR-01: one deterministic boundary, never a Friday→Monday span; FR-04: inactive window does not disable risk-group accounting; POL-07: no fabricated obligation on an inactive day) but not the mechanism. Three mechanisms are all consistent with those words.

### Options

| Option | Behaviour |
| --- | --- |
| **A** | Boundary clock applies to every civil day; an inactive/disabled window only stops the *restriction*; no usable clock → local midnight |
| B | Boundary only on active days; on inactive days the boundary becomes local midnight |
| C | Boundary only on active days; otherwise stretch to the next active day (current behaviour) |

### Approved policy: **A** (29 October 2026)

Concretely:

1. Boundary instant = Morning Buffer `endTime` on every civil day, including inactive and disabled days.
2. Inactive/disabled affects only whether the window restricts apps, and (separately) whether a morning obligation is created that day.
3. If no valid `HH:MM` boundary exists anywhere, use local midnight as the boundary and emit a diagnostic naming the window and raw value.
4. `activeDays: []` still means "no active routine days" (FR-02); the boundary simply no longer depends on `activeDays`.

### Consequences of the approved policy

- A Friday evening stays one Attention Day through Saturday morning; Saturday gets its own id at the configured clock. The 72-hour day is impossible, so T01/T03 become testable and weekend risk-group exhaustion cannot inflate Friday's ordinal.
- A user who disables weekend mornings keeps correct cooldown/substitution accounting and loses no counters; this is the PRD's success criterion for defect A.
- Disabling a window mid-week does not reset anything at midnight; the change affects restrictions only.
- Existing test `pass03_attention_day.test.ts:227–235` must be rewritten — it currently asserts the Friday→Monday stretch. That is an approved-behaviour change and needs the owner's acceptance of PD-1, nothing more.
- Residual risk: on a day with no window at all, the boundary still fires at the configured time. The user sees no restriction, which is correct, but a "morning required" surface must not appear (MM-2 gates that separately).

### Discarded alternatives (not approved)

- **B** creates two reset rules in one week: an evening can be split across midnight, resetting ordinals and substitutions inside what the user experiences as one night. Directly conflicts with POL-05's "no midnight reset loophole" and FR-03.
- **C** is the current defect: reproduced as a 72-hour day, and it makes "exact bound session for the current day" ambiguous for two days every week.

### Engineer actions under A

Both resolvers (TS `attentionDay.ts`, Kotlin `NativeAttentionExchange.kt`) change in the same integration order; parity cases P1–P9 in the contract must pass before merge. No physical claim until T01–T05 run at C3.

---

## PD-2 — Cross-boundary gate expiry, pending schedule edits, and cap/ledger semantics

### What is ambiguous

Three linked questions that the PRD constrains but does not settle:

1. Does an unsatisfied restorative gate expire when the Attention Day closes?
2. If the user edits the schedule while a gate is open, does the open day end early, move, or freeze?
3. When a gate is carried past a boundary, does its substitution/ordinal ledger follow the gate or the new day?

FR-03 requires "document approved cross-boundary gate expiry semantics before changing them" and forbids silent invalidation or early ledger reset; FR-12 forbids unlocking on a query error; POL-09 forbids clearing legitimate completion. It does not say which expiry rule to adopt.

### Options

| Option | Gate at boundary | Schedule edit mid-gate | Ledger |
| --- | --- | --- | --- |
| **A (recommended)** | carried until satisfied | open day frozen; close boundary clamped to `max(old, new)`; new schedule from next boundary | follows the gate's own Attention Day; never resets early |
| B | carried with a grace deadline | as A, plus a visible deadline | follows the gate's day until the deadline |
| C | dropped at boundary | day recomputed immediately | resets with the new day |

### Approved policy: **A** (29 October 2026), with the ledger rule stated explicitly

1. **Gate lifetime:** an unsatisfied gate persists across any number of boundaries, keeping its `attentionDayId`, `gateId`, ordinal, requirement numbers and provider binding. It leaves only by satisfaction or the existing explicit risk-group deletion behaviour. No new silent expiry, grace deadline or abandonment shortcut exists. Emit the FR-16 audit event (`cause: schedule-edit`, before/after day id, boundary, gate ids, ordinal, substitutions).
2. **Schedule edit:** on save, keep the current `attentionDayId`; set `nextBoundaryAt = max(persisted, newScheduleBoundary)`; apply the new windows from the next boundary. Emit the FR-16 audit event (`cause: schedule-edit`, before/after day id, boundary, gate ids, ordinal, substitutions).
3. **Ledger:** `cooldownsTriggered` and `meditationSubstitutionsUsed` belong to the Attention Day that opened the gate. A gate carried into a new day does **not** consume the new day's cap; the new day starts its own ordinal at 1 while the old gate still holds. Record the owning day on the gate so this is answerable from persisted state.
4. **Midnight:** `SC-7` (obligation lifetime) is independent of `SC-8` (evidence date scope). CD3 evidence remains calendar-scoped per FR-08; the gate is simply not destroyed.

### Consequences of the approved policy

- No clock event or settings edit can produce an unlock. FR-03, FR-12 and POL-09 are simultaneously satisfiable.
- A user who completes a 90-minute cooldown late at night keeps the obligation into the next morning rather than waking up free; this is the conservative reading, and it is what "never unlock solely due to a provider query error" generalises to.
- The next day can legitimately show "one carried obligation + today's ordinal 1". FR-15 requires that be displayed truthfully, so the UI must distinguish carried from today's.
- The FR-16 audit ledger becomes mandatory, and the store needs an additive per-gate record plus `substitutionDayId` (or equivalent). This is an engineering migration with review — not a reason to defer.
- T06, T17 and T21 become pass/fail tests instead of "undefined behaviour".

### Discarded alternatives (not approved)

- **B** is defensible if the owner wants a bounded nuisance ceiling, but needs a deadline field and a policy for what happens at the deadline (abandon vs re-hold). It must not silently drop.
- **C** is today's effective behaviour and is a silent unlock: a schedule edit that disables the morning buffer makes the new boundary midnight, the day id changes, and `evaluateRestorativeGate` drops the gate as stale (`restorativeGate.ts:343–348`). Rejected on FR-03/FR-12 grounds.

### Engineer actions under A

Persist the owning day on every gate; freeze/clamp on `updateConfiguration`; change no gate identity fields; add the audit event; add Kotlin parity so a native-created gate survives the same transition. Verified at T06/T21, then C3.

---

## PD-3 — Provider switch before meaningful progress

> **Approved 29 October 2026** (see `OWNER_POLICY_REVIEW.md`). The text below records the approved policy. It does not record owner acceptance of anything beyond these three policies (device, merge, tag, release remain later gates). FR-11 remains authoritative.

### What is ambiguous

FR-11 mandates one stable session id per gate+provider, that progress never combines, and that a session satisfies at most one gate. It also says "reselect before meaningful progress must obey frozen provider-switch rules". The PRD does not say what happens to the first provider's binding if the user selects the other provider and later returns to the first.

### Options

| Option | Switch before progress | Switching back | Late evidence from the unselected binding |
| --- | --- | --- | --- |
| **A (controller proposal)** | allowed after reconciliation proves no progress | **reactivates the original id; no new id minted** | retained for reconciliation; cannot satisfy while inactive; never reassigned to another gate |
| B | refused after first selection | n/a | n/a |
| C | allowed, silently re-mints (current) | new id | silently lost |

### Approved policy: **A** (29 October 2026)

1. **Persistent identity:** exactly one session id per `(gateId, provider)`, minted on first selection of that provider and persisted before launch. Re-selecting the same provider, or switching **back** to it, reuses that id. Never mint a second id for the same pair.
2. **Binding state:** a provider binding is **ACTIVE** (currently selected) or **INACTIVE** (previously selected). INACTIVE is not "abandoned" and is not terminal. At most one binding is ACTIVE at a time.
3. **Before switching:** reconcile the ACTIVE binding. Switch only if verified meaningful progress is **absent**. If reconciliation is unavailable, unknown, errored or ambiguous, treat progress as **not proven zero** and refuse the switch (fail-closed).
4. **Switching back before progress:** reactivate the original binding and its original id. Do not mint a new one, and do not copy evidence between bindings.
5. **Satisfaction:** only the ACTIVE binding's exact bound evidence may satisfy the gate. Evidence is never combined across bindings or providers.
6. **Late evidence while inactive:** a completion produced by an INACTIVE binding cannot satisfy the gate while it is inactive. It is retained for reconciliation; on reactivation it is evaluated under the normal exact-bound rule. It is never assigned to another gate.
7. **Lock:** once verified meaningful progress exists on the ACTIVE binding (`activeSeconds > 0`, `qualifiedPages > 0`, or `completedQualifiedSeconds > 0` for that bound session), provider and session id freeze for the life of the gate and no further switching is offered.
8. **One session, one gate:** unchanged (FR-11/POL-04).
9. **UI:** switching must state that only the selected path can count, and switching back restores the same session rather than starting over.

### Consequences of the approved policy

- FR-11's "stable id per gate+provider" holds even across A→B→A; returning to the first provider does not lose its id or its completed work.
- No irrecoverable orphan: a binding is inactive, not destroyed, so evidence can be reconciled when it becomes active again.
- Fail-closed on uncertain reconciliation means a switch may be temporarily refused when a provider cannot be queried; the gate stays open and the user is told why.
- Storage needs one id and one state per (gate, provider) — additive, reversible migration, engineering with review.
- T15/T16 become deterministic: re-tap reuses; switch-back reactivates; late inactive evidence is retained but not counted; post-progress switch is refused.

### Discarded alternatives (not approved)

- **B** avoids multi-binding state but permanently traps a user who mis-taps or lacks one provider that day.
- **C** is today's behaviour and the DEF-05 data-loss path: a new id per tap means the session the user actually completes is orphaned.

### Engineer actions under A

Mint-once per (gate, provider); persist ACTIVE/INACTIVE state and the id map before launch; reconcile before any switch and refuse on unknown; reactivate on switch-back; evaluate only the ACTIVE binding; retain inactive evidence with its gate id; freeze on first verified progress; in-flight guard on both buttons. Verified at T15/T16 without a device for the state-machine rows.

---

## Decision record

| ID | Approved policy | Owner decision | Date | Notes |
| --- | --- | --- | --- | --- |
| PD-1 | A | Approved | 2026-10-29 | `OWNER_POLICY_REVIEW.md` |
| PD-2 | A | Approved | 2026-10-29 | `OWNER_POLICY_REVIEW.md` |
| PD-3 | A | Approved | 2026-10-29 | `OWNER_POLICY_REVIEW.md`; FR-11 still authoritative |

Approval is recorded once, explicitly, in `OWNER_POLICY_REVIEW.md`. Engineering review of the implementation remains pending and is not a policy reopening.

---

## What is still not covered

- No physical/device evidence for any clause. The two DEF-01 reproductions are JS-domain only; both are recorded as `DYNAMICALLY_REPRODUCED`, not device-proven.
- Reader and Meditation repositories were not inspected in R0; provider-side qualification defects remain possible and would return at Wave A2/A3.
- Baseline suites all pass: Routine JS **423**, Routine native **80**, Reader **106**, Meditation **177**, zero failures/errors/skips; Routine native cold build 21m4s. No physical or signing acceptance has been performed.
- Installed APK hashes, manifest export state and signer facts are unverified; #13's exact trigger therefore remains a hypothesis.
