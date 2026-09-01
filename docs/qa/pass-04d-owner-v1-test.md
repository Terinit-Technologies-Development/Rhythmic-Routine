# Pass 04D — Owner V1 Android Build & Physical Device Test Runbook

> **Target Status:** `V1_CANDIDATE` (Awaiting Owner Physical Device Confirmation)
> **Branch:** `qa/pass-04-device-release-validation`
> **Artifact Produced:** `android/app/build/outputs/apk/qaStandalone/app-qaStandalone.apk`
> **Package ID:** `com.terinit.rhythmicroutine.qa`

---

## 1. Owner Manual Build Instructions (PowerShell)

Execute the following commands in order from the repository root:

```powershell
# 1. Clean reproducible dependency install
npm ci

# 2. Clean native project prebuild (regenerates AndroidManifest with launcher queries and styles)
npx expo prebuild --platform android --clean --no-install

# 3. Enter Android native build directory
cd android

# 4. Clean previous build artifacts
.\gradlew.bat clean

# 5. Compile the canonical standalone QA APK
.\gradlew.bat assembleQaStandalone -PreactNativeArchitectures=arm64-v8a --console=plain
```

---

## 2. Locate, Verify & Install APK

Return to the repository root and inspect the compiled output:

```powershell
# 1. Return to project root
cd ..

# 2. Locate the freshly generated standalone APK
Get-ChildItem -Recurse .\android\app\build\outputs\apk -Filter *.apk |
  Sort-Object LastWriteTime -Descending |
  Select-Object FullName, Length, LastWriteTime

# 3. Strictly verify the APK structure (must pass all 7 standalone invariants)
node .\scripts\verify-android-qa-apk.mjs ".\android\app\build\outputs\apk\qaStandalone\app-qaStandalone.apk"

# 4. Install onto your connected Android phone via ADB
adb install -r ".\android\app\build\outputs\apk\qaStandalone\app-qaStandalone.apk"
```

---

## 3. Owner V1 Physical Device Test Checklist

Complete each verification step on your physical Android phone:

### Test 1: Full Launcher App Discovery
- [ ] Open Rhythm (`com.terinit.rhythmicroutine.qa`).
- [ ] Navigate to the **Apps** tab.
- [ ] Tap the **Refresh** icon button next to the count badge.
- [ ] **Completeness:** Ordinary user-launchable apps installed on your phone (e.g. Chrome, YouTube, Instagram, WhatsApp, Spotify) are now visible in the list.
- [ ] **No Hidden Junk:** Background system services, providers, and non-launchable components are NOT listed.
- [ ] **Deduplication:** No duplicate rows appear for apps with multiple internal activities.
- [ ] **Self-Exclusion:** Rhythm itself is not present in the selectable list.
- [ ] **Search:** Searching by app name, category, or package name (e.g., `com.instagram`) locates the expected app.
- [ ] **Count Badge:** Header displays `XX launchable apps` with the profile privacy note.

### Test 2: Classification Persistence
- [ ] In the **Apps** tab, assign:
  - 2 apps to **Risk** (e.g. Instagram and YouTube in Social/Entertainment)
  - 1 app to **Essential** (e.g. Phone or Maps)
  - 1 app to **Normal** (e.g. Chrome)
- [ ] Force close Rhythm and reopen it.
- [ ] Verify all classifications and group memberships remain intact.

### Test 3: Evening Wind-Down Intervention
- [ ] In the **Routine** tab, temporarily configure **Evening Wind-Down** so that the start time is 5 minutes before current time, and end time is 20 minutes in the future.
- [ ] Ensure **Social** is marked as protected.
- [ ] Verify Accessibility service is enabled in Android Settings.
- [ ] Open the assigned Social app from your home screen.
- [ ] **Result:** The full-screen **Touch Grass** screen appears immediately.
- [ ] **Visuals:** The overlay is completely opaque with `#FAF7F0` calm background; the restricted app is NOT readable underneath.
- [ ] **Copy:** Displays *"This app is paused by your current Rhythm window or recovery cooldown."*

### Test 4: Already-Foreground Routine Start (Critical Verification)
- [ ] Configure Evening Wind-Down to start **1 to 2 minutes in the future**.
- [ ] Open the assigned Social app **BEFORE** the start time arrives.
- [ ] Stay actively inside the Social app.
- [ ] Wait for the clock to cross into the Wind-Down window.
- [ ] **Result:** Touch Grass appears over the app automatically without requiring you to leave and re-enter the app.

### Test 5: Back Navigation Routes to Home
- [ ] With Touch Grass visible, press the Android system **Back** button (or back gesture).
- [ ] **Result:** You are returned directly to your Android **Home screen**.
- [ ] **Invariant:** The restricted app is NOT revealed underneath.
- [ ] Try opening the restricted app again from launcher -> Touch Grass immediately returns.

### Test 6: Unrestricted & Essential App Controls
- [ ] During the active Wind-Down, open an app classified as **Normal** -> Opens normally.
- [ ] Open an app classified as **Essential** (e.g. Phone, Maps) -> Opens normally with zero interruption.

### Test 7: Main App Swiped Away
- [ ] While Wind-Down is active, open the app switcher (Recents) and swipe Rhythm away. *(Do NOT tap "Force Stop" in Android Settings).*
- [ ] Open the restricted app from your launcher.
- [ ] **Result:** `RhythmEnforcementService` still intercepts and presents Touch Grass.

### Test 8: Accessibility Service Disable / Re-enable
- [ ] In Android Settings > Accessibility, toggle Rhythm off.
- [ ] Open the restricted app -> App opens without overlay; Rhythm Settings reports capability as `foundation-only`.
- [ ] Re-enable Rhythm in Accessibility Settings.
- [ ] Open the restricted app -> Touch Grass immediately returns; Settings reports capability as `enforced`.

### Test 9: Temporary Access Lease
- [ ] Open Rhythm and trigger a temporary **Access Lease** (or Emergency Bypass) for the Social group.
- [ ] Open the restricted Social app -> Opens normally.
- [ ] Remain in the app until the lease expires.
- [ ] **Result:** Touch Grass immediately reappears when the lease expires.

### Test 10: Auto-Close When Window Ends
- [ ] Leave Touch Grass visible on screen near the end of the temporary Wind-Down window.
- [ ] When the scheduled window ends:
- [ ] **Result:** Touch Grass overlay automatically finishes and closes without manual dismissal.

---

## 4. Optional Live Diagnostics

To view technical logs during testing:

```powershell
# Clear old log buffer
adb logcat -c

# Monitor enforcement events in real time
adb logcat | Select-String "RhythmEnforcement|RhythmOverlay|AndroidRuntime"
```

Or open Rhythm **Settings > Experimental Diagnostics** on your phone to view live service status, restricted package count, active lease count, and last intervention details.
