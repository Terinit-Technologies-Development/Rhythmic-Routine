package expo.modules.rhythmdevice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeGroupUsageAccountingTest {
    private val dateKey = "2026-09-24"
    private val localMidnight = 1_790_179_200_000L
    private val segmentStartedAt = localMidnight + 12 * 60 * 60_000L
    private val exhaustionAt = segmentStartedAt + 5 * 60_000L
    private val allowanceMillis = 30 * 60_000L

    @Test
    fun `exhaustion watermark prevents old UsageStats intervals from replaying after cycle reset`() {
        val priorUsage = NativeGroupAllowanceUsage(
            groupId = "social",
            dateKey = dateKey,
            usedMillis = 25 * 60_000L,
            activePackageName = "social.app",
            activeSegmentStartedAt = segmentStartedAt,
            exhaustedAt = null,
            cycleRevision = 7L,
        )
        val staleWatermark = segmentStartedAt - 10 * 60_000L

        assertFalse(
            NativeGroupUsageAccounting.hasCommittedExhaustion(
                "social", dateKey, priorUsage, emptyMap(), emptyMap(),
            ),
        )

        val exhaustion = NativeGroupUsageAccounting.prepareExhaustion(
            groupId = "social",
            dateKey = dateKey,
            now = exhaustionAt,
            localMidnight = localMidnight,
            allowanceMillis = allowanceMillis,
            previousUsage = priorUsage,
            activeSegmentStartedAt = segmentStartedAt,
            existingWatermark = staleWatermark,
        )

        assertEquals(allowanceMillis, exhaustion.usage.usedMillis)
        assertEquals(exhaustionAt, exhaustion.usage.exhaustedAt)
        assertEquals(exhaustionAt, exhaustion.accountedThrough)
        assertNull(exhaustion.usage.activePackageName)
        assertNull(exhaustion.usage.activeSegmentStartedAt)
        assertEquals(7L, exhaustion.usage.cycleRevision)

        val initialAttentionState = NativeDailyAttentionExchangeState(dateKey, 2, 0L, 0, segmentStartedAt)
        val firstAllocation = NativeAttentionExchangeLogic.allocateCooldown(
            state = initialAttentionState,
            policy = NativeAttentionExchangeLogic.DEFAULT_POLICY,
            groupId = "social",
            packageNames = setOf("social.app"),
            startedAt = exhaustionAt,
            endsAt = exhaustionAt + 60 * 60_000L,
            dateKey = dateKey,
            existingCooldowns = emptyMap(),
            existingGates = emptyMap(),
            alreadyExhausted = false,
        )
        assertTrue(firstAllocation.allocated)
        assertEquals(3, firstAllocation.dailyAttentionExchange.cooldownsTriggered)

        // A repeated threshold callback sees the committed exhausted ledger/cooldown/gate
        // through the same guard used by exhaustGroup(), so it cannot allocate a second ordinal.
        assertTrue(
            NativeGroupUsageAccounting.hasCommittedExhaustion(
                "social",
                dateKey,
                exhaustion.usage,
                firstAllocation.cooldowns,
                firstAllocation.readingGates,
            ),
        )
        assertEquals(1, firstAllocation.cooldowns.size)
        assertEquals(1, firstAllocation.readingGates.size)
        assertEquals(3, firstAllocation.readingGates["social"]?.dailyCooldownOrdinal)
        assertEquals(
            exhaustionAt,
            NativeGroupUsageAccounting.withWatermarkUpdates(
                mapOf("social" to staleWatermark),
                mapOf("social" to exhaustion.accountedThrough),
            )["social"],
        )

        val completedAt = exhaustionAt + 60 * 60_000L
        val resetUsage = NativeAttentionExchangeLogic.completeGroupCycle(
            groupId = "social",
            dateKey = dateKey,
            now = completedAt,
            previous = exhaustion.usage,
        )
        assertEquals(0L, resetUsage.usedMillis)
        assertNull(resetUsage.exhaustedAt)
        assertEquals(8L, resetUsage.cycleRevision)

        // Reconciliation later sees the old pre-exhaustion history plus new activity.
        // The saved exhaustion watermark clips the old interval and admits only post-reset use.
        val preExhaustionReplay = NativeGroupUsageAccounting.unaccountedIntervalMillis(
            startedAt = exhaustionAt - 10 * 60_000L,
            endedAt = exhaustionAt,
            watermark = exhaustion.accountedThrough,
            localMidnight = localMidnight,
        )
        val newCycleActivity = NativeGroupUsageAccounting.unaccountedIntervalMillis(
            startedAt = completedAt + 60_000L,
            endedAt = completedAt + 4 * 60_000L,
            watermark = exhaustion.accountedThrough,
            localMidnight = localMidnight,
        )
        val reconciledNextCycle = resetUsage.copy(
            usedMillis = resetUsage.usedMillis + preExhaustionReplay + newCycleActivity,
        )

        assertEquals(0L, preExhaustionReplay)
        assertEquals(3 * 60_000L, newCycleActivity)
        assertEquals(3 * 60_000L, reconciledNextCycle.usedMillis)
    }

    @Test
    fun `watermark never moves backward when a committed boundary is older`() {
        val laterWatermark = exhaustionAt + 60_000L
        assertEquals(
            laterWatermark,
            NativeGroupUsageAccounting.nextAccountingWatermark(laterWatermark, exhaustionAt),
        )
    }
}
