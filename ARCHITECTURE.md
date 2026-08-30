# Rhythmic-Routine Architecture & Design

## System Overview

Rhythmic-Routine is architected with strict unidirectional data flow and clean separation of concerns:

```
┌───────────────────────────────────────────────────────────────┐
│                      UI Components & Screens                  │
│                (Today, Apps, Routine, Insights)               │
└──────────────────────────────┬────────────────────────────────┘
                               │ User Actions & Subscriptions
                               ▼
┌───────────────────────────────────────────────────────────────┐
│                      Zustand Prototype Store                  │
│                  (Pure Reactive State Projection)             │
└──────────────────────────────┬────────────────────────────────┘
                               │ Dispatches Actions
                               ▼
┌───────────────────────────────────────────────────────────────┐
│                      RhythmCoordinator                        │
│          (Engine Lifecycle, Clock Timer, Event Bus)           │
└──────────────┬───────────────────────────────┬────────────────┘
               │ Dispatches Events             │ Executes Effects
               ▼                               ▼
┌──────────────────────────────┐ ┌──────────────────────────────┐
│      Pure Rhythm Engine      │ │       Platform Services      │
│  - State Machine Reducer     │ │  - RestrictionProvider       │
│  - Session Accounting (5m)   │ │  - UsageProvider             │
│  - Multi-Group Cooldowns     │ │  - Local Storage (SQLite)    │
│  - Access Lease Overrides    │ │  - PermissionProvider        │
│  - Restriction Reason Union  │ │  - LocalInsightsRepository   │
│  - Essential-App Safety      │ └──────────────────────────────┘
└──────────────────────────────┘
```

## Key Invariants

1. **Unidirectional Control Flow:** UI never modifies engine runtime state directly. UI dispatches user actions to `RhythmCoordinator`, which passes events through the pure state reducer `processRhythmEvent`, updates runtime state, persists to local storage, executes side effects, and notifies listeners.
2. **Essential-App Safety:** Essential applications (Phone, Maps, Camera, Messages) are strictly excluded from restriction computations under all circumstances. If a user reclassifies an app as Essential, it is automatically purged from all Risk Groups.
3. **5-Minute Inactivity Tolerance:** If a user switches from a risk app to an essential app (e.g. checking a 2FA SMS code or phone call) and returns to the risk group within 5 minutes (300,000 ms), the session resumes from its previous elapsed time without resetting to 0. The gap period itself is not counted as risk usage.
4. **Independent Multi-Group Cooldowns:** Reaching a session threshold on Group A (e.g. Social Feeds) triggers a cooldown on Group A only, without interfering with ongoing sessions or cooldowns on Group B (e.g. Entertainment).
5. **Restriction-Reason Union:** An application remains restricted if at least one active reason (`routine` or `cooldown`) applies to its group, and no active `AccessLease` suppresses it.
6. **Intentional Access Leases:** Emergency or intentional overrides grant a temporary 5-minute window (`EMERGENCY_ACCESS_MINUTES = 5`) suppressing restrictions for the targeted group only. Active cooldowns continue running and automatically restore restrictions when the lease expires.
