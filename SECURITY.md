# Security Policy

Rhythmic-Routine is an experimental, local-first digital-wellbeing application. Because all data is stored strictly on-device without cloud infrastructure, user accounts, or remote telemetry, the attack surface is primarily focused on on-device data isolation and native platform permission boundaries.

---

## 1. Supported Versions

| Version | Supported | Notes |
| :--- | :--- | :--- |
| **1.0.x** | **Yes** | Active experimental release line. |
| **< 1.0.0** | No | Pre-release and proof-of-concept commits are not supported. |

---

## 2. Reporting a Vulnerability

If you believe you have found a security vulnerability or sensitive permission boundary defect:

1. **Do NOT Post Publicly:** Do not open a public GitHub issue or discuss exploitable vulnerabilities in public forums.
2. **Private Vulnerability Reporting (Preferred):** Use GitHub's **Private Vulnerability Reporting** feature on this repository if enabled.
3. **Direct Contact:** If private reporting is unavailable, contact the maintainers at `security@terinittechnologies.com`.
4. **Data Hygiene:** **Never** include device passwords, auth tokens, personal messages, or private application inventories in vulnerability reports. Use sanitized package identifiers (e.g. `com.example.app`) and synthetic logs.

---

## 3. Response Expectations & Scope

- **SLA:** Because Rhythmic-Routine is currently experimental software, Terinit Technologies does not offer a guaranteed response time or commercial service-level agreement (SLA) for vulnerability reports. We triage and remediate issues on a best-effort basis.
- **Experimental Notice:** Rhythmic-Routine is not security software, anti-malware, or hardened parental-control software. It does not claim to prevent deliberate circumvention by device owners who possess full device administrative control.
