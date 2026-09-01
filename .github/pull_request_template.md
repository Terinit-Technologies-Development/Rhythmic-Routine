## Description

<!-- Briefly describe the rationale, architectural design, and impact of this change. -->

---

## Architectural & Privacy Verification

Please verify that your change conforms to project invariants:

- [ ] **Focused Scope:** PR addresses a single clear concern without unrelated refactoring.
- [ ] **Local-First Privacy Preserved:** No network endpoints, cloud analytics, tracking SDKs, or telemetry have been introduced.
- [ ] **Essential App Invariant Preserved:** Essential apps (*Phone, Maps, Emergency Utilities*) remain mathematically exempt from restrictions across all routines, cooldowns, and leases.
- [ ] **Pure Engine Separation:** State machine and domain transitions reside in `src/domain/rhythm/` as pure deterministic TypeScript.
- [ ] **Native Impact Documented:** Any Android/iOS native changes adhere to least-privilege permissions and are documented.

---

## Quality Checklist

- [ ] Automated tests added or updated (`src/domain/**/__tests__/`).
- [ ] `npm test` passed cleanly (100% test pass rate).
- [ ] `npm run typecheck` passed cleanly (0 type errors).
- [ ] `npm run lint` passed cleanly (0 lint errors/warnings).
- [ ] `npm run build:web` exported static bundle cleanly.

---

## Contributor License Agreement (CLA)

- [ ] **I agree to the terms of the [Contributor License Agreement](CONTRIBUTOR_LICENSE.md)** and confirm that this contribution is my original work and that Terinit Technologies may redistribute and license it under personal use and commercial licenses.
