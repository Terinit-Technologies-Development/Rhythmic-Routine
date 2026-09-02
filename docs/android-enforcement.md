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
* **Native Per-App Daily Ledger:** `RhythmEnforcementService` maintains a compact per-app daily usage ledger in `SharedPreferences` (`DAILY_USAGE_LEDGER_JSON`).
* **Touch Grass Time Exclusion:** When Rhythm's overlay (`context.packageName`) or system UI becomes foreground, any active Risk app segment is finalized, deadline is cancelled, and active segment is stopped. Staring at Touch Grass never accumulates Risk usage.
* **Stale Exhaustion Clearing:** When an allowance is increased (such that `totalUsed < newAllowance`), `exhaustedAt` is immediately cleared, elapsed active usage is committed once, and the remaining allowance deadline is rescheduled. Base restrictions (routines/cooldowns) remain untouched.
* **Watermarked Idempotent Reconciliation:** Authoritative `LAST_USAGE_ACCOUNTED_AT` watermark tracks committed usage. UsageStats reconciliation queries bounded historical transitions, reconstructing pre-watermark state and adding only the delta strictly following the watermark. Prevents double-counting with live Accessibility tracking.
* **Ordered Reconnect Recovery:** On service reconnection, ordered foreground/background transitions determine the true active package (rejecting foreground apps with subsequent background events), restores active segments, and schedules exact allowance deadlines.
* **Event-Driven Local-Midnight Rollover:** A single `Handler` callback schedules the next local midnight. At midnight, Day 1 accounting closes, Day 2 starts fresh at `usedMillis = 0`, and the full allowance deadline is rescheduled without process polling.
* **Background-Resilient Routine Boundaries:** Routine schedule (`ROUTINE_SCHEDULE_JSON`) is evaluated natively on foreground events. Scheduled boundary callbacks (`scheduleNextRoutineBoundary`) trigger exact transitions:
  - *Evening → Overnight:* Continues protection with zero unlock gap.
  - *Overnight → Morning:* Remains protected.
  - *Morning → Open Day:* Routine restriction clears automatically even while React Native JS is suspended.
* **Reduced JS Cadence & Signature Caching:** JS reconciliation interval relaxed to 60 seconds. `PlatformNativeRhythmSyncProvider` caches signatures for base restrictions, daily policies, and routine schedules, eliminating redundant IPC and native writes.
* **Continuous Risk Group Session Tracking:** `NativeUsageProvider` executes a bounded 60-second query to emit `APP_FOREGROUND` and `APP_BACKGROUND` events into the TypeScript engine, preserving multi-app session thresholds and inactivity gaps.
* **App Discovery Refresh Policy Guard:** `RhythmCoordinator.refreshInstalledApps()` explicitly preserves `dailyRiskAllowance` (including `lastEditedDateKey`), preventing installed app scans from resetting once-daily allowance edit guards.

## 6. Verification Status
* **Classification:** **`V1.0.1_PATCH_CANDIDATE`**
* **Testing:** Pass 01/01A domain foundation merged; Pass 02 native usage ledger, exact allowance deadline, watermarked reconciliation, midnight rollover, and routine boundaries fully verified (149 passing tests across 25 suites).
* **iOS Status:** Experimental, source-implemented foundation. Untested on physical Apple hardware.
