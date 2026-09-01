# Rhythmic-Routine 🌿

> **"Use your phone. Just don’t live in it."**

> [!IMPORTANT]
> **Experimental V1**
>
> Rhythmic-Routine is an experimental digital-wellbeing project.
> Android has been validated on physical hardware during V1 development.
> The iOS implementation remains experimental and has not yet been
> validated on physical Apple hardware.

**Rhythmic-Routine** is a **source-available** experimental digital-wellbeing application designed around **natural digital rhythm** rather than punitive daily screen-time quotas.

Personal, non-commercial use is permitted under the [Rhythmic-Routine Personal Use License](LICENSE).  
**Commercial use requires a separate commercial license.** See [Commercial Licensing](COMMERCIAL_LICENSE.md).

---

## 📱 Platform Readiness

| Platform | V1 Status | Verification State |
| :--- | :--- | :--- |
| **Android** | **Experimental V1** | **Physical hardware validated** (`PHYSICAL_DEVICE_VERIFIED`). Self-contained offline standalone APK. |
| **iOS** | **Experimental Foundation** | **Source-implemented architecture** — not physically tested or verified on Apple hardware. |
| **Web** | **Development & Demo** | Interactive browser demonstration and simulation environment. |

---

## 📸 Portfolio Mockups & Visual Identity

<div align="center">
  <img src="docs/portfolio-mockups/02-today-dashboard.png" width="220" alt="Today Dashboard" />
  <img src="docs/portfolio-mockups/03-routine.png" width="220" alt="Routine Configuration" />
  <img src="docs/portfolio-mockups/06-touch-grass-cooldown.png" width="220" alt="Touch Grass Cooldown" />
  <img src="docs/portfolio-mockups/05-risk-group-social-feeds.png" width="220" alt="Risk Group Social Feeds" />
</div>

*All high-resolution application screen mockups are available in [`docs/portfolio-mockups/`](docs/portfolio-mockups).*

---

## ✨ Core Pillars

1. **Morning Buffer** ⛅
   * Postpone morning doomscrolling by keeping distracting apps unavailable until your chosen waking boundary (e.g., 08:00 AM).
2. **Evening Wind-Down** 🌙
   * Help your mind disconnect before sleep by gently pausing social feeds and entertainment after your evening threshold (e.g., 21:30 PM).
3. **Risk Groups** 🛡️
   * Monitor related apps collectively (e.g. *X, Instagram, TikTok, Reddit, Discord* share continuous session limits: 18m X + 12m Instagram = 30m Social Feeds).
4. **Touch Grass Recovery** 🌱
   * Reaching a session threshold triggers an offline recovery period (e.g. 90 min) with feel-good grounding suggestions. Supports multiple concurrent group cooldowns.
5. **Calm Temporary Access Overrides** 🤝
   * Need urgent access? Grant a temporary override lease (e.g. 5–15 minutes). Restrictions on other groups and ongoing cooldowns continue running uninterrupted.
6. **Essential-App Invariant Safety** 🔒
   * Core utility apps (*Phone, Maps, Camera, Clock*) are strictly classified as **Essential** and are never restricted under any routine or cooldown.
7. **Local Insights & History** 📊
   * Real on-device telemetry and weekly consistency rollups with zero cloud tracking.

---

## 🏗️ Architecture & Control Flow

```text
UI (React Native / Expo Router)
        ↓
Zustand Store (Application State Projection)
        ↓
RhythmCoordinator (Lifecycle & Event Dispatcher + 15s Engine Clock)
        ↓
Pure TypeScript Rhythm Engine (State Machine, Reducer, Inactivity Tolerance, Access Leases)
        ↓
PlatformServices Layer (Usage, Restrictions, Storage, Permissions)
        ↓
Platform Adapters:
  ├── Storage: expo-sqlite (kv-store) on Native / WebStorageProvider on Web
  ├── Usage: Android UsageStatsManager / iOS DeviceActivity
  ├── Restrictions: Android RhythmEnforcementService & Overlay / iOS Screen Time ManagedSettingsStore
  ├── Insights: LocalInsightsRepository with bounded 14-day raw / 90-day summary retention
  └── Permissions: Truthful capability reporting ('enforced' vs 'foundation-only')
```

### 1. Pure TypeScript Rhythm Engine (`src/domain/rhythm/`)
* **Zero Dependencies:** Completely decoupled from React, Zustand, SQLite, or OS APIs.
* **Routine Resolution:** Evaluates real clock time, same-day windows, and cross-midnight routines across active weekdays.
* **Continuous Group Sessions & Inactivity Accounting:** Cumulative usage across member apps in a Risk Group with 5-minute inactivity gap tolerance.
* **Multi-Group Concurrent Cooldowns:** Manages independent cooldowns per Risk Group; expiring one group preserves active cooldowns on other groups.
* **Access Leases & Reason Union:** Tracks multi-reason restrictions (`routine` + `cooldown`) minus active temporary `AccessLease` suppressions.

