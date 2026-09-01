# Pass 04 — Qualification Evidence Index

## 1. Source Baseline & Repository State

| Parameter | Value |
| :--- | :--- |
| **Repository** | `Terinit-Technologies-Development/Rhythmic-Routine` |
| **Active Qualification Branch** | `qa/pass-04-device-release-validation` |
| **Base Merged Commit SHA** | `80c5c65cc9cf6fee2cfb5baf1639ab9988b2dc6a` (`origin/master`) |
| **Pull Request Status** | `PR: not created` |
| **Worktree / Branch Isolation** | Branch tracking `origin/master`. Master branch remains unmodified. |

---

## 2. Automated Quality & Health Gates

| Gate / Command | Result | Details / Evidence |
| :--- | :--- | :--- |
| **`npm ci`** | **PASS** (Code 0) | Clean installation of dependencies using package-lock. |
| **`npm test`** | **PASS** (104 / 104) | 16 suites, 104 tests passed, 0 failures, 0 skipped. |
| **`npm run typecheck`** | **PASS** (Code 0) | TypeScript compiler checked all files with 0 type errors. |
| **`npm run lint`** | **PASS** (Code 0) | ESLint (Expo flat config) completed with 0 errors and 0 warnings. |
| **`npm run build:web`** | **PASS** (Code 0) | Web bundle exported to `dist/` cleanly (2,646 modules bundled). |
| **`npx expo-doctor`** | **PASS** (21 / 21) | All 21 health checks passed with zero issues. |
| **`npx expo install --check`** | **PASS** (Code 0) | Output: `Dependencies are up to date`. |
| **`npx expo config --type public`** | **PASS** (Code 0) | Verified `runtimeVersion`, bundle ID, package, and EAS extension configuration. |
| **`npx expo config --type introspect`** | **PASS** (Code 0) | Verified iOS entitlements (`com.apple.developer.family-controls = true`, `group.com.terinit.rhythmicroutine`) and Android permissions. |
| **Clean CNG Prebuild #1** | **PASS** (Code 0) | `npx expo prebuild --clean --no-install` generated clean native project structure. |
| **Clean CNG Prebuild #2** | **PASS** (Code 0) | Second clean prebuild executed to confirm 100% idempotency. |
| **iOS Extension Synthesis** | **PASS** (Code 0) | `node scripts/verify-ios-extension-project.mjs` verified `PBXTargetDependency`, `.appex` build file, and `PrivacyInfo.xcprivacy` resource build phase. |
| **iOS Privacy Manifests** | **PASS** (Code 0) | `node scripts/verify-ios-privacy-manifests.mjs` verified `1C8F.1` across app.config.ts and extension PrivacyInfo.xcprivacy. |
| **Android Native Compile** | **PASS** (Code 0) | `gradlew assembleDebug` and `gradlew assembleQaStandalone` verified; built `app-qaStandalone.apk`. |
| **Secret & Credential Hygiene** | **PASS** (Code 0) | Zero private keys, certificates, keystores, or API tokens committed. |

---

## 3. Platform Qualification Artifacts

### Android Platform
- **Qualification Document:** [`docs/qa/pass-04-android-device-results.md`](./pass-04-android-device-results.md)
- **Target & Compile SDK:** SDK 36 (Android 16).
- **Service Configuration:** `canRetrieveWindowContent="false"`, `TYPE_WINDOW_STATE_CHANGED`, no `isAccessibilityTool`.
- **Physical Hardware State:** **`PHYSICAL_DEVICE_VERIFIED`** (Pass 04C confirmed by owner). Pass 04D app discovery and overlay hardening: **`V1_CANDIDATE`** awaiting owner runbook test.
- **Classification:** `PHYSICAL_DEVICE_VERIFIED` (Pass 04C) / `V1_CANDIDATE` (Pass 04D).

### iOS Platform
- **Qualification Document:** [`docs/qa/pass-04-ios-build-results.md`](./pass-04-ios-build-results.md)
- **Target Identifiers:** Main App `com.terinit.rhythmicroutine`, Extension `com.terinit.rhythmicroutine.activitymonitor`, App Group `group.com.terinit.rhythmicroutine`.
- **EAS Build Matrix:** Configured in `eas.json` with `preview` (internal APK distribution) and `production` (store submission). Project linkage: `EAS_PROJECT_NOT_LINKED` (`OWNER_ACTION_REQUIRED`).
- **Family Controls Distribution Entitlement:** `owner-confirmation-required` (`NOT_REQUESTED` in Apple portal) / `provisioning-blocked`.
- **Classification:** `source-config-verified` / `untested-experimental` (EAS/macOS build & physical hardware gates remain).

---

## 4. Store Policy & Privacy Submission Materials

| Document | Purpose | File Link |
| :--- | :--- | :--- |
| **Google Play Accessibility Declaration** | Text declaration for Play Console policy review. | [`docs/release/google-play-accessibility-declaration.md`](../release/google-play-accessibility-declaration.md) |
| **Google Play Video Script** | Step-by-step recording instructions for disclosure & intervention demo. | [`docs/release/google-play-accessibility-video-script.md`](../release/google-play-accessibility-video-script.md) |
| **Google Play Data Safety Inventory** | Accurate responses distinguishing on-device access from 0 byte upload. | [`docs/release/google-play-data-safety.md`](../release/google-play-data-safety.md) |
| **Unified Store Listing Draft** | Accurate copy, tagline, feature bullets, and keywords. | [`docs/release/store-listing-draft.md`](../release/store-listing-draft.md) |
| **Apple Family Controls Audit** | Capability readiness, App IDs, and entitlement request instructions. | [`docs/release/apple-family-controls-readiness.md`](../release/apple-family-controls-readiness.md) |
| **Apple Privacy Nutrition Label** | Privacy Manifest (`PrivacyInfo.xcprivacy`) and data usage responses. | [`docs/release/apple-privacy-inventory.md`](../release/apple-privacy-inventory.md) |
| **Capability Matrix** | Comprehensive status across all 30 platform features. | [`docs/release/capability-matrix.md`](../release/capability-matrix.md) |
| **Defect Log** | Tracks all identified issues (DEF-04-01, DEF-04-02). | [`docs/qa/pass-04-defects.md`](./pass-04-defects.md) |
| **Pass 04D Owner V1 Test Runbook** | Owner manual build commands and 10-point V1 checklist. | [`docs/qa/pass-04d-owner-v1-test.md`](./pass-04d-owner-v1-test.md) |

---

## 5. Summary Qualification Decision

- **Exit State:** **`V1_SOURCE_READY_FOR_OWNER_ANDROID_FINAL_TEST`**
- **Decision Rationale:**
  - **Android Platform:** Experimental V1 candidate. Full launcher app discovery via `<queries>`, package deduplication, real package ID reconciliation, live foreground re-evaluation, overlay debounce, opaque theme, and auto-close timer are 100% implemented and covered by 104 automated tests. Ready for manual compilation and physical phone verification.
  - **iOS Platform:** Included as an experimental, source-implemented foundation. It has not yet been validated on physical Apple hardware and will be qualified in a future release.
