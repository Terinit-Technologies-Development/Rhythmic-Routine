# Productive Attention Exchange — v1.2 Pass 02

This document describes the Routine-side policy and persistence layer. It does not describe a release-ready enforcement boundary; native Risk-app enforcement and the reading-gate experience are Pass 03 work.

## Ownership and evidence

Rhythmic Reader Protocol V2 is the evidence authority. Routine queries:

```text
content://com.terinit.rhythmicreader.evidence/daily/{YYYY-MM-DD}
```

using `com.terinit.rhythmicreader.permission.RECOVERY` and the explicit projection:
`protocolVersion`, `dateKey`, `verifiedActiveSeconds`, `qualifiedPages`, and `updatedAtEpochMs`.

Routine caches a `ReadingEvidenceSnapshot` in runtime for continuity. It is a projection, not an evidence source. An empty Cursor for a valid date means the Reader provider is available and compatible with `0` seconds and `0` pages. A failed query maps to unavailable; a returned protocol/date mismatch maps to available but incompatible. Neither case can satisfy a reading requirement.

Protocol V1 recovery-session calls remain available for compatibility. V1 session completion is not consulted by the v1.2 attention-exchange policy.

## Policy and global ordinal

`src/domain/rhythm/attentionExchange.ts` owns the v1.2 policy and pure calculations:

| Daily cooldown ordinal | Verified active seconds | Qualified pages |
| ---: | ---: | ---: |
| 1 | 0 | 0 |
| 2 | 0 | 0 |
| 3 | 3,600 | 36 |
| 4 | 5,400 | 47 |
| 5 | 7,200 | 58 |
| 6 | 9,000 | 69 |
| 7 | 10,800 | 80 |

The daily ordinal is global across Risk Groups. It is persisted in `dailyAttentionExchange.cooldownsTriggered`, with the date and the highest assigned requirements. `GroupAllowanceUsage.cycleRevision` remains exclusively part of the native/per-group allowance ledger and is never used as this ordinal.

Ordinals and requirement snapshots are assigned when the cooldown is created. The snapshot fields on `ActiveCooldown` are not recalculated when another group later creates a cooldown.

## Reading gate lifecycle

`activeReadingGates` is separate from `activeCooldowns`. Only non-zero requirements create a gate. The gate records its Risk Group, local attention date, assigned ordinal, creation time, cooldown end, and the two required evidence dimensions.

- While a cooldown runs, its gate remains even if both reading targets are already met.
- When the timer ends, incomplete or unavailable evidence leaves the gate active.
- When the timer has ended and both verified evidence dimensions meet the snapshot, the gate is removed.
- Evidence time cannot substitute for qualified pages, or vice versa.
- A temporary Access Lease does not modify evidence or gate satisfaction.
- Deleting a Risk Group removes that group's gate but does not decrement the historical global daily count.

`deriveAttentionGateStatus` exposes cooldown-active, reading-required, Reader availability/compatibility, and satisfaction state plus remaining time/pages for later application layers.

## Local-date boundary

At local midnight, the daily ordinal and highest requirement reset, and previous-date reading gates and cached evidence are discarded. An active cooldown timer remains in `activeCooldowns` and keeps its original `endsAt`. A timer that crosses midnight therefore continues, while its previous-day reading gate does not carry forward.

## Existing-runtime migration

Pre-v1.2 persisted cooldowns and access leases are preserved. Legacy cooldowns receive no v1.2 metadata and no reading gate, so migration does not create retroactive reading debt. When v1.2 daily state is missing, each persisted cooldown whose `startedAt` falls on the current local date contributes to the initial daily count. Existing v1.2 cooldown ordinals/gates are used to infer the known highest ordinal, and observed legacy cooldowns are added to that value. Once `dailyAttentionExchange` exists, it remains authoritative until date rollover.

## Native cooldown imports and Pass 02 limit

Importing the same still-active native cooldown more than once is idempotent: once its group is present in runtime, repeated `NATIVE_COOLDOWN_RESTORED` snapshots merge the end time without allocating another ordinal. A previously unseen active native cooldown gets one import-time allocation and requirement snapshot.

Pass 02 cannot reconstruct native-only cooldown cycles that both started and fully elapsed while JavaScript was suspended. It also cannot know the true global ordinal for a newly imported native cooldown if earlier unseen cycles occurred during that suspension. Pass 03 must move allocation and enforcement into the native authoritative policy state to close this gap. Per-group `cycleRevision` is not a substitute.

## Persistence fields

`RhythmRuntime` and `PersistedRuntime` contain:

- `dailyAttentionExchange`: the daily global ordinal and highest requirements;
- `activeReadingGates`: durable post-timer obligations keyed by Risk Group ID;
- `readingEvidence`: the replaceable cached Reader V2 projection;
- cooldown requirement/date/ordinal snapshots on `activeCooldowns`.

The engine returns and persists defensive copies of these maps and records.