### 2. Local-First Privacy (Zero Cloud Backend)
* **No Account:** No signup, email, login, or authentication required.
* **No Cloud Backend:** No remote servers, cloud databases, or API backends.
* **No Analytics SDKs:** Zero tracking pixels, telemetry frameworks, or event trackers.
* **No Ads:** Zero ad networks, monetization SDKs, or commercial tracking.
* **No Telemetry Upload:** Rhythmic-Routine does not transmit app inventory, usage history, routine configuration, or usage telemetry off-device.
* **App Inventory Remains Local:** Discovered launcher package names stay strictly in device memory.
* **Usage History Remains Local:** Stored exclusively in sandboxed local SQLite (`expo-sqlite`).

---

## 🚀 Tech Stack

* **Framework:** [Expo SDK 57](https://expo.dev) + [Expo Router](https://docs.expo.dev/router/introduction/)
* **UI & Components:** [React Native](https://reactnative.dev), [React Native Web](https://necolas.github.io/react-native-web/), [Lucide React Native](https://lucide.dev)
* **Local Persistence:** [expo-sqlite](https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/) (`expo-sqlite/kv-store`)
* **Native Modules:** Local Expo Module (`modules/rhythm-device/`) with Kotlin (Android) and Swift (iOS)
* **Config Plugins:** `plugins/withRhythmScreenTime.ts` (FamilyControls entitlement, App Groups, Xcode extension target synthesis)
* **State Management:** [Zustand](https://github.com/pmndrs/zustand)
* **Code Quality & Testing:** TypeScript, ESLint 9 (Expo Flat Config), Node Test Runner (`tsx`)

---

## 📦 Getting Started

### Installation
```bash
git clone https://github.com/Terinit-Technologies-Development/Rhythmic-Routine.git
cd Rhythmic-Routine
npm install
```

### Running the Development Server
```bash
# Start the web client (runs with full mock platform adapters and interactive state switcher)
npm run web

# Start Expo Go UI fallback (UI-only, truthful foundation mock)
npm run start:go

# Start Rhythm Development Client (Metro-backed, full local native modules)
npm run start:dev
```

### Android Build Modes & Physical Device QA
* **Canonical App Icon:** [`assets/rhythmic_routine_logo.png`](assets/rhythmic_routine_logo.png)
* **Development Client:** `app-debug.apk` backed by Metro (`adb reverse tcp:8081 tcp:8081 && npm run start:dev`). Note: `app-debug.apk` is **not** a standalone offline binary.
* **Standalone Phone QA:** `app-qaStandalone.apk` with embedded offline JavaScript bundle and `.qa` package ID. Runs without Metro or PC tethering.
* **Pass 04D V1 Manual Test Runbook:** See [`docs/qa/pass-04d-owner-v1-test.md`](docs/qa/pass-04d-owner-v1-test.md).
* **Architecture Runbook:** See [`docs/qa/pass-04c-owner-build-commands.md`](docs/qa/pass-04c-owner-build-commands.md) and [`docs/qa/android-runtime-build-modes.md`](docs/qa/android-runtime-build-modes.md).

### Quality & Testing Commands
```bash
# Run 104 domain, engine, access lease, insights, persistence, discovery, and overlay tests
npm test

# Run TypeScript typecheck
npm run typecheck

# Run ESLint check
npm run lint

# Export static production web bundle
npm run build:web
```

---

## 📄 Documentation

* [Architecture Guide](ARCHITECTURE.md)
* [Platform Setup & Build Instructions](PLATFORM_SETUP.md)
* [Privacy Architecture](PRIVACY.md)
* [Android Enforcement Architecture (ADR-003)](docs/architecture/ADR-003-android-enforcement.md)
* [iOS Screen Time Integration](docs/ios-screen-time.md)
* [Rhythm Engine Specification](docs/rhythm-engine.md)
* [Local Data Model & Storage](docs/local-data-model.md)
* [Contributing Guidelines](CONTRIBUTING.md)

---

## 📄 License

Rhythmic-Routine is **source-available**.

- **Personal/non-commercial use:** permitted under the [Rhythmic-Routine Personal Use License](LICENSE).
- **Commercial use:** requires a separate commercial license from Terinit Technologies. See [COMMERCIAL_LICENSE.md](COMMERCIAL_LICENSE.md).
- Earlier MIT-licensed history is documented in [LICENSE_HISTORY.md](LICENSE_HISTORY.md).

The Rhythmic-Routine name and logo are not licensed for unrestricted reuse. See [TRADEMARKS.md](TRADEMARKS.md).
