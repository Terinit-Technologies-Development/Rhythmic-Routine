# Apple App Store Privacy Inventory & Nutrition Label Responses

## 1. App Store Privacy Nutrition Label Overview

| Question | Selection | Technical Rationale |
| :--- | :--- | :--- |
| **Data Collection by App** | **Data Not Collected** | Rhythmic-Routine does not transmit any user data off the device. 100% of data is stored and processed locally. |
| **Tracking Across Apps & Websites** | **No** | The app does not track users across apps or websites owned by other companies. No IDFA or advertising identifiers are accessed. |
| **Third-Party Telemetry SDKs** | **None** | No analytics, crash reporting, or monetization SDKs are bundled. |

---

## 2. On-Device Data Usage Inventory

Apple App Store guidelines distinguish between **Data Collected (transmitted off-device)** and **Data Processed On-Device**. Rhythmic-Routine accesses and processes the following data locally on the user's device:

| Data Category | On-Device Processing Purpose | Off-Device Transmission? | Storage Location |
| :--- | :--- | :--- | :--- |
| **Screen Time / FamilyActivity Tokens** | Allows the user to select which apps belong to their Risk Groups and enables `ManagedSettings.ShieldSettings` to display system shields during active routines. | **STRICTLY NO (0 bytes)** | `UserDefaults(suiteName: "group.com.terinit.rhythmicroutine")`. Token contents remain opaque in system memory; tokens are never serialized into JS or logs. |
| **Routine & Group Configurations** | Stores user-configured schedules (Morning Buffer, Evening Wind-Down) and Risk Group limits (threshold minutes, cooldown minutes). | **STRICTLY NO (0 bytes)** | Application SQLite database via `expo-sqlite`. |
| **Session & Cooldown Timestamps** | Tracks when an active cooldown or Access Lease started and calculates absolute expiration (`endsAt`). | **STRICTLY NO (0 bytes)** | App Group `UserDefaults` and application SQLite database. |
| **Local Insights Aggregates** | Generates daily and 7-day focus adherence summaries, session counts, and protected time rollups for the user's review. | **STRICTLY NO (0 bytes)** | Application SQLite database. Raw events are pruned after 14 days; summaries are pruned after 90 days. |

---

## 3. Mandatory Apple Privacy Manifest (`PrivacyInfo.xcprivacy`)

In compliance with Apple's Spring 2024 privacy manifest requirements for third-party SDKs and required reason APIs:

### Required Reason API Usage
- **UserDefaults (System API Category `NSPrivacyAccessedAPICategoryUserDefaults`):**
  - Reason Code: `1C8F.1` (Access user defaults that are shared between an app and app extensions in the same App Group).
  - Main App (`app.config.ts` -> `ios.privacyManifests`): Declares `1C8F.1` for storing and reading shared rhythm state, activity selection references, and configuration signatures in `UserDefaults(suiteName: "group.com.terinit.rhythmicroutine")`.
  - Extension (`ios-targets/RhythmDeviceActivityMonitor/PrivacyInfo.xcprivacy`): Declares `1C8F.1` for reading routine configurations, active lease expiry times, and recording monitor status in the shared App Group.
  - Reason code `CA92.1` is deliberately not used because preferences are shared between the application and extension targets within the shared App Group rather than confined to a single isolated app container.

### Tracking Domains
- `NSPrivacyTracking`: `false`
- `NSPrivacyTrackingDomains`: `[]` (Empty)
- `NSPrivacyCollectedDataTypes`: `[]` (Empty — no data collected off-device)
