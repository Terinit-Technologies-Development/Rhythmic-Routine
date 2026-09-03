# Android Enforcement Architecture

On Android, Rhythmic-Routine implements a two-tier architecture separating quantitative usage tracking from mindful intervention:

## 1. Observation: `UsageStatsManager`
* Requires `PACKAGE_USAGE_STATS` permission.
* Quantitatively observes foreground app intervals and session lengths.
* Powers the 5-minute inactivity gap tolerance logic in `NativeUsageProvider`.

## 2. Enforcement: `RhythmEnforcementService` & `RhythmOverlayActivity`
* When a Risk Group reaches its limit or enters a routine window (Morning Buffer, Evening Wind-Down), restricted package names are written to native `SharedPreferences` (`rhythm_restrictions`).
* `RhythmEnforcementService` (Accessibility Service) observes only `TYPE_WINDOW_STATE_CHANGED` events.
* If a newly foregrounded app is in the restricted set, it immediately launches the fullscreen `RhythmOverlayActivity` presenting the calm "Touch Grass" intervention.
* **Privacy Boundary:** `canRetrieveWindowContent="false"`. No screen text, node trees, or private information is ever read.

## 3. Base Registry & Lease Separation (Pass 03C)
* **Sole Registry Writer:** `RhythmDeviceModule.setBaseRestrictions()` is the sole writer to `BASE_RESTRICTED_PACKAGES`.
* **Delta Integrity:** Delta methods (`applyShieldRestrictions`, `clearShieldRestrictions`) no longer mutate `BASE_RESTRICTED_PACKAGES`.
* **Access Lease Isolation:** Active access leases are maintained exclusively in `ACCESS_LEASES_JSON`. Leases suppress restrictions dynamically inside `RhythmEnforcementService.isEffectivelyRestricted()` without deleting base package records.
* **Live In-Process Expiry:** Active leases schedule a main looper `Handler` callback in `RhythmEnforcementService`. When a lease expires while the user remains foregrounded in the restricted app, the intervention overlay appears immediately.

## 4. Pass 04D Final Hardening & App Discovery
* **Launcher Package Visibility:** Manifest defines `<queries>` with `ACTION_MAIN` and `CATEGORY_LAUNCHER`. Discovers all user-launchable apps without requiring invasive `QUERY_ALL_PACKAGES` permission.
* **Package Deduplication & Self-Exclusion:** Package entries are deduplicated by `packageName` and sorted case-insensitively. Rhythm itself (`context.packageName`) is excluded from selectable lists.
* **Live Foreground Re-Evaluation:** When `setBaseRestrictions()` writes a new restriction set, `RhythmEnforcementService.instance?.onBaseRestrictionsChanged()` re-evaluates the currently foregrounded package immediately. If restricted, Touch Grass appears without waiting for an external window change.
* **Recent Foreground Seeding:** Uses `UsageStatsManager.queryEvents()` (last 60s) to discover foreground package if `lastForegroundPackage` is null upon service connection.
* **Debounce & Single-Task Overlay:** Debounced at 850ms; skips duplicate activity launches if `RhythmOverlayActivity.isVisible` is already true. Launch mode configured as `singleTask` with `excludeFromRecents="true"`.
* **Opaque Theme & Back Navigation:** Uses `Theme.Rhythm.Overlay` (`#FAF7F0` background) so underlying app content is not visible. Pressing Back routes directly to the Android Home screen (`CATEGORY_HOME`).
* **Auto-Close On Window Expiry:** While visible, the overlay polls `isEffectivelyRestricted` every second and automatically closes if the protection window has elapsed.
* **Read-Only Technical Diagnostics:** Exposes `getEnforcementDiagnostics()` for local technical state inspection (service running, restricted count, active leases, overlay visible).

## 5. Pass 02 Android Native Daily Usage Ledger, Watermarked Reconciliation & Resilient Boundaries
* **Disentangled Native Restriction Hierarchy:** Android native restriction evaluation has explicit, truthful sources:
  - `routine restriction`: evaluated natively against `ROUTINE_SCHEDULE_JSON` (Morning Buffer, Evening Wind-Down, and derived Overnight gap).
  - `daily allowance restriction`: evaluated natively against `DAILY_USAGE_LEDGER_JSON` and `DAILY_ALLOWANCE_POLICIES_JSON`.
  - `cooldown restriction`: evaluated natively against synced `COOLDOWN_POLICIES_JSON` (`NativeCooldownPolicy = { groupId, packageNames, endsAt }`).
  - `Access Lease suppression`: active leases in `ACCESS_LEASES_JSON` dynamically suppress effective restrictions without clearing underlying policies.
  - Stale JS routine state cannot keep an app locked after Morning Buffer ends; `BASE_RESTRICTED_PACKAGES` is cleared so native dynamically evaluates real-time boundaries.
* **Exact Pass 01 Overnight Semantics:**
  - *Pre-midnight:* Evening active today AND Morning active tomorrow.
  - *Post-midnight:* Evening active yesterday AND Morning active today.
  - If either boundary is disabled or inactive for that day: no derived overnight lock.
  - During valid overnight gap: **ALL Risk apps restricted** (not merely packages in configured routine groups). Morning and Evening windows retain their configured protected packages.
  - Full support for Sunday → Monday, cross-midnight evening windows, weekday differences, and disabled routines.
* **Native Nearest-Cooldown Scheduling:** Active cooldowns sync package IDs plus `endsAt` values from `RhythmRuntime.activeCooldowns`. Native evaluates `endsAt` against current time, schedules only the nearest cooldown expiry on `Handler`, and re-evaluates the foreground package at expiry without polling or requiring running JS.
* **Per-Package Accounting Watermarks:** `LAST_USAGE_ACCOUNTED_BY_PACKAGE_JSON` tracks each Risk app's own accounted timestamp alongside global `LAST_USAGE_RECONCILED_AT`. Live Accessibility segment commits advance only that app's watermark; historical UsageStats reconciliation queries bounded intervals and repairs missed intervals for other apps without double-counting.
* **Authoritative Current-Foreground Resolver:** Single `resolveCurrentForegroundPackage()` processes ordered foreground and background transitions across `[localMidnight, now]`. Accurately resolves foreground -> background as null, rapid app switches, and foreground apps active >5 minutes across service reconnects.
* **DST-Safe Boundary Scheduling:** Local midnight and routine boundary calculations use `Calendar.add(Calendar.DAY_OF_YEAR, 1)` and calendar field mutations rather than raw millisecond math (`+ 86_400_000L`).
* **Resume Risk Group Reconciliation:** `handleAppResume()` executes an immediate bounded activity events refresh via `refreshActivityEvents()` before reconciling TypeScript Risk Group session continuity, eliminating up to 60-second resume lag.
* **Touch Grass Time Exclusion:** When Rhythm's overlay (`context.packageName`) or system UI becomes foreground, active Risk segments are immediately finalized. Staring at Touch Grass never accumulates Risk usage.
* **Stale Exhaustion Clearing:** When an allowance is increased (`totalUsed < newAllowance`), exhaustion is cleared and remaining allowance deadline is rescheduled.

## 6. Verification Status
* **Classification:** **`V1.0.1_PATCH_CANDIDATE`**
* **Testing:** Pass 01/01A domain foundation merged; Pass 02 native usage ledger, exact allowance deadline, watermarked reconciliation, midnight rollover, native routine semantics, cooldown scheduling, and authoritative foreground resolver fully verified (158 passing tests across 25 suites).
* **iOS Status:** Experimental, source-implemented foundation. Untested on physical Apple hardware.
