# Contributing to Rhythmic-Routine

We welcome contributions to Rhythmic-Routine!

## Development Guidelines

1. **Local-First & Zero-Telemetry:** Never add remote server dependencies, analytics trackers, user authentication, or cloud databases.
2. **Pure TypeScript Rhythm Engine:** All domain business logic, state transitions, inactivity gaps, and restriction reason unions must live in `src/domain/` as pure, deterministic TypeScript with comprehensive unit tests.
3. **Essential-App Safety:** Never compromise the invariant that essential apps (Phone, Maps, Utilities) are completely unblockable.
4. **Code Quality:** All PRs must pass `npm run lint`, `npm run typecheck`, and `npm test`.

## Pull Request Process

1. Create a feature branch from `master`.
2. Ensure test coverage for all new state machine paths or platform adapters.
3. Run `npm test && npm run lint && npm run typecheck`.
4. Submit a descriptive Pull Request.
