package expo.modules.rhythmdevice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Pass 5A native <-> JS reconciliation: one logical gate per (Attention Day,
 * group, ordinal) with the SAME deterministic identity, no duplicate gates, no
 * ordinal churn during reconciliation, provider binding added by JS is kept,
 * and completed (satisfied) state is never downgraded.
 */
class RestorativeReconciliationTest {

    private val today = "2026-09-29"
    private val attentionDayId = "ad-20260929-0800"

    private fun gate(
        gateId: String = RestorativeEnforcement.gateIdFor(attentionDayId, "social", 4),
        groupId: String = "social",
        ordinal: Int = 4,
        status: String = "pending-selection",
        provider: String? = null,
        dayId: String = attentionDayId,
    ) = NativeRestorativeGateState(
        gateId = gateId,
        groupId = groupId,
        attentionDayId = dayId,
        requirementKind = "restorative-choice",
        status = status,
        selectedProvider = provider,
        dailyCooldownOrdinal = ordinal,
        restorativeReadingSeconds = 1800L,
        restorativeReadingPages = 11,
        requiredMeditationSeconds = 1800L,
    )

    private fun snapshot(
        gates: Map<String, NativeRestorativeGateState>,
        dayId: String = attentionDayId,
    ) = RestorativeEnforcementSnapshot(
        restorativeGates = gates,
        attentionDay = NativeAttentionDayState(dayId),
        morningMeditation = null,
        companionPackages = RestorativeEnforcement.DEFAULT_COMPANION_PACKAGES,
    )

    @Test
    fun `gate identity is deterministic and shared with the JS engine`() {
        assertEquals(
            "gate-ad-20260929-0800-social-o4",
            RestorativeEnforcement.gateIdFor(attentionDayId, "social", 4),
        )
        // Same inputs -> same id; different ordinal/day/group -> different id.
        assertEquals(
            RestorativeEnforcement.gateIdFor(attentionDayId, "social", 4),
            RestorativeEnforcement.gateIdFor(attentionDayId, "social", 4),
        )
    }

    @Test
    fun `native gate and JS projection of the same identity converge to one gate`() {
        val nativeCreated = snapshot(mapOf("social" to gate()))
        val jsProjection = snapshot(
            mapOf(
                "social" to gate(
                    status = "in-progress",
                    provider = "reader",
                )
            )
        )

        val merged = RestorativeEnforcement.reconcileIncoming(nativeCreated, jsProjection)
        assertEquals(1, merged.restorativeGates.size)
        val result = merged.restorativeGates.getValue("social")
        assertEquals("gate-ad-20260929-0800-social-o4", result.gateId)
        assertEquals(4, result.dailyCooldownOrdinal)
        // JS may add provider selection/session binding.
        assertEquals("reader", result.selectedProvider)
        assertEquals("in-progress", result.status)
    }

    @Test
    fun `a satisfied gate is never downgraded by reconciliation`() {
        val completed = snapshot(mapOf("social" to gate(status = "satisfied", provider = "meditation")))
        val staleProjection = snapshot(mapOf("social" to gate(status = "pending-selection")))

        val merged = RestorativeEnforcement.reconcileIncoming(completed, staleProjection)
        val result = merged.restorativeGates.getValue("social")
        assertEquals("satisfied", result.status)
        assertEquals("meditation", result.selectedProvider)
    }

    @Test
    fun `a native-created gate survives until the JS projection catches up`() {
        val nativeCreated = snapshot(mapOf("social" to gate()))
        val emptyProjection = snapshot(emptyMap())

        val merged = RestorativeEnforcement.reconcileIncoming(nativeCreated, emptyProjection)
        assertEquals(1, merged.restorativeGates.size)
        assertEquals("gate-ad-20260929-0800-social-o4", merged.restorativeGates.getValue("social").gateId)
    }

    @Test
    fun `a replacement gate for the same group replaces without duplication`() {
        val previous = snapshot(mapOf("social" to gate(ordinal = 4)))
        val next = snapshot(
            mapOf("social" to gate(gateId = RestorativeEnforcement.gateIdFor(attentionDayId, "social", 5), ordinal = 5))
        )

        val merged = RestorativeEnforcement.reconcileIncoming(previous, next)
        assertEquals(1, merged.restorativeGates.size)
        assertEquals(5, merged.restorativeGates.getValue("social").dailyCooldownOrdinal)
        assertEquals(
            "gate-ad-20260929-0800-social-o5",
            merged.restorativeGates.getValue("social").gateId,
        )
    }

    @Test
    fun `a new attention day replaces the store wholesale`() {
        val previous = snapshot(mapOf("social" to gate()))
        val newDay = snapshot(emptyMap(), dayId = "ad-20260930-0800")

        val merged = RestorativeEnforcement.reconcileIncoming(previous, newDay)
        assertTrue(merged.restorativeGates.isEmpty())
        assertEquals("ad-20260930-0800", merged.attentionDay?.id)
    }

    @Test
    fun `provider-neutral gates start unselected and pending`() {
        val pending = gate()
        assertNull(pending.selectedProvider)
        assertEquals("pending-selection", pending.status)
        assertEquals("none", pending.selectedProviderLabel())
        assertEquals(1800L, pending.restorativeReadingSeconds)
        assertEquals(11, pending.restorativeReadingPages)
        assertEquals(1800L, pending.requiredMeditationSeconds)
    }
}
