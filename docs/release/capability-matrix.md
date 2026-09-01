# Rhythmic-Routine Release Capability Matrix

## Classification Legend
- **`physical-device-verified`**: Verified on real physical device hardware with interactive confirmation.
- **`native-build-verified`**: Compiled and linked successfully through native toolchains (`gradlew` / `xcodebuild` / EAS).
- **`generated-project-verified`**: Verified through clean CNG generation and structural synthesis checks.
- **`source-implemented`**: Implemented and verified by automated unit/integration tests in TypeScript or native source.
- **`store-policy-prepared`**: Completed policy declaration, disclosure script, or privacy inventory ready for submission.
- **`entitlement-blocked`**: Blocked pending external platform approval (e.g. Apple Family Controls distribution grant).
- **`provisioning-blocked`**: Blocked pending signed provisioning profile generation with restricted capabilities.
- **`deferred`**: Explicitly out of scope for Pass 04 release candidate.

---

## Capability Matrix

| Platform | Capability / Subsystem | Current Status | Verification Source & Evidence |
| :--- | :--- | :--- | :--- |
| **Cross-Platform** | Pure TypeScript RhythmEngine State Machine | `source-implemented` | 104 automated tests passing (`npm test`). Verified routine resolution, continuous sessions, cooldowns, leases, discovery deduplication, and disclosure consent flows. |
| **Cross-Platform** | Local SQLite Insights Persistence & Compaction | `source-implemented` | 100% SQLite persistence via `expo-sqlite`. Daily rollups, 14d raw event compaction, 90d summary pruning verified by unit tests. |
| **Cross-Platform** | Essential Apps Absolute Exemption Invariant | `source-implemented` | Dialers/Maps/Emergency apps strictly barred from restrictions across all routines, cooldowns, and leases. |
| **Cross-Platform** | Release Build Profiles (`eas.json`) | `source-implemented` | `eas.json` configured with `preview` (APK / internal distribution) and `production` (AAB / store submission). Project linkage: `EAS_PROJECT_NOT_LINKED` (`OWNER_ACTION_REQUIRED`). |
| **Cross-Platform** | Native Runtime Version Contract | `source-implemented` | `runtimeVersion: { policy: 'appVersion' }` added to `app.config.ts`. |
| **Android** | Clean CNG Project Generation & Idempotency | `generated-project-verified` | `npx expo prebuild --clean --no-install` runs with zero errors; verified idempotent across consecutive passes. |
| **Android** | Native Compilation & Standalone QA APK Packaging | `native-build-verified` | Verified via `gradlew assembleQaStandalone`; generated `app-qaStandalone.apk` (`com.terinit.rhythmicroutine.qa`) with embedded offline JS bundle and canonical logo. |
| **Android** | Target SDK 36 & Compile SDK 36 Compatibility | `native-build-verified` | Verified against Expo SDK 57 / React Native 0.86 Gradle project structure and compiled without deprecation errors. |
| **Android** | Manifest & Least-Privilege Permission Boundary | `generated-project-verified` | Only `PACKAGE_USAGE_STATS` & `BIND_ACCESSIBILITY_SERVICE`. Launcher discovery `<queries>` used without `QUERY_ALL_PACKAGES`. `isAccessibilityTool` strictly absent. |
| **Android** | AccessibilityService Configuration | `generated-project-verified` | `accessibility_service_config.xml` specifies `typeWindowStateChanged` and `canRetrieveWindowContent="false"`. |
| **Android** | In-App Prominent Disclosure & Consent Flow | `source-implemented` | Shared disclosure component rendered both on `Home / Today` ("Finish device setup" card) and `Settings` with explicit Cancel and Affirmative Consent routing. |
| **Android** | Real-Time Touch Grass Mindful Intervention | `source-implemented` | `RhythmEnforcementService` displays fullscreen opaque `RhythmOverlayActivity` with 850ms debounce, auto-close timer, and Back-to-Home navigation. |
| **Android** | Base Restriction & Access Lease Separation | `source-implemented` | `setBaseRestrictions` is sole writer to `BASE_RESTRICTED_PACKAGES`; temporary leases use isolated `SharedPreferences` keys. |
| **Android** | Process-Death & Reboot Lease Expiry | `source-implemented` | Service compares absolute expiry timestamp on window state changes without requiring main app relaunch. |
| **Android** | Launcher App Discovery & Reconciliation | `source-implemented` | Targeted `ACTION_MAIN` + `CATEGORY_LAUNCHER` queries, deduplication by package, self-exclusion, and real package ID reconciliation. |
| **Android** | Physical Device Hardware Qualification | `physical-device-verified` (Pass 04C) / `V1_CANDIDATE` (Pass 04D) | Pass 04C confirmed 100% pass by owner. Pass 04D app discovery and overlay hardening ready for manual test via [`docs/qa/pass-04d-owner-v1-test.md`](../qa/pass-04d-owner-v1-test.md). |
| **iOS** | Clean CNG Synthesis & App Extension Embedding | `generated-project-verified` | `scripts/verify-ios-extension-project.mjs` verifies `RhythmDeviceActivityMonitor.appex`, single `PBXTargetDependency`, `PrivacyInfo.xcprivacy` in extension group and Resources phase, and idempotent re-runs. |
| **iOS** | Apple Privacy Manifests (App & Extension) | `source-implemented` | Main app (`app.config.ts`) and extension (`PrivacyInfo.xcprivacy`) declare category `NSPrivacyAccessedAPICategoryUserDefaults` with reason `1C8F.1`. Verified by `scripts/verify-ios-privacy-manifests.mjs`. |
| **iOS** | DeviceActivity Monitor Quota Consolidation | `source-implemented` | Daily routine compression (1 monitor each), Open Day skipping (0 monitors), multi-event `risk.daily` (1 monitor), nearest-expiry (1 monitor). Total <= 4 activities. |
| **iOS** | Per-Risk-Group Activity Selection Revisioning | `source-implemented` | Opaque tokens saved to App Group `UserDefaults`; `selection_revision.<groupId>` bumps trigger clean config synchronization. |
| **iOS** | Two-Phase Monitoring Error Boundaries | `source-implemented` | `persistent_monitoring_operational` reset on replacement; distinct error boundaries prevent stale healthy masking. |
| **iOS** | Cold-Start Native State Import Ordering | `source-implemented` | App Group snapshot read and imported into `RhythmCoordinator` prior to outward synchronization. |
| **iOS** | 15-Minute Truthful Access Lease Invariant | `source-implemented` | Enforced at UI and engine boundary; DeviceActivity extension schedules wake interval at least 15m out. |
| **iOS** | Family Controls Distribution Entitlement | `owner-confirmation-required` | Apple lifecycle status: `NOT_REQUESTED`. Requires developer portal application for distribution profiles. |
| **iOS** | Provisioning Profiles (Ad-Hoc / Store) | `provisioning-blocked` | Awaiting Family Controls distribution entitlement assignment before EAS can generate signed profiles. |
| **iOS** | Physical iPhone Hardware Qualification | `deferred / device-pending` | Blocked by macOS build requirement and pending Apple distribution entitlement. |
| **Store Policy** | Google Play Accessibility Declaration | `store-policy-prepared` | Complete declaration prepared in `docs/release/google-play-accessibility-declaration.md`. |
| **Store Policy** | Google Play Video Demonstration Script | `store-policy-prepared` | Shot-by-shot script prepared in `docs/release/google-play-accessibility-video-script.md`. |
| **Store Policy** | Google Play Data Safety Inventory | `store-policy-prepared` | Full questionnaire responses prepared in `docs/release/google-play-data-safety.md`. |
| **Store Policy** | Unified Store Listing Copy & Metadata | `store-policy-prepared` | Prepared in `docs/release/store-listing-draft.md` with accurate, non-punitive messaging. |
| **Store Policy** | Apple Family Controls Readiness Audit | `store-policy-prepared` | Audit completed in `docs/release/apple-family-controls-readiness.md`. |
| **Store Policy** | Apple Privacy Nutrition Label Responses | `store-policy-prepared` | Completed in `docs/release/apple-privacy-inventory.md`. |
