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

## 4. Verification Status
* **Source Implementation:** Complete in `RhythmEnforcementService.kt`, `RhythmDeviceModule.kt`, and `nativePolicy.ts`.
* **Generated-Project Verification:** Android native project generated and verified via `npx expo prebuild --clean --no-install`.
* **Native Build & Device Verification:** Ready for Android SDK / Gradle build and physical/emulator device execution with `PACKAGE_USAGE_STATS` and accessibility authorization.
