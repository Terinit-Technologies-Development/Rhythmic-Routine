package expo.modules.rhythmdevice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeAttentionExchangeLogicTest {
    private val today = "2026-09-24"
    private val tomorrow = "2026-09-25"
    private val now = 1_790_243_200_000L

    private fun gate(
        groupId: String = "social",
        ordinal: Int = 3,
        endsAt: Long = now - 1,
        dateKey: String = today,
        seconds: Long = 3600,
        pages: Int = 36,
    ) = NativeReadingGate(groupId, dateKey, ordinal, now - 120_000, endsAt, seconds, pages)

    private fun evidence(
        seconds: Long = 3600,
        pages: Int = 36,
        available: Boolean = true,
        compatible: Boolean = true,
        protocol: Int? = 2,
        dateKey: String = today,
    ) = NativeDailyReadingEvidenceResult(
        providerAvailable = available,
        protocolCompatible = compatible,
        protocolVersion = protocol,
        dateKey = dateKey,
        verifiedActiveSeconds = seconds,
        qualifiedPages = pages,
        updatedAtEpochMs = now,
    )

    @Test
    fun `policy thresholds use the global ordinal and both reading dimensions`() {
        assertEquals(NativeReadingRequirement(0, 0), NativeAttentionExchangeLogic.requirementForCooldownOrdinal(2))
        assertEquals(NativeReadingRequirement(3600, 36), NativeAttentionExchangeLogic.requirementForCooldownOrdinal(3))
        assertEquals(NativeReadingRequirement(5400, 47), NativeAttentionExchangeLogic.requirementForCooldownOrdinal(4))
        assertEquals(NativeReadingRequirement(7200, 58), NativeAttentionExchangeLogic.requirementForCooldownOrdinal(5))

        val third = gate()
        assertEquals(
            NativeAttentionGatePhase.READING_REQUIRED,
            NativeAttentionExchangeLogic.evaluateGate(third, evidence(seconds = 3600, pages = 35), now, today).phase,
        )
        assertEquals(
            NativeAttentionGatePhase.READING_REQUIRED,
            NativeAttentionExchangeLogic.evaluateGate(third, evidence(seconds = 3599, pages = 80), now, today).phase,
        )
        assertEquals(
            NativeAttentionGatePhase.SATISFIED,
            NativeAttentionExchangeLogic.evaluateGate(third, evidence(), now, today).phase,
        )
    }

    @Test
    fun `next target preview follows today's global cooldown ordinal and policy`() {
        val first = NativeAttentionExchangeLogic.nextReadingTargetPreview(
            NativeAttentionExchangeLogic.newDailyState(today, now),
            today,
        )
        assertEquals(1, first.nextCooldownOrdinal)
        assertEquals(0L, first.requiredActiveSeconds)
        assertEquals(0, first.requiredQualifiedPages)

        val afterFreeCooldowns = NativeAttentionExchangeLogic.nextReadingTargetPreview(
            NativeDailyAttentionExchangeState(today, 2, 0L, 0, now),
            today,
        )
        assertEquals(3, afterFreeCooldowns.nextCooldownOrdinal)
        assertEquals(3600L, afterFreeCooldowns.requiredActiveSeconds)
        assertEquals(36, afterFreeCooldowns.requiredQualifiedPages)

        val laterTarget = NativeAttentionExchangeLogic.nextReadingTargetPreview(
            NativeDailyAttentionExchangeState(today, 3, 3600L, 36, now),
            today,
        )
        assertEquals(4, laterTarget.nextCooldownOrdinal)
        assertEquals(5400L, laterTarget.requiredActiveSeconds)
        assertEquals(47, laterTarget.requiredQualifiedPages)

        val nextDay = NativeAttentionExchangeLogic.nextReadingTargetPreview(
            NativeDailyAttentionExchangeState(today, 3, 3600L, 36, now),
            tomorrow,
        )
        assertEquals(tomorrow, nextDay.dateKey)
        assertEquals(1, nextDay.nextCooldownOrdinal)
        assertEquals(0L, nextDay.requiredActiveSeconds)
        assertEquals(0, nextDay.requiredQualifiedPages)
    }

    @Test
    fun `one exhaustion receives one daily ordinal across groups and retries`() {
        var state = NativeAttentionExchangeLogic.newDailyState(today, now)
        var cooldowns = emptyMap<String, NativeCooldownPolicy>()
        var gates = emptyMap<String, NativeReadingGate>()
        val expected = listOf(1, 2, 3)

        listOf("social", "video", "social").forEachIndexed { index, groupId ->
            val result = NativeAttentionExchangeLogic.allocateCooldown(
                state, NativeAttentionExchangeLogic.DEFAULT_POLICY, groupId, setOf("$groupId.app"),
                now + index, now + 60_000 + index, today, cooldowns, gates, alreadyExhausted = false,
            )
            assertTrue(result.allocated)
            assertEquals(expected[index], result.dailyAttentionExchange.cooldownsTriggered)
            state = result.dailyAttentionExchange
            cooldowns = result.cooldowns
            gates = result.readingGates

            if (index == 1) {
                // The first group's timer has elapsed and its cycle completed;
                // the daily global ordinal is intentionally not reset.
                cooldowns = cooldowns - "social"
                gates = gates - "social"
            }

            if (index == 0) {
                val retry = NativeAttentionExchangeLogic.allocateCooldown(
                    state, NativeAttentionExchangeLogic.DEFAULT_POLICY, groupId, setOf("$groupId.app"),
                    now + index, now + 60_000 + index, today, cooldowns, gates, alreadyExhausted = false,
                )
                assertFalse(retry.allocated)
                assertEquals(1, retry.dailyAttentionExchange.cooldownsTriggered)
            }
        }

        assertEquals(3, state.cooldownsTriggered)
        assertNotNull(gates["social"])
        assertEquals(3, gates["social"]?.dailyCooldownOrdinal)
        assertEquals(3600L, gates["social"]?.requiredReadingSeconds)
        assertEquals(36, gates["social"]?.requiredQualifiedPages)
    }

    @Test
    fun `cooldown expiry keeps an unsatisfied gate and completes only after both thresholds`() {
        val activeCooldown = NativeCooldownPolicy(
            "social", setOf("social.app"), now + 60_000, now,
            attentionDateKey = today,
            dailyCooldownOrdinal = 3,
            requiredReadingSeconds = 3600,
            requiredQualifiedPages = 36,
        )
        val active = NativeAttentionExchangeLogic.decideCooldownExpiry(activeCooldown, gate(endsAt = now + 60_000), null, now, today)
        assertEquals(NativeCooldownExpiryAction.KEEP_ACTIVE_TIMER, active.action)

        val expiredCooldown = activeCooldown.copy(endsAt = now - 1)
        val waiting = NativeAttentionExchangeLogic.decideCooldownExpiry(expiredCooldown, gate(), null, now, today)
        assertEquals(NativeCooldownExpiryAction.REMOVE_TIMER_KEEP_GATE, waiting.action)
        assertEquals(NativeAttentionGatePhase.READER_UNAVAILABLE, waiting.phase)
        assertNotNull(waiting.gate)

        val satisfied = NativeAttentionExchangeLogic.decideCooldownExpiry(expiredCooldown, gate(), evidence(), now, today)
        assertEquals(NativeCooldownExpiryAction.COMPLETE_RESTRICTED_CYCLE, satisfied.action)
        assertEquals(NativeAttentionGatePhase.SATISFIED, satisfied.phase)
    }

    @Test
    fun `Reader unavailable and incompatible are distinct and fail closed`() {
        val readingGate = gate()
        val unavailable = NativeAttentionExchangeLogic.evaluateGate(readingGate, null, now, today)
        assertEquals(NativeAttentionGatePhase.READER_UNAVAILABLE, unavailable.phase)
        assertFalse(unavailable.readerProviderAvailable)

        val incompatible = NativeAttentionExchangeLogic.evaluateGate(
            readingGate,
            evidence(available = true, compatible = false, protocol = 3),
            now,
            today,
        )
        assertEquals(NativeAttentionGatePhase.READER_INCOMPATIBLE, incompatible.phase)
        assertTrue(incompatible.readerProviderAvailable)
        assertFalse(incompatible.readerProtocolCompatible)
    }

    @Test
    fun `access leases suppress enforcement without deleting or satisfying a gate`() {
        val readingGate = gate()
        assertTrue(NativeAttentionExchangeLogic.isEffectivelyRestricted(false, false, true, false))
        assertFalse(NativeAttentionExchangeLogic.isEffectivelyRestricted(false, false, true, true))
        assertEquals(readingGate, gate())
        assertTrue(NativeAttentionExchangeLogic.isEffectivelyRestricted(false, false, true, false))
    }

    @Test
    fun `restart reconciliation preserves native state against stale JavaScript snapshots`() {
        val nativeGate = gate(groupId = "social", ordinal = 4, seconds = 5400, pages = 47)
        val nativeState = NativeDailyAttentionExchangeState(today, 4, 5400, 47, now)
        val staleJsState = NativeDailyAttentionExchangeState(today, 1, 0, 0, now - 10_000)
        val staleJsGate = gate(groupId = "video", ordinal = 1, seconds = 0, pages = 0)

        val (reconciledState, reconciledGates) = NativeAttentionExchangeLogic.reconcileIncomingState(
            nativeState,
            mapOf("social" to nativeGate),
            staleJsState,
            mapOf("video" to staleJsGate),
            today,
            now,
        )
        assertEquals(4, reconciledState.cooldownsTriggered)
        assertEquals(mapOf("social" to nativeGate), reconciledGates)
    }

    @Test
    fun `legacy timers migrate without retroactive reading debt`() {
        val legacy = NativeCooldownPolicy("social", setOf("social.app"), now + 60_000, now)
        assertNull(NativeAttentionExchangeLogic.gateForCooldown(legacy, today))
        val legacyState = NativeDailyAttentionExchangeState(today, 2, 0, 0, now)
        val (migrated, gates) = NativeAttentionExchangeLogic.reconcileIncomingState(
            null,
            emptyMap(),
            legacyState,
            emptyMap(),
            today,
            now,
        )
        assertEquals(2, migrated.cooldownsTriggered)
        assertTrue(gates.isEmpty())
        assertEquals(
            NativeCooldownExpiryAction.KEEP_ACTIVE_TIMER,
            NativeAttentionExchangeLogic.decideCooldownExpiry(legacy, null, null, now, today).action,
        )
    }

    @Test
    fun `midnight clears previous day gates and prior day timers retain only their timer`() {
        val priorGate = gate(dateKey = today, endsAt = now + 60_000)
        val priorState = NativeDailyAttentionExchangeState(today, 3, 3600, 36, now)
        val (newState, newGates) = NativeAttentionExchangeLogic.reconcileIncomingState(
            priorState,
            mapOf("social" to priorGate),
            null,
            emptyMap(),
            tomorrow,
            now + 86_400_000,
        )
        assertEquals(tomorrow, newState.dateKey)
        assertEquals(0, newState.cooldownsTriggered)
        assertTrue(newGates.isEmpty())

        val crossMidnight = NativeCooldownPolicy(
            "social", setOf("social.app"), now + 86_400_000, now,
            attentionDateKey = today,
            dailyCooldownOrdinal = 3,
            requiredReadingSeconds = 3600,
            requiredQualifiedPages = 36,
        )
        assertEquals(
            NativeCooldownExpiryAction.KEEP_ACTIVE_TIMER,
            NativeAttentionExchangeLogic.decideCooldownExpiry(crossMidnight, null, null, now + 1, tomorrow).action,
        )
        assertEquals(
            NativeCooldownExpiryAction.COMPLETE_RESTRICTED_CYCLE,
            NativeAttentionExchangeLogic.decideCooldownExpiry(crossMidnight, null, null, now + 86_400_001, tomorrow).action,
        )
    }

    @Test
    fun `cycle completion resets allowance while preserving cycle revision semantics`() {
        val prior = NativeGroupAllowanceUsage("social", today, 2_000_000L, "social.app", now - 60_000, now, 8)
        val completed = NativeAttentionExchangeLogic.completeGroupCycle("social", today, now, prior)
        assertEquals(0L, completed.usedMillis)
        assertNull(completed.activePackageName)
        assertNull(completed.activeSegmentStartedAt)
        assertNull(completed.exhaustedAt)
        assertEquals(9L, completed.cycleRevision)
    }
}
