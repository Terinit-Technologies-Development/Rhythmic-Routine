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

## 3. Android Native Setup

1. Generate the native Android project:
   ```bash
   npx expo prebuild --platform android
   ```
2. Build and run on an Android device or emulator:
   ```bash
   npx expo run:android
   ```
3. Grant permissions in Android Settings:
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
