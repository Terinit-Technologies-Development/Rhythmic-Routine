package expo.modules.rhythmdevice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Pass 4 — Restorative preview / insight projection tests (pure JVM).
 */
class RestorativeProjectionTest {

    private fun gate(
        ordinal: Int,
        kind: String = "restorative-choice",
        status: String = "in-progress",
        provider: String? = "reader",
        attentionDayId: String = "ad-20260927-0730"
    ) = NativeRestorativeGateState(
        gateId = "gate-$attentionDayId-social-o$ordinal",
        groupId = "social",
        attentionDayId = attentionDayId,
        requirementKind = kind,
        status = status,
        selectedProvider = provider,
        dailyCooldownOrdinal = ordinal
    )

    /** Wire-map form (what the JS snapshot actually sends). */
    private fun gateMap(
        ordinal: Int,
        kind: String = "restorative-choice",
        status: String = "in-progress",
        provider: String? = "reader",
        attentionDayId: String = "ad-20260927-0730",
        groupId: String = "social"
    ): Map<String, Any?> = mapOf(
        "gateId" to "gate-$attentionDayId-$groupId-o$ordinal",
        "groupId" to groupId,
        "attentionDayId" to attentionDayId,
        "dailyCooldownOrdinal" to ordinal,
        "createdAt" to 1L,
        "cooldownEndsAt" to 2L,
        "requirementKind" to kind,
        "selectedProvider" to provider,
        "providerSessionId" to "session-$ordinal",
        "status" to status,
        "requiredReadingSeconds" to 1800,
        "requiredQualifiedPages" to 11,
        "requiredMeditationSeconds" to 1800
    )

    @Test
    fun `requirement kinds follow the frozen Pass 3 policy`() {
        assertEquals("none", RestorativeEnforcement.requirementKindForOrdinal(1))
        assertEquals("none", RestorativeEnforcement.requirementKindForOrdinal(2))
        assertEquals("baseline-reading", RestorativeEnforcement.requirementKindForOrdinal(3))
        assertEquals("restorative-choice", RestorativeEnforcement.requirementKindForOrdinal(4))
        assertEquals("restorative-choice", RestorativeEnforcement.requirementKindForOrdinal(5))
    }

    @Test
    fun `preview gate selection prefers the next ordinal`() {
        val gates = listOf(gate(3, kind = "baseline-reading", status = "in-progress"), gate(4))
        val selected = RestorativeEnforcement.selectPreviewGate(gates, nextOrdinal = 4)
        assertEquals(4, selected?.dailyCooldownOrdinal)
    }

    @Test
    fun `preview gate selection falls back to the oldest open gate`() {
        val gates = listOf(gate(5, status = "pending-selection", provider = null), gate(3, kind = "baseline-reading"))
        val selected = RestorativeEnforcement.selectPreviewGate(gates, nextOrdinal = 6)
        assertNotNull(selected)
        assertTrue(selected!!.holdsGroup)
    }

    @Test
    fun `insight projection counts gates per attention day only`() {
        val snapshot = RestorativeEnforcement.parse(
            mapOf(
                "activeRestorativeGates" to listOf(
                    gateMap(4, status = "satisfied", provider = "meditation", groupId = "social"),
                    gateMap(5, status = "satisfied", provider = "reader", groupId = "entertainment"),
                    gateMap(6, status = "in-progress", provider = "meditation", groupId = "news"),
                    // Different Attention Day — must not leak into today.
                    gateMap(3, kind = "baseline-reading", status = "satisfied", provider = "reader",
                        attentionDayId = "ad-20260926-0730", groupId = "gaming")
                )
            )
        )
        val values = AttentionInsightProvider.deriveValues(
            snapshot,
            attentionDayId = "ad-20260927-0730",
            cooldownsTriggered = 6
        )

        assertEquals(1, values[AttentionInsightProvider.COLUMN_PROTOCOL_VERSION])
        assertEquals("ad-20260927-0730", values[AttentionInsightProvider.COLUMN_ATTENTION_DAY_ID])
        assertEquals(6, values[AttentionInsightProvider.COLUMN_COOLDOWNS_TRIGGERED])
        assertEquals(3, values[AttentionInsightProvider.COLUMN_RESTORATIVE_GATES_CREATED])
        assertEquals(2, values[AttentionInsightProvider.COLUMN_RESTORATIVE_GATES_SATISFIED])
        assertEquals(1, values[AttentionInsightProvider.COLUMN_READER_RESTORATIVE_COMPLETIONS])
        assertEquals(1, values[AttentionInsightProvider.COLUMN_MEDITATION_RESTORATIVE_COMPLETIONS])
        // One satisfied meditation gate == exactly one substitution consumed.
        assertEquals(1, values[AttentionInsightProvider.COLUMN_MEDITATION_SUBSTITUTIONS_USED])
        assertEquals(1, values[AttentionInsightProvider.COLUMN_MEDITATION_SUBSTITUTIONS_REMAINING])
    }

