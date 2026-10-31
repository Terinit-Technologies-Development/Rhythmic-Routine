package expo.modules.rhythmdevice

import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/**
 * B1 — deterministic native Morning Meditation obligation.
 *
 * This file is deliberately pure (java.util Calendar/TimeZone only; minSdk 24
 * has no verified java.time desugaring). The AccessibilityService uses it to
 * mint and persist the exact tuple `morning-<AttentionDayId>` without Routine
 * JS ever entering the foreground.
 */
data class NativeMorningMigrationState(
    val migratedAt: Long,
    val migrationAttentionDayId: String,
    val enforceableFromAttentionDayId: String? = null,
)

data class MorningWindowEligibility(
    val eligible: Boolean,
    val boundaryAt: Long,
    val reason: String? = null,
)

object MorningEnforcement {
    const val MORNING_SESSION_KIND = "MORNING_REQUIRED"
    const val REQUIRED_QUALIFIED_SECONDS = 1800
    val SOURCE_COOLDOWN_ID: String? = null

    private val CLOCK = Regex("^(?:[01]\\d|2[0-3]):[0-5]\\d$")

    fun sessionId(attentionDayId: String): String = "morning-$attentionDayId"

    fun parseClockMinutes(value: String): Int? {
        val trimmed = value.trim()
        if (!CLOCK.matches(trimmed)) return null
        val parts = trimmed.split(":")
        return parts[0].toInt() * 60 + parts[1].toInt()
    }

    /** ISO weekday: 1 = Monday ... 7 = Sunday (matches JS/RoutineWindow). */
    fun isoWeekday(epochMs: Long): Int {
        val calendar = Calendar.getInstance().apply { timeInMillis = epochMs }
        val day = calendar.get(Calendar.DAY_OF_WEEK)
        return if (day == Calendar.SUNDAY) 7 else day - 1
    }

    /** Fresh installs enforce from their own day; upgrades only strictly after. */
    fun migrationFor(
        cohort: String,
        attentionDayId: String,
        now: Long,
    ): NativeMorningMigrationState = if (cohort == "fresh") {
        NativeMorningMigrationState(
            migratedAt = now,
            migrationAttentionDayId = attentionDayId,
            enforceableFromAttentionDayId = attentionDayId,
        )
    } else {
        NativeMorningMigrationState(
            migratedAt = now,
            migrationAttentionDayId = attentionDayId,
        )
    }

    /**
     * Eligibility (MM-2): valid end clock, enabled, non-empty activeDays that
     * contains the civil day the boundary falls on. Empty/disabled/inactive/
     * malformed windows create no obligation.
     */
    fun eligibility(
        schedule: NativeRoutineSchedule,
        attentionDayStartedAt: Long,
    ): MorningWindowEligibility {
        val window = schedule.windows.firstOrNull { it.type == "morning-buffer" }
            ?: return MorningWindowEligibility(false, attentionDayStartedAt, "no-morning-window")
        if (!window.enabled) {
            return MorningWindowEligibility(false, attentionDayStartedAt, "morning-window-disabled")
        }
        val start = parseClockMinutes(window.startTime)
        val end = parseClockMinutes(window.endTime)
            ?: return MorningWindowEligibility(false, attentionDayStartedAt, "morning-end-malformed")
        if (start == null || start == end) {
            return MorningWindowEligibility(false, attentionDayStartedAt, "morning-window-invalid")
        }
        if (window.activeDays.isEmpty()) {
            return MorningWindowEligibility(false, attentionDayStartedAt, "morning-active-days-empty")
        }
        // Opening-day semantics for a cross-midnight window: the obligation
        // belongs to the civil day the window OPENED on. Use Calendar civil
        // subtraction (noon anchor) so DST/offset changes cannot shift it.
        val openingWeekday = if (start > end) {
            isoWeekday(
                Calendar.getInstance().apply {
                    timeInMillis = attentionDayStartedAt
                    add(Calendar.DAY_OF_YEAR, -1)
                    set(Calendar.HOUR_OF_DAY, 12)
                    set(Calendar.MINUTE, 0)
                    set(Calendar.SECOND, 0)
                    set(Calendar.MILLISECOND, 0)
                }.timeInMillis
            )
        } else {
            isoWeekday(attentionDayStartedAt)
        }
        if (openingWeekday !in window.activeDays) {
            return MorningWindowEligibility(false, attentionDayStartedAt, "morning-day-inactive")
        }
        return MorningWindowEligibility(true, attentionDayStartedAt)
    }

