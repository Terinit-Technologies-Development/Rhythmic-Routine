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
