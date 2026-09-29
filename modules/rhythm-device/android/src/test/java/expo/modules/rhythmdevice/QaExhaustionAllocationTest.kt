package expo.modules.rhythmdevice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Blocker remediation: the production-equivalent QA trigger re-enters the SAME
 * production transition used when native group allowance is genuinely
 * exhausted (`startGroupUsage` -> `exhaustGroup` -> `allocateCooldown`). These
 * tests pin the production allocation outcomes the QA closure sequence reads:
 * ordinal 1, ordinal 2, then ordinal 3 with the real CD3 baseline gate
 * (3600 seconds / 36 pages) — across parallel Risk Group cooldowns, without
 * touching the 90-minute cooldown duration.
 */
class QaExhaustionAllocationTest {

    private val today = "2026-09-29"
    private val now = 1_790_649_600_000L
    private val cooldownMillis = 90 * 60_000L
    private val policy = NativeReadingAttentionPolicy()

    private fun exhaust(
        state: NativeDailyAttentionExchangeState,
        cooldowns: Map<String, NativeCooldownPolicy>,
        gates: Map<String, NativeReadingGate>,
        groupId: String,
        packageName: String,
    ) = NativeAttentionExchangeLogic.allocateCooldown(
        state = state,
        policy = policy,
        groupId = groupId,
        packageNames = setOf(packageName),
        startedAt = now,
        endsAt = now + cooldownMillis,
        dateKey = today,
        existingCooldowns = cooldowns,
        existingGates = gates,
        alreadyExhausted = false,
    )

    @Test
    fun `production exhaustion allocates ordinals 1 and 2 without gates`() {
        var state = NativeAttentionExchangeLogic.newDailyState(today, now)

        val first = exhaust(state, emptyMap(), emptyMap(), "qa-1", "com.qa.one")
        assertTrue(first.allocated)
        assertEquals(1, first.dailyAttentionExchange.cooldownsTriggered)
        assertEquals(1, first.cooldowns.getValue("qa-1").dailyCooldownOrdinal)
        assertNull("Ordinals 1-2 carry no reading gate", first.readingGates["qa-1"])
        assertEquals(
            "The 90-minute production cooldown flows through untouched",
            cooldownMillis,
            first.cooldowns.getValue("qa-1").endsAt - first.cooldowns.getValue("qa-1").startedAt,
        )

        state = first.dailyAttentionExchange
        val second = exhaust(state, first.cooldowns, first.readingGates, "qa-2", "com.qa.two")
        assertTrue(second.allocated)
        assertEquals(2, second.dailyAttentionExchange.cooldownsTriggered)
        assertEquals(2, second.cooldowns.getValue("qa-2").dailyCooldownOrdinal)
        assertNull(second.readingGates["qa-2"])
        assertEquals(
            "Parallel Risk Group cooldowns stay independent",
            2,
            second.cooldowns.size,
        )
    }

    @Test
    fun `third production exhaustion allocates ordinal 3 with the CD3 baseline gate`() {
        var state = NativeAttentionExchangeLogic.newDailyState(today, now)
        var cooldowns = emptyMap<String, NativeCooldownPolicy>()
        var gates = emptyMap<String, NativeReadingGate>()

        for ((groupId, packageName) in listOf("qa-1" to "com.qa.one", "qa-2" to "com.qa.two")) {
            val allocation = exhaust(state, cooldowns, gates, groupId, packageName)
            assertTrue(allocation.allocated)
            state = allocation.dailyAttentionExchange
            cooldowns = allocation.cooldowns
            gates = allocation.readingGates
        }

        val third = exhaust(state, cooldowns, gates, "qa-3", "com.qa.three")
        assertTrue(third.allocated)
        assertEquals(3, third.dailyAttentionExchange.cooldownsTriggered)

        val cooldown = third.cooldowns.getValue("qa-3")
        assertEquals(3, cooldown.dailyCooldownOrdinal)
        assertEquals(today, cooldown.attentionDateKey)

        val gate = third.readingGates.getValue("qa-3")
        assertEquals(3, gate.dailyCooldownOrdinal)
        assertEquals(3600L, gate.requiredReadingSeconds)
        assertEquals(36, gate.requiredQualifiedPages)
        assertEquals(
            "CD3 is the baseline-reading requirement kind",
            "baseline-reading",
            RestorativeEnforcement.requirementKindForOrdinal(cooldown.dailyCooldownOrdinal!!),
        )
    }

    @Test
    fun `an already allocated exhaustion is idempotent - never a second ordinal`() {
        var state = NativeAttentionExchangeLogic.newDailyState(today, now)
        val first = exhaust(state, emptyMap(), emptyMap(), "qa-1", "com.qa.one")
        state = first.dailyAttentionExchange

        val retry = exhaust(state, first.cooldowns, first.readingGates, "qa-1", "com.qa.one")
        assertFalse("A committed exhaustion must not allocate again", retry.allocated)
        assertEquals(1, retry.dailyAttentionExchange.cooldownsTriggered)
    }
}
