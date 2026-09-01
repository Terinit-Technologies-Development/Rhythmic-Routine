# Rhythmic-Routine 🌿

> **"Use your phone. Just don’t live in it."**

**Rhythmic-Routine** is an open-source digital wellbeing application designed around **natural digital rhythm** rather than punitive daily screen-time quotas.

Instead of locking you out of your device with arbitrary limits, Rhythm structures your day into intentional focus buffers, provides continuous-session recovery periods, groups related scroll-heavy apps to protect your attention, and offers calm emergency overrides.

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
5. **Calm 5-Minute Access Overrides** 🤝
   * Need urgent access? Grant a 5-minute temporary override lease. Restrictions on other groups and ongoing cooldowns continue running uninterrupted.
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

### 2. Local-First Privacy (Zero Backend)
* **No Cloud Accounts / No Firebase / No Supabase / No Analytics Trackers.**
* Persisted locally using `expo-sqlite/kv-store` on native devices and browser storage on web.
* 100% of routines, app classifications, active cooldown timestamps, and local history remain on the physical device.

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
* **Owner Manual Runbook:** See [`docs/qa/pass-04c-owner-build-commands.md`](docs/qa/pass-04c-owner-build-commands.md) and [`docs/qa/android-runtime-build-modes.md`](docs/qa/android-runtime-build-modes.md).

### Quality & Testing Commands
```bash
# Run 53 domain, engine, access lease, insights, persistence, and deduplication unit tests
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

MIT License. Free and open source for mindful digital wellbeing.
