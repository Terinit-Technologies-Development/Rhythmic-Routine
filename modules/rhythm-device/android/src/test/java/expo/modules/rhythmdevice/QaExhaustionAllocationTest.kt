package expo.modules.rhythmdevice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
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

    private fun evidence(seconds: Long, pages: Int) = NativeDailyReadingEvidenceResult(
        providerAvailable = true,
        protocolCompatible = true,
        protocolVersion = 2,
        dateKey = today,
        verifiedActiveSeconds = seconds,
        qualifiedPages = pages,
        updatedAtEpochMs = now,
    )

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

    @Test
    fun `triggers 1 to 5 allocate the frozen kind table - never cumulative`() {
        var state = NativeAttentionExchangeLogic.newDailyState(today, now)
        var cooldowns = emptyMap<String, NativeCooldownPolicy>()
        var gates = emptyMap<String, NativeReadingGate>()
        var restorative = emptyMap<String, NativeRestorativeGateState>()
        val attentionDayId = "ad-20260929-0800"

        (1..5).forEach { ordinal ->
            val groupId = "qa-$ordinal"
            val allocation = NativeAttentionExchangeLogic.allocateCooldown(
                state = state,
                policy = policy,
                groupId = groupId,
                packageNames = setOf("com.qa.$ordinal"),
                startedAt = now,
                endsAt = now + cooldownMillis,
                dateKey = today,
                existingCooldowns = cooldowns,
                existingGates = gates,
                alreadyExhausted = false,
                attentionDayId = attentionDayId,
                existingRestorativeGates = restorative,
            )
            assertTrue("trigger $ordinal must allocate", allocation.allocated)
            assertEquals(ordinal, allocation.dailyAttentionExchange.cooldownsTriggered)
            val cooldown = allocation.cooldowns.getValue(groupId)
            when (ordinal) {
                1, 2 -> {
                    assertEquals("none", cooldown.requirementKind)
                    assertNull(allocation.readingGates[groupId])
                    assertNull(allocation.restorativeGates[groupId])
                }
                3 -> {
                    assertEquals("baseline-reading", cooldown.requirementKind)
                    assertEquals(3600L, cooldown.requiredReadingSeconds)
                    assertEquals(36, cooldown.requiredQualifiedPages)
                    val readingGate = allocation.readingGates.getValue(groupId)
                    assertEquals(3600L, readingGate.requiredReadingSeconds)
                    assertEquals(36, readingGate.requiredQualifiedPages)
                    assertNull(allocation.restorativeGates[groupId])
                }
                else -> {
                    assertEquals("restorative-choice", cooldown.requirementKind)
                    assertEquals(1800L, cooldown.restorativeReadingSeconds)
                    assertEquals(11, cooldown.restorativeReadingPages)
                    assertEquals(1800L, cooldown.requiredMeditationSeconds)
                    assertNotEquals(5400L, cooldown.restorativeReadingSeconds)
                    assertNotEquals(47, cooldown.restorativeReadingPages)
                    assertNotEquals(7200L, cooldown.restorativeReadingSeconds)
                    assertNotEquals(58, cooldown.restorativeReadingPages)
                    assertNull("CD4+ is NOT another reading gate", allocation.readingGates[groupId])
                    val gate = allocation.restorativeGates.getValue(groupId)
                    assertEquals("gate-$attentionDayId-$groupId-o$ordinal", gate.gateId)
                    assertEquals("restorative-choice", gate.requirementKind)
                    assertEquals("pending-selection", gate.status)
                    assertNull(gate.selectedProvider)
                    assertEquals(1800L, gate.restorativeReadingSeconds)
                    assertEquals(11, gate.restorativeReadingPages)
                    assertEquals(1800L, gate.requiredMeditationSeconds)
                }
            }
            state = allocation.dailyAttentionExchange
            cooldowns = allocation.cooldowns
            gates = allocation.readingGates
            restorative = allocation.restorativeGates
        }

        // CD3 may establish the baseline projection; CD4+ never mutates it.
        assertEquals(3600L, state.highestRequiredActiveSeconds)
        assertEquals(36, state.highestRequiredQualifiedPages)
    }

    @Test
    fun `a migrated legacy obligation keeps 5400 47 - the next new cooldown is restorative-choice`() {
        // Seed the existing migrated LEGACY_READING obligation: ordinal 4, 5400/47.
        val legacyGate = NativeReadingGate("social", today, 4, now - 120_000, now - 1, 5400L, 47)
        val legacyCooldown = NativeCooldownPolicy(
            "social", setOf("com.social.app"), now + 60_000, now - 120_000,
            attentionDateKey = today, dailyCooldownOrdinal = 4,
            requirementKind = "legacy-reading",
            requiredReadingSeconds = 5400L, requiredQualifiedPages = 47,
        )
        val state = NativeAttentionExchangeLogic.newDailyState(today, now).copy(cooldownsTriggered = 4)

        // Restart/reconcile: the obligation keeps its historical numbers.
        val (reconciledState, reconciledGates) = NativeAttentionExchangeLogic.reconcileIncomingState(
            nativeState = state,
            nativeGates = mapOf("social" to legacyGate),
            incomingState = state.copy(cooldownsTriggered = 1),
            incomingGates = mapOf("social" to legacyGate.copy(requiredReadingSeconds = 1800, requiredQualifiedPages = 11)),
            today = today,
            now = now,
        )
        assertEquals(4, reconciledState.cooldownsTriggered)
        assertEquals(5400L, reconciledGates.getValue("social").requiredReadingSeconds)
        assertEquals(47, reconciledGates.getValue("social").requiredQualifiedPages)

        // Complete it (evidence satisfies 5400/47) -> cycle completes.
        val completion = NativeAttentionExchangeLogic.decideCooldownExpiry(
            legacyCooldown.copy(endsAt = now - 1),
            legacyGate,
            evidence(seconds = 5400, pages = 47),
            now,
            today,
        )
        assertEquals(NativeCooldownExpiryAction.COMPLETE_RESTRICTED_CYCLE, completion.action)

        // The NEXT new cooldown carries the discrete restorative choice.
        val next = NativeAttentionExchangeLogic.allocateCooldown(
            state = state,
            policy = policy,
            groupId = "video",
            packageNames = setOf("com.video.app"),
            startedAt = now,
            endsAt = now + cooldownMillis,
            dateKey = today,
            existingCooldowns = emptyMap(),
            existingGates = emptyMap(),
            alreadyExhausted = false,
            attentionDayId = "ad-20260929-0800",
        )
        assertTrue(next.allocated)
        assertEquals(5, next.dailyAttentionExchange.cooldownsTriggered)
        val nextCooldown = next.cooldowns.getValue("video")
        assertEquals("restorative-choice", nextCooldown.requirementKind)
        assertEquals(1800L, nextCooldown.restorativeReadingSeconds)
        assertEquals(11, nextCooldown.restorativeReadingPages)
        assertEquals(1800L, nextCooldown.requiredMeditationSeconds)
        assertNotEquals(7200L, nextCooldown.restorativeReadingSeconds)
        assertNotEquals(58, nextCooldown.restorativeReadingPages)
    }
}
