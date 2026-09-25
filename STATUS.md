# Project & Platform Status

| Attribute | Current Value |
| :--- | :--- |
| **Current Version** | `1.2.0` |
| **Release Maturity** | **Internal Stable Release (Private / Internal Android)** |
| **Licensing Model** | **Source-Available** ([Rhythmic-Routine Personal Use License](LICENSE)) |
| **Commercial Licensing** | Available through [Terinit Technologies](COMMERCIAL_LICENSE.md) |
| **Primary Codebase** | React Native (Expo SDK 57 / React 19 / TypeScript) |
| **Automated Test Suite** | 355 tests passing across 67 suites (`npm test`) |

---

## Platform Readiness Matrix

| Platform | Readiness Classification | Physical Hardware Verification | Release Qualification |
| :--- | :--- | :--- | :--- |
| **Android** | **Internal Stable Release** | **VERIFIED** (owner-accepted paired build on physical hardware; v1.2.0 acceptance) | Accepted for private/internal Android distribution via direct APK. Routine↔Reader signature-protected IPC verified on-device. Store submission not applicable. |
| **iOS** | **Experimental Foundation** | **UNTESTED** | Source-implemented architecture (Config Plugins, ManagedSettings, DeviceActivity extension). Physical iPhone compilation and real-world Screen Time qualification remain pending Apple distribution entitlement assignment and macOS build validation. |
| **Web** | **Development & Demo** | N/A | Static client bundle exportable via `expo export -p web`. Simulates all state machine transitions and engine clocks without native permissions. |

---

## Distribution Status

- **GitHub Source Release:** Published as `v1.2.0` internal release record.
- **Android Internal Binary:** Distributed directly as an internal APK (standalone QA variant and stable package); clean in-place updates preserve local application data.
- **Public App Stores:** Not applicable — this release line is private/internal. Google Play and Apple App Store publication are not planned.
- **Signing Requirement:** Rhythmic Routine and Rhythmic Reader must share the same stable signing identity to preserve signature-protected IPC.
