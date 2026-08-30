# Store Listing Copy & Metadata Draft

## 1. Store Metadata

- **Application Title:** Rhythmic-Routine
- **Subtitle / Short Description (Google Play - 80 chars max):**
  Mindful routine windows, session cooldowns, and local-only digital wellbeing.
- **Subtitle (Apple App Store - 30 chars max):**
  Mindful Routine Windows
- **Category:** Health & Fitness / Productivity / Digital Wellbeing
- **Content Rating:** Everyone (PEGI 3 / 4+)

---

## 2. Full Store Description

### Tagline
*“Use your phone. Just don’t live in it.”*

### Body Copy
Rhythmic-Routine is a calm, local-first digital wellbeing companion that replaces daily time-quota punishments with rhythmic routine windows and mindful session recovery breaks.

Instead of locking you out of your device after an arbitrary 30-minute timer or demanding parental-style PIN bypasses, Rhythmic-Routine focuses on rhythm:

### Key Capabilities

- 🌅 **Morning Buffer:**
  Start your day grounded. Keep high-distraction apps gently shielded during your morning waking routine while leaving phone, maps, and essential tools instantly accessible.

- 🌙 **Evening Wind-Down:**
  Protect your sleep hygiene with an intentional cross-midnight window that quiets feeds before bed.

- ⚡ **Risk Group Sessions & Cooldowns:**
  Organize high-friction apps into unified Risk Groups (like Social or Entertainment). If you use apps within a group continuously past your configured threshold, Rhythmic-Routine prompts a calming recovery break (Touch Grass) so your brain can reset.

- 🛡️ **Essential App Invariant:**
  Phone, Maps, Camera, and your designated essential tools are never restricted. Emergency and utility access is always guaranteed.

- ⏱️ **Mindful Access Leases:**
  Need to check something specific during a cooldown? Take an intentional, temporary Access Lease (15 minutes on iOS, 5–15 minutes on Android) that automatically restores protection when completed.

- 📊 **100% Private, Local Insights:**
  Review your continuous focus trends, cooldown intervals, and routine adherence. Your insights are calculated and stored entirely on your device using local SQLite.

---

## 3. Privacy & Honest Engineering Commitments

- **Zero Cloud Sync:** No accounts, no email signups, no remote servers, no cloud databases.
- **Zero Ads & Zero Trackers:** No telemetry SDKs, no advertising identifiers, no third-party data brokering.
- **Truthful Platform Capabilities:**
  - On **Android**: Real-time mindful interventions use Android’s AccessibilityService window state change observation. Screen text, keystrokes, messages, and passwords are never read or stored.
  - On **iOS**: Uses Apple’s Screen Time framework (FamilyControls, DeviceActivity, and ManagedSettings) for native system shielding.

---

## 4. What Rhythmic-Routine Is Not

To ensure complete transparency and policy compliance:
- Rhythmic-Routine is **not** an unbreakable kiosk blocker or child-lock parental control tool.
- Rhythmic-Routine is **not** a medical device, diagnosis tool, or addiction cure.
- Rhythmic-Routine is an intentional habit companion built for self-guided focus and mindful recovery.

---

## 5. Keywords / Tags

`digital wellbeing`, `screen time`, `routine buffer`, `mindful focus`, `app limiter`, `local only`, `open source`, `productivity`, `habits`

---

## 6. Release Notes (Version 1.0.0)
- Initial release candidate for Rhythmic-Routine.
- Full support for Morning Buffer and Evening Wind-Down routines.
- Multi-group continuous session tracking and independent cooldowns.
- Local SQLite Insights persistence with automatic summary rollup.
- Native enforcement via Android AccessibilityService and iOS Screen Time.
