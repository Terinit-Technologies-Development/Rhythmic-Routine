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
    fun `restorative hold expires only when the active attention day changes`() {
        val snapshot = RestorativeEnforcement.parse(
            mapOf(
                "activeRestorativeGates" to listOf(gateMap(status = "in-progress")),
                "attentionDay" to mapOf(
                    "id" to "ad-20260927-0730",
                    "nextBoundaryAt" to 1_790_000_000_000L,
                ),
            )
        )
        assertTrue(snapshot.hasRestorativeHold("social", "ad-20260927-0730"))
        assertFalse(snapshot.hasRestorativeHold("social", "ad-20260928-0730"))
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
                    "satisfied" to true,
                    "satisfiedAt" to 1L
                )
            ),
            trustNativeCompletionMarker = true,
        )
        assertFalse(snapshot.morningFocusActive)
    }

    @Test
    fun `naked js satisfied flag never clears the native hold`() {
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
        assertTrue(snapshot.morningFocusActive)
        assertNull(snapshot.morningMeditation?.satisfiedAt)
    }

    @Test
    fun `persisted native marker remains trusted after restart while forged projection does not`() {
        val persisted = RestorativeEnforcement.fromJson(
            """{"morningRequirements":[{"attentionDayId":"ad-20260928-0830","sessionId":"morning-ad-20260928-0830","requiredQualifiedSeconds":1800,"createdAt":1,"satisfied":true,"satisfiedAt":2,"sourceRhythmicDayId":"ad-20260928-0830","sessionKind":"MORNING_REQUIRED"}]}"""
        )
        assertFalse(persisted.morningFocusActive)
        assertEquals(2L, persisted.allMorningRequirements().single().satisfiedAt!!)

        val forged = RestorativeEnforcement.parse(
            mapOf(
                "morningMeditation" to mapOf(
                    "attentionDayId" to "ad-20260928-0830",
                    "sessionId" to "different-session",
                    "requiredQualifiedSeconds" to 1800,
                    "satisfied" to true,
                    "satisfiedAt" to 2L,
                )
            )
        )
        assertTrue(forged.morningFocusActive)
    }

    @Test
    fun `stale js publication cannot clear a newer native morning binding`() {
        val latest = RestorativeEnforcement.parse(
            mapOf(
                "morningRequirements" to listOf(
                    mapOf(
                        "attentionDayId" to "ad-20260928-0830",
                        "sessionId" to "morning-ad-20260928-0830",
                        "requiredQualifiedSeconds" to 1800,
                        "createdAt" to 10L,
                        "satisfied" to false,
                        "sessionKind" to "MORNING_REQUIRED",
                        "sourceRhythmicDayId" to "ad-20260928-0830",
                    )
                )
            ),
            trustNativeCompletionMarker = true,
        )
        val staleJs = RestorativeEnforcement.parse(emptyMap())
        val rebased = RestorativeEnforcement.reconcileIncoming(latest, staleJs)
        val carried = rebased.allMorningRequirements().single()
        assertEquals("morning-ad-20260928-0830", carried.sessionId)
        assertEquals(10L, carried.createdAt)
        assertTrue(rebased.morningFocusActive)
    }

    @Test
    fun `stale provider observation cannot regress a verified native completion`() {
        val latest = RestorativeEnforcement.parse(
            mapOf(
                "morningRequirements" to listOf(
                    mapOf(
                        "attentionDayId" to "ad-20260928-0830",
                        "sessionId" to "morning-ad-20260928-0830",
                        "requiredQualifiedSeconds" to 1800,
                        "createdAt" to 10L,
                        "satisfied" to true,
                        "satisfiedAt" to 20L,
                        "sessionKind" to "MORNING_REQUIRED",
                        "sourceRhythmicDayId" to "ad-20260928-0830",
                    )
                )
            ),
            trustNativeCompletionMarker = true,
        )
        val stalePending = RestorativeEnforcement.parse(
            mapOf(
                "morningRequirements" to listOf(
                    mapOf(
                        "attentionDayId" to "ad-20260928-0830",
                        "sessionId" to "morning-ad-20260928-0830",
                        "requiredQualifiedSeconds" to 1800,
                        "createdAt" to 10L,
                        "satisfied" to false,
                        "sessionKind" to "MORNING_REQUIRED",
                        "sourceRhythmicDayId" to "ad-20260928-0830",
                    )
                )
            )
        )
        val rebased = RestorativeEnforcement.reconcileIncoming(latest, stalePending)
        val retained = rebased.allMorningRequirements().single()
        assertEquals(20L, retained.satisfiedAt!!)
        assertFalse(rebased.morningFocusActive)
    }

    @Test
    fun `explicit reclassification removes Essential exemption and reverse restores it`() {
        val latest = RestorativeEnforcement.parse(
            mapOf(
                "essentialPackages" to listOf("com.example.bank"),
                "managedPackages" to listOf("com.example.social"),
            )
        )
        val reclassified = RestorativeEnforcement.reconcileIncoming(
            latest,
            RestorativeEnforcement.parse(
                mapOf(
                    "essentialPackages" to emptyList<String>(),
                    "managedPackages" to listOf("com.example.bank", "com.example.social"),
                )
            ),
        )
        assertFalse("com.example.bank" in reclassified.essentialPackages)
        assertTrue("com.example.bank" in reclassified.managedPackages)
        assertTrue(
            NativeAttentionExchangeLogic.isEffectivelyRestricted(
                baseOrRoutineRestricted = false,
                cooldownActive = true,
                gatePresent = false,
                accessLeaseActive = false,
                essentialPackage = MorningEnforcement.isEssentialPackage(
                    "com.example.bank",
                    reclassified.essentialPackages,
                ),
            )
        )

        val restoredEssential = RestorativeEnforcement.reconcileIncoming(
            reclassified,
            RestorativeEnforcement.parse(
                mapOf(
                    "essentialPackages" to listOf("com.example.bank"),
                    "managedPackages" to listOf("com.example.social"),
                )
            ),
        )
        assertTrue("com.example.bank" in restoredEssential.essentialPackages)
        assertFalse("com.example.bank" in restoredEssential.managedPackages)
        assertFalse(
            NativeAttentionExchangeLogic.isEffectivelyRestricted(
                baseOrRoutineRestricted = false,
                cooldownActive = true,
                gatePresent = false,
                accessLeaseActive = false,
                essentialPackage = MorningEnforcement.isEssentialPackage(
                    "com.example.bank",
                    restoredEssential.essentialPackages,
                ),
            )
        )
    }

    @Test
    fun `missing classification projection cannot remove an accepted Essential exemption`() {
        val latest = RestorativeEnforcement.parse(
            mapOf(
                "essentialPackages" to listOf("com.example.bank"),
                "managedPackages" to listOf("com.example.social"),
            )
        )
        val stale = RestorativeEnforcement.parse(emptyMap())
        val rebased = RestorativeEnforcement.reconcileIncoming(latest, stale)
        assertTrue("com.example.bank" in rebased.essentialPackages)
        assertEquals(setOf("com.example.social"), rebased.managedPackages)
    }

    @Test
    fun `stale native gate publisher preserves latest accepted classification`() {
        val latest = RestorativeEnforcement.parse(
            mapOf(
                "essentialPackages" to emptyList<String>(),
                "managedPackages" to listOf("com.example.bank"),
            )
        )
        val staleNative = RestorativeEnforcement.parse(
            mapOf(
                "essentialPackages" to listOf("com.example.bank"),
                "managedPackages" to emptyList<String>(),
            )
        )
        val preserved = RestorativeEnforcement.reconcileIncoming(
            latest,
            staleNative.copy(
                hasEssentialProjection = false,
                hasManagedProjection = false,
            ),
        )
        assertFalse("com.example.bank" in preserved.essentialPackages)
        assertTrue("com.example.bank" in preserved.managedPackages)
    }

    @Test
    fun `unfinished restorative gate carries across attention day with provider progress`() {
        val latest = RestorativeEnforcement.parse(
            mapOf(
                "activeRestorativeGates" to listOf(gateMap()),
                "attentionDay" to mapOf("id" to "ad-20260927-0730", "nextBoundaryAt" to 1L),
            )
        )
        val incoming = RestorativeEnforcement.parse(
            mapOf(
                "activeRestorativeGates" to emptyList<Any>(),
                "attentionDay" to mapOf("id" to "ad-20260928-0730", "nextBoundaryAt" to 2L),
            )
        )
        val rebased = RestorativeEnforcement.reconcileIncoming(latest, incoming)
        val carried = rebased.restorativeGates.getValue("social")
        assertEquals("ad-20260927-0730", carried.attentionDayId)
        assertEquals("meditation", carried.selectedProvider)
        assertEquals("in-progress", carried.status)
    }

    @Test
    fun `distinct incoming same-group gate cannot replace an unfinished carried binding`() {
        val latest = RestorativeEnforcement.parse(
            mapOf(
                "activeRestorativeGates" to listOf(gateMap(status = "in-progress")),
                "attentionDay" to mapOf("id" to "ad-20260927-0730", "nextBoundaryAt" to 1L),
            )
        )
        val incoming = RestorativeEnforcement.parse(
            mapOf(
                "activeRestorativeGates" to listOf(
                    gateMap(groupId = "social", status = "pending-selection").toMutableMap().apply {
                        put("gateId", "gate-ad-20260928-0730-social-o5")
                        put("attentionDayId", "ad-20260928-0730")
                        put("dailyCooldownOrdinal", 5)
                        put("selectedProvider", null)
                    }
                ),
                "attentionDay" to mapOf("id" to "ad-20260928-0730", "nextBoundaryAt" to 2L),
            )
        )
        val rebased = RestorativeEnforcement.reconcileIncoming(latest, incoming)
        val carried = rebased.restorativeGates.getValue("social")
        assertEquals("gate-ad-20260927-0730-social-o4", carried.gateId)
        assertEquals("meditation", carried.selectedProvider)
    }

    @Test
    fun `same textual gate id with wrong immutable binding cannot complete the pending gate`() {
        val knownGate = gateMap(status = "in-progress") + mapOf(
            "restorativeReadingSeconds" to 1800L,
            "restorativeReadingPages" to 11,
        )
        val latest = RestorativeEnforcement.parse(
            mapOf(
                "activeRestorativeGates" to listOf(knownGate),
                "attentionDay" to mapOf("id" to "ad-20260927-0730", "nextBoundaryAt" to 1L),
            )
        )
        val wrongs = listOf(
            "attentionDayId" to "ad-20260928-0730",
            "dailyCooldownOrdinal" to 5,
            "requirementKind" to "baseline-reading",
            "groupId" to "video",
            "createdAt" to 999L,
            "restorativeReadingSeconds" to 900L,
        )
        for ((key, value) in wrongs) {
            val incoming = RestorativeEnforcement.parse(
                mapOf(
                    "activeRestorativeGates" to listOf(
                        (knownGate + ("status" to "satisfied")).toMutableMap().apply { put(key, value) }
                    ),
                    "attentionDay" to mapOf("id" to "ad-20260927-0730", "nextBoundaryAt" to 2L),
                )
            )
            val rebased = RestorativeEnforcement.reconcileIncoming(latest, incoming)
            val carried = rebased.restorativeGates.getValue("social")
            assertEquals("wrong $key must not complete", "in-progress", carried.status)
            assertEquals(1800L, carried.restorativeReadingSeconds)
            assertEquals("meditation", carried.selectedProvider)
        }
        val exactCompletion = latest.copy(
            restorativeGates = mapOf(
                "social" to latest.restorativeGates.getValue("social").copy(status = "satisfied"),
            ),
        )
        assertTrue(RestorativeEnforcement.reconcileIncoming(latest, exactCompletion)
            .restorativeGates.getValue("social").satisfied)
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
                "attentionDay" to mapOf(
                    "id" to "ad-20260927-0730",
                    "nextBoundaryAt" to 1_790_000_000_000L,
                ),
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
        assertEquals(original.attentionDay?.nextBoundaryAt, restored.attentionDay?.nextBoundaryAt)
        assertEquals(original.morningMeditation?.sessionId, restored.morningMeditation?.sessionId)
        assertEquals(original.companionPackages, restored.companionPackages)
        assertTrue(restored.hasRestorativeHold("social"))

        // Corrupt storage never widens enforcement.
        val corrupt = RestorativeEnforcement.fromJson("{not json")
        assertEquals(0, corrupt.restorativeGates.size)
        assertNull(corrupt.morningMeditation)
        assertNotNull(RestorativeEnforcement.fromJson(null))
    }

    @Test
    fun `cross day incoming replacement cannot erase an actual pending gate`() {
        val previous = RestorativeEnforcement.parse(mapOf(
            "activeRestorativeGates" to listOf(gateMap()),
            "attentionDay" to mapOf("id" to "ad-20260927-0730", "nextBoundaryAt" to 1L),
        ))
        val incoming = RestorativeEnforcement.parse(mapOf(
            "activeRestorativeGates" to listOf(gateMap() + mapOf(
                "gateId" to "gate-ad-20260928-0730-social-o1",
                "attentionDayId" to "ad-20260928-0730",
                "dailyCooldownOrdinal" to 1,
                "status" to "pending-selection",
                "selectedProvider" to null,
            )),
            "attentionDay" to mapOf("id" to "ad-20260928-0730", "nextBoundaryAt" to 2L),
        ))
        val rebased = RestorativeEnforcement.reconcileIncoming(previous, incoming)
        assertEquals(previous.restorativeGates["social"], rebased.restorativeGates["social"])
    }

    @Test
    fun `context persistence merge cannot replace a carried pending binding`() {
        val old = RestorativeEnforcement.parse(mapOf(
            "activeRestorativeGates" to listOf(gateMap()),
        )).restorativeGates.getValue("social")
        val incoming = old.copy(
            gateId = "gate-ad-20260928-0730-social-o1",
            attentionDayId = "ad-20260928-0730",
            dailyCooldownOrdinal = 1,
            status = "pending-selection",
            selectedProvider = null,
        )
        val result = RestorativeEnforcement.gatesForPersistence(
            mapOf("social" to old), mapOf("social" to incoming),
        )
        assertEquals(old, result["social"])
    }

    @Test
    fun `same textual gate id with wrong immutable owner cannot complete pending gate`() {
        val previous = RestorativeEnforcement.parse(mapOf(
            "activeRestorativeGates" to listOf(gateMap()),
            "attentionDay" to mapOf("id" to "ad-20260927-0730", "nextBoundaryAt" to 1L),
        ))
        val wrong = previous.restorativeGates.getValue("social").copy(
            attentionDayId = "ad-20260928-0730",
            dailyCooldownOrdinal = 1,
            status = "satisfied",
        )
        val incoming = previous.copy(
            attentionDay = NativeAttentionDayState("ad-20260928-0730", 2L),
            restorativeGates = mapOf("social" to wrong),
        )
        val merged = RestorativeEnforcement.reconcileIncoming(previous, incoming)
        assertEquals(previous.restorativeGates["social"], merged.restorativeGates["social"])
    }
}
