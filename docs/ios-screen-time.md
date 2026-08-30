# iOS Screen Time & DeviceActivity Architecture

On iOS, Rhythmic-Routine integrates with Apple's native Screen Time and Family Controls frameworks (iOS 16+).

## 1. Extension Target: `RhythmDeviceActivityMonitor`
* Synthesized deterministically via Expo Config Plugin `plugins/withRhythmScreenTime.ts`.
* Executes out-of-process in the background when `DeviceActivitySchedule` or `DeviceActivityEvent` thresholds are reached.

## 2. App Group & Shared State
* Main App and Extension share an App Group container (`group.com.terinit.rhythmicroutine`).
* The main app persists `FamilyActivitySelection` opaque tokens (`ApplicationToken`, `ActivityCategoryToken`) and `SharedRhythmState` in `UserDefaults`.

## 3. Shielding via `ManagedSettingsStore`
* The extension uses `ManagedSettingsStore(named: .init("RhythmRoutineStore"))` to apply or remove system shields based on the active restriction reason union (Morning Buffer, Evening Wind-Down, Cooldowns, minus active Access Leases).

## 4. Bounded DeviceActivity Monitoring Budget (Pass 03C)
Apple limits each application and its extensions to a hard ceiling of **20 active `DeviceActivity` schedules**. To guarantee stability and prevent budget exhaustion:
* **Strict Capacity Limits:** Maximum persistent monitors <= 18, reserving 1 slot for dynamic expiry and 1 safety slot.
* **7-Day Routine Compression:** Routines active on all 7 days (`Set(activeDays) == Set(1...7)`) collapse into 1 repeating daily monitor (`routine|<id>|daily`).
* **Non-Protective Routines Skipped:** Open Day protects 0 risk groups and generates 0 monitors.
* **Consolidated Risk Monitoring (`risk.daily`):** All Risk Groups with non-empty selections register threshold events on a single shared daily schedule (`risk.daily`).
* **Default Persistent Total:** Exactly 3 monitors (Morning Buffer, Evening Wind-Down, risk.daily).
* **Single Nearest-Expiry Wake Monitor:** Replaces per-group expiry monitors with one nearest-expiry wake schedule (`expiry|next|<endsAt>`).
* **15-Minute Semantic Lease Compatibility:** DeviceActivity requires intervals >= 15 minutes. The native wake schedule ensures an interval >= 15m + 2s while the pure engine and shared state enforce the exact semantic boundary.
* **Runtime Sync vs Config Sync Separation:** Steady-state `CLOCK_TICK` updates runtime snapshot without rebuilding persistent monitors. Persistent monitors only rebuild when `computeMonitoringConfigSignature` changes.
* **Out-of-Process Pruning:** When the expiry wake callback fires, it prunes all expired cooldowns and leases simultaneously and schedules the next wake-up.

## 5. Verification Status
* **Source Implementation:** Complete in `RhythmDeviceModule.swift`, `DeviceActivityMonitorExtension.swift`, and `NativeRhythmSyncProvider.ts`.
* **Generated-Project Verification:** Verified via `scripts/verify-ios-extension-project.mjs` ensuring target dependency, `Embed App Extensions` build phase (`dstSubfolderSpec = 13`), and `.appex` embedding.
* **Native Build & Device Verification:** Ready for macOS Xcode build and physical device provisioning with Family Controls entitlement.
