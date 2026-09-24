package expo.modules.rhythmdevice

data class NativeReadingAttentionPolicy(
    val freeCooldownCount: Int = 2,
    val baselineActiveSeconds: Long = 60L * 60L,
    val baselineQualifiedPages: Int = 36,
    val incrementalActiveSeconds: Long = 30L * 60L,
    val incrementalQualifiedPages: Int = 11,
) {
    fun normalized() = copy(
        freeCooldownCount = freeCooldownCount.coerceAtLeast(0),
        baselineActiveSeconds = baselineActiveSeconds.coerceAtLeast(0L),
        baselineQualifiedPages = baselineQualifiedPages.coerceAtLeast(0),
        incrementalActiveSeconds = incrementalActiveSeconds.coerceAtLeast(0L),
        incrementalQualifiedPages = incrementalQualifiedPages.coerceAtLeast(0),
    )
}

data class NativeReadingRequirement(val activeSeconds: Long, val qualifiedPages: Int)

data class NativeDailyAttentionExchangeState(
    val dateKey: String,
    val cooldownsTriggered: Int,
    val highestRequiredActiveSeconds: Long,
    val highestRequiredQualifiedPages: Int,
    val updatedAt: Long,
)

data class NativeReadingGate(
    val groupId: String,
    val attentionDateKey: String,
    val dailyCooldownOrdinal: Int,
    val createdAt: Long,
    val cooldownEndsAt: Long,
    val requiredReadingSeconds: Long,
    val requiredQualifiedPages: Int,
)

data class NativeDailyReadingEvidenceResult(
    val providerAvailable: Boolean,
    val protocolCompatible: Boolean,
    val protocolVersion: Int?,
    val dateKey: String,
    val verifiedActiveSeconds: Long,
    val qualifiedPages: Int,
    val updatedAtEpochMs: Long,
)

enum class NativeAttentionGatePhase {
    NONE,
    COOLDOWN_ACTIVE,
    READING_REQUIRED,
    READER_UNAVAILABLE,
    READER_INCOMPATIBLE,
    SATISFIED,
}

data class NativeAttentionGateEvaluation(
    val phase: NativeAttentionGatePhase,
    val verifiedActiveSeconds: Long,
    val qualifiedPages: Int,
    val remainingSeconds: Long,
    val remainingPages: Int,
    val readerProviderAvailable: Boolean,
    val readerProtocolCompatible: Boolean,
)

data class NativeCooldownAllocation(
    val dailyAttentionExchange: NativeDailyAttentionExchangeState,
    val cooldowns: Map<String, NativeCooldownPolicy>,
    val readingGates: Map<String, NativeReadingGate>,
    val allocated: Boolean,
)

enum class NativeCooldownExpiryAction {
    KEEP_ACTIVE_TIMER,
    REMOVE_TIMER_KEEP_GATE,
    COMPLETE_RESTRICTED_CYCLE,
}

data class NativeCooldownExpiryDecision(
    val action: NativeCooldownExpiryAction,
    val phase: NativeAttentionGatePhase,
    val gate: NativeReadingGate?,
)

object NativeAttentionExchangeLogic {
    val DEFAULT_POLICY = NativeReadingAttentionPolicy()

    fun newDailyState(dateKey: String, now: Long) = NativeDailyAttentionExchangeState(
        dateKey = dateKey,
        cooldownsTriggered = 0,
        highestRequiredActiveSeconds = 0L,
        highestRequiredQualifiedPages = 0,
        updatedAt = now,
    )

    fun requirementForCooldownOrdinal(
        ordinal: Int,
        policy: NativeReadingAttentionPolicy = DEFAULT_POLICY,
    ): NativeReadingRequirement {
        val normalized = policy.normalized()
        val safeOrdinal = ordinal.coerceAtLeast(0)
        if (safeOrdinal <= normalized.freeCooldownCount) {
            return NativeReadingRequirement(0L, 0)
        }

        val increments = safeOrdinal.toLong() - normalized.freeCooldownCount.toLong() - 1L
        return NativeReadingRequirement(
            activeSeconds = saturatedAdd(
                normalized.baselineActiveSeconds,
                saturatedMultiply(increments, normalized.incrementalActiveSeconds),
            ),
            qualifiedPages = saturatedIntAdd(
                normalized.baselineQualifiedPages,
                saturatedIntMultiply(increments, normalized.incrementalQualifiedPages),
            ),
        )
    }

