# Google Play Store Data Safety Questionnaire Responses

## Data Collection & Sharing Overview

| Question | Response | Technical Details |
| :--- | :--- | :--- |
| **Does your app collect or share any user data?** | **No** (Data is processed locally on device only) | Rhythmic-Routine does not collect or transmit any user data off the device. All data remains inside application-private storage on the user's hardware. |
| **Is all data collected by your app encrypted in transit?** | **Not Applicable** | No data is transmitted across networks or off the device. |
| **Do you provide a way for users to request data deletion?** | **Yes** | Users can tap "Reset Local Storage & Engine State" directly within Settings or clear application storage in Android system settings. Since no data is stored remotely, this purges 100% of stored data. |

---

## Detailed Data Category Inventory

Google Play requires disclosure of data **accessed on-device** versus data **collected/transmitted off-device**.

### 1. App Activity / Device Activity

| Data Type | Accessed On-Device? | Collected / Transmitted Off-Device? | Purpose | Retention |
| :--- | :--- | :--- | :--- | :--- |
| **Installed Apps / Package Names** | **YES** | **NO** | To allow the user to select which applications belong to their custom Risk Groups. | Stored locally in SQLite. Never uploaded. |
| **Foreground App Window Identity** | **YES** | **NO** | To determine when a configured Risk App is opened during an active routine buffer or cooldown window in order to show the Touch Grass intervention. | Processed in real-time memory by `RhythmEnforcementService`. Never transmitted off-device. |
| **Usage Time & Session Duration** | **YES** | **NO** | To aggregate continuous foreground session time and compute daily usage insights for the user's personal review. | Stored locally in SQLite on-device. Compacted automatically (raw events purged after 14 days; daily rollups after 90 days). |

### 2. Personal Information (PII)

| Data Type | Accessed On-Device? | Collected Off-Device? | Notes |
| :--- | :--- | :--- | :--- |
| **Name, Email, Phone Number** | **NO** | **NO** | No user account, registration, login, or personal profile exists. |
| **User Identifiers / Device IDs** | **NO** | **NO** | No hardware IDs, advertising IDs, or telemetry identifiers are read or stored. |
| **Financial / Payment Information** | **NO** | **NO** | No purchases, subscriptions, payment gateways, or commerce integrations. |

### 3. Location, Photos, Audio, Messages, Keystrokes

| Data Type | Accessed? | Collected? | Notes |
| :--- | :--- | :--- | :--- |
| **Location (Precise or Coarse)** | **NO** | **NO** | No location permissions declared. |
| **Photos & Videos** | **NO** | **NO** | No media access permissions. |
| **Messages / Emails / SMS** | **NO** | **NO** | Accessibility service has `canRetrieveWindowContent="false"`. Strictly cannot inspect message content. |
| **Keystrokes / Typed Content** | **NO** | **NO** | No input tracking or keylogging capabilities. |

---

## Third-Party SDKs & Telemetry

| Category | Present in App? | Details |
| :--- | :--- | :--- |
| **Analytics SDKs (Google Analytics, Mixpanel, Amplitude, etc.)** | **NONE** | 0 analytics SDKs in `package.json` or native build files. |
| **Crash Reporting SDKs (Firebase Crashlytics, Sentry, Bugsnag, etc.)** | **NONE** | No external crash upload services. |
| **Advertising SDKs (AdMob, Unity Ads, AppLovin, etc.)** | **NONE** | Completely ad-free open-source software. |
| **Cloud Storage / Database Sync (Supabase, Firebase, AWS, etc.)** | **NONE** | All state is persisted via local `expo-sqlite` and Android `SharedPreferences`. |

---

## Play Console Form Filling Cheat-Sheet
- **Data Collection:** Select "No" (Explain: "App processes device activity locally for digital wellbeing routines; no data is transferred off the device").
- **Security Practices:** Data is not collected or transmitted off device.
- **Children's Privacy:** App is not directed primarily at children under 13.
