# Rhythm Engine Specification

The Rhythm Engine (`src/domain/rhythm/`) is a pure, deterministic TypeScript domain state machine.

## State Priority Hierarchy
When multiple routines or sessions overlap, the high-level application state resolves according to strict precedence:

1. **`evening-wind-down`**: Evening routine window active (highest priority).
2. **`morning-buffer`**: Morning buffer routine window active.
3. **`cooldown`**: At least one active risk group cooldown.
4. **`risk-session`**: Active continuous foreground session on a risk group.
5. **`available`**: Normal daytime state.

## Core Reducer: `processRhythmEvent`
Takes `(currentRuntime, event, config)` and outputs `{ nextRuntime, effects }`.
Side effects (e.g. `APPLY_RESTRICTIONS`, `CLEAR_RESTRICTIONS`, `RECORD_HISTORY`) are returned as pure descriptors to be executed by `RhythmCoordinator` on platform adapters.
