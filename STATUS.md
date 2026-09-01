# Project & Platform Status

| Attribute | Current Value |
| :--- | :--- |
| **Current Version** | `1.0.0` |
| **Release Maturity** | **Experimental V1** |
| **Licensing Model** | **Source-Available** ([Rhythmic-Routine Personal Use License](LICENSE)) |
| **Commercial Licensing** | Available through [Terinit Technologies](COMMERCIAL_LICENSE.md) |
| **Primary Codebase** | React Native (Expo SDK 57 / React 19 / TypeScript) |
| **Automated Test Suite** | 104 tests passing across 16 suites (`npm test`) |

---

## Platform Readiness Matrix

| Platform | Readiness Classification | Physical Hardware Verification | Release Qualification |
| :--- | :--- | :--- | :--- |
| **Android** | **Experimental V1** | **VERIFIED** (Pass 04C / Pass 04D physical device testing confirmed by owner) | Qualified for manual compilation and self-hosted personal device installation via standalone QA APK (`app-qaStandalone.apk`). Store submission not yet conducted. |
| **iOS** | **Experimental Foundation** | **UNTESTED** | Source-implemented architecture (Config Plugins, ManagedSettings, DeviceActivity extension). Physical iPhone compilation and real-world Screen Time qualification remain pending Apple distribution entitlement assignment and macOS build validation. |
| **Web** | **Development & Demo** | N/A | Static client bundle exportable via `expo export -p web`. Simulates all state machine transitions and engine clocks without native permissions. |

---

## Distribution Status

- **Public Source Repository:** Hosted at [GitHub](https://github.com/Terinit-Technologies-Development/Rhythmic-Routine).
- **Binary Distribution:** Source-only release. Binaries are compiled manually by the user or enterprise licensee.
- **App Stores:** Google Play Console and Apple App Store submissions have **not** been published. Policy declarations, data safety inventories, and video scripts are documented in `docs/release/` for prospective future submission.
