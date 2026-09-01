# Platform Setup & Native Build Guide

Rhythmic-Routine is built using **Expo SDK 57 (React Native 0.86)** with Local Native Modules and Config Plugins (`expo prebuild`).

## Prerequisites

* **Node.js:** v22.x or v24.x
* **Package Manager:** `npm` (v10+)
* **Android Development:** Android Studio, JDK 17+, Android SDK (API 34+)
* **iOS Development (macOS only):** Xcode 16+, CocoaPods

---

## 1. Quick Start (Web Development)

```bash
npm install
npm run start
```
Press `w` in terminal to launch the interactive web demo in your browser. The web version includes a built-in state simulation bar to test Morning Buffer, Evening Wind-Down, Active Cooldowns, and Emergency Access overrides without needing physical device permissions.

---

## 2. Running Test Suites & Quality Checks

```bash
# Run unit & integration test suites
npm test

# Run ESLint check
npm run lint

# Run TypeScript typecheck
npm run typecheck

# Verify web export build
npm run build:web
```

---

## 3. Android Native Setup & Runtime Modes

### Canonical App Icon
The canonical application icon is located at [`assets/rhythmic_routine_logo.png`](assets/rhythmic_routine_logo.png) (1254x1254) with background `#F8F4E8`. It is configured as the main icon and Android adaptive icon foreground image.

### Build Modes:
1. **Mode 1: Expo Go (`npm run start:go`)**:
   UI layout testing only. Activates truthful unlinked native fallback (`foundation-only`, zero permissions).
2. **Mode 2: Rhythm Development Client (`app-debug.apk`)**:
   Built with `expo-dev-client`. Connects to Metro via `adb reverse tcp:8081 tcp:8081` and `npm run start:dev`. Used for live feature development and hot-reloading. *Note: `app-debug.apk` is not a standalone APK and requires Metro.*
3. **Mode 3: Standalone QA APK (`app-qaStandalone.apk`)**:
   Canonical standalone APK. Uses the `qaStandalone` build type to automatically embed the offline JavaScript bundle via React Native Gradle Plugin (`createBundleQaStandaloneJsAndAssets`). Runs completely offline without Metro or PC tethering.
   * **Owner Manual Build Instructions:** See [`docs/qa/pass-04c-owner-build-commands.md`](docs/qa/pass-04c-owner-build-commands.md).

### Permissions on Device:
* **Usage Access:** Settings -> Apps -> Special app access -> Usage Access -> Enable **Rhythmic-Routine**.
* **Accessibility Intervention:** Settings -> Accessibility -> Downloaded apps -> Enable **Rhythmic-Routine**.

---

## 4. iOS Native Setup (Screen Time & Device Activity)

1. Generate the native iOS project:
   ```bash
   npx expo prebuild --platform ios
   ```
2. Open `ios/RhythmicRoutine.xcworkspace` in Xcode.
3. Configure your Apple Developer Team for code signing.
4. Build and run on a physical iOS device running iOS 16.0+:
   ```bash
   npx expo run:ios --device
   ```
5. Authorize Screen Time when prompted by the app.