    fun requirement(
        attentionDayId: String,
        boundaryAt: Long,
    ): NativeMorningMeditationState = NativeMorningMeditationState(
        attentionDayId = attentionDayId,
        sessionId = sessionId(attentionDayId),
        requiredQualifiedSeconds = REQUIRED_QUALIFIED_SECONDS,
        createdAt = boundaryAt,
        satisfied = false,
        satisfiedAt = null,
        sourceRhythmicDayId = attentionDayId,
        sessionKind = MORNING_SESSION_KIND,
    )

    /**
     * Deterministic reconciliation. A same-day requirement and an already
     * committed satisfaction are never cleared or downgraded. A new day gets
     * its own identity only when eligibility holds.
     */
    /**
     * Carry-aware reconciliation: never discard an unfinished binding, even
     * when the new civil day is inactive or eligible. A new eligible day adds
     * its own deterministic tuple; completion promotion only uses trusted
     * provider evidence for that exact tuple.
     */
    fun reconcileRequirements(
        existing: List<NativeMorningMeditationState>,
        attentionDay: NativeAttentionDayState,
        schedule: NativeRoutineSchedule,
        migration: NativeMorningMigrationState,
        now: Long,
        evidenceBySession: Map<String, NativeMeditationSessionEvidence>,
    ): List<NativeMorningMeditationState> {
        val byDay = LinkedHashMap<String, NativeMorningMeditationState>()
        for (item in existing) byDay[item.attentionDayId] = item
        val eligibleForDay = isEnforceable(migration, attentionDay.id) &&
            eligibility(schedule, attentionDay.startedAt).eligible
        if (eligibleForDay && byDay[attentionDay.id] == null) {
            byDay[attentionDay.id] = requirement(attentionDay.id, attentionDay.startedAt)
        }
        return byDay.values.map { item ->
            val normalized = item.copy(
                sourceRhythmicDayId = item.sourceRhythmicDayId ?: item.attentionDayId,
                sessionKind = MORNING_SESSION_KIND,
                sourceCooldownId = SOURCE_COOLDOWN_ID,
            )
            val evidence = evidenceBySession[normalized.sessionId]
            if (normalized.satisfiedAt == null && evidence != null &&
                isVerifiedCompletion(normalized, evidence)
            ) {
                normalized.copy(
                    satisfied = true,
                    satisfiedAt = evidence.completedAtEpochMs ?: now,
                )
            } else {
                normalized
            }
        }.sortedWith(compareBy({ it.createdAt }, { it.attentionDayId }))
    }

    fun reconcile(
        existing: NativeMorningMeditationState?,
        attentionDay: NativeAttentionDayState,
        schedule: NativeRoutineSchedule,
        migration: NativeMorningMigrationState,
        now: Long,
        evidence: NativeMeditationSessionEvidence?,
    ): NativeMorningMeditationState? {
        val all = reconcileRequirements(
            existing = listOfNotNull(existing),
            attentionDay = attentionDay,
            schedule = schedule,
            migration = migration,
            now = now,
            evidenceBySession = evidence?.let { mapOf(it.sessionId to it) } ?: emptyMap(),
        )
        return all.lastOrNull { it.attentionDayId == attentionDay.id }
            ?: all.firstOrNull()
    }

    /**
     * One authoritative effective projection shared by the restriction
     * predicate, bridge snapshot and diagnostics.
     *
     * - Persisted historical pending obligations are retained (oldest-first).
     * - A process-local failed creation intent is eligible only for the current
     *   Attention Day and only when the authoritative persisted state does not
     *   prove that EXACT immutable binding is complete.
     * - Persisted rows win over a failed copy for the same day; an unrelated
     *   completion identity never clears the failed intent.
     */
    fun effectiveMorningRequirements(
        persisted: List<NativeMorningMeditationState>,
        failedCurrentDay: Collection<NativeMorningMeditationState>,
        currentAttentionDayId: String,
    ): List<NativeMorningMeditationState> {
        val result = persisted.toMutableList()
        val persistedByDay = persisted.associateBy { it.attentionDayId }
        for (failed in failedCurrentDay) {
            if (failed.attentionDayId != currentAttentionDayId) continue
            val existing = persistedByDay[failed.attentionDayId]
            if (existing == null) {
                if (result.none { it.sessionId == failed.sessionId }) result.add(failed)
                continue
            }
            if (existing.satisfiedAt == null) {
                // Persisted pending state is authoritative; do not duplicate.
                continue
            }
            val exactComplete =
                existing.sessionId == failed.sessionId &&
                    existing.createdAt == failed.createdAt &&
                    existing.requiredQualifiedSeconds == failed.requiredQualifiedSeconds &&
                    existing.attentionDayId == failed.attentionDayId &&
                    existing.sourceRhythmicDayId == failed.attentionDayId &&
                    existing.sessionKind == MORNING_SESSION_KIND &&
                    failed.sessionKind == MORNING_SESSION_KIND
            if (!exactComplete) {
                result.removeAll { it.attentionDayId == failed.attentionDayId }
                result.add(failed)
            }
        }
        return result
            .distinctBy { it.attentionDayId }
            .sortedWith(compareBy({ it.createdAt }, { it.attentionDayId }))
    }

