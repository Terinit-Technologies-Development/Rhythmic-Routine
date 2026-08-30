# Apple Family Controls & Screen Time Capability Readiness

## 1. Identifier & Entitlement Inventory

| Component | Identifier / Target Name | Configuration Source |
| :--- | :--- | :--- |
| **Main App Bundle ID** | `com.terinit.rhythmicroutine` | `app.config.ts`, `ios.bundleIdentifier` |
| **Extension Target Name** | `RhythmDeviceActivityMonitor` | `plugins/withRhythmScreenTime.ts` |
| **Extension Bundle ID** | `com.terinit.rhythmicroutine.activitymonitor` | `app.config.ts`, `extra.eas.build.experimental.ios.appExtensions` |
| **Shared App Group** | `group.com.terinit.rhythmicroutine` | `app.config.ts`, `plugins/withRhythmScreenTime.ts` |
| **Screen Time Entitlement** | `com.apple.developer.family-controls` | Required for both Main App and Extension Target |
| **App Group Entitlement** | `com.apple.security.application-groups` | Required for shared `UserDefaults` sync |

---

## 2. Apple Entitlement & Provisioning Status Matrix

| Gate / Requirement | Status | Current Reality & Action Required |
| :--- | :--- | :--- |
| **Apple Developer Program Membership** | `available` | Project owner holds active Apple Developer Program account. |
| **Main App ID Registration** | `available` | Registered under `com.terinit.rhythmicroutine`. |
| **Extension App ID Registration** | `available` | Registered under `com.terinit.rhythmicroutine.activitymonitor`. |
| **App Group Creation & Assignment** | `available` | Assigned to `group.com.terinit.rhythmicroutine` across both targets. |
| **Family Controls (Development Capability)** | `available` | Authorized on personal development team devices via Xcode / development provisioning. |
| **Family Controls (Distribution Capability — Main)** | `pending` (`WAITING_ON_APPLE_ENTITLEMENT`) | Apple requires formal request submission via Apple Developer portal for TestFlight and App Store distribution profiles. |
| **Family Controls (Distribution Capability — Extension)** | `pending` (`WAITING_ON_APPLE_ENTITLEMENT`) | Must be approved concurrently for the DeviceActivity monitor extension target. |
| **Ad-Hoc / Preview Provisioning Profile** | `provisioning-blocked` | Awaiting Apple Family Controls distribution entitlement assignment before EAS can generate ad-hoc profile. |
| **App Store Distribution Provisioning Profile** | `provisioning-blocked` | Awaiting Apple Family Controls distribution entitlement assignment before EAS can generate distribution profile. |

---

## 3. Entitlement Application Guidance for Project Owner

To unlock TestFlight and App Store distribution builds:

1. Log into [Apple Developer Account — Entitlement Requests](https://developer.apple.com/contact/request/family-controls-distribution).
2. Select App ID: `com.terinit.rhythmicroutine` (and repeat for `com.terinit.rhythmicroutine.activitymonitor`).
3. Explain App Functionality:
   - *“Rhythmic-Routine is a mindful digital wellbeing tool that utilizes Family Controls to help individuals schedule gentle routine buffer windows (such as morning and evening routines) and recovery breaks for self-selected high-distraction apps. The app operates 100% locally with zero cloud backend or external data collection.”*
4. Explain Extension Functionality:
   - *“The RhythmDeviceActivityMonitor extension monitors device activity event thresholds to schedule recovery cooldowns and shield updates via ManagedSettings when the user crosses self-defined focus boundaries.”*
5. Once approved by Apple:
   - In Developer Portal, regenerate Provisioning Profiles with `Family Controls (Distribution)` checked.
   - Run `eas build --platform ios --profile preview` to generate signed internal test build.