    /** One global ordinal per accepted exhaustion; existing timer/gate/ledger state makes retries idempotent. */
    fun allocateCooldown(
        state: NativeDailyAttentionExchangeState,
        policy: NativeReadingAttentionPolicy,
        groupId: String,
        packageNames: Set<String>,
        startedAt: Long,
        endsAt: Long,
        dateKey: String,
        existingCooldowns: Map<String, NativeCooldownPolicy>,
        existingGates: Map<String, NativeReadingGate>,
        alreadyExhausted: Boolean,
    ): NativeCooldownAllocation {
        if (
            alreadyExhausted ||
            existingCooldowns.containsKey(groupId) ||
            existingGates[groupId]?.attentionDateKey == dateKey
        ) {
            return NativeCooldownAllocation(state, existingCooldowns, existingGates, allocated = false)
        }

        val daily = if (state.dateKey == dateKey) state else newDailyState(dateKey, startedAt)
        val ordinal = if (daily.cooldownsTriggered == Int.MAX_VALUE) Int.MAX_VALUE else daily.cooldownsTriggered + 1
        val requirement = requirementForCooldownOrdinal(ordinal, policy)
        val cooldown = NativeCooldownPolicy(
            groupId = groupId,
            packageNames = packageNames,
            startedAt = startedAt,
            endsAt = endsAt,
            attentionDateKey = dateKey,
            dailyCooldownOrdinal = ordinal,
            requiredReadingSeconds = requirement.activeSeconds,
            requiredQualifiedPages = requirement.qualifiedPages,
        )
        val nextCooldowns = existingCooldowns.toMutableMap().apply { put(groupId, cooldown) }
        val nextGates = existingGates.toMutableMap().apply {
            remove(groupId)
            if (requirement.activeSeconds > 0L || requirement.qualifiedPages > 0) {
                put(
                    groupId,
                    NativeReadingGate(
                        groupId = groupId,
                        attentionDateKey = dateKey,
                        dailyCooldownOrdinal = ordinal,
                        createdAt = startedAt,
                        cooldownEndsAt = endsAt,
                        requiredReadingSeconds = requirement.activeSeconds,
                        requiredQualifiedPages = requirement.qualifiedPages,
                    ),
                )
            }
        }

        return NativeCooldownAllocation(
            dailyAttentionExchange = daily.copy(
                cooldownsTriggered = ordinal,
                highestRequiredActiveSeconds = maxOf(daily.highestRequiredActiveSeconds, requirement.activeSeconds),
                highestRequiredQualifiedPages = maxOf(daily.highestRequiredQualifiedPages, requirement.qualifiedPages),
                updatedAt = startedAt,
            ),
            cooldowns = nextCooldowns,
            readingGates = nextGates,
            allocated = true,
        )
    }

    fun gateForCooldown(cooldown: NativeCooldownPolicy, today: String): NativeReadingGate? {
        val dateKey = cooldown.attentionDateKey ?: return null
        val ordinal = cooldown.dailyCooldownOrdinal ?: return null
        if (dateKey != today || ordinal <= 0) return null
        if (cooldown.requiredReadingSeconds <= 0L && cooldown.requiredQualifiedPages <= 0) return null
        return NativeReadingGate(
            groupId = cooldown.groupId,
            attentionDateKey = dateKey,
            dailyCooldownOrdinal = ordinal,
            createdAt = cooldown.startedAt,
            cooldownEndsAt = cooldown.endsAt,
            requiredReadingSeconds = cooldown.requiredReadingSeconds.coerceAtLeast(0L),
            requiredQualifiedPages = cooldown.requiredQualifiedPages.coerceAtLeast(0),
        )
    }

    fun evaluateGate(
        gate: NativeReadingGate,
        evidence: NativeDailyReadingEvidenceResult?,
        now: Long,
        today: String,
    ): NativeAttentionGateEvaluation {
        val available = evidence?.providerAvailable == true
        val compatible = evidence?.let {
            it.protocolCompatible && it.protocolVersion == 2 && it.dateKey == today &&
                it.verifiedActiveSeconds >= 0L && it.qualifiedPages >= 0
        } == true
        val seconds = if (compatible) evidence!!.verifiedActiveSeconds else 0L
        val pages = if (compatible) evidence!!.qualifiedPages else 0
        val remainingSeconds = (gate.requiredReadingSeconds - seconds).coerceAtLeast(0L)
        val remainingPages = (gate.requiredQualifiedPages - pages).coerceAtLeast(0)

        val phase = when {
            gate.attentionDateKey != today -> NativeAttentionGatePhase.NONE
            gate.cooldownEndsAt > now -> NativeAttentionGatePhase.COOLDOWN_ACTIVE
            !available -> NativeAttentionGatePhase.READER_UNAVAILABLE
            !compatible -> NativeAttentionGatePhase.READER_INCOMPATIBLE
            seconds >= gate.requiredReadingSeconds && pages >= gate.requiredQualifiedPages -> NativeAttentionGatePhase.SATISFIED
            else -> NativeAttentionGatePhase.READING_REQUIRED
        }
        return NativeAttentionGateEvaluation(
            phase = phase,
            verifiedActiveSeconds = seconds,
            qualifiedPages = pages,
            remainingSeconds = remainingSeconds,
            remainingPages = remainingPages,
            readerProviderAvailable = available,
            readerProtocolCompatible = compatible,
        )
    }

