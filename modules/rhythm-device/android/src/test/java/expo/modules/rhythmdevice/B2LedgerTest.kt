package expo.modules.rhythmdevice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * B2 — durable native restorative completion ledger (F8 / FR-10 / T21).
 *
 * The ledger is the authoritative per-Attention-Day completion count. These
 * tests exercise the same public reconciliation/persistence path used by the
 * accepted native projection, not a test-only seam.
 */
class B2LedgerTest {

    private fun gateMap(
        gateId: String,
        attentionDayId: String = "ad-20261101-0730",
        groupId: String = "social",
        provider: String = "meditation",
        status: String = "satisfied",
    ): Map<String, Any?> = mapOf(
        "gateId" to gateId,
        "groupId" to groupId,
        "attentionDayId" to attentionDayId,
        "dailyCooldownOrdinal" to 4,
        "createdAt" to 1L,
        "cooldownEndsAt" to 2L,
        "requirementKind" to "restorative-choice",
        "selectedProvider" to provider,
        "providerSessionId" to "session-$gateId",
        "status" to status,
        "requiredReadingSeconds" to 0,
        "requiredQualifiedPages" to 0,
        "requiredMeditationSeconds" to 1800,
    )

    private fun snapshotWith(
        dayId: String,
        gates: List<Map<String, Any?>> = emptyList(),
        completions: List<Map<String, Any?>> = emptyList(),
        morning: Map<String, Any?>? = null,
    ): RestorativeEnforcementSnapshot {
        val map = mutableMapOf<String, Any?>(
            "attentionDay" to mapOf("id" to dayId, "nextBoundaryAt" to 1L),
            "activeRestorativeGates" to gates,
            "restorativeCompletions" to completions,
        )
        if (morning != null) map["morningMeditation"] = morning
        return RestorativeEnforcement.parse(map, trustNativeCompletionMarker = true)
    }

    private fun completion(gateId: String, attentionDayId: String, provider: String = "meditation") =
        mapOf(
            "gateId" to gateId,
            "groupId" to "social",
            "attentionDayId" to attentionDayId,
            "provider" to provider,
            "completedAt" to 10L,
        )

    @Test
    fun `ledger retains completed gates across history replacement and JSON roundtrip`() {
        val dayA = "ad-20261101-0730"
        val dayB = "ad-20261102-0730"

        val first = RestorativeEnforcement.reconcileIncoming(
            RestorativeEnforcement.parse(emptyMap()),
            snapshotWith(dayA, gates = listOf(gateMap("gate-a", dayA))),
        )
        assertEquals(1, first.restorativeCompletions.size)
        assertEquals("gate-a", first.restorativeCompletions.single().gateId)

        // The next Attention Day replaces the current gate for the same group;
        // the prior completion must remain in history.
        val second = RestorativeEnforcement.reconcileIncoming(
            first,
            snapshotWith(dayB, gates = listOf(gateMap("gate-b", dayB))),
        )
        assertEquals(2, second.restorativeCompletions.size)
        assertEquals(setOf("gate-a", "gate-b"), second.restorativeCompletions.map { it.gateId }.toSet())

        val restored = RestorativeEnforcement.fromJson(
            RestorativeEnforcement.toJson(second).toString()
        )
        assertEquals(2, restored.restorativeCompletions.size)
        assertEquals(
            setOf("gate-a", "gate-b"),
            restored.restorativeCompletions.map { it.gateId }.toSet()
        )

        // Repeated accepted reconciliation is idempotent by gateId.
        val deduped = RestorativeEnforcement.reconcileIncoming(restored, restored)
        assertEquals(2, deduped.restorativeCompletions.size)
    }

    @Test
    fun `insights count per attention day from the ledger without double counting current gates`() {
        val day = "ad-20261101-0730"
        val snapshot = snapshotWith(
            dayId = day,
            // gate-a is both a current satisfied gate and a ledger row.
            gates = listOf(gateMap("gate-a", day)),
            completions = listOf(
                completion("gate-a", day),
                completion("gate-b", day),
            ),
        )

        val values = AttentionInsightProvider.deriveValues(snapshot, day, 3)
        assertEquals(
            2,
            values[AttentionInsightProvider.COLUMN_MEDITATION_SUBSTITUTIONS_USED] as Int
        )
        assertEquals(
            0,
            values[AttentionInsightProvider.COLUMN_MEDITATION_SUBSTITUTIONS_REMAINING] as Int
        )
        assertEquals(
            2,
            values[AttentionInsightProvider.COLUMN_MEDITATION_RESTORATIVE_COMPLETIONS] as Int
        )

        // A different Attention Day never inherits this day's completions.
        val otherDay = AttentionInsightProvider.deriveValues(
            snapshot,
            "ad-20261102-0730",
            3,
        )
        assertEquals(
            0,
            otherDay[AttentionInsightProvider.COLUMN_MEDITATION_SUBSTITUTIONS_USED] as Int
        )
    }

    @Test
    fun `morning completion is never recorded in the cooldown substitution ledger`() {
        val day = "ad-20261101-0730"
        val snapshot = snapshotWith(
            dayId = day,
            morning = mapOf(
                "attentionDayId" to day,
                "sessionId" to "morning-$day",
                "requiredQualifiedSeconds" to 1800,
                "satisfied" to true,
                "satisfiedAt" to 5L,
            ),
        )

        assertTrue(snapshot.restorativeCompletions.isEmpty())
        val values = AttentionInsightProvider.deriveValues(snapshot, day, 1)
        assertEquals(
            0,
            values[AttentionInsightProvider.COLUMN_MEDITATION_SUBSTITUTIONS_USED] as Int
        )
        assertEquals(
            2,
            values[AttentionInsightProvider.COLUMN_MEDITATION_SUBSTITUTIONS_REMAINING] as Int
        )
    }
}