    fun sameMorningBinding(
        left: NativeMorningMeditationState,
        right: NativeMorningMeditationState,
    ): Boolean =
        left.attentionDayId == right.attentionDayId &&
            left.sessionId == right.sessionId &&
            left.createdAt == right.createdAt &&
            left.requiredQualifiedSeconds == right.requiredQualifiedSeconds &&
            left.sessionKind == MORNING_SESSION_KIND &&
            right.sessionKind == MORNING_SESSION_KIND &&
            left.sourceRhythmicDayId == left.attentionDayId &&
            right.sourceRhythmicDayId == right.attentionDayId &&
            left.sourceCooldownId == null &&
            right.sourceCooldownId == null

    /**
     * Failed intents that are genuinely unpersisted and still part of the
     * effective hold. Exact durable completion/retry is not a transient failure.
     */
    fun effectiveFailedMorningIntents(
        persisted: List<NativeMorningMeditationState>,
        failedCurrentDay: Collection<NativeMorningMeditationState>,
        currentAttentionDayId: String,
    ): List<NativeMorningMeditationState> {
        val effective = effectiveMorningRequirements(
            persisted,
            failedCurrentDay,
            currentAttentionDayId,
        )
        return failedCurrentDay
            .filter { it.attentionDayId == currentAttentionDayId }
            .filter { failed ->
                effective.any { sameMorningBinding(it, failed) } &&
                    persisted.none { sameMorningBinding(it, failed) }
            }
            .sortedWith(compareBy({ it.createdAt }, { it.attentionDayId }))
    }

    fun effectivePendingMorning(
        persisted: List<NativeMorningMeditationState>,
        failedCurrentDay: Collection<NativeMorningMeditationState>,
        currentAttentionDayId: String,
    ): NativeMorningMeditationState? =
        effectiveMorningRequirements(persisted, failedCurrentDay, currentAttentionDayId)
            .filter { it.satisfiedAt == null }
            .minWithOrNull(compareBy({ it.createdAt }, { it.attentionDayId }))

    fun isVerifiedCompletion(
        requirement: NativeMorningMeditationState,
        evidence: NativeMeditationSessionEvidence,
    ): Boolean {
        if (evidence.sessionKind != MORNING_SESSION_KIND) return false
        if (evidence.sourceRhythmicDayId != requirement.attentionDayId) return false
        if (evidence.sourceCooldownId != null) return false
        return evidence.sessionId == requirement.sessionId &&
            evidence.protocolVersion == MeditationContract.PROTOCOL_VERSION &&
            evidence.status == "COMPLETED" &&
            evidence.requiredQualifiedSeconds >= requirement.requiredQualifiedSeconds &&
            evidence.completedQualifiedSeconds >= requirement.requiredQualifiedSeconds
    }

    /** Parsed comparable Attention Day date/time; never raw string ordering. */
    private data class DayKey(val date: String, val minutes: Int?)

    private fun dayKey(id: String): DayKey? {
        Regex("^ad-(\\d{4})(\\d{2})(\\d{2})-(\\d{2})(\\d{2})$").matchEntire(id)?.let {
            return DayKey(
                date = "${it.groupValues[1]}${it.groupValues[2]}${it.groupValues[3]}",
                minutes = it.groupValues[4].toInt() * 60 + it.groupValues[5].toInt(),
            )
        }
        Regex("^ad-(\\d{4})-(\\d{2})-(\\d{2})$").matchEntire(id)?.let {
            return DayKey("${it.groupValues[1]}${it.groupValues[2]}${it.groupValues[3]}", null)
        }
        return null
    }

