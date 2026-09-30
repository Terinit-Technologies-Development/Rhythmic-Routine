package expo.modules.rhythmdevice

import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

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

/**
 * Pass 3 requirement kinds. Wire labels match the persisted
 * `restorative_gates_json` / JS `ActiveRestorativeGate` schema exactly.
 *
 * The v1.2 cumulative escalation is preserved ONLY for migrated
 * LEGACY_READING obligations; every new allocation uses the frozen table
 * (ordinal 1-2 none, ordinal 3 baseline, ordinal 4+ restorative choice).
 */
enum class NativeRestorativeRequirementKind(val wireLabel: String) {
    NONE("none"),
    BASELINE_READING("baseline-reading"),
    RESTORATIVE_CHOICE("restorative-choice"),
    LEGACY_READING("legacy-reading");

    companion object {
        fun fromWire(value: String?): NativeRestorativeRequirementKind =
            entries.firstOrNull { it.wireLabel == value } ?: NONE
    }
}

/**
 * Explicit requirement specification per cooldown ordinal (Pass 3 policy,
 * frozen). CD3 = BASELINE_READING satisfied from aggregate Daily Reader
 * Evidence V2. CD4+ = RESTORATIVE_CHOICE: exactly one discrete requirement —
 * a bound Reader recovery session (1800 s / 11 pages) OR a bound Meditation
 * session (1800 qualified s). Never another cumulative reading gate.
 */
data class NativeRestorativeRequirement(
    val kind: NativeRestorativeRequirementKind,
    val baselineReadingSeconds: Long = 0L,
    val baselineReadingPages: Int = 0,
    val restorativeReadingSeconds: Long = 0L,
    val restorativeReadingPages: Int = 0,
    val meditationSeconds: Long = 0L,
)

data class NativeRoutineReadingTargetPreview(
    val dateKey: String,
    val nextCooldownOrdinal: Int,
    val requiredActiveSeconds: Long,
    val requiredQualifiedPages: Int,
)

