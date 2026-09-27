package expo.modules.rhythmdevice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Pass 3 — native Restorative enforcement projection tests (pure JVM).
 * Fail-closed: malformed data never widens enforcement.
 */
class RestorativeEnforcementTest {

    private fun gateMap(
        groupId: String = "social",
        requirementKind: String = "restorative-choice",
        status: String = "in-progress"
    ): Map<String, Any?> = mapOf(
        "gateId" to "gate-ad-20260927-0730-social-o4",
        "groupId" to groupId,
        "attentionDayId" to "ad-20260927-0730",
        "dailyCooldownOrdinal" to 4,
        "createdAt" to 1L,
        "cooldownEndsAt" to 2L,
        "requirementKind" to requirementKind,
        "selectedProvider" to "meditation",
        "providerSessionId" to "m1",
        "status" to status,
        "requiredReadingSeconds" to 1800,
        "requiredQualifiedPages" to 11,
        "requiredMeditationSeconds" to 1800
    )

    @Test
    fun `satisfied gate does not hold its group while in-progress does`() {
        val snapshot = RestorativeEnforcement.parse(
            mapOf("activeRestorativeGates" to listOf(gateMap(status = "satisfied")))
        )
        assertFalse(snapshot.hasRestorativeHold("social"))

        val open = RestorativeEnforcement.parse(
            mapOf("activeRestorativeGates" to listOf(gateMap(status = "in-progress")))
        )
        assertTrue(open.hasRestorativeHold("social"))

        val pending = RestorativeEnforcement.parse(
            mapOf("activeRestorativeGates" to listOf(gateMap(status = "pending-selection")))
        )
        assertTrue(pending.hasRestorativeHold("social"))
    }

    @Test
    fun `kind none never holds and unknown kinds are rejected`() {
        val none = RestorativeEnforcement.parse(
            mapOf("activeRestorativeGates" to listOf(gateMap(requirementKind = "none")))
        )
        assertFalse(none.hasRestorativeHold("social"))

        val unknown = RestorativeEnforcement.parse(
            mapOf("activeRestorativeGates" to listOf(gateMap(requirementKind = "something-else")))
        )
        assertFalse(unknown.hasRestorativeHold("social"))
    }

    @Test
    fun `morning focus holds managed apps but never companions`() {
        val snapshot = RestorativeEnforcement.parse(
            mapOf(
                "morningMeditation" to mapOf(
                    "attentionDayId" to "ad-20260928-0730",
                    "sessionId" to "morning-ad-20260928-0730",
                    "requiredQualifiedSeconds" to 1800,
                    "satisfied" to false
                )
            )
        )
        assertTrue(snapshot.morningFocusActive)
        assertTrue(snapshot.isCompanionPackage("com.terinit.rhythmicmeditation"))
        assertTrue(snapshot.isCompanionPackage("com.terinit.rhythmicroutine"))
        assertFalse(snapshot.isCompanionPackage("com.instagram.android"))
    }

    @Test
    fun `satisfied morning ends the focus`() {
        val snapshot = RestorativeEnforcement.parse(
            mapOf(
                "morningMeditation" to mapOf(
                    "attentionDayId" to "ad-20260928-0730",
                    "sessionId" to "morning-ad-20260928-0730",
                    "requiredQualifiedSeconds" to 1800,
                    "satisfied" to true
                )
            )
        )
        assertFalse(snapshot.morningFocusActive)
    }

    @Test
    fun `missing or malformed data parses to fail-closed defaults`() {
        val empty = RestorativeEnforcement.parse(emptyMap())
        assertNull(empty.attentionDay)
        assertNull(empty.morningMeditation)
        assertFalse(empty.morningFocusActive)
        // The companion allowlist is ALWAYS present, regardless of payload.
        assertTrue(empty.isCompanionPackage("com.terinit.rhythmicmeditation"))

        val malformed = RestorativeEnforcement.parse(
            mapOf(
                "activeRestorativeGates" to listOf("not-a-map", null, mapOf("groupId" to "social")),
                "attentionDay" to "not-a-map",
                "morningMeditation" to mapOf("sessionId" to "x"),
                "officialCompanionPackages" to listOf(null, "", "com.example.app")
            )
        )
        assertEquals(0, malformed.restorativeGates.size)
        assertNull(malformed.attentionDay)
        assertNull(malformed.morningMeditation)
        assertTrue(malformed.isCompanionPackage("com.example.app"))
    }

    @Test
    fun `json round trip preserves the enforcement snapshot`() {
        val original = RestorativeEnforcement.parse(
            mapOf(
                "activeRestorativeGates" to listOf(gateMap()),
                "attentionDay" to mapOf("id" to "ad-20260927-0730"),
                "morningMeditation" to mapOf(
                    "attentionDayId" to "ad-20260928-0730",
                    "sessionId" to "morning-ad-20260928-0730",
                    "requiredQualifiedSeconds" to 1800,
                    "satisfied" to false
                ),
                "officialCompanionPackages" to listOf("com.terinit.rhythmicmeditation")
            )
        )
        val restored = RestorativeEnforcement.fromJson(
            RestorativeEnforcement.toJson(original).toString()
        )
        assertEquals(original.restorativeGates, restored.restorativeGates)
        assertEquals(original.attentionDay?.id, restored.attentionDay?.id)
        assertEquals(original.morningMeditation?.sessionId, restored.morningMeditation?.sessionId)
        assertEquals(original.companionPackages, restored.companionPackages)
        assertTrue(restored.hasRestorativeHold("social"))

        // Corrupt storage never widens enforcement.
        val corrupt = RestorativeEnforcement.fromJson("{not json")
        assertEquals(0, corrupt.restorativeGates.size)
        assertNull(corrupt.morningMeditation)
        assertNotNull(RestorativeEnforcement.fromJson(null))
    }
}
