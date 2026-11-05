# SW-2026-005 test matrix

All results refer to the canonical source SHAs in EXECUTION_LEDGER.md. Baseline green suites are not blanket proof of PRD acceptance. No physical-device tests performed or owner phone access requested.

Routine baseline: npm test 423/423 PASS; typecheck PASS; lint PASS; generated Android prebuild PASS. Native suites in progress, exact logs adjacent. No APK acceptance yet.

| ID | Required case | Current evidence/status |
|---|---|---|
| T01 | Mon–Fri schedule, Sat/Sun disabled: separate Attention Day boundary on Sat and Sun; no Friday-to-Monday stretched counters. | BASELINE FAILURE REPRODUCED (JS); remediation not implemented |
| T02 | Sat/Sun morning/evening inactive: windows don't restrict by schedule, risk-group allowance and cooldown still function. | NOT VERIFIED |
| T03 | Sunday→Monday, Friday→Saturday and local 23:59→00:01: expected boundaries and no unintended resets. | NOT VERIFIED |
| T04 | Empty activeDays, malformed time, disabled window, same-day/cross-midnight windows: one consistent interpretation in TS and native. | NOT VERIFIED |
| T05 | DST 23h/25h day, device time-zone change and manual clock-forward/back: deterministic boundary without invented completed meditation minutes. | BASELINE FAILURE REPRODUCED (JS); remediation not implemented |
| T06 | Mid-gate schedule edit and in-place upgrade: preserve correct gate, ordinal, completion, cohort/substitution cap and cooldown end. | NOT VERIFIED |
| T07 | Morning eligible-day transition: one required session ID, managed nonessential blocked, Essential and companions reachable. | NOT VERIFIED |
| T08 | Morning 29:59 cancelled/paused/expired/wrong-session: hold remains; exact 30m completed qualified session releases. | NOT VERIFIED |
| T09 | Force-stop Routine/Meditation, screen off, resume, process death and reboot: no phantom credit/duplicate morning requirement. | NOT VERIFIED |
| T10 | Morning release does not consume one of two cooldown Meditation substitutions. | NOT VERIFIED |
| T11 | CD1/CD2: 90m separation only; no restorative obligation. | NOT VERIFIED |
| T12 | CD3: 3600s and 36 qualified pages cumulative Reader V2 required; one short dimension fails. | NOT VERIFIED |
| T13 | CD4 Reader: 1800s AND 11 pages in the EXACT bound V1 session; daily V2 aggregate alone does not satisfy. | NOT VERIFIED |
| T14 | CD4 Meditation: 1800s monotonic in EXACT bound V1 session; wrong ID/protocol/partial time fails. | NOT VERIFIED |
| T15 | Provider selected then re-tapped/returned/relaunched: same idempotent session binding; no double consumption. | NOT VERIFIED |
| T16 | Reader/Meditation switch before progress and attempted switch after progress: approved lock rules enforced. | NOT VERIFIED |
| T17 | Complete activity before timer expiry: cooldown continues until original end; complete cooldown before activity: gate remains enforced. | NOT VERIFIED |
| T18 | Missing provider, bad signature, denied signature-level IPC, unknown session, malformed response: cannot fail open; actionable diagnostics. | NOT VERIFIED |
| T19 | Same-signed Routine↔Meditation↔Reader: valid neutral projection is connected even with no active gates; #13 reproducible and closed with evidence. | NOT VERIFIED |
| T20 | Native module missing or simulated success: never report ENFORCED; persisted Risk policy and live intervention proved for actual risk package. | NOT VERIFIED |
| T21 | Multiple groups/cooldowns, device/JS state import, process restart: no gate loss or cross-group evidence leakage. | NOT VERIFIED |
| T22 | Android 16/API 36 on available owner test hardware; package/install upgrade with versionCode monotonic and identical expected signer. | NOT VERIFIED |
| T23 | All previously green Routine JS and Android native, Reader unit/instrumentation, and Meditation unit/instrumentation tests remain green or document environmental limitation accurately. | NOT VERIFIED |
| T24 | Adversarial Essential-app exercise, access lease and provider spoof attempt: essential safety preserved and no ordinary lease bypasses compulsory morning gate. | NOT VERIFIED |
| T25 | UI screenshot review: displayed requirement, provider, cooldown and connection state agree with logged native truth. | NOT VERIFIED |

For every implementation pass, replace each applicable status with pinned revision, command/test identity, result, device scope and artifact hashes. Keep physical and deterministic results separate. T22 and runtime T07–T25 device assertions cannot pass from static source or synthetic provider completions.
