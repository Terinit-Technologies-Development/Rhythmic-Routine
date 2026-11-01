package expo.modules.rhythmdevice

import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone

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
    /** Select the actual accepted allocation state without rewinding a newer day. */
    fun stateAfterAcceptedAllocation(
        current: NativeDailyAttentionExchangeState,
        allocated: NativeDailyAttentionExchangeState,
    ): NativeDailyAttentionExchangeState {
        val sameDay = current.attentionDayId != null &&
            current.attentionDayId == allocated.attentionDayId ||
            current.attentionDayId == null && allocated.attentionDayId == null &&
                current.dateKey == allocated.dateKey
        if (!sameDay) return current
        return allocated.copy(
            dateKey = current.dateKey,
            cooldownsTriggered = maxOf(current.cooldownsTriggered, allocated.cooldownsTriggered),
            highestRequiredActiveSeconds = maxOf(current.highestRequiredActiveSeconds, allocated.highestRequiredActiveSeconds),
            highestRequiredQualifiedPages = maxOf(current.highestRequiredQualifiedPages, allocated.highestRequiredQualifiedPages),
            updatedAt = maxOf(current.updatedAt, allocated.updatedAt),
        )
    }

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

    private data class NativeAttentionClockResolution(
        val minutesIntoDay: Int?,
        val issue: String?,
    )

    private data class NativeCivilDate(val year: Int, val month: Int, val day: Int)

    private data class NativeAttentionDayResolution(
        val id: String,
        val startedAt: Long,
        val nextBoundaryAt: Long,
    )

    /**
     * The configured Morning Buffer END clock. The first usable clock wins on
     * EVERY civil day, even when that window is disabled or today's weekday is
     * not in `activeDays`; only the restriction window is inactive.
     */
    private fun resolveAttentionDayClock(schedule: NativeRoutineSchedule): NativeAttentionClockResolution {
        var issue: String? = null
        var sawMorningBuffer = false
        for (window in schedule.windows) {
            if (window.type != "morning-buffer") continue
            sawMorningBuffer = true
            val raw = window.endTime
            if (raw.isBlank()) {
                if (issue == null) {
                    issue = "Morning Buffer \"${window.id}\" has no endTime; expected HH:MM in 24-hour local time."
                }
                continue
            }
            val minutes = parseTimeToMinutes(raw)
            if (minutes == null) {
                if (issue == null) {
                    issue = "Morning Buffer \"${window.id}\" has malformed endTime \"$raw\"; expected HH:MM in 24-hour local time."
                }
                continue
            }
            return NativeAttentionClockResolution(minutes, issue)
        }
        if (sawMorningBuffer && issue == null) {
            issue = "No Morning Buffer endTime is configured; expected HH:MM in 24-hour local time."
        }
        return NativeAttentionClockResolution(null, issue)
    }

    /** Minutes past local midnight for the accounting clock, or null for midnight fallback. */
    fun configuredAttentionDayClockMinutes(schedule: NativeRoutineSchedule): Int? =
        resolveAttentionDayClock(schedule).minutesIntoDay

    /** Actionable malformed-clock warning; null when the configuration is usable. */
    fun attentionDayClockIssue(schedule: NativeRoutineSchedule): String? =
        resolveAttentionDayClock(schedule).issue

    /**
     * Resolves the current Attention Day exactly like JS `resolveAttentionDay`:
     * the configured Morning Buffer END clock opens the day on every civil day;
     * no usable clock falls back to the local civil calendar day. Deterministic —
     * native allocation and JS reconciliation derive the SAME gate identity.
     */
    private fun resolveAttentionDay(now: Long, schedule: NativeRoutineSchedule): NativeAttentionDayResolution {
        val minutes = resolveAttentionDayClock(schedule).minutesIntoDay
        if (minutes != null) {
            val todayBoundary = boundaryAt(now, minutes, 0)
            val startedAt = if (todayBoundary <= now) todayBoundary else boundaryAt(now, minutes, -1)
            return NativeAttentionDayResolution(
                id = attentionDayIdForBoundary(startedAt),
                startedAt = startedAt,
                nextBoundaryAt = boundaryAt(startedAt, minutes, 1),
            )
        }

        var startedAt = boundaryAt(now, 0, 0)
        if (startedAt > now) startedAt = boundaryAt(now, 0, -1)
        return NativeAttentionDayResolution(
            id = "ad-${localDateKey(startedAt)}",
            startedAt = startedAt,
            nextBoundaryAt = boundaryAt(startedAt, 0, 1),
        )
    }

    /** Resolves the current Attention Day id exactly like JS `resolveAttentionDay`. */
    fun resolveAttentionDayId(now: Long, schedule: NativeRoutineSchedule): String =
        resolveAttentionDay(now, schedule).id

    /** Resolves the current identity and the next scheduled boundary. */
    fun resolveAttentionDayState(now: Long, schedule: NativeRoutineSchedule): NativeAttentionDayState =
        resolveAttentionDay(now, schedule).let {
            NativeAttentionDayState(it.id, it.nextBoundaryAt, it.startedAt)
        }

    /** Civil calendar date `dayOffset` days from `now` (not a fixed 24h offset). */
    private fun civilDateAfter(now: Long, dayOffset: Int): NativeCivilDate {
        val calendar = Calendar.getInstance().apply {
            timeInMillis = now
            add(Calendar.DAY_OF_YEAR, dayOffset)
        }
        return NativeCivilDate(
            year = calendar.get(Calendar.YEAR),
            month = calendar.get(Calendar.MONTH),
            day = calendar.get(Calendar.DAY_OF_MONTH),
        )
    }

    /**
     * Local civil timestamp at `minutesIntoDay` on the civil date `dayOffset`
     * days from `now`.
     *
     * Mirrors ECMAScript `new Date(y, m, d, h, min)`: spring-forward gaps
     * normalize forward by the pre-transition offset; fall-back overlaps choose
     * the earlier instant. Android minSdk 24 uses java.util.Calendar/TimeZone
     * (no java.time desugaring dependency).
     */
    private fun boundaryAt(now: Long, minutesIntoDay: Int, dayOffset: Int): Long {
        val date = civilDateAfter(now, dayOffset)
        return resolveLocalCivilTime(
            date.year,
            date.month,
            date.day,
            minutesIntoDay / 60,
            minutesIntoDay % 60,
        )
    }

    private fun resolveLocalCivilTime(year: Int, month: Int, day: Int, hour: Int, minute: Int): Long {
        val zone = TimeZone.getDefault()
        val wallAsUtc = Calendar.getInstance(TimeZone.getTimeZone("UTC")).apply {
            clear()
            set(year, month, day, hour, minute, 0)
            set(Calendar.MILLISECOND, 0)
        }.timeInMillis
        val offsets = LinkedHashSet<Int>()
        for (deltaHours in intArrayOf(-48, -24, -6, -1, 0, 1, 6, 24, 48)) {
            offsets.add(zone.getOffset(wallAsUtc + deltaHours * 3_600_000L))
        }
        val matching = offsets.asSequence()
            .map { offset -> wallAsUtc - offset }
            .filter { localFieldsMatch(it, zone, year, month, day, hour, minute) }
            .sorted()
            .toList()
        if (matching.isNotEmpty()) return matching.first()
        // Gap: apply the offset in effect before the requested wall time,
        // which yields the same forward-normalized instant as JavaScript.
        val beforeOffset = zone.getOffset(wallAsUtc - 24L * 3_600_000L)
        return wallAsUtc - beforeOffset
    }

    private fun localFieldsMatch(
        epochMs: Long,
        zone: TimeZone,
        year: Int,
        month: Int,
        day: Int,
        hour: Int,
        minute: Int,
    ): Boolean {
        val calendar = Calendar.getInstance(zone).apply { timeInMillis = epochMs }
        return calendar.get(Calendar.YEAR) == year &&
            calendar.get(Calendar.MONTH) == month &&
            calendar.get(Calendar.DAY_OF_MONTH) == day &&
            calendar.get(Calendar.HOUR_OF_DAY) == hour &&
            calendar.get(Calendar.MINUTE) == minute
    }

    private fun parseTimeToMinutes(value: String): Int? {
        val trimmed = value.trim()
        if (!Regex("^(?:[01]\\d|2[0-3]):[0-5]\\d$").matches(trimmed)) return null
        val parts = trimmed.split(":")
        return parts[0].toInt() * 60 + parts[1].toInt()
    }

    private fun localDateKey(now: Long): String =
        SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date(now))

    /** A new-pass gate cannot belong to an Attention Day that began after it was created. */
    fun wasCreatedInAttentionDay(
        createdAt: Long,
        attentionDayId: String,
        schedule: NativeRoutineSchedule,
    ): Boolean = resolveAttentionDayId(createdAt, schedule) == attentionDayId

    fun isCurrentAttentionReadingGate(
        gate: NativeReadingGate,
        attentionDayId: String,
        schedule: NativeRoutineSchedule,
        restorativeGate: NativeRestorativeGateState? = null,
    ): Boolean {
        if (restorativeGate?.requirementKind == NativeRestorativeRequirementKind.LEGACY_READING.wireLabel) {
            return true
        }
        return wasCreatedInAttentionDay(gate.createdAt, attentionDayId, schedule)
    }

    fun isCurrentRestorativeGate(
        gate: NativeRestorativeGateState,
        attentionDayId: String,
        schedule: NativeRoutineSchedule,
        fallbackCreatedAt: Long = 0L,
    ): Boolean {
        if (gate.requirementKind == NativeRestorativeRequirementKind.LEGACY_READING.wireLabel) return true
        if (gate.attentionDayId != attentionDayId) return false
        val createdAt = gate.createdAt.takeIf { it > 0L } ?: fallbackCreatedAt
        return createdAt <= 0L || wasCreatedInAttentionDay(createdAt, attentionDayId, schedule)
    }

    fun staleCurrentAttentionGateGroups(
        gates: Collection<NativeRestorativeGateState>,
        attentionDayId: String,
        schedule: NativeRoutineSchedule,
        readingGates: Map<String, NativeReadingGate> = emptyMap(),
    ): Set<String> = gates.asSequence()
        .filter {
            it.attentionDayId == attentionDayId &&
                it.requirementKind != NativeRestorativeRequirementKind.LEGACY_READING.wireLabel
        }
        .filterNot { gate ->
            isCurrentRestorativeGate(
                gate,
                attentionDayId,
                schedule,
                fallbackCreatedAt = readingGates[gate.groupId]?.createdAt ?: 0L,
            )
        }
        .mapTo(linkedSetOf()) { it.groupId }

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
                it.holdsGroup
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
            attentionDayId = attentionDayId,
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
                    createdAt = startedAt,
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

    /**
     * Local midnight starts a new calendar date, but does not end the active
     * Attention Day. Keep its cooldown ordinal until the saved morning
     * boundary while expiring calendar-date-scoped reading gates.
     */
    fun reconcileMidnightRollover(
        nativeState: NativeDailyAttentionExchangeState?,
        nativeGates: Map<String, NativeReadingGate>,
        today: String,
        now: Long,
        attentionDayId: String,
    ): Pair<NativeDailyAttentionExchangeState, Map<String, NativeReadingGate>> =
        reconcileIncomingState(
            nativeState = nativeState,
            nativeGates = nativeGates,
            incomingState = null,
            incomingGates = emptyMap(),
            today = today,
            now = now,
            attentionDayId = attentionDayId,
        )

    /**
     * The single effective-restriction predicate used by intervention, access
     * and usage-reentry paths. Essential is always reachable; an ordinary
     * access lease can never suppress a compulsory morning hold.
     */
    fun isEffectivelyRestricted(
        baseOrRoutineRestricted: Boolean,
        cooldownActive: Boolean,
        gatePresent: Boolean,
        accessLeaseActive: Boolean,
        restorativeHold: Boolean = false,
        morningHold: Boolean = false,
        essentialPackage: Boolean = false,
    ): Boolean {
        if (essentialPackage) return false
        if (morningHold) return true
        return (baseOrRoutineRestricted || cooldownActive || gatePresent || restorativeHold) &&
            !accessLeaseActive
    }

    /**
     * A CD4+ cooldown must never be treated as satisfied merely because its
     * restorative gate is absent. This covers legacy split-commit state until
     * the deterministic gate is durably recovered.
     */
    fun isRestorativeIntentUnresolved(
        cooldown: NativeCooldownPolicy?,
        gate: NativeRestorativeGateState?,
    ): Boolean =
        cooldown != null &&
            cooldown.requirementKind == "restorative-choice" &&
            gate == null

    enum class NativeRestorativeRecoveryAction { NONE, ACCEPT_EXISTING, CREATE, UNRESOLVED }

    data class NativeRestorativeRecoveryDecision(
        val action: NativeRestorativeRecoveryAction,
        val attentionDayId: String? = null,
        val gateId: String? = null,
    )

    /**
     * Pure recovery decision. Never reinterprets the persisted binding from the
     * current schedule; an existing exact gate or immutable cooldown metadata
     * is the only accepted authority.
     */
    fun restorativeRecoveryDecision(
        cooldown: NativeCooldownPolicy?,
        existingGate: NativeRestorativeGateState?,
    ): NativeRestorativeRecoveryDecision {
        if (cooldown == null || cooldown.requirementKind != "restorative-choice") {
            return NativeRestorativeRecoveryDecision(NativeRestorativeRecoveryAction.NONE)
        }
        val ordinal = cooldown.dailyCooldownOrdinal ?: 0
        if (ordinal <= 0) {
            return NativeRestorativeRecoveryDecision(NativeRestorativeRecoveryAction.UNRESOLVED)
        }
        if (existingGate != null) {
            val gateDay = existingGate.attentionDayId
            val cooldownDay = cooldown.attentionDayId?.takeIf { it.isNotBlank() }
            val sameOwner = cooldownDay == null || gateDay == cooldownDay
            val exact = gateDay.isNotBlank() &&
                sameOwner &&
                existingGate.groupId == cooldown.groupId &&
                existingGate.requirementKind == "restorative-choice" &&
                existingGate.status in setOf("pending-selection", "in-progress", "satisfied") &&
                existingGate.dailyCooldownOrdinal == ordinal &&
                existingGate.createdAt > 0L &&
                cooldown.startedAt > 0L &&
                existingGate.createdAt == cooldown.startedAt &&
                existingGate.gateId == RestorativeEnforcement.gateIdFor(gateDay, cooldown.groupId, ordinal)
            return if (exact) {
                NativeRestorativeRecoveryDecision(
                    NativeRestorativeRecoveryAction.ACCEPT_EXISTING,
                    gateDay,
                    existingGate.gateId,
                )
            } else {
                NativeRestorativeRecoveryDecision(NativeRestorativeRecoveryAction.UNRESOLVED)
            }
        }
        if (cooldown.startedAt <= 0L) {
            return NativeRestorativeRecoveryDecision(NativeRestorativeRecoveryAction.UNRESOLVED)
        }
        val originalDayId = cooldown.attentionDayId?.takeIf { it.isNotBlank() }
            ?: return NativeRestorativeRecoveryDecision(NativeRestorativeRecoveryAction.UNRESOLVED)
        return NativeRestorativeRecoveryDecision(
            NativeRestorativeRecoveryAction.CREATE,
            originalDayId,
            RestorativeEnforcement.gateIdFor(originalDayId, cooldown.groupId, ordinal),
        )
    }

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