data class NativeDailyAttentionExchangeState(
    val dateKey: String,
    val cooldownsTriggered: Int,
    val highestRequiredActiveSeconds: Long,
    val highestRequiredQualifiedPages: Int,
    val updatedAt: Long,
    val attentionDayId: String? = null,
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
    /** Pass 3: CD4+ allocations carry a provider-neutral Restorative Gate. */
    val restorativeGates: Map<String, NativeRestorativeGateState> = emptyMap(),
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

    fun nextReadingTargetPreview(
        state: NativeDailyAttentionExchangeState?,
        dateKey: String,
        policy: NativeReadingAttentionPolicy = DEFAULT_POLICY,
    ): NativeRoutineReadingTargetPreview {
        val dailyState = state?.takeIf { it.dateKey == dateKey }
            ?: newDailyState(dateKey, state?.updatedAt ?: 0L)
        val ordinal = if (dailyState.cooldownsTriggered == Int.MAX_VALUE) {
            Int.MAX_VALUE
        } else {
            dailyState.cooldownsTriggered.coerceAtLeast(0) + 1
        }
        val requirement = requirementForCooldownOrdinal(ordinal, policy)
        // Compatibility columns carry the kind's READING requirement — never
        // the obsolete cumulative escalation (ordinal 4 is 1800/11, not 5400/47).
        return NativeRoutineReadingTargetPreview(
            dateKey = dateKey,
            nextCooldownOrdinal = ordinal,
            requiredActiveSeconds = readingRequirementOf(requirement).first,
            requiredQualifiedPages = readingRequirementOf(requirement).second,
        )
    }

    /** The reading requirement a legacy/v1 surface would show for this kind. */
    private fun readingRequirementOf(requirement: NativeRestorativeRequirement): Pair<Long, Int> =
        when (requirement.kind) {
            NativeRestorativeRequirementKind.NONE -> 0L to 0
            NativeRestorativeRequirementKind.BASELINE_READING ->
                requirement.baselineReadingSeconds to requirement.baselineReadingPages
            NativeRestorativeRequirementKind.RESTORATIVE_CHOICE ->
                requirement.restorativeReadingSeconds to requirement.restorativeReadingPages
            NativeRestorativeRequirementKind.LEGACY_READING ->
                requirement.baselineReadingSeconds to requirement.baselineReadingPages
        }

    fun newDailyState(dateKey: String, now: Long, attentionDayId: String? = null) = NativeDailyAttentionExchangeState(
        dateKey = dateKey,
        cooldownsTriggered = 0,
        highestRequiredActiveSeconds = 0L,
        highestRequiredQualifiedPages = 0,
        updatedAt = now,
        attentionDayId = attentionDayId,
    )

    /** The frozen Pass 3 policy table: which requirement kind an ordinal carries. */
    fun requirementKindForOrdinal(ordinal: Int): NativeRestorativeRequirementKind {
        val safeOrdinal = ordinal.coerceAtLeast(0)
        return when {
            safeOrdinal <= 2 -> NativeRestorativeRequirementKind.NONE
            safeOrdinal == 3 -> NativeRestorativeRequirementKind.BASELINE_READING
            else -> NativeRestorativeRequirementKind.RESTORATIVE_CHOICE
        }
    }

    /**
     * The requirement for a NEWLY allocated cooldown (Pass 3, frozen):
     * ordinal 1-2 none, ordinal 3 the Daily Reader baseline (3600/36),
     * ordinal 4+ ONE discrete restorative choice (Reader 1800/11 OR
     * Meditation 1800 qualified s). The v1.2 cumulative escalation never
     * applies to new allocations.
     */
    fun requirementForCooldownOrdinal(
        ordinal: Int,
        policy: NativeReadingAttentionPolicy = DEFAULT_POLICY,
    ): NativeRestorativeRequirement {
        val normalized = policy.normalized()
        return when (requirementKindForOrdinal(ordinal)) {
            NativeRestorativeRequirementKind.NONE ->
                NativeRestorativeRequirement(NativeRestorativeRequirementKind.NONE)
            NativeRestorativeRequirementKind.BASELINE_READING ->
                NativeRestorativeRequirement(
                    kind = NativeRestorativeRequirementKind.BASELINE_READING,
                    baselineReadingSeconds = normalized.baselineActiveSeconds,
                    baselineReadingPages = normalized.baselineQualifiedPages,
                )
            NativeRestorativeRequirementKind.RESTORATIVE_CHOICE ->
                NativeRestorativeRequirement(
                    kind = NativeRestorativeRequirementKind.RESTORATIVE_CHOICE,
                    restorativeReadingSeconds = RestorativeEnforcement.RESTORATIVE_READING_SECONDS,
                    restorativeReadingPages = RestorativeEnforcement.RESTORATIVE_QUALIFIED_PAGES,
                    meditationSeconds = RestorativeEnforcement.RESTORATIVE_MEDITATION_SECONDS,
                )
            // Migrated obligations keep their STORED numbers; never re-derive.
            NativeRestorativeRequirementKind.LEGACY_READING ->
                NativeRestorativeRequirement(NativeRestorativeRequirementKind.LEGACY_READING)
        }
    }

    /**
     * The obsolete v1.2 cumulative escalation. Kept ONLY so migration and
     * legacy gate audits can reproduce historical requirements (e.g. an active
     * 5400s/47p obligation at ordinal 4). Never use this for new cooldowns.
     */
    fun legacyReadingRequirementForOrdinal(
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

    /** `ad-<yyyyMMdd>-<HHmm>` — the SAME id formula as the JS engine. */
    fun attentionDayIdForBoundary(boundaryEpochMs: Long): String {
        val format = SimpleDateFormat("yyyyMMdd-HHmm", Locale.US)
        return "ad-${format.format(Date(boundaryEpochMs))}"
    }

    /**
     * Resolves the current Attention Day id exactly like JS `resolveAttentionDay`:
     * the Morning Buffer END time opens the day (walking back to the most
     * recent active boundary); no usable window falls back to the local
     * calendar day. Deterministic — native allocation and JS reconciliation
     * must derive the SAME gate identity from it.
     */
    fun resolveAttentionDayId(now: Long, schedule: NativeRoutineSchedule): String {
        val morning = schedule.windows.firstOrNull {
            it.type == "morning-buffer" && it.enabled && it.endTime.isNotBlank()
        }
        val minutes = morning?.let { parseTimeToMinutes(it.endTime) }
        if (morning != null && minutes != null) {
            for (back in 0..7) {
                val candidate = boundaryAt(now, minutes, back)
                if (candidate <= now && isActiveOnDay(morning, candidate)) {
                    return attentionDayIdForBoundary(candidate)
                }
            }
        }
        return "ad-${localDateKey(now)}"
    }

    /** Resolves the current identity and the next scheduled boundary. */
    fun resolveAttentionDayState(now: Long, schedule: NativeRoutineSchedule): NativeAttentionDayState {
        val id = resolveAttentionDayId(now, schedule)
        val morning = schedule.windows.firstOrNull {
            it.type == "morning-buffer" && it.enabled && it.endTime.isNotBlank()
        }
        val minutes = morning?.let { parseTimeToMinutes(it.endTime) }
        if (morning != null && minutes != null && Regex("^ad-\\d{8}-\\d{4}$").matches(id)) {
            for (daysAhead in 0..7) {
                val candidate = boundaryAt(now, minutes, -daysAhead)
                if (candidate > now && isActiveOnDay(morning, candidate)) {
                    return NativeAttentionDayState(id, candidate)
                }
            }
        }
        return NativeAttentionDayState(id, boundaryAt(now, 0, -1))
    }

    /** Local midnight of (now - daysBack) plus minutesIntoDay. */
    private fun boundaryAt(now: Long, minutesIntoDay: Int, daysBack: Int): Long {
        val calendar = Calendar.getInstance().apply {
            timeInMillis = now
            add(Calendar.DAY_OF_YEAR, -daysBack)
            set(Calendar.HOUR_OF_DAY, 0)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }
        return calendar.timeInMillis + minutesIntoDay * 60_000L
    }

    private fun localMidnight(now: Long): Long = boundaryAt(now, 0, 0)

    /** ISO weekday (Monday=1 .. Sunday=7) — matches JS `getIsoWeekday`. */
    private fun isActiveOnDay(window: NativeRoutineWindow, epochMs: Long): Boolean {
        if (window.activeDays.isEmpty()) return true
        val calendar = Calendar.getInstance().apply { timeInMillis = epochMs }
        val iso = when (calendar.get(Calendar.DAY_OF_WEEK)) {
            Calendar.SUNDAY -> 7
            else -> calendar.get(Calendar.DAY_OF_WEEK) - 1
        }
        return iso in window.activeDays
    }

    private fun parseTimeToMinutes(value: String): Int? {
        if (!Regex("^(?:[01]\\d|2[0-3]):[0-5]\\d$").matches(value)) return null
        val parts = value.split(":")
        return parts[0].toInt() * 60 + parts[1].toInt()
    }

    private fun localDateKey(now: Long): String =
        SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date(now))

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
        attentionDayId: String = "ad-$dateKey",
        existingRestorativeGates: Map<String, NativeRestorativeGateState> = emptyMap(),
    ): NativeCooldownAllocation {
        if (
            alreadyExhausted ||
            existingCooldowns.containsKey(groupId) ||
            existingGates[groupId]?.attentionDateKey == dateKey ||
            existingRestorativeGates[groupId]?.let {
                it.attentionDayId == attentionDayId && it.holdsGroup
            } == true
        ) {
            return NativeCooldownAllocation(state, existingCooldowns, existingGates, allocated = false)
        }

        val daily = if (
            state.attentionDayId == attentionDayId ||
            (state.attentionDayId == null && state.dateKey == dateKey)
        ) {
            state.copy(dateKey = dateKey, attentionDayId = attentionDayId)
        } else {
            newDailyState(dateKey, startedAt, attentionDayId)
        }
        val ordinal = if (daily.cooldownsTriggered == Int.MAX_VALUE) Int.MAX_VALUE else daily.cooldownsTriggered + 1
        val requirement = requirementForCooldownOrdinal(ordinal, policy)
        val cooldown = NativeCooldownPolicy(
            groupId = groupId,
            packageNames = packageNames,
            startedAt = startedAt,
            endsAt = endsAt,
            attentionDateKey = dateKey,
            dailyCooldownOrdinal = ordinal,
            requirementKind = requirement.kind.wireLabel,
            requiredReadingSeconds = requirement.baselineReadingSeconds,
            requiredQualifiedPages = requirement.baselineReadingPages,
            restorativeReadingSeconds = requirement.restorativeReadingSeconds,
            restorativeReadingPages = requirement.restorativeReadingPages,
            requiredMeditationSeconds = requirement.meditationSeconds,
        )
        val nextCooldowns = existingCooldowns.toMutableMap().apply { put(groupId, cooldown) }

        // CD3 = BASELINE_READING: the aggregate Daily Reader Evidence gate.
        // CD4+ = RESTORATIVE_CHOICE: NOT another reading gate — a provider-
        // neutral Restorative Gate (Pass 3 schema) instead.
        val nextGates = existingGates.toMutableMap().apply { remove(groupId) }
        val nextRestorativeGates = existingRestorativeGates.toMutableMap().apply { remove(groupId) }
        when (requirement.kind) {
            NativeRestorativeRequirementKind.BASELINE_READING -> {
                if (requirement.baselineReadingSeconds > 0L || requirement.baselineReadingPages > 0) {
                    nextGates[groupId] = NativeReadingGate(
                        groupId = groupId,
                        attentionDateKey = dateKey,
                        dailyCooldownOrdinal = ordinal,
                        createdAt = startedAt,
                        cooldownEndsAt = endsAt,
                        requiredReadingSeconds = requirement.baselineReadingSeconds,
                        requiredQualifiedPages = requirement.baselineReadingPages,
                    )
                }
            }
            NativeRestorativeRequirementKind.RESTORATIVE_CHOICE -> {
                nextRestorativeGates[groupId] = NativeRestorativeGateState(
                    gateId = RestorativeEnforcement.gateIdFor(attentionDayId, groupId, ordinal),
                    groupId = groupId,
                    attentionDayId = attentionDayId,
                    requirementKind = NativeRestorativeRequirementKind.RESTORATIVE_CHOICE.wireLabel,
                    status = "pending-selection",
                    selectedProvider = null,
                    dailyCooldownOrdinal = ordinal,
                    requiredReadingSeconds = 0L,
                    requiredQualifiedPages = 0,
                    restorativeReadingSeconds = requirement.restorativeReadingSeconds,
                    restorativeReadingPages = requirement.restorativeReadingPages,
                    requiredMeditationSeconds = requirement.meditationSeconds,
                )
            }
            else -> Unit
        }

        // Pass 3 (item: highestRequired* is a migration/compatibility
        // projection only). CD3 may establish 3600/36; RESTORATIVE_CHOICE must
        // never mutate these (no 5400/47, no 7200/58).
        val requirementEstablishesBaseline = requirement.kind == NativeRestorativeRequirementKind.BASELINE_READING
        return NativeCooldownAllocation(
            dailyAttentionExchange = daily.copy(
                cooldownsTriggered = ordinal,
                highestRequiredActiveSeconds = if (requirementEstablishesBaseline) {
                    maxOf(daily.highestRequiredActiveSeconds, requirement.baselineReadingSeconds)
                } else {
                    daily.highestRequiredActiveSeconds
                },
                highestRequiredQualifiedPages = if (requirementEstablishesBaseline) {
                    maxOf(daily.highestRequiredQualifiedPages, requirement.baselineReadingPages)
                } else {
                    daily.highestRequiredQualifiedPages
                },
                updatedAt = startedAt,
            ),
            cooldowns = nextCooldowns,
            readingGates = nextGates,
            allocated = true,
            restorativeGates = nextRestorativeGates,
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
        attentionDayId: String = "ad-$today",
    ): Pair<NativeDailyAttentionExchangeState, Map<String, NativeReadingGate>> {
        if (nativeState == null) {
            val seeded = incomingState?.takeIf { it.dateKey == today }?.let {
                it.copy(attentionDayId = attentionDayId)
            } ?: newDailyState(today, now, attentionDayId)
            val persistedGates = nativeGates.filterValues { it.attentionDateKey == today }
            val gates = if (persistedGates.isNotEmpty()) persistedGates else incomingGates.filterValues { it.attentionDateKey == today }
            return withGateRequirements(seeded, gates) to gates
        }
        val sameAttentionDay = nativeState.attentionDayId == attentionDayId ||
            (nativeState.attentionDayId == null && nativeState.dateKey == today)
        if (!sameAttentionDay) return newDailyState(today, now, attentionDayId) to emptyMap()
        val gates = nativeGates.filterValues { it.attentionDateKey == today }
        return withGateRequirements(nativeState.copy(dateKey = today, attentionDayId = attentionDayId), gates) to gates
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
