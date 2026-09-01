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

The application codebase defines all required identifiers, entitlements, App Groups, and extension targets. Physical portal status requires owner confirmation in the Apple Developer console:

| Gate / Requirement | Status | Verification & Current Reality |
| :--- | :--- | :--- |
| **Apple Developer Program Membership** | `owner-confirmation-required` | Project owner must log into Apple Developer console to verify active membership. |
| **Main App ID Registration** | `owner-confirmation-required` | Must be registered under `com.terinit.rhythmicroutine`. |
| **Extension App ID Registration** | `owner-confirmation-required` | Must be registered under `com.terinit.rhythmicroutine.activitymonitor`. |
| **App Group Creation & Assignment** | `owner-confirmation-required` | Must be enabled with identifier `group.com.terinit.rhythmicroutine` on both app IDs. |
| **Family Controls (Development Capability)** | `owner-confirmation-required` | Apple allows development testing on signed personal development devices. |
| **Family Controls (Distribution Capability — Main)** | `NOT_REQUESTED` (`owner-confirmation-required`) | Official Apple lifecycle status: `NOT_REQUESTED`, `PENDING`, `APPROVED`, or `DECLINED`. Apple requires formal entitlement request submission via Developer portal for TestFlight and App Store distribution profiles. |
| **Family Controls (Distribution Capability — Extension)** | `NOT_REQUESTED` (`owner-confirmation-required`) | Must be requested and approved concurrently for the DeviceActivity monitor extension target. |
| **Ad-Hoc / Internal Provisioning Profile** | `provisioning-blocked` | Awaiting Apple Family Controls distribution entitlement assignment before EAS or Xcode can generate ad-hoc/internal profile. |
| **App Store Distribution Provisioning Profile** | `provisioning-blocked` | Awaiting Apple Family Controls distribution entitlement assignment before EAS or Xcode can generate App Store profile. |

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
