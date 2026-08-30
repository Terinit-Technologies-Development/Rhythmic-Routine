# Google Play Store AccessibilityService Policy Declaration Draft

## Application Information
- **Application Name:** Rhythmic-Routine
- **Package Name:** `com.terinit.rhythmicroutine`
- **Declared Service:** `expo.modules.rhythmdevice.RhythmEnforcementService`
- **Permission:** `android.permission.BIND_ACCESSIBILITY_SERVICE`

---

## 1. Core Purpose of Accessibility Service Use

Rhythmic-Routine is a local-first digital wellbeing application designed to help users maintain intentional habits through structured routine buffer windows and Risk Group cooldowns.

The application uses Android's AccessibilityService API for the sole purpose of **detecting when a user-configured Risk App enters the foreground** during an active restriction period (such as a Morning Buffer, Evening Wind-Down, or an active session cooldown) in order to display a calm, fullscreen mindful intervention ("Touch Grass").

---

## 2. Specific Accessibility API Capabilities Used

| Capability / Event | Utilized? | Technical Specification & Usage Justification |
| :--- | :--- | :--- |
| **`TYPE_WINDOW_STATE_CHANGED`** | **YES** | Used exclusively to read the foreground package identifier (`packageName`) when a window transition occurs. |
| **`canRetrieveWindowContent`** | **NO (`false`)** | The service configuration explicitly sets `canRetrieveWindowContent="false"`. The service has no ability to inspect window hierarchies or read screen text. |
| **Keystroke / Input Logging** | **NO** | No flag or method for keystroke monitoring, touch event capture, or input logging is implemented. |
| **Automated UI Gestures / Remote Control** | **NO** | The service does not perform clicks, swipes, text entry, or automated navigation. |
| **Settings / System Automation** | **NO** | The service does not modify system settings, prevent app uninstallation, or circumvent OS security controls. |

---

## 3. Clear Demarcation: Data Accessed vs. Data Not Accessed

### Data Accessed On-Device:
- **Foreground Package Name:** The identity of the currently active app package is observed in real-time.
- **Timestamp of Window Transition:** To calculate continuous session duration within a user-defined Risk Group.

### Data Strictly NOT Accessed:
- **Screen text and displayed content:** Never read, parsed, or processed.
- **Personal messages, chats, and emails:** Never inspected.
- **Passwords, PINs, and authentication tokens:** Never inspected.
- **Form fields and user input:** Never observed or recorded.
- **Audio, microphone, or camera data:** Never accessed (no permissions declared).

---

## 4. Local-Only Data Handling & Privacy Guarantee

- **Zero Cloud Transmission:** Rhythmic-Routine has no backend servers, no user accounts, no authentication SDKs, no cloud sync, and no third-party telemetry or advertising SDKs.
- **On-Device Evaluation:** All routine evaluations, session timers, and cooldown calculations occur 100% locally on the device inside `RhythmEngine`.
- **Local Storage:** Configuration and aggregated summary insights are stored strictly on-device in application-private storage (`SQLite` and `SharedPreferences`).

---

## 5. Prominent In-App Disclosure & Affirmative User Consent

Prior to directing the user to Android's system Accessibility Settings, Rhythmic-Routine presents an unmissable, prominent in-app disclosure modal.

### Disclosure Requirements Met:
1. **Prominent Placement:** Appears within the normal user flow in Settings upon tapping "Enable Intervention".
2. **Explicit Explanation:** Explains what is observed (foreground package identity), why it is observed (to trigger Touch Grass during active routines/cooldowns), and what is NOT observed (screen content, messages, passwords).
3. **No Coercion:** Explicitly provides two clear buttons:
   - **"Cancel"**: Closes the dialog without opening system settings.
   - **"I Understand — Enable Intervention"**: Confirms informed consent and routes the user to `android.settings.ACCESSIBILITY_SETTINGS`.
4. **Honest Classification:** Prominently discloses that Rhythmic-Routine is **not** an assistive technology tool designed primarily for people with disabilities, and does not declare `android:isAccessibilityTool="true"`.

---

## 6. Why Alternative APIs Are Insufficient

- **`UsageStatsManager` (Usage Access):** `UsageStatsManager` provides historical aggregated polling data. Android limits the frequency and immediacy of usage event broadcasts. Polling `UsageStatsManager` operates on a delayed interval (10–15 seconds) which cannot deliver an immediate, synchronous intervention at the moment a restricted application is opened.
- **Combination Architecture:** Rhythmic-Routine uses `UsageStatsManager` for passive aggregate background statistics, but requires `AccessibilityService` (`TYPE_WINDOW_STATE_CHANGED`) to provide real-time, deterministic intervention delivery when a cooldown is active.