    fun isEnforceable(
        migration: NativeMorningMigrationState,
        attentionDayId: String,
    ): Boolean {
        val current = dayKey(attentionDayId) ?: return false
        migration.enforceableFromAttentionDayId?.let { floorId ->
            if (attentionDayId == floorId) return true
            val floor = dayKey(floorId) ?: return false
            if (current.date != floor.date) return current.date > floor.date
            if (current.minutes == null || floor.minutes == null) return false
            return current.minutes >= floor.minutes
        }
        if (attentionDayId == migration.migrationAttentionDayId) return false
        val migrationKey = dayKey(migration.migrationAttentionDayId) ?: return false
        if (current.date != migrationKey.date) return current.date > migrationKey.date
        if (current.minutes == null || migrationKey.minutes == null) return false
        return current.minutes > migrationKey.minutes
    }

    /** A failed persistence must preserve the previous accepted state. */
    fun <T> acceptedPersistence(saved: Boolean, previous: T, next: T): T =
        if (saved) next else previous

    fun isEssentialPackage(
        packageName: String,
        essentialPackages: Set<String>,
    ): Boolean = packageName in essentialPackages

    fun isManagedMorningPackage(
        packageName: String,
        baseRestrictedPackages: Set<String>,
        riskPolicies: Collection<NativeRiskGroupPolicy>,
        companionPackages: Set<String>,
        managedPackages: Set<String> = emptySet(),
    ): Boolean {
        if (packageName in companionPackages) return false
        if (packageName in baseRestrictedPackages) return true
        if (packageName in managedPackages) return true
        return riskPolicies.any { packageName in it.packageNames }
    }

    fun isInsideWindow(window: NativeRoutineWindow, now: Long): Boolean {
        if (!window.enabled) return false
        val calendar = Calendar.getInstance().apply { timeInMillis = now }
        val minutes = calendar.get(Calendar.HOUR_OF_DAY) * 60 + calendar.get(Calendar.MINUTE)
        val iso = isoWeekday(now)
        val start = parseClockMinutes(window.startTime) ?: return false
        val end = parseClockMinutes(window.endTime) ?: return false
        if (start == end || window.activeDays.isEmpty()) return false
        if (start < end) {
            return iso in window.activeDays && minutes >= start && minutes < end
        }
        val previous = if (iso == 1) 7 else iso - 1
        return (minutes >= start && iso in window.activeDays) ||
            (minutes < end && previous in window.activeDays)
    }

    /**
     * Strict routine/overnight predicate mirroring `routine.ts`. Used by the
     * single native effective-restriction path so weekend/inactive windows and
     * cross-midnight mornings cannot fabricate an all-day lock.
     */
    fun isProtectedByRoutine(
        schedule: NativeRoutineSchedule,
        packageName: String,
        now: Long,
    ): Boolean {
        val windows = schedule.windows.filter { it.enabled }
        if (windows.isEmpty()) return false
        for (window in windows) {
            if (packageName in window.protectedPackages && isInsideWindow(window, now)) return true
        }
        if (packageName !in schedule.allRiskPackages) return false
        return isInsideOvernightProtection(schedule, now)
    }

    fun isInsideOvernightProtection(schedule: NativeRoutineSchedule, now: Long): Boolean {
        val evening = schedule.windows.firstOrNull { it.type == "evening-wind-down" } ?: return false
        val morning = schedule.windows.firstOrNull { it.type == "morning-buffer" } ?: return false
        if (!evening.enabled || !morning.enabled) return false
        if (isInsideWindow(evening, now) || isInsideWindow(morning, now)) return false

        val calendar = Calendar.getInstance().apply { timeInMillis = now }
        val minutes = calendar.get(Calendar.HOUR_OF_DAY) * 60 + calendar.get(Calendar.MINUTE)
        val iso = isoWeekday(now)
        val eveningStart = parseClockMinutes(evening.startTime) ?: return false
        val eveningEnd = parseClockMinutes(evening.endTime) ?: return false
        val morningStart = parseClockMinutes(morning.startTime) ?: return false
        val eveningDays = evening.activeDays
        val morningDays = morning.activeDays
        val previous = if (iso == 1) 7 else iso - 1
        val next = if (iso == 7) 1 else iso + 1
        val eveningCrossesMidnight = eveningStart > eveningEnd

        if (minutes < morningStart) {
            if (previous !in eveningDays || iso !in morningDays) return false
            return if (eveningCrossesMidnight) minutes >= eveningEnd else true
        }
        if (!eveningCrossesMidnight && minutes >= eveningEnd) {
            if (iso !in eveningDays || next !in morningDays) return false
            return true
        }
        return false
    }

    /** Bounded diagnostic date key, matching Routine's native policy vocabulary. */
    fun localDateKey(now: Long): String =
        SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date(now))
}
