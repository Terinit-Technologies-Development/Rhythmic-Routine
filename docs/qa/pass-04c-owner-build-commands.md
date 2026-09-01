# Pass 04C — Owner Manual Build & Installation Runbook

> **IMPORTANT**: All commands in this document are to be executed manually by the repository owner on the development machine and connected physical device. The automated agent has validated all configurations at source level and MUST NOT execute these commands.

---

## Phase 1: Environment & Project Preparation

Ensure you are in the repository root directory `D:\Desktop\Rhythmic-Routine` and your working tree is clean:

```powershell
# 1. Verify git branch and commit status
git status
git log -1 --oneline

# 2. Verify clean dependency installation
npm ci

# 3. Clean and regenerate native Android project using Expo Config Plugins
npx expo prebuild `
  --platform android `
  --clean `
  --no-install
```

---

## Phase 2: Compile Standalone QA APK

Compile the standalone QA APK targeting the physical device's 64-bit ARM architecture. The React Native Gradle Plugin will automatically bundle the JavaScript code and assets:

```powershell
# 1. Navigate to android directory
cd android

# 2. Clean previous build artifacts
.\gradlew.bat clean

# 3. Compile the qaStandalone build variant
.\gradlew.bat assembleQaStandalone `
  -PreactNativeArchitectures=arm64-v8a `
  --console=plain
```

> **What to observe**: Look for task `:app:createBundleQaStandaloneJsAndAssets` in the build output. This proves React Native is bundling the offline JavaScript bundle and embedding it into the APK.

---

## Phase 3: Locate Compiled APK

Return to the project root and locate the output APK:

```powershell
cd ..

Get-ChildItem `
  -Recurse `
  .\android\app\build\outputs\apk `
  -Filter *.apk |
  Sort-Object LastWriteTime -Descending |
  Select-Object `
    FullName,
    Length,
    LastWriteTime
```

**Expected Directory**: `android\app\build\outputs\apk\qaStandalone\`  
**Expected Filename**: `app-qaStandalone.apk` (or similar variant name, with size > 15MB)

---

## Phase 4: Verify Embedded Bundle & Package Identity

Run the standalone verification script with the absolute path to the compiled APK:

```powershell
node .\scripts\verify-android-qa-apk.mjs `
  ".\android\app\build\outputs\apk\qaStandalone\app-qaStandalone.apk"
```

**Expected Result**:
```text
[verify-android-qa-apk] Verifying Android QA Standalone APK packaging...
  ✓ Target APK found: ...
  ✓ APK size verified: XX.XX MB (...)
  ✓ QA variant name verified: app-qaStandalone.apk
  ✓ Embedded JS asset verified: "assets/index.android.bundle" is packaged inside APK
  ✓ Application ID verified via aapt: "com.terinit.rhythmicroutine.qa"
  ✓ Version name suffix verified via aapt: "1.0.0-qa"
[verify-android-qa-apk] All Android Standalone QA APK checks passed successfully.
```

---

## Phase 5: Install APK on Physical Device

Ensure your device is connected via USB with Developer Mode and USB Debugging enabled:

```powershell
# 1. Check connected devices
adb devices

# 2. Stream install the QA APK onto the phone
adb install -r `
  ".\android\app\build\outputs\apk\qaStandalone\app-qaStandalone.apk"
```

> **If signature or update conflict occurs** (due to previous test installs):
> ```powershell
> adb uninstall com.terinit.rhythmicroutine.qa
> adb install ".\android\app\build\outputs\apk\qaStandalone\app-qaStandalone.apk"
> ```

---

## Phase 6: Prove No-Metro Standalone Execution

Before launching the app, ensure all Metro/Expo processes and port forwards are completely closed:

```powershell
# 1. Remove all active reverse port tunnels
adb reverse --remove-all
```

2. **Close all terminal windows running Metro or Expo CLI** (`npx expo start`, `npm run start:dev`, etc.).
3. **Optionally disconnect the phone from USB.**
4. **On your phone, tap the "Rhythmic-Routine QA" launcher icon.**

**Success Criteria**:
- App launches immediately on tap.
- New brand logo (`rhythmic_routine_logo`) is displayed on the launcher and splash.
- The Today screen renders immediately.
- SQLite database initializes locally.
- Tab navigation between Today, Routine, Insights, and Settings works smoothly.
- **NO** Metro connection prompt appears.
- **NO** `localhost:8081` connection errors.
- **NO** "Unable to load script" error screen.

---

## Phase 7: Optional ADB Headless Launch

If launching via ADB:

```powershell
adb shell monkey `
  -p com.terinit.rhythmicroutine.qa `
  -c android.intent.category.LAUNCHER `
  1
```

---

## Phase 8: Diagnostics & Troubleshooting

If unexpected behavior occurs, collect logcat diagnostics:

```powershell
# 1. Clear old logs
adb logcat -c

# 2. Launch the app and filter relevant tags
adb logcat |
  Select-String `
    "ReactNativeJS|AndroidRuntime|Rhythm|SoLoader|JSBundle"

# 3. Inspect installed package details
adb shell dumpsys package `
  com.terinit.rhythmicroutine.qa

# 4. Confirm installed packages on device
adb shell pm list packages |
  Select-String rhythmic
```

---

## Phase 9: App Icon Device Checklist

Inspect the physical phone screen and verify each item:

- [ ] Launcher displays the new `rhythmic_routine_logo` mark.
- [ ] No default Expo triangle logo is shown.
- [ ] No old geometric placeholder icon is shown.
- [ ] Launcher adaptive mask (circle on Pixel, squircle on Samsung) displays cleanly without clipping the central motif.
- [ ] App switcher (recent tasks) displays the correct new logo.
- [ ] Settings > Apps > Rhythmic-Routine QA displays the correct logo and `#F8F4E8` background.
