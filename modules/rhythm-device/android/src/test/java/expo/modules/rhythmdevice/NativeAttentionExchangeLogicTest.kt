package expo.modules.rhythmdevice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Calendar

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
    fun `policy thresholds use the frozen Pass 3 kind table - never cumulative`() {
        assertEquals(NativeRestorativeRequirementKind.NONE, NativeAttentionExchangeLogic.requirementKindForOrdinal(1))
        assertEquals(NativeRestorativeRequirementKind.NONE, NativeAttentionExchangeLogic.requirementKindForOrdinal(2))
        assertEquals(
            NativeRestorativeRequirementKind.BASELINE_READING,
            NativeAttentionExchangeLogic.requirementKindForOrdinal(3),
        )
        assertEquals(
            NativeRestorativeRequirementKind.RESTORATIVE_CHOICE,
            NativeAttentionExchangeLogic.requirementKindForOrdinal(4),
        )
        assertEquals(
            NativeRestorativeRequirementKind.RESTORATIVE_CHOICE,
            NativeAttentionExchangeLogic.requirementKindForOrdinal(5),
        )

        val third = NativeAttentionExchangeLogic.requirementForCooldownOrdinal(3)
        assertEquals(NativeRestorativeRequirementKind.BASELINE_READING, third.kind)
        assertEquals(3600L, third.baselineReadingSeconds)
        assertEquals(36, third.baselineReadingPages)

        // CD4+ is ONE discrete restorative choice - explicitly NOT 5400/47.
        val fourth = NativeAttentionExchangeLogic.requirementForCooldownOrdinal(4)
        assertEquals(NativeRestorativeRequirementKind.RESTORATIVE_CHOICE, fourth.kind)
        assertEquals(1800L, fourth.restorativeReadingSeconds)
        assertEquals(11, fourth.restorativeReadingPages)
        assertEquals(1800L, fourth.meditationSeconds)
        assertEquals(0L, fourth.baselineReadingSeconds)
        assertNotEquals(5400L, fourth.restorativeReadingSeconds)
        assertNotEquals(47, fourth.restorativeReadingPages)

        // CD5+ stays the same discrete choice - explicitly NOT 7200/58.
        val fifth = NativeAttentionExchangeLogic.requirementForCooldownOrdinal(5)
        assertEquals(NativeRestorativeRequirementKind.RESTORATIVE_CHOICE, fifth.kind)
        assertEquals(1800L, fifth.restorativeReadingSeconds)
        assertEquals(11, fifth.restorativeReadingPages)
        assertEquals(1800L, fifth.meditationSeconds)
        assertNotEquals(7200L, fifth.restorativeReadingSeconds)
        assertNotEquals(58, fifth.restorativeReadingPages)

        // The cumulative model survives ONLY as the legacy audit for migrated
        // v1.2 obligations (e.g. an active 5400/47 gate at ordinal 4).
        assertEquals(NativeReadingRequirement(5400, 47), NativeAttentionExchangeLogic.legacyReadingRequirementForOrdinal(4))
        assertEquals(NativeReadingRequirement(7200, 58), NativeAttentionExchangeLogic.legacyReadingRequirementForOrdinal(5))

        val thirdGate = gate()
        assertEquals(
            NativeAttentionGatePhase.READING_REQUIRED,
            NativeAttentionExchangeLogic.evaluateGate(thirdGate, evidence(seconds = 3600, pages = 35), now, today).phase,
        )
        assertEquals(
            NativeAttentionGatePhase.READING_REQUIRED,
            NativeAttentionExchangeLogic.evaluateGate(thirdGate, evidence(seconds = 3599, pages = 80), now, today).phase,
        )
        assertEquals(
            NativeAttentionGatePhase.SATISFIED,
            NativeAttentionExchangeLogic.evaluateGate(thirdGate, evidence(), now, today).phase,
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
        // Reader Preview v2 compatibility columns show the restorative choice's
        // reading requirement (1800/11) - never the obsolete cumulative 5400/47.
        assertEquals(1800L, laterTarget.requiredActiveSeconds)
        assertEquals(11, laterTarget.requiredQualifiedPages)

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
    fun `stale restorative gate from a prior Attention Day does not block a new allocation`() {
        val currentDayId = "ad-20260925-0730"
        val previousDayGate = NativeRestorativeGateState(
            gateId = "gate-ad-20260924-0730-social-o4",
            groupId = "social",
            attentionDayId = "ad-20260924-0730",
            requirementKind = "restorative-choice",
            status = "pending-selection",
        )
        val state = NativeDailyAttentionExchangeState(
            dateKey = tomorrow,
            cooldownsTriggered = 3,
            highestRequiredActiveSeconds = 0L,
            highestRequiredQualifiedPages = 0,
            updatedAt = now,
            attentionDayId = currentDayId,
        )

        val allocation = NativeAttentionExchangeLogic.allocateCooldown(
            state = state,
            policy = NativeAttentionExchangeLogic.DEFAULT_POLICY,
            groupId = "social",
            packageNames = setOf("social.app"),
            startedAt = now,
            endsAt = now + 60_000,
            dateKey = tomorrow,
            existingCooldowns = emptyMap(),
            existingGates = emptyMap(),
            alreadyExhausted = false,
            attentionDayId = currentDayId,
            existingRestorativeGates = mapOf("social" to previousDayGate),
        )

        assertTrue(allocation.allocated)
        assertEquals(4, allocation.dailyAttentionExchange.cooldownsTriggered)
        assertEquals(currentDayId, allocation.restorativeGates["social"]?.attentionDayId)
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
    fun `attention-day ordinal survives midnight but resets at the saved morning boundary`() {
        val attentionDayId = "ad-20260924-0730"
        val oldGate = gate(dateKey = today, ordinal = 4)
        val state = NativeDailyAttentionExchangeState(
            today, 4, 3600L, 36, now, attentionDayId,
        )

        val (afterMidnight, dateScopedGates) = NativeAttentionExchangeLogic.reconcileMidnightRollover(
            nativeState = state,
            nativeGates = mapOf("social" to oldGate),
            today = tomorrow,
            now = now + 60_000,
            attentionDayId = attentionDayId,
        )
        assertEquals(4, afterMidnight.cooldownsTriggered)
        assertEquals(tomorrow, afterMidnight.dateKey)
        assertEquals(attentionDayId, afterMidnight.attentionDayId)
        // The CD3 Daily Reader baseline remains calendar-date scoped.
        assertTrue(dateScopedGates.isEmpty())

        val (nextAttentionDay, _) = NativeAttentionExchangeLogic.reconcileIncomingState(
            nativeState = afterMidnight,
            nativeGates = emptyMap(),
            incomingState = null,
            incomingGates = emptyMap(),
            today = tomorrow,
            now = now + 8 * 60 * 60_000,
            attentionDayId = "ad-20260925-0730",
        )
        assertEquals(0, nextAttentionDay.cooldownsTriggered)
        assertEquals("ad-20260925-0730", nextAttentionDay.attentionDayId)
    }

    @Test
    fun `native attention-day resolver matches morning and calendar fallback boundaries`() {
        val morning = NativeRoutineWindow(
            id = "morning-buffer",
            type = "morning-buffer",
            startTime = "06:30",
            endTime = "07:30",
            activeDays = (1..7).toSet(),
            protectedPackages = emptySet(),
            enabled = true,
        )
        val schedule = NativeRoutineSchedule(listOf(morning), emptySet())
        val at = Calendar.getInstance().apply {
            set(2026, Calendar.SEPTEMBER, 24, 23, 59, 0)
            set(Calendar.MILLISECOND, 0)
        }.timeInMillis
        val day = NativeAttentionExchangeLogic.resolveAttentionDayState(at, schedule)
        assertEquals("ad-20260924-0730", day.id)
        val nextBoundary = Calendar.getInstance().apply {
            timeInMillis = at
            add(Calendar.DAY_OF_YEAR, 1)
            set(Calendar.HOUR_OF_DAY, 7)
            set(Calendar.MINUTE, 30)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }.timeInMillis
        assertEquals(nextBoundary, day.nextBoundaryAt)

        val fallback = NativeAttentionExchangeLogic.resolveAttentionDayState(
            at,
            NativeRoutineSchedule(emptyList(), emptySet()),
        )
        assertEquals("ad-2026-09-24", fallback.id)
    }

    @Test
    fun `a gate created before the morning boundary is not current-day evidence`() {
        val morning = NativeRoutineWindow(
            id = "morning-buffer",
            type = "morning-buffer",
            startTime = "06:30",
            endTime = "07:30",
            activeDays = (1..7).toSet(),
            protectedPackages = emptySet(),
            enabled = true,
        )
        val schedule = NativeRoutineSchedule(listOf(morning), emptySet())
        val beforeBoundary = Calendar.getInstance().apply {
            set(2026, Calendar.OCTOBER, 1, 7, 29, 0)
            set(Calendar.MILLISECOND, 0)
        }.timeInMillis
        val afterBoundary = Calendar.getInstance().apply {
            set(2026, Calendar.OCTOBER, 1, 9, 0, 0)
            set(Calendar.MILLISECOND, 0)
        }.timeInMillis
        val currentDay = NativeAttentionExchangeLogic.resolveAttentionDayState(afterBoundary, schedule)

        assertFalse(NativeAttentionExchangeLogic.wasCreatedInAttentionDay(beforeBoundary, currentDay.id, schedule))
        assertTrue(NativeAttentionExchangeLogic.wasCreatedInAttentionDay(afterBoundary, currentDay.id, schedule))

        val staleIncomingGate = NativeRestorativeGateState(
            gateId = "gate-${currentDay.id}-social-o3",
            groupId = "social",
            attentionDayId = currentDay.id,
            requirementKind = "baseline-reading",
            status = "in-progress",
            createdAt = beforeBoundary,
        )
        assertEquals(
            setOf("social"),
            NativeAttentionExchangeLogic.staleCurrentAttentionGateGroups(
                listOf(staleIncomingGate), currentDay.id, schedule,
            ),
        )
        assertTrue(
            NativeAttentionExchangeLogic.staleCurrentAttentionGateGroups(
                listOf(staleIncomingGate.copy(createdAt = afterBoundary)), currentDay.id, schedule,
            ).isEmpty(),
        )
    }

    @Test
    fun `orphan calendar-date reading gate is filtered by creation Attention Day`() {
        val morning = NativeRoutineWindow(
            id = "morning-buffer",
            type = "morning-buffer",
            startTime = "06:30",
            endTime = "07:30",
            activeDays = (1..7).toSet(),
            protectedPackages = emptySet(),
            enabled = true,
        )
        val schedule = NativeRoutineSchedule(listOf(morning), emptySet())
        val beforeBoundary = Calendar.getInstance().apply {
            set(2026, Calendar.OCTOBER, 1, 7, 29, 0)
            set(Calendar.MILLISECOND, 0)
        }.timeInMillis
        val afterBoundary = Calendar.getInstance().apply {
            set(2026, Calendar.OCTOBER, 1, 9, 0, 0)
            set(Calendar.MILLISECOND, 0)
        }.timeInMillis
        val dayId = NativeAttentionExchangeLogic.resolveAttentionDayId(afterBoundary, schedule)
        val readingGate = NativeReadingGate(
            groupId = "social",
            attentionDateKey = "2026-10-01",
            dailyCooldownOrdinal = 3,
            createdAt = beforeBoundary,
            cooldownEndsAt = afterBoundary + 60_000,
            requiredReadingSeconds = 3600,
            requiredQualifiedPages = 36,
        )

        assertFalse(NativeAttentionExchangeLogic.isCurrentAttentionReadingGate(
            readingGate, dayId, schedule,
        ))
        assertTrue(NativeAttentionExchangeLogic.isCurrentAttentionReadingGate(
            readingGate.copy(createdAt = afterBoundary), dayId, schedule,
        ))
        assertTrue(NativeAttentionExchangeLogic.isCurrentAttentionReadingGate(
            readingGate,
            dayId,
            schedule,
            NativeRestorativeGateState(
                gateId = "legacy-social-o3",
                groupId = "social",
                attentionDayId = "ad-legacy",
                requirementKind = "legacy-reading",
                status = "in-progress",
            ),
        ))
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