    @Test
    fun `substitution remaining never exceeds the cap and never goes negative`() {
        val threeMeditationGates = RestorativeEnforcement.parse(
            mapOf(
                "activeRestorativeGates" to listOf(
                    gateMap(4, status = "satisfied", provider = "meditation", groupId = "social"),
                    gateMap(5, status = "satisfied", provider = "meditation", groupId = "entertainment"),
                    gateMap(6, status = "satisfied", provider = "meditation", groupId = "news")
                )
            )
        )
        val values = AttentionInsightProvider.deriveValues(threeMeditationGates, "ad-20260927-0730", 6)
        assertEquals(3, values[AttentionInsightProvider.COLUMN_MEDITATION_SUBSTITUTIONS_USED])
        assertEquals(0, values[AttentionInsightProvider.COLUMN_MEDITATION_SUBSTITUTIONS_REMAINING])

        val none = AttentionInsightProvider.deriveValues(
            RestorativeEnforcement.parse(emptyMap()), "ad-20260927-0730", 0
        )
        assertEquals(0, none[AttentionInsightProvider.COLUMN_MEDITATION_SUBSTITUTIONS_USED])
        assertEquals(2, none[AttentionInsightProvider.COLUMN_MEDITATION_SUBSTITUTIONS_REMAINING])
    }

    @Test
    fun `provider label is strict - garbage never reads as a provider`() {
        assertEquals("reader", gate(4, provider = "reader").selectedProviderLabel())
        assertEquals("meditation", gate(4, provider = "meditation").selectedProviderLabel())
        assertEquals("none", gate(4, provider = "something-else").selectedProviderLabel())
        assertEquals("none", gate(4, provider = null).selectedProviderLabel())
    }

    @Test
    fun `selected provider is preserved through json round trip`() {
        val snapshot = RestorativeEnforcement.parse(
            mapOf("activeRestorativeGates" to listOf(gateMap(4, provider = "meditation")))
        )
        val restored = RestorativeEnforcement.fromJson(
            RestorativeEnforcement.toJson(snapshot).toString()
        )
        assertEquals("meditation", restored.restorativeGates["social"]?.selectedProviderLabel())
        assertEquals(4, restored.restorativeGates["social"]?.dailyCooldownOrdinal)
    }

    @Test
    fun `restorative reader requirement is the discrete 30 min 11 pages`() {
        assertEquals(1800L, RestorativeEnforcement.RESTORATIVE_READING_SECONDS)
        assertEquals(11, RestorativeEnforcement.RESTORATIVE_QUALIFIED_PAGES)
        assertEquals(3600L, RestorativeEnforcement.BASELINE_READING_SECONDS)
        assertEquals(36, RestorativeEnforcement.BASELINE_QUALIFIED_PAGES)
        assertFalse(
            "CD4+ is discrete, never the v1.2 cumulative 5400/47",
            RestorativeEnforcement.RESTORATIVE_READING_SECONDS == 5400L
        )
    }
}
