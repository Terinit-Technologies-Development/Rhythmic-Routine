package expo.modules.rhythmdevice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Calendar
import java.util.TimeZone

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
    fun `completed restorative gate from a prior Attention Day permits a new allocation`() {
        val currentDayId = "ad-20260925-0730"
        val previousDayGate = NativeRestorativeGateState(
            gateId = "gate-ad-20260924-0730-social-o4",
            groupId = "social",
            attentionDayId = "ad-20260924-0730",
            requirementKind = "restorative-choice",
            status = "satisfied",
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
    fun `cd4 allocation carries a deterministic gate and missing gate fails closed`() {
        val dayId = "ad-20260924-0730"
        val state = NativeDailyAttentionExchangeState(today, 3, 3600L, 36, now, dayId)
        val allocation = NativeAttentionExchangeLogic.allocateCooldown(
            state = state,
            policy = NativeAttentionExchangeLogic.DEFAULT_POLICY,
            groupId = "social",
            packageNames = setOf("com.twitter.android"),
            startedAt = now,
            endsAt = now + 90 * 60_000L,
            dateKey = today,
            existingCooldowns = emptyMap(),
            existingGates = emptyMap(),
            alreadyExhausted = false,
            attentionDayId = dayId,
            existingRestorativeGates = emptyMap(),
        )
        assertTrue(allocation.allocated)
        val cooldown = allocation.cooldowns.getValue("social")
        val gate = allocation.restorativeGates.getValue("social")
        assertEquals(4, cooldown.dailyCooldownOrdinal)
        assertEquals("restorative-choice", cooldown.requirementKind)
        assertEquals(dayId, cooldown.attentionDayId)
        assertEquals(4, gate.dailyCooldownOrdinal)
        assertEquals(dayId, gate.attentionDayId)

        val retry = NativeAttentionExchangeLogic.allocateCooldown(
            state = allocation.dailyAttentionExchange,
            policy = NativeAttentionExchangeLogic.DEFAULT_POLICY,
            groupId = "social",
            packageNames = setOf("com.twitter.android"),
            startedAt = now,
            endsAt = now + 90 * 60_000L,
            dateKey = today,
            existingCooldowns = allocation.cooldowns,
            existingGates = allocation.readingGates,
            alreadyExhausted = false,
            attentionDayId = dayId,
            existingRestorativeGates = allocation.restorativeGates,
        )
        assertFalse(retry.allocated)
        assertEquals(gate.gateId, allocation.restorativeGates.getValue("social").gateId)

        assertTrue(
            NativeAttentionExchangeLogic.isRestorativeIntentUnresolved(cooldown, null)
        )
        assertTrue(
            NativeAttentionExchangeLogic.isEffectivelyRestricted(
                baseOrRoutineRestricted = false,
                cooldownActive = false,
                gatePresent = false,
                accessLeaseActive = false,
                restorativeHold = NativeAttentionExchangeLogic.isRestorativeIntentUnresolved(
                    cooldown,
                    null,
                ),
            )
        )
    }

    @Test
    fun `restorative recovery uses immutable binding and never the current schedule`() {
        val bound = NativeCooldownPolicy(
            groupId = "social",
            packageNames = setOf("com.twitter.android"),
            startedAt = now,
            endsAt = now - 1,
            attentionDateKey = today,
            dailyCooldownOrdinal = 4,
            attentionDayId = "ad-20260924-0730",
            requirementKind = "restorative-choice",
            restorativeReadingSeconds = 1800,
            restorativeReadingPages = 11,
            requiredMeditationSeconds = 1800,
        )
        val create = NativeAttentionExchangeLogic.restorativeRecoveryDecision(bound, null)
        assertEquals(
            NativeAttentionExchangeLogic.NativeRestorativeRecoveryAction.CREATE,
            create.action,
        )
        assertEquals("ad-20260924-0730", create.attentionDayId)
        assertEquals(
            RestorativeEnforcement.gateIdFor("ad-20260924-0730", "social", 4),
            create.gateId,
        )

        val existing = NativeRestorativeGateState(
            gateId = create.gateId!!,
            groupId = "social",
            attentionDayId = create.attentionDayId!!,
            requirementKind = "restorative-choice",
            status = "satisfied",
            dailyCooldownOrdinal = 4,
            createdAt = now,
        )
        assertEquals(
            NativeAttentionExchangeLogic.NativeRestorativeRecoveryAction.ACCEPT_EXISTING,
            NativeAttentionExchangeLogic.restorativeRecoveryDecision(bound, existing).action,
        )
        val staleOldDay = existing.copy(
            attentionDayId = "ad-20260923-0730",
            gateId = RestorativeEnforcement.gateIdFor("ad-20260923-0730", "social", 4),
        )
        assertEquals(
            NativeAttentionExchangeLogic.NativeRestorativeRecoveryAction.UNRESOLVED,
            NativeAttentionExchangeLogic.restorativeRecoveryDecision(bound, staleOldDay).action,
        )
        assertEquals(
            NativeAttentionExchangeLogic.NativeRestorativeRecoveryAction.UNRESOLVED,
            NativeAttentionExchangeLogic.restorativeRecoveryDecision(
                bound,
                existing.copy(groupId = "video"),
            ).action,
        )
        assertEquals(
            NativeAttentionExchangeLogic.NativeRestorativeRecoveryAction.UNRESOLVED,
            NativeAttentionExchangeLogic.restorativeRecoveryDecision(
                bound,
                existing.copy(requirementKind = "baseline-reading"),
            ).action,
        )
        assertEquals(
            NativeAttentionExchangeLogic.NativeRestorativeRecoveryAction.UNRESOLVED,
            NativeAttentionExchangeLogic.restorativeRecoveryDecision(
                bound,
                existing.copy(createdAt = now - 1000),
            ).action,
        )
        val legacyBound = bound.copy(attentionDayId = null)
        assertEquals(
            NativeAttentionExchangeLogic.NativeRestorativeRecoveryAction.ACCEPT_EXISTING,
            NativeAttentionExchangeLogic.restorativeRecoveryDecision(legacyBound, existing).action,
        )
        assertEquals(
            NativeAttentionExchangeLogic.NativeRestorativeRecoveryAction.UNRESOLVED,
            NativeAttentionExchangeLogic.restorativeRecoveryDecision(
                legacyBound,
                existing.copy(createdAt = now - 1000),
            ).action,
        )

        val missingIdentity = bound.copy(attentionDayId = null)
        assertEquals(
            NativeAttentionExchangeLogic.NativeRestorativeRecoveryAction.UNRESOLVED,
            NativeAttentionExchangeLogic.restorativeRecoveryDecision(missingIdentity, null).action,
        )
        val malformed = bound.copy(dailyCooldownOrdinal = 0)
        assertEquals(
            NativeAttentionExchangeLogic.NativeRestorativeRecoveryAction.UNRESOLVED,
            NativeAttentionExchangeLogic.restorativeRecoveryDecision(malformed, null).action,
        )
        assertTrue(
            NativeAttentionExchangeLogic.isRestorativeIntentUnresolved(malformed, null)
        )
    }

    @Test
    fun `completed historical gate allows a new cycle while unfinished carried gate blocks it`() {
        val dayId = "ad-20260924-0730"
        val state = NativeDailyAttentionExchangeState(today, 3, 3600L, 36, now, dayId)
        val completed = NativeRestorativeGateState(
            gateId = "gate-old-social-o3",
            groupId = "social",
            attentionDayId = "ad-20260923-0730",
            requirementKind = "restorative-choice",
            status = "satisfied",
            dailyCooldownOrdinal = 3,
            createdAt = now - 86_400_000L,
        )
        val allowed = NativeAttentionExchangeLogic.allocateCooldown(
            state, NativeAttentionExchangeLogic.DEFAULT_POLICY, "social",
            setOf("com.twitter.android"), now, now + 60_000L, today,
            emptyMap(), emptyMap(), false, dayId, mapOf("social" to completed),
        )
        assertTrue(allowed.allocated)

        val unfinished = completed.copy(status = "in-progress", gateId = "gate-old-social-o4")
        val blocked = NativeAttentionExchangeLogic.allocateCooldown(
            state, NativeAttentionExchangeLogic.DEFAULT_POLICY, "social",
            setOf("com.twitter.android"), now, now + 60_000L, today,
            emptyMap(), emptyMap(), false, dayId, mapOf("social" to unfinished),
        )
        assertFalse(blocked.allocated)
    }

    @Test
    fun `exhaustion allocation preserves concurrent other-group cooldown and gate`() {
        val dayId = "ad-20260924-0730"
        val state = NativeDailyAttentionExchangeState(today, 3, 3600L, 36, now, dayId)
        val otherCooldown = NativeCooldownPolicy(
            groupId = "video",
            packageNames = setOf("com.youtube"),
            startedAt = now - 1000,
            endsAt = now + 60_000,
            attentionDateKey = today,
            dailyCooldownOrdinal = 3,
            attentionDayId = dayId,
            requirementKind = "baseline-reading",
            requiredReadingSeconds = 3600,
            requiredQualifiedPages = 36,
        )
        val otherGate = NativeReadingGate(
            "video", today, 3, now - 1000, now + 60_000, 3600, 36,
        )
        val allocation = NativeAttentionExchangeLogic.allocateCooldown(
            state = state,
            policy = NativeAttentionExchangeLogic.DEFAULT_POLICY,
            groupId = "social",
            packageNames = setOf("com.twitter.android"),
            startedAt = now,
            endsAt = now + 90 * 60_000L,
            dateKey = today,
            existingCooldowns = mapOf("video" to otherCooldown),
            existingGates = mapOf("video" to otherGate),
            alreadyExhausted = false,
            attentionDayId = dayId,
            existingRestorativeGates = emptyMap(),
        )
        assertTrue(allocation.allocated)
        assertEquals(otherCooldown, allocation.cooldowns["video"])
        assertEquals(otherGate, allocation.readingGates["video"])
        assertTrue(allocation.cooldowns.containsKey("social"))
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
        val staleJsGate = gate(groupId = "video", ordinal = 1, seconds = 3600, pages = 36)

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
    fun `midnight keeps an unfinished previous day gate and prior day timer`() {
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
        // PD-2: the unfinished gate is carried; the new day does not inherit its ordinal.
        assertTrue(newGates.containsKey("social"))
        assertEquals(today, newGates.getValue("social").attentionDateKey)

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
        // The timer is gone but the gate remains until verified completion.
        assertEquals(
            NativeCooldownExpiryAction.REMOVE_TIMER_KEEP_GATE,
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

        val (afterMidnight, carriedGates) = NativeAttentionExchangeLogic.reconcileMidnightRollover(
            nativeState = state,
            nativeGates = mapOf("social" to oldGate),
            today = tomorrow,
            now = now + 60_000,
            attentionDayId = attentionDayId,
        )
        assertEquals(4, afterMidnight.cooldownsTriggered)
        assertEquals(tomorrow, afterMidnight.dateKey)
        assertEquals(attentionDayId, afterMidnight.attentionDayId)
        // CD3 evidence remains calendar-date scoped, but the unfinished gate is
        // carried with its original creation key.
        assertTrue(carriedGates.containsKey("social"))
        assertEquals(today, carriedGates.getValue("social").attentionDateKey)

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

    // ── SW-2026-005 A1: Attention Day clock boundary ──────────────────────

    private fun morningWindow(
        id: String = "morning-buffer",
        endTime: String = "07:30",
        activeDays: Set<Int> = (1..7).toSet(),
        enabled: Boolean = true,
    ) = NativeRoutineWindow(
        id = id,
        type = "morning-buffer",
        startTime = "06:30",
        endTime = endTime,
        activeDays = activeDays,
        protectedPackages = emptySet(),
        enabled = enabled,
    )

    private fun scheduleOf(vararg windows: NativeRoutineWindow) =
        NativeRoutineSchedule(windows.toList(), emptySet())

    private fun localEpoch(year: Int, month: Int, day: Int, hour: Int, minute: Int): Long =
        Calendar.getInstance().apply {
            clear()
            set(year, month - 1, day, hour, minute, 0)
            set(Calendar.MILLISECOND, 0)
        }.timeInMillis

    private fun utcEpoch(year: Int, month: Int, day: Int, hour: Int, minute: Int): Long =
        Calendar.getInstance(TimeZone.getTimeZone("UTC")).apply {
            clear()
            set(year, month - 1, day, hour, minute, 0)
            set(Calendar.MILLISECOND, 0)
        }.timeInMillis

    @Test
    fun `inactive weekend days keep their own daily clock boundary`() {
        val schedule = scheduleOf(morningWindow(activeDays = setOf(1, 2, 3, 4, 5)))
        val friday = localEpoch(2026, 9, 25, 12, 0)
        val saturday = localEpoch(2026, 9, 26, 12, 0)
        val sunday = localEpoch(2026, 9, 27, 12, 0)
        val monday = localEpoch(2026, 9, 28, 12, 0)

        assertEquals("ad-20260925-0730", NativeAttentionExchangeLogic.resolveAttentionDayId(friday, schedule))
        assertEquals("ad-20260926-0730", NativeAttentionExchangeLogic.resolveAttentionDayId(saturday, schedule))
        assertEquals("ad-20260927-0730", NativeAttentionExchangeLogic.resolveAttentionDayId(sunday, schedule))
        assertEquals("ad-20260928-0730", NativeAttentionExchangeLogic.resolveAttentionDayId(monday, schedule))

        // No Friday-to-Monday stretch while Saturday/Sunday windows are inactive.
        val fridayState = NativeAttentionExchangeLogic.resolveAttentionDayState(friday, schedule)
        val saturdayState = NativeAttentionExchangeLogic.resolveAttentionDayState(saturday, schedule)
        assertEquals(localEpoch(2026, 9, 26, 7, 30), fridayState.nextBoundaryAt)
        assertEquals(localEpoch(2026, 9, 27, 7, 30), saturdayState.nextBoundaryAt)
        assertNotEquals(localEpoch(2026, 9, 28, 7, 30), fridayState.nextBoundaryAt)
    }

    @Test
    fun `midnight does not reset a morning clock Attention Day`() {
        val schedule = scheduleOf(morningWindow(activeDays = setOf(1, 2, 3, 4, 5)))

        assertEquals(
            "ad-20260925-0730",
            NativeAttentionExchangeLogic.resolveAttentionDayId(localEpoch(2026, 9, 25, 23, 59), schedule),
        )
        assertEquals(
            "ad-20260925-0730",
            NativeAttentionExchangeLogic.resolveAttentionDayId(localEpoch(2026, 9, 26, 0, 1), schedule),
        )
        assertEquals(
            "ad-20260925-0730",
            NativeAttentionExchangeLogic.resolveAttentionDayId(localEpoch(2026, 9, 26, 7, 29), schedule),
        )
        assertEquals(
            "ad-20260926-0730",
            NativeAttentionExchangeLogic.resolveAttentionDayId(localEpoch(2026, 9, 26, 7, 30), schedule),
        )
    }

    @Test
    fun `disabled and empty-activeDays windows still configure the accounting clock`() {
        val disabled = scheduleOf(
            morningWindow(activeDays = setOf(1, 2, 3, 4, 5), enabled = false),
        )
        assertEquals(
            "ad-20260926-0730",
            NativeAttentionExchangeLogic.resolveAttentionDayId(localEpoch(2026, 9, 26, 12, 0), disabled),
        )

        val noActiveDays = scheduleOf(morningWindow(activeDays = emptySet()))
        assertEquals(
            "ad-20260926-0730",
            NativeAttentionExchangeLogic.resolveAttentionDayId(localEpoch(2026, 9, 26, 12, 0), noActiveDays),
        )
    }

    @Test
    fun `malformed morning clocks fall back to midnight and report an actionable issue`() {
        val malformed = scheduleOf(morningWindow(id = "morning-primary", endTime = "not-a-time"))
        val at = localEpoch(2026, 9, 26, 23, 59)
        val state = NativeAttentionExchangeLogic.resolveAttentionDayState(at, malformed)
        val issue = NativeAttentionExchangeLogic.attentionDayClockIssue(malformed)

        assertEquals("ad-2026-09-26", state.id)
        assertEquals(localEpoch(2026, 9, 27, 0, 0), state.nextBoundaryAt)
        assertNull(NativeAttentionExchangeLogic.configuredAttentionDayClockMinutes(malformed))
        assertNotNull(issue)
        assertTrue(issue!!.contains("morning-primary"))
        assertTrue(issue.contains("malformed endTime"))
        assertTrue(issue.contains("HH:MM"))

        val missing = scheduleOf(morningWindow(id = "morning-no-end", endTime = "  "))
        assertEquals("ad-2026-09-26", NativeAttentionExchangeLogic.resolveAttentionDayId(at, missing))
        assertNotNull(NativeAttentionExchangeLogic.attentionDayClockIssue(missing))
    }

    @Test
    fun `the first usable configured morning clock wins`() {
        val schedule = scheduleOf(
            morningWindow(id = "morning-broken", endTime = "25:99"),
            morningWindow(id = "morning-valid", endTime = "08:15"),
        )

        assertEquals(
            8 * 60 + 15,
            NativeAttentionExchangeLogic.configuredAttentionDayClockMinutes(schedule) ?: -1,
        )
        assertNotNull(NativeAttentionExchangeLogic.attentionDayClockIssue(schedule))
        assertEquals(
            "ad-20260926-0815",
            NativeAttentionExchangeLogic.resolveAttentionDayId(localEpoch(2026, 9, 26, 9, 0), schedule),
        )
    }

    @Test
    fun `resolved boundary is always strictly after the sampled instant`() {
        val schedule = scheduleOf(morningWindow(activeDays = setOf(1, 2, 3, 4, 5)))
        val samples = listOf(
            localEpoch(2026, 9, 25, 7, 29),
            localEpoch(2026, 9, 25, 7, 30),
            localEpoch(2026, 9, 26, 0, 0),
            localEpoch(2026, 9, 26, 7, 30),
            localEpoch(2026, 9, 27, 23, 59),
            localEpoch(2026, 9, 28, 0, 0),
            localEpoch(2026, 9, 28, 7, 30),
        )
        for (at in samples) {
            val state = NativeAttentionExchangeLogic.resolveAttentionDayState(at, schedule)
            assertTrue("next boundary must be after $at", state.nextBoundaryAt > at)
        }
    }

    @Test
    fun `spring and fall DST days use civil calendar boundaries`() {
        val original = TimeZone.getDefault()
        try {
            TimeZone.setDefault(TimeZone.getTimeZone("America/New_York"))
            val schedule = scheduleOf(morningWindow())

            // 2026-03-08 02:00 -> 03:00: the Attention Day that opens 07:30 on
            // 03-07 spans 23 real hours.
            val spring = NativeAttentionExchangeLogic.resolveAttentionDayState(
                localEpoch(2026, 3, 7, 12, 0),
                schedule,
            )
            assertEquals("ad-20260307-0730", spring.id)
            assertEquals(localEpoch(2026, 3, 8, 7, 30), spring.nextBoundaryAt)
            assertEquals(
                23L * 60L * 60L * 1000L,
                spring.nextBoundaryAt - localEpoch(2026, 3, 7, 7, 30),
            )

            // 2026-11-01 02:00 -> 01:00: the Attention Day that opens 07:30 on
            // 10-31 spans 25 real hours.
            val fall = NativeAttentionExchangeLogic.resolveAttentionDayState(
                localEpoch(2026, 10, 31, 12, 0),
                schedule,
            )
            assertEquals("ad-20261031-0730", fall.id)
            assertEquals(localEpoch(2026, 11, 1, 7, 30), fall.nextBoundaryAt)
            assertEquals(
                25L * 60L * 60L * 1000L,
                fall.nextBoundaryAt - localEpoch(2026, 10, 31, 7, 30),
            )
        } finally {
            TimeZone.setDefault(original)
        }
    }

    @Test
    fun `gap and overlap boundary clocks match JavaScript civil-time semantics`() {
        val original = TimeZone.getDefault()
        try {
            TimeZone.setDefault(TimeZone.getTimeZone("America/New_York"))

            // 02:30 does not exist on spring-forward day: normalize to 03:30 EDT.
            val gapSchedule = scheduleOf(morningWindow(endTime = "02:30"))
            val gap = NativeAttentionExchangeLogic.resolveAttentionDayState(
                localEpoch(2026, 3, 8, 12, 0),
                gapSchedule,
            )
            assertEquals("ad-20260308-0330", gap.id)
            assertEquals(localEpoch(2026, 3, 9, 2, 30), gap.nextBoundaryAt)
            assertEquals(
                23L * 60L * 60L * 1000L,
                gap.nextBoundaryAt - utcEpoch(2026, 3, 8, 7, 30), // 03:30 EDT
            )

            // 01:30 occurs twice on fall-back day: choose the earlier (EDT)
            // occurrence exactly like ECMAScript Date.
            val overlapSchedule = scheduleOf(morningWindow(endTime = "01:30"))
            val overlap = NativeAttentionExchangeLogic.resolveAttentionDayState(
                localEpoch(2026, 11, 1, 12, 0),
                overlapSchedule,
            )
            assertEquals("ad-20261101-0130", overlap.id)
            val earlierOccurrence = utcEpoch(2026, 11, 1, 5, 30) // 01:30 EDT
            val laterBoundary = utcEpoch(2026, 11, 2, 6, 30) // 01:30 EST
            assertEquals(laterBoundary, overlap.nextBoundaryAt)
            assertEquals(
                25L * 60L * 60L * 1000L,
                overlap.nextBoundaryAt - earlierOccurrence,
            )
        } finally {
            TimeZone.setDefault(original)
        }
    }

    @Test
    fun `the same instant resolves deterministically after a timezone change`() {
        val original = TimeZone.getDefault()
        try {
            val schedule = scheduleOf(morningWindow())
            val instant = utcEpoch(2026, 9, 26, 0, 0) // 2026-09-25T20:00 New York

            TimeZone.setDefault(TimeZone.getTimeZone("America/New_York"))
            assertEquals(
                "ad-20260925-0730",
                NativeAttentionExchangeLogic.resolveAttentionDayId(instant, schedule),
            )

            // 2026-09-26T09:00 in Tokyo: the local morning clock has passed.
            TimeZone.setDefault(TimeZone.getTimeZone("Asia/Tokyo"))
            assertEquals(
                "ad-20260926-0730",
                NativeAttentionExchangeLogic.resolveAttentionDayId(instant, schedule),
            )
        } finally {
            TimeZone.setDefault(original)
        }
    }

    @Test
    fun `accepted allocation advances its current day without rewinding civil reporting time`() {
        val current = NativeDailyAttentionExchangeState(
            "2026-09-29", 3, 3600L, 36, 2000L, "ad-20260928-0830",
        )
        val allocated = current.copy(
            dateKey = "2026-09-28", cooldownsTriggered = 4, updatedAt = 1000L,
        )
        val committed = NativeAttentionExchangeLogic.stateAfterAcceptedAllocation(current, allocated)
        assertEquals(4, committed.cooldownsTriggered)
        assertEquals(current.dateKey, committed.dateKey)
        assertEquals(current.attentionDayId, committed.attentionDayId)
        assertEquals(current.updatedAt, committed.updatedAt)
    }

    @Test
    fun `accepted prior day retry cannot replace the current global allocation counters`() {
        val current = NativeDailyAttentionExchangeState(
            "2026-09-29", 7, 3600L, 36, 2000L, "ad-20260929-0830",
        )
        val oldAllocation = current.copy(
            dateKey = "2026-09-28", cooldownsTriggered = 4, updatedAt = 1000L,
            attentionDayId = "ad-20260928-0830",
        )
        assertEquals(
            current,
            NativeAttentionExchangeLogic.stateAfterAcceptedAllocation(current, oldAllocation),
        )
    }
}
