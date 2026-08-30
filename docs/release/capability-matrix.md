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
| **Cross-Platform** | Pure TypeScript RhythmEngine State Machine | `source-implemented` | 79 automated tests passing (`npm test`). Verified routine resolution, continuous sessions, cooldowns, and leases. |
| **Cross-Platform** | Local SQLite Insights Persistence & Compaction | `source-implemented` | 100% SQLite persistence via `expo-sqlite`. Daily rollups, 14d raw event compaction, 90d summary pruning verified by unit tests. |
| **Cross-Platform** | Essential Apps Absolute Exemption Invariant | `source-implemented` | Dialers/Maps/Emergency apps strictly barred from restrictions across all routines, cooldowns, and leases. |
| **Cross-Platform** | Release Build Matrix (`eas.json`) | `source-implemented` | `eas.json` created with `development`, `preview` (APK/internal), and `production` (AAB/autoIncrement) profiles. |
| **Cross-Platform** | Native Runtime Version Contract | `source-implemented` | `runtimeVersion: { policy: 'appVersion' }` added to `app.config.ts`. |
| **Android** | Clean CNG Project Generation & Idempotency | `generated-project-verified` | `npx expo prebuild --clean --no-install` runs with zero errors; verified idempotent across consecutive passes. |
| **Android** | Target SDK 36 & Compile SDK 36 Compatibility | `generated-project-verified` | Verified against Expo SDK 57 / React Native 0.86 Gradle project structure. |
| **Android** | Manifest & Least-Privilege Permission Boundary | `generated-project-verified` | Only `PACKAGE_USAGE_STATS` & `BIND_ACCESSIBILITY_SERVICE`. Zero invasive permissions. `isAccessibilityTool` strictly absent. |
| **Android** | AccessibilityService Configuration | `generated-project-verified` | `accessibility_service_config.xml` specifies `typeWindowStateChanged` and `canRetrieveWindowContent="false"`. |
| **Android** | In-App Prominent Disclosure & Consent Modal | `source-implemented` | Custom pre-consent modal implemented in `app/settings.tsx` with explicit Cancel and Affirmative Consent routing. |
| **Android** | Real-Time Touch Grass Mindful Intervention | `source-implemented` | `RhythmEnforcementService` displays fullscreen `RhythmOverlayActivity` on restricted package launch. |
| **Android** | Base Restriction & Access Lease Separation | `source-implemented` | `setBaseRestrictions` is sole writer to `BASE_RESTRICTED_PACKAGES`; temporary leases use isolated `SharedPreferences` keys. |
| **Android** | Process-Death & Reboot Lease Expiry | `source-implemented` | Service compares absolute expiry timestamp on window state changes without requiring main app relaunch. |
| **Android** | Physical Device Hardware Qualification | `generated-project-verified` | Blocked by absence of physical Android device attached to local host (`adb devices` was empty). |
| **iOS** | Clean CNG Synthesis & App Extension Embedding | `generated-project-verified` | `scripts/verify-ios-extension-project.mjs` verifies `RhythmDeviceActivityMonitor.appex`, single `PBXTargetDependency`, and idempotent re-runs. |
| **iOS** | DeviceActivity Monitor Quota Consolidation | `source-implemented` | Daily routine compression (1 monitor each), Open Day skipping (0 monitors), multi-event `risk.daily` (1 monitor), nearest-expiry (1 monitor). Total <= 4 activities. |
| **iOS** | Per-Risk-Group Activity Selection Revisioning | `source-implemented` | Opaque tokens saved to App Group `UserDefaults`; `selection_revision.<groupId>` bumps trigger clean config synchronization. |
| **iOS** | Two-Phase Monitoring Error Boundaries | `source-implemented` | `persistent_monitoring_operational` reset on replacement; distinct error boundaries prevent stale healthy masking. |
| **iOS** | Cold-Start Native State Import Ordering | `source-implemented` | App Group snapshot read and imported into `RhythmCoordinator` prior to outward synchronization. |
| **iOS** | 15-Minute Truthful Access Lease Invariant | `source-implemented` | Enforced at UI and engine boundary; DeviceActivity extension schedules wake interval at least 15m out. |
| **iOS** | Family Controls Distribution Entitlement | `entitlement-blocked` | Restricted Apple capability requires manual developer portal approval for distribution profiles (`WAITING_ON_APPLE_ENTITLEMENT`). |
| **iOS** | Provisioning Profiles (Ad-Hoc / Store) | `provisioning-blocked` | Awaiting Family Controls distribution entitlement assignment before EAS can generate signed profiles. |
| **iOS** | Physical iPhone Hardware Qualification | `generated-project-verified` | Blocked by macOS build requirement and pending Apple distribution entitlement. |
| **Store Policy** | Google Play Accessibility Declaration | `store-policy-prepared` | Complete declaration prepared in `docs/release/google-play-accessibility-declaration.md`. |
| **Store Policy** | Google Play Video Demonstration Script | `store-policy-prepared` | Shot-by-shot script prepared in `docs/release/google-play-accessibility-video-script.md`. |
| **Store Policy** | Google Play Data Safety Inventory | `store-policy-prepared` | Full questionnaire responses prepared in `docs/release/google-play-data-safety.md`. |
| **Store Policy** | Unified Store Listing Copy & Metadata | `store-policy-prepared` | Prepared in `docs/release/store-listing-draft.md` with accurate, non-punitive messaging. |
| **Store Policy** | Apple Family Controls Readiness Audit | `store-policy-prepared` | Audit completed in `docs/release/apple-family-controls-readiness.md`. |
| **Store Policy** | Apple Privacy Nutrition Label Responses | `store-policy-prepared` | Completed in `docs/release/apple-privacy-inventory.md`. |
