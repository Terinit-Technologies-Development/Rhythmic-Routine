# Rhythmic-Routine 🌿

> **"Use your phone. Just don’t live in it."**

**Rhythmic-Routine** is an open-source digital wellbeing application designed around **natural digital rhythm** rather than punitive daily screen-time quotas.

Instead of locking you out of your device with arbitrary limits, Rhythm structures your day into intentional focus buffers, provides continuous-session recovery periods, and groups related scroll-heavy apps to protect your attention.

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
   * Reaching a session threshold triggers a mandatory offline recovery period (e.g. 90 min) with feel-good grounding suggestions.
5. **Essential-App Invariant Safety** 🔒
   * Core utility apps (*Phone, Maps, Camera, Clock*) are strictly classified as **Essential** and are never restricted under any routine or cooldown.

---

## 🏗️ Architecture: Pass 02 (Native Rhythm Engine & Local Foundation)

```text
UI (React Native / Expo Router)
        ↓
Zustand Store (Application State Projection)
        ↓
RhythmCoordinator (Lifecycle & Event Dispatcher)
        ↓
Pure TypeScript Rhythm Engine (State Machine & Reducer)
        ↓
PlatformServices Layer (Usage, Restrictions, Storage, Permissions)
        ↓
Platform Adapters:
  ├── Web / Test Mocks: MockUsageProvider, MockRestrictionProvider, MockStorageProvider
  ├── Android Native: UsageStatsManager (Bounded 15s query, AppOpsManager permission intent)
  └── iOS Native: FamilyControls (AuthorizationCenter), ManagedSettingsStore shield foundation
```

### 1. Pure TypeScript Rhythm Engine (`src/domain/rhythm/`)
* **Zero Dependencies:** Completely decoupled from React, Zustand, SQLite, or OS APIs.
* **Routine Resolution:** Evaluates real clock time, same-day windows, and cross-midnight routines (e.g. 22:00 to 06:30) across active weekdays.
* **Continuous Group Sessions:** Tracks cumulative usage across member apps in a Risk Group with a 5-minute inactivity gap tolerance.
* **Restriction Reason Union:** Tracks multi-reason restrictions (`routine` + `cooldown`) preventing premature unlocking when overlapping windows change.

### 2. Battery Discipline & Observation Model
* **No permanent tight JavaScript polling loops.**
* Android uses bounded 15-second interval reconciliation during active monitoring.
* iOS maps to native `FamilyControls` and `DeviceActivity` schedules without JavaScript battery drain.

### 3. Local-First Privacy (Zero Backend)
* **No Cloud Accounts / No Firebase / No Supabase / No Analytics Trackers.**
* 100% of routines, app classifications, active cooldown timestamps, and local history remain on the device.

---

## 🚀 Tech Stack

* **Framework:** [Expo SDK 57](https://expo.dev) + [Expo Router](https://docs.expo.dev/router/introduction/)
* **UI & Components:** [React Native](https://reactnative.dev), [React Native Web](https://necolas.github.io/react-native-web/), [Lucide React Native](https://lucide.dev)
* **Native Module:** Local Expo Module (`modules/rhythm-device/`) with Kotlin (Android) and Swift (iOS)
* **Vector Graphics & Artwork:** [React Native SVG](https://github.com/software-mansion/react-native-svg)
* **State Management:** [Zustand](https://github.com/pmndrs/zustand)
* **Code Quality & Testing:** TypeScript, ESLint 9 (Expo Flat Config), Node Test Runner (`tsx`)

---

## 📦 Getting Started

### Prerequisites
* Node.js `20.x` or higher
* npm or yarn

### Installation
```bash
git clone https://github.com/Terinit-Technologies-Development/Rhythmic-Routine.git
cd Rhythmic-Routine
npm install
```

### Running the Development Server
```bash
# Start the web client (runs with full mock platform adapters)
npm run web

# Start Expo dev client for mobile simulators
npm run start
```

### Quality & Testing Commands
```bash
# Run 36 domain, engine, persistence, and coordinator unit tests
npm test

# Run TypeScript typecheck
npm run typecheck

# Run ESLint check
npm run lint

# Export static production web bundle
npm run build:web
```

---

## 📱 Platform Specifics & Entitlement Notes

### Android
* **Usage Access:** Requires system authorization via `Settings.ACTION_USAGE_ACCESS_SETTINGS` (`PACKAGE_USAGE_STATS`). The Settings screen provides direct navigation to grant permission.
* **Restriction Enforcement:** Native restriction registry interface configured behind `RestrictionProvider`.

### iOS
* **Family Controls:** Implemented using `FamilyControls.AuthorizationCenter.shared.requestAuthorization(for: .individual)` and `ManagedSettingsStore`.
* **Apple Entitlement:** Production device shielding requires Apple's `com.apple.developer.family-controls` entitlement in your provisioning profile.

---

## 📄 License

MIT License. Free and open source for mindful digital wellbeing.
