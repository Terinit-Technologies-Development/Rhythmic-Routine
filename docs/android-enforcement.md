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

## 5. Verification Status
* **Classification:** **`V1_CANDIDATE`** (Experimental V1)
* **Testing:** Android physical device qualification completed in Pass 04C; Pass 04D app discovery and overlay hardening source-verified and ready for owner manual runbook test.
* **iOS Status:** Experimental, source-implemented foundation. Untested on physical Apple hardware.