    fun decideCooldownExpiry(
        cooldown: NativeCooldownPolicy,
        gate: NativeReadingGate?,
        evidence: NativeDailyReadingEvidenceResult?,
        now: Long,
        today: String,
    ): NativeCooldownExpiryDecision {
        if (cooldown.endsAt > now) {
            return NativeCooldownExpiryDecision(NativeCooldownExpiryAction.KEEP_ACTIVE_TIMER, NativeAttentionGatePhase.COOLDOWN_ACTIVE, gate)
        }

        // A prior day's obligation expires at local midnight; the timer itself remains authoritative.
        if (cooldown.attentionDateKey != today) {
            return NativeCooldownExpiryDecision(NativeCooldownExpiryAction.COMPLETE_RESTRICTED_CYCLE, NativeAttentionGatePhase.NONE, null)
        }

        val effectiveGate = gate?.takeIf { it.attentionDateKey == today } ?: gateForCooldown(cooldown, today)
        if (effectiveGate == null) {
            return NativeCooldownExpiryDecision(NativeCooldownExpiryAction.COMPLETE_RESTRICTED_CYCLE, NativeAttentionGatePhase.NONE, null)
        }

        val evaluation = evaluateGate(effectiveGate, evidence, now, today)
        return if (evaluation.phase == NativeAttentionGatePhase.SATISFIED) {
            NativeCooldownExpiryDecision(NativeCooldownExpiryAction.COMPLETE_RESTRICTED_CYCLE, evaluation.phase, null)
        } else {
            NativeCooldownExpiryDecision(NativeCooldownExpiryAction.REMOVE_TIMER_KEEP_GATE, evaluation.phase, effectiveGate.copy(cooldownEndsAt = cooldown.endsAt))
        }
    }

    /** Existing native state wins on the same date. JS can initialize an empty native store once. */
    fun reconcileIncomingState(
        nativeState: NativeDailyAttentionExchangeState?,
        nativeGates: Map<String, NativeReadingGate>,
        incomingState: NativeDailyAttentionExchangeState?,
        incomingGates: Map<String, NativeReadingGate>,
        today: String,
        now: Long,
    ): Pair<NativeDailyAttentionExchangeState, Map<String, NativeReadingGate>> {
        if (nativeState == null) {
            val seeded = incomingState?.takeIf { it.dateKey == today } ?: newDailyState(today, now)
            val persistedGates = nativeGates.filterValues { it.attentionDateKey == today }
            val gates = if (persistedGates.isNotEmpty()) persistedGates else incomingGates.filterValues { it.attentionDateKey == today }
            return withGateRequirements(seeded, gates) to gates
        }
        if (nativeState.dateKey != today) return newDailyState(today, now) to emptyMap()
        val gates = nativeGates.filterValues { it.attentionDateKey == today }
        return withGateRequirements(nativeState, gates) to gates
    }

    fun isEffectivelyRestricted(
        baseOrRoutineRestricted: Boolean,
        cooldownActive: Boolean,
        gatePresent: Boolean,
        accessLeaseActive: Boolean,
    ): Boolean = (baseOrRoutineRestricted || cooldownActive || gatePresent) && !accessLeaseActive

    fun completeGroupCycle(
        groupId: String,
        dateKey: String,
        now: Long,
        previous: NativeGroupAllowanceUsage?,
    ): NativeGroupAllowanceUsage = NativeGroupAllowanceUsage(
        groupId = groupId,
        dateKey = dateKey,
        usedMillis = 0L,
        activePackageName = null,
        activeSegmentStartedAt = null,
        exhaustedAt = null,
        cycleRevision = (previous?.cycleRevision ?: 0L) + 1L,
    )

    private fun withGateRequirements(
        state: NativeDailyAttentionExchangeState,
        gates: Map<String, NativeReadingGate>,
    ): NativeDailyAttentionExchangeState = state.copy(
        cooldownsTriggered = maxOf(state.cooldownsTriggered.coerceAtLeast(0), gates.values.maxOfOrNull { it.dailyCooldownOrdinal } ?: 0),
        highestRequiredActiveSeconds = maxOf(state.highestRequiredActiveSeconds.coerceAtLeast(0L), gates.values.maxOfOrNull { it.requiredReadingSeconds } ?: 0L),
        highestRequiredQualifiedPages = maxOf(state.highestRequiredQualifiedPages.coerceAtLeast(0), gates.values.maxOfOrNull { it.requiredQualifiedPages } ?: 0),
    )

    private fun saturatedMultiply(left: Long, right: Long): Long = try {
        Math.multiplyExact(left, right)
    } catch (_: ArithmeticException) {
        Long.MAX_VALUE
    }

    private fun saturatedAdd(left: Long, right: Long): Long = try {
        Math.addExact(left, right)
    } catch (_: ArithmeticException) {
        Long.MAX_VALUE
    }

    private fun saturatedIntMultiply(left: Long, right: Int): Int {
        if (left <= 0L || right <= 0) return 0
        val result = left * right.toLong()
        return if (result > Int.MAX_VALUE || result < 0L) Int.MAX_VALUE else result.toInt()
    }

    private fun saturatedIntAdd(left: Int, right: Int): Int =
        if (Int.MAX_VALUE - left.coerceAtLeast(0) < right.coerceAtLeast(0)) Int.MAX_VALUE
        else left.coerceAtLeast(0) + right.coerceAtLeast(0)
}
