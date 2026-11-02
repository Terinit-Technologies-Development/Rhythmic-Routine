package expo.modules.rhythmdevice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * C1 CD3 carry: an unfinished baseline Reading Gate crosses the calendar
 * boundary with its original identity/timer. Reader V2 evidence remains
 * calendar-scoped: current date OR creation date, evaluated separately.
 */
class C1Cd3CarryTest {
    private val yesterday = "2026-11-01"
    private val today = "2026-11-02"
    private val now = 1_793_000_000_000L
    private val attentionDayId = "ad-20261101-0730"

    private fun gate() = NativeReadingGate(
        groupId = "social",
        attentionDateKey = yesterday,
        dailyCooldownOrdinal = 3,
        createdAt = now - 86_400_000L,
        cooldownEndsAt = now - 60_000L,
        requiredReadingSeconds = 3600L,
        requiredQualifiedPages = 36,
    )

    private fun evidence(dateKey: String, seconds: Long = 3600L, pages: Int = 36) =
        NativeDailyReadingEvidenceResult(
            providerAvailable = true,
            protocolCompatible = true,
            protocolVersion = 2,
            dateKey = dateKey,
            verifiedActiveSeconds = seconds,
            qualifiedPages = pages,
            updatedAtEpochMs = now,
        )

    @Test
    fun `unsatisfied gate survives midnight and does not inflate the new day counters`() {
        val (state, gates) = NativeAttentionExchangeLogic.reconcileIncomingState(
            nativeState = null,
            nativeGates = mapOf("social" to gate()),
            incomingState = null,
            incomingGates = emptyMap(),
            today = today,
            now = now,
            attentionDayId = "ad-20261102-0730",
        )

        assertTrue(gates.containsKey("social"))
        assertEquals(yesterday, gates.getValue("social").attentionDateKey)
        assertEquals(0, state.cooldownsTriggered)
        assertEquals(0L, state.highestRequiredActiveSeconds)
    }

    @Test
    fun `midnight rollover keeps an unfinished carried gate`() {
        val (state, gates) = NativeAttentionExchangeLogic.reconcileMidnightRollover(
            nativeState = NativeDailyAttentionExchangeState(
                dateKey = yesterday,
                cooldownsTriggered = 4,
                highestRequiredActiveSeconds = 3600L,
                highestRequiredQualifiedPages = 36,
                updatedAt = now,
                attentionDayId = attentionDayId,
            ),
            nativeGates = mapOf("social" to gate()),
            today = today,
            now = now,
            attentionDayId = attentionDayId,
        )

        assertTrue(gates.containsKey("social"))
        assertEquals(today, state.dateKey)
        assertEquals(4, state.cooldownsTriggered)
    }

    @Test
    fun `current and creation date aggregates each satisfy independently`() {
        val current = NativeAttentionExchangeLogic.evaluateGate(gate(), evidence(today), now, today)
        val creation = NativeAttentionExchangeLogic.evaluateGate(gate(), evidence(yesterday), now, today)

        assertEquals(NativeAttentionGatePhase.SATISFIED, current.phase)
        assertEquals(NativeAttentionGatePhase.SATISFIED, creation.phase)
    }

    @Test
    fun `partial aggregates are never pooled and absent evidence never completes`() {
        val currentPartial = NativeAttentionExchangeLogic.evaluateGate(
            gate(),
            evidence(today, seconds = 1800L, pages = 18),
            now,
            today,
        )
        val creationPartial = NativeAttentionExchangeLogic.evaluateGate(
            gate(),
            evidence(yesterday, seconds = 1800L, pages = 18),
            now,
            today,
        )
        val absent = NativeAttentionExchangeLogic.evaluateGate(gate(), null, now, today)

        assertEquals(NativeAttentionGatePhase.READING_REQUIRED, currentPartial.phase)
        assertEquals(NativeAttentionGatePhase.READING_REQUIRED, creationPartial.phase)
        assertEquals(NativeAttentionGatePhase.READER_UNAVAILABLE, absent.phase)
    }

    @Test
    fun `expired timer keeps the gate unless verified evidence completes it`() {
        val cooldown = NativeCooldownPolicy(
            groupId = "social",
            packageNames = setOf("social.app"),
            startedAt = now - 86_400_000L,
            endsAt = now - 60_000L,
            attentionDateKey = yesterday,
            dailyCooldownOrdinal = 3,
            requiredReadingSeconds = 3600L,
            requiredQualifiedPages = 36,
        )

        val waiting = NativeAttentionExchangeLogic.decideCooldownExpiry(
            cooldown,
            gate(),
            null,
            now,
            today,
        )
        assertEquals(NativeCooldownExpiryAction.REMOVE_TIMER_KEEP_GATE, waiting.action)
        assertNotNull(waiting.gate)

        val creationComplete = NativeAttentionExchangeLogic.decideCooldownExpiry(
            cooldown,
            gate(),
            evidence(yesterday),
            now,
            today,
        )
        assertEquals(NativeCooldownExpiryAction.COMPLETE_RESTRICTED_CYCLE, creationComplete.action)
    }

    @Test
    fun `old cooldown can recover its original gate identity`() {
        val cooldown = NativeCooldownPolicy(
            groupId = "social",
            packageNames = setOf("social.app"),
            startedAt = now - 86_400_000L,
            endsAt = now - 60_000L,
            attentionDateKey = yesterday,
            dailyCooldownOrdinal = 3,
            requiredReadingSeconds = 3600L,
            requiredQualifiedPages = 36,
        )

        val recovered = NativeAttentionExchangeLogic.gateForCooldown(cooldown, today)
        assertNotNull(recovered)
        assertEquals(yesterday, recovered!!.attentionDateKey)
        assertEquals(3, recovered.dailyCooldownOrdinal)
    }

    @Test
    fun `carried gate keeps the effective restriction hold`() {
        assertTrue(
            NativeAttentionExchangeLogic.isEffectivelyRestricted(
                baseOrRoutineRestricted = false,
                cooldownActive = false,
                gatePresent = true,
                accessLeaseActive = false,
            )
        )
    }
}
