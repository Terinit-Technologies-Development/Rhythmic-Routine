# Local Data Model & Storage Specification

Rhythmic-Routine uses a strictly local storage layer (`expo-sqlite` key-value store on native, `localStorage` on web).

## Key-Value Storage Schema

| Key | Type | Description |
|-----|------|-------------|
| `rhythm_preferences` | JSON | User configuration: RoutineWindows, RiskGroups, App classifications, 5m gap tolerance. |
| `rhythm_runtime_state` | JSON | Persisted runtime state: active cooldowns map, active access leases, routine IDs, timestamps. |
| `rhythm_history_log` | JSON Array | Bounded event log of timestamped rhythm events (cooldowns, sessions, access leases). |

## Compaction & Retention
* **Raw Events:** Retained for 14 days.
* **Daily Aggregated Summaries:** Retained for 90 days.
* **Reset:** Clearing storage via Settings erases all keys without residual state.
