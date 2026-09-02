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

## 5. Pass 02 Android Native Daily Usage Ledger & Exact Deadline
* **Native Per-App Daily Ledger:** `RhythmEnforcementService` maintains a compact per-app daily usage ledger in `SharedPreferences` (`DAILY_USAGE_LEDGER_JSON`).
* **Package Foreground Transitions:** On Accessibility `TYPE_WINDOW_STATE_CHANGED`, transitions finalize the prior Risk app segment, commit elapsed milliseconds into `usedMillis`, and start a new segment for the incoming Risk app.
* **Duplicate Event Protection:** Successive window state change events for the currently active package never reset `activeSegmentStartedAt`, eliminating time truncation bugs.
* **Single Active Allowance Deadline:** Only ONE deadline callback exists at a time via `Handler.postDelayed`. When a Risk app enters foreground, the exact remaining allowance is scheduled. When remaining reaches 0, the app is marked exhausted and Touch Grass appears immediately.
* **Access Lease Accounting:** Usage accumulates continuously during active Access Leases without alteration. If daily allowance is exhausted during a lease, the exhaustion state is preserved and Touch Grass triggers immediately upon lease expiration.
* **Zero-Minute Allowance:** Apps configured with 0 minutes allowance are immediately marked exhausted and restricted upon launch during Open Day.
* **Bounded UsageStats Reconciliation:** Bounded query triggered on service connect, app resume, and process recovery with watermark tracking (`LAST_USAGE_RECONCILED_AT`). Deduplicates events and eliminates permanent 15-second polling loops from JavaScript.
* **Native Snapshot API:** Exposes `getDailyUsageSnapshot()` and `reconcileDailyUsage()` bridging native ledger state to TypeScript application layers.

## 6. Verification Status
* **Classification:** **`V1.0.1_PATCH_CANDIDATE`**
* **Testing:** Pass 01/01A domain foundation merged; Pass 02 native usage ledger, exact allowance deadline, and bounded reconciliation implemented with 0 battery polling overhead.
* **iOS Status:** Experimental, source-implemented foundation. Untested on physical Apple hardware.
