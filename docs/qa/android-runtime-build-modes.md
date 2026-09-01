# Android Runtime Build Modes & Workflow Guide

## Overview

Rhythmic-Routine supports distinct runtime modes designed for different stages of development, quality assurance, and distribution. Because Rhythmic-Routine relies on custom Kotlin and Swift native modules (`rhythm-device`), Android `AccessibilityService`, `UsageStatsManager`, and iOS `FamilyControls`, the app cannot run natively inside generic pre-built store containers like Expo Go.

---

## 1. Runtime Mode Matrix

| Mode | Target Binary | JavaScript Source | Native Modules | Use Case |
| :--- | :--- | :--- | :--- | :--- |
| **Mode 1: Expo Go** | Store-downloaded Expo Go APK | Local Metro bundler | **Fallback/Mock only** (no native code) | Rapid UI layout and design testing without native device features. Shows subtle notice banner. |
| **Mode 2: Rhythm Dev Client** | `app-debug.apk` (with `expo-dev-client`) | Local Metro bundler (`:8081`) | **Full custom native modules** | Active feature development with live reloading and full native capability. |
| **Mode 3: Standalone QA APK** | `app-qaStandalone.apk` / `app-debug.apk` | Embedded offline JS bundle (`assets/index.android.bundle`) | **Full custom native modules** | Physical device QA, offline testing, tap-and-play installation without Metro. |
| **Mode 4: Production Release** | `app-release.aab` / `app-release.apk` | Embedded minified JS bundle | **Full custom native modules** | Production distribution signed with release keystore. |

---

## 2. Mode 1: Expo Go (UI-Only Fallback)

- **Entry Command**: `npm run start:go` (`npx expo start --go`)
- **Behavior**:
  - Automatically activates truthful native fallback in `modules/rhythm-device`.
  - `isRhythmNativeModuleAvailable` returns `false`.
  - Permissions report `false`, capability reports `foundation-only`, and token pickers return `0`.
  - Displays non-intrusive `ExpoGoDevBanner` informing developers that native enforcement requires the Development Client or Standalone QA build.

---

## 3. Mode 2: Rhythm Development Client

- **Build Command**:
  ```powershell
  cd android
  .\gradlew.bat assembleDebug -PreactNativeArchitectures=arm64-v8a
  ```
- **Install Command**:
  ```powershell
  adb install -r app\build\outputs\apk\debug\app-debug.apk
  ```
- **Run Command**:
  ```powershell
  adb reverse tcp:8081 tcp:8081
  npm run start:dev
  ```
- **Behavior**:
  - Replaces Expo Go on physical devices.
  - Connects to Metro over USB or Wi-Fi for live reloading.
  - Executes full custom Kotlin modules and Android background services.

---

## 4. Mode 3: Standalone QA APK (Offline / No Metro)

- **Automated Script**:
  ```powershell
  .\scripts\build-android-qa.ps1
  ```
- **Manual Build Steps**:
  1. Generate embedded offline JavaScript bundle:
     ```powershell
     npx expo export:embed --platform android --dev false --entry-file node_modules/expo-router/entry.js --bundle-output android/app/src/main/assets/index.android.bundle --assets-dest android/app/src/main/res
     ```
  2. Assemble APK:
     ```powershell
     cd android
     .\gradlew.bat assembleDebug -PreactNativeArchitectures=arm64-v8a
     ```
  3. Verify with inspection script:
     ```powershell
     node scripts/verify-android-qa-apk.mjs
     ```
- **Behavior**:
  - Embeds `index.android.bundle` inside the APK assets.
  - Launches immediately on phone taps without needing Metro, PC connection, or terminal commands.

---

## 5. Path Length & Memory Optimization on Windows

- **Windows Ninja Path Length Limit**:
  React Native New Architecture generates deeply nested C++ object paths. Gradle autolinking subdirectories have been shortened (`safear_b`, `rngest_b`, `rnrean_b`, `rnscre_b`, `rnsvg_b`, `rnwork_b`), keeping all object file paths under 240 characters (well below the Win32 260-character `_MAX_PATH` threshold).
- **Concurrency & JVM Configuration**:
  Gradle daemon memory is configured to `-Xmx3072m -XX:MaxMetaspaceSize=512m` with `org.gradle.workers.max=4` to prevent native memory exhaustion during C++ and Kotlin compilation.
