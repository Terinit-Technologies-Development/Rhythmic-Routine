package expo.modules.rhythmdevice

import android.accessibilityservice.AccessibilityService
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import org.json.JSONArray
import org.json.JSONObject
import java.text.ParsePosition
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone

data class NativeRecoveryActivity(val id: String, val title: String, val subtitle: String, val iconEmoji: String, val durationSuggestion: String?)
data class NativeRiskGroupPolicy(val groupId: String, val groupName: String, val packageNames: Set<String>, val allowanceMinutes: Int, val cooldownMinutes: Int, val recoveryActivity: NativeRecoveryActivity)
data class NativeGroupAllowanceUsage(val groupId: String, val dateKey: String, val usedMillis: Long, val activePackageName: String?, val activeSegmentStartedAt: Long?, val exhaustedAt: Long?, val cycleRevision: Long)
data class NativeGroupAllowanceSnapshot(val groupId: String, val dateKey: String, val usedSeconds: Int, val allowanceMinutes: Int, val remainingSeconds: Int, val exhausted: Boolean, val activePackageName: String?, val activeSegmentStartedAt: Long?, val exhaustedAt: Long?, val cycleRevision: Long)
data class NativeAccessLease(val groupId: String, val packageNames: Set<String>, val endsAt: Long)
data class NativeCooldownPolicy(
    val groupId: String,
    val packageNames: Set<String>,
    val endsAt: Long,
    val startedAt: Long = 0L,
    val attentionDateKey: String? = null,
    val dailyCooldownOrdinal: Int? = null,
    val requiredReadingSeconds: Long = 0L,
    val requiredQualifiedPages: Int = 0,
)
data class NativeRoutineWindow(val id: String, val type: String, val startTime: String, val endTime: String, val activeDays: Set<Int>, val protectedPackages: Set<String>, val enabled: Boolean)
data class NativeRoutineSchedule(val windows: List<NativeRoutineWindow>, val allRiskPackages: Set<String>)
data class NativeOverlayAttentionInfo(
    val groupName: String,
    val mode: String,
    val cooldownEndsAt: Long,
    val ordinal: Int?,
    val requiredReadingSeconds: Long,
    val requiredQualifiedPages: Int,
    val evaluation: NativeAttentionGateEvaluation?,
)

private data class UsageTransition(val packageName: String, val timestamp: Long, val foreground: Boolean)

class RhythmEnforcementService : AccessibilityService() {
    private val DEBOUNCE_MS = 850L
    private val handler = Handler(Looper.getMainLooper())
    private val leaseCallbacks = mutableMapOf<String, Runnable>()
    private var allowanceDeadlineRunnable: Runnable? = null
    private var midnightRolloverRunnable: Runnable? = null
    private var routineBoundaryRunnable: Runnable? = null
    private var cooldownExpiryRunnable: Runnable? = null

    var lastForegroundPackage: String? = null; private set
    var lastInterventionPackage: String? = null; private set
    var lastInterventionAt: Long = 0L; private set
    var activeUsageGroup: String? = null; private set
    var activeUsagePackage: String? = null; private set
    var activeUsageStartedAt: Long? = null; private set
    var allowanceDeadlineAt: Long? = null; private set
    var nextRoutineBoundaryAt: Long? = null; private set
    var nextMidnightRolloverAt: Long? = null; private set
    var nearestCooldownExpiryAt: Long? = null; private set
    var lastUsageReconciledAt: Long = 0L; private set

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        isRunning = true
        val prefs = applicationContext.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE)
        loadAttentionPolicy(applicationContext)
        lastUsageReconciledAt = prefs.getLong(RhythmNativePolicyKeys.LAST_USAGE_RECONCILED_AT, 0L)
        val now = System.currentTimeMillis()
        rolloverIfNeeded(now)
        loadActiveLeases(applicationContext).forEach { scheduleLeaseExpiry(it) }
        reconcileUsage(toTime = now)
        reconcileAllReadingGates(now)
        pruneExpiredCooldowns(now)
        scheduleMidnightRollover(now)
        scheduleNearestCooldownExpiry()
        scheduleNextRoutineBoundary()
        restoreForegroundStateAfterReconnect()
    }

    override fun onDestroy() {
        leaseCallbacks.values.forEach { handler.removeCallbacks(it) }
        leaseCallbacks.clear()
        cancelAllowanceDeadline(); cancelMidnightRollover(); cancelRoutineBoundary(); cancelCooldownExpiry()
        activeUsageGroup?.let { finalizeActiveGroupSegment(it, System.currentTimeMillis()) }
        isRunning = false
        instance = null
        super.onDestroy()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event?.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        val packageName = event.packageName?.toString() ?: return
        val now = System.currentTimeMillis()
        if (packageName == applicationContext.packageName || packageName.startsWith("com.android.systemui")) {
            lastForegroundPackage?.let { if (it == activeUsagePackage) activeUsageGroup?.let { group -> finalizeActiveGroupSegment(group, now) } }
            lastForegroundPackage = packageName
            cancelAllowanceDeadline()
            return
        }
        val sameForeground = packageName == lastForegroundPackage
        val previousGroup = activeUsageGroup
        val previousPackage = activeUsagePackage
        lastForegroundPackage = packageName
        if (!sameForeground && previousGroup != null && previousPackage != null) finalizeActiveGroupSegment(previousGroup, now)
        if (!sameForeground) cancelAllowanceDeadline()
        pruneExpiredLeases(applicationContext, now)
        rolloverIfNeeded(now)
        pruneExpiredCooldowns(now)
        val policy = findGroupPolicyForPackage(loadRiskGroupPolicies(applicationContext), packageName)
        val priorHold = policy?.let { hasGroupAttentionHold(applicationContext, it.groupId, now) } == true
        if (policy != null && priorHold) reconcileReadingGate(policy.groupId, now)
        if (sameForeground && !priorHold) return
        if (isEffectivelyRestricted(applicationContext, packageName, now)) {
            presentIntervention(packageName, policy, loadCooldownForPackage(packageName, now)?.endsAt)
        } else if (policy != null && !hasGroupAttentionHold(applicationContext, policy.groupId, now) && !hasActiveAccessLease(applicationContext, packageName, now)) {
            startGroupUsage(policy, packageName, now)
        } else {
            activeUsageGroup = null; activeUsagePackage = null; activeUsageStartedAt = null
        }
    }

    private fun findGroupPolicyForPackage(policies: List<NativeRiskGroupPolicy>, packageName: String): NativeRiskGroupPolicy? = policies.firstOrNull { packageName in it.packageNames }

    @Synchronized private fun startGroupUsage(policy: NativeRiskGroupPolicy, packageName: String, now: Long) {
        rolloverIfNeeded(now)
        if (hasGroupAttentionHold(applicationContext, policy.groupId, now) || hasActiveAccessLease(applicationContext, packageName, now)) {
            activeUsageGroup = null; activeUsagePackage = null; activeUsageStartedAt = null
            return
        }
        val ledger = loadGroupUsageLedger(applicationContext).toMutableMap()
        val current = ledger[policy.groupId]?.takeIf { it.dateKey == getLocalDateKey(now) }
            ?: NativeGroupAllowanceUsage(policy.groupId, getLocalDateKey(now), 0L, null, null, null, ledger[policy.groupId]?.cycleRevision ?: 0L)
        val remaining = policy.allowanceMinutes * 60_000L - current.usedMillis
        if (remaining <= 0L || policy.allowanceMinutes <= 0 || current.exhaustedAt != null) {
            exhaustGroup(policy, packageName, now)
            return
        }
        val usage = current.copy(activePackageName = packageName, activeSegmentStartedAt = now)
        ledger[policy.groupId] = usage
        saveGroupUsageLedger(applicationContext, ledger)
        activeUsageGroup = policy.groupId; activeUsagePackage = packageName; activeUsageStartedAt = now
        scheduleGroupAllowanceDeadline(policy.groupId, packageName, now + remaining)
        scheduleMidnightRollover(now)
    }

    @Synchronized private fun finalizeActiveGroupSegment(groupId: String, now: Long) {
        val ledger = loadGroupUsageLedger(applicationContext).toMutableMap()
        val current = ledger[groupId]
        val started = activeUsageStartedAt ?: current?.activeSegmentStartedAt
        if (current != null && started != null && current.dateKey == getLocalDateKey(now)) {
            ledger[groupId] = current.copy(usedMillis = current.usedMillis + maxOf(0L, now - maxOf(getLocalMidnight(now), started)), activePackageName = null, activeSegmentStartedAt = null)
            val watermarks = NativeGroupUsageAccounting.withWatermarkUpdates(
                loadAccountedWatermarks(applicationContext),
                mapOf(groupId to now),
            )
            persistUsageAccountingState(applicationContext, ledger, watermarks)
        }
        if (activeUsageGroup == groupId) { activeUsageGroup = null; activeUsagePackage = null; activeUsageStartedAt = null }
    }

    @Synchronized private fun exhaustGroup(policy: NativeRiskGroupPolicy, foregroundPackage: String, now: Long) {
        rolloverIfNeeded(now)
        val ledger = loadGroupUsageLedger(applicationContext).toMutableMap()
        val dateKey = getLocalDateKey(now)
        val prior = ledger[policy.groupId]?.takeIf { it.dateKey == dateKey }
        val cooldowns = loadCooldownPolicies(applicationContext).associateBy { it.groupId }
        val gates = loadReadingGates(applicationContext)
        if (NativeGroupUsageAccounting.hasCommittedExhaustion(policy.groupId, dateKey, prior, cooldowns, gates)) return

        val activeStartedAt = activeUsageStartedAt ?: ledger[policy.groupId]?.activeSegmentStartedAt
        val exhaustion = NativeGroupUsageAccounting.prepareExhaustion(
            groupId = policy.groupId,
            dateKey = dateKey,
            now = now,
            localMidnight = getLocalMidnight(now),
            allowanceMillis = policy.allowanceMinutes * 60_000L,
            previousUsage = ledger[policy.groupId],
            activeSegmentStartedAt = activeStartedAt,
            existingWatermark = loadAccountedWatermarks(applicationContext)[policy.groupId],
        )
        ledger[policy.groupId] = exhaustion.usage
        val endsAt = now + policy.cooldownMinutes * 60_000L
        val attention = loadAttentionExchangeState(applicationContext, now)
        val allocation = NativeAttentionExchangeLogic.allocateCooldown(
            state = attention,
            policy = loadAttentionPolicy(applicationContext),
            groupId = policy.groupId,
            packageNames = policy.packageNames,
            startedAt = now,
            endsAt = endsAt,
            dateKey = dateKey,
            existingCooldowns = cooldowns,
            existingGates = gates,
            alreadyExhausted = false,
        )
        if (!allocation.allocated) return
        val updatedCooldowns = allocation.cooldowns.values.toList()
        val saved = persistAttentionMutation(
            context = applicationContext,
            ledger = ledger,
            cooldowns = updatedCooldowns,
            state = allocation.dailyAttentionExchange,
            gates = allocation.readingGates,
            accountedWatermarkUpdates = mapOf(policy.groupId to exhaustion.accountedThrough),
        )
        if (!saved) {
            Log.e(TAG, "Failed to persist exhaustion accounting for ${policy.groupId}")
            return
        }
        activeUsageGroup = null; activeUsagePackage = null; activeUsageStartedAt = null
        scheduleNearestCooldownExpiry(now)
        if (lastForegroundPackage == foregroundPackage && !hasActiveAccessLease(applicationContext, foregroundPackage, now)) presentIntervention(foregroundPackage, policy, endsAt)
        Log.i(TAG, "Risk group exhausted: ${policy.groupId}; ordinal ${allocation.dailyAttentionExchange.cooldownsTriggered}; cooldown ends $endsAt")
    }

    private fun Long?.orZero(): Long = this ?: 0L

    private fun scheduleGroupAllowanceDeadline(groupId: String, packageName: String, deadline: Long) {
        cancelAllowanceDeadline()
        allowanceDeadlineAt = deadline
        val callback = Runnable { onAllowanceDeadlineFired(groupId, packageName, deadline) }
        allowanceDeadlineRunnable = callback
        handler.postDelayed(callback, maxOf(0L, deadline - System.currentTimeMillis()))
    }

    private fun onAllowanceDeadlineFired(groupId: String, packageName: String, scheduled: Long) {
        val now = System.currentTimeMillis()
        if (lastForegroundPackage != packageName || activeUsageGroup != groupId || activeUsagePackage != packageName) return
        val policy = loadRiskGroupPolicies(applicationContext).firstOrNull { it.groupId == groupId } ?: return
        val usage = loadGroupUsageLedger(applicationContext)[groupId] ?: return
        val started = activeUsageStartedAt ?: usage.activeSegmentStartedAt ?: now
        val total = usage.usedMillis + maxOf(0L, now - started)
        if (now < scheduled && total < policy.allowanceMinutes * 60_000L) return
        exhaustGroup(policy, packageName, now)
    }

    private fun cancelAllowanceDeadline() { allowanceDeadlineRunnable?.let { handler.removeCallbacks(it) }; allowanceDeadlineRunnable = null; allowanceDeadlineAt = null }

    private fun scheduleMidnightRollover(now: Long) {
        cancelMidnightRollover()
        val next = getNextLocalMidnight(now)
        nextMidnightRolloverAt = next
        val callback = Runnable { onMidnightRolloverFired(next) }
        midnightRolloverRunnable = callback
        handler.postDelayed(callback, maxOf(0L, next - now))
    }
    private fun cancelMidnightRollover() { midnightRolloverRunnable?.let { handler.removeCallbacks(it) }; midnightRolloverRunnable = null; nextMidnightRolloverAt = null }

    private fun rolloverIfNeeded(now: Long) {
        val ledger = loadGroupUsageLedger(applicationContext)
        val today = getLocalDateKey(now)
        val storedAttention = loadStoredAttentionExchangeState(applicationContext)
        val oldGateExists = loadReadingGates(applicationContext).values.any { it.attentionDateKey != today }
        if (ledger.values.any { it.dateKey != today } || storedAttention?.dateKey?.let { it != today } == true || oldGateExists) {
            onMidnightRolloverFired(getLocalMidnight(now))
        }
    }

    private fun onMidnightRolloverFired(midnight: Long) {
        val now = System.currentTimeMillis()
        if (now + 1000L < midnight) return
        val today = getLocalDateKey(now)
        val old = loadGroupUsageLedger(applicationContext)
        val next = mutableMapOf<String, NativeGroupAllowanceUsage>()
        for (policy in loadRiskGroupPolicies(applicationContext)) {
            val prior = old[policy.groupId]
            next[policy.groupId] = NativeGroupAllowanceUsage(policy.groupId, today, 0L, null, null, null, prior?.cycleRevision ?: 0L)
        }
        old.filterKeys { key -> next[key] == null }.forEach { (key, usage) ->
            next[key] = NativeGroupAllowanceUsage(key, today, 0L, null, null, null, usage.cycleRevision)
        }
        val priorAttention = loadStoredAttentionExchangeState(applicationContext)
        val nextAttention = priorAttention?.takeIf { it.dateKey == today }
            ?: NativeAttentionExchangeLogic.newDailyState(today, now)
        // Active timers intentionally retain their original endsAt and metadata across midnight.
        val cooldowns = loadCooldownPolicies(applicationContext)
        val gates = loadReadingGates(applicationContext).filterValues { it.attentionDateKey == today }
        persistAttentionMutation(applicationContext, next, cooldowns, nextAttention, gates)
        if (priorAttention?.dateKey != today) {
            applicationContext.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE)
                .edit().remove(RhythmNativePolicyKeys.DAILY_READING_EVIDENCE_JSON).apply()
        }
        cancelAllowanceDeadline()
        val rolloverPackage = activeUsagePackage
        activeUsageGroup = null
        activeUsagePackage = null
        activeUsageStartedAt = null
        val foreground = lastForegroundPackage
        val policy = foreground?.let { findGroupPolicyForPackage(loadRiskGroupPolicies(applicationContext), it) }
        if (foreground != null && policy != null && rolloverPackage != null && !isEffectivelyRestricted(applicationContext, foreground, now) && !hasActiveAccessLease(applicationContext, foreground, now)) startGroupUsage(policy, foreground, now)
        scheduleMidnightRollover(now + 1000L)
    }

    private fun scheduleNextRoutineBoundary(now: Long = System.currentTimeMillis()) {
        cancelRoutineBoundary()
        val schedule = loadRoutineSchedule(applicationContext)
        val calendar = Calendar.getInstance().apply { timeInMillis = now }
        val currentMinutes = calendar.get(Calendar.HOUR_OF_DAY) * 60 + calendar.get(Calendar.MINUTE)
        val targets = mutableSetOf<Int>(1440)
        schedule.windows.filter { it.enabled }.forEach { window ->
            parseTime(window.startTime).takeIf { it > currentMinutes }?.let { targets += it }
            parseTime(window.endTime).takeIf { it > currentMinutes }?.let { targets += it }
        }
        val target = targets.minOrNull() ?: 1440
        val boundary = if (target >= 1440) getNextLocalMidnight(now) else Calendar.getInstance().apply {
            timeInMillis = now; set(Calendar.HOUR_OF_DAY, target / 60); set(Calendar.MINUTE, target % 60); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
        }.timeInMillis
        nextRoutineBoundaryAt = boundary
        val r = Runnable { onRoutineBoundaryFired() }
        routineBoundaryRunnable = r
        handler.postDelayed(r, maxOf(0L, boundary - now))
    }
    private fun cancelRoutineBoundary() { routineBoundaryRunnable?.let { handler.removeCallbacks(it) }; routineBoundaryRunnable = null; nextRoutineBoundaryAt = null }
    private fun onRoutineBoundaryFired() {
        val now = System.currentTimeMillis()
        rolloverIfNeeded(now)
        lastForegroundPackage?.let { packageName ->
            val policy = findGroupPolicyForPackage(loadRiskGroupPolicies(applicationContext), packageName)
            if (isEffectivelyRestricted(applicationContext, packageName, now)) {
                activeUsageGroup?.let { finalizeActiveGroupSegment(it, now) }
                cancelAllowanceDeadline()
                presentIntervention(packageName, policy, loadCooldownForPackage(packageName, now)?.endsAt)
            } else if (policy != null && !hasGroupAttentionHold(applicationContext, policy.groupId, now) && !hasActiveAccessLease(applicationContext, packageName, now)) {
                if (activeUsageGroup == null) startGroupUsage(policy, packageName, now)
            }
        }
        scheduleNextRoutineBoundary(now + 1000L)
    }

    private fun scheduleNearestCooldownExpiry(now: Long = System.currentTimeMillis()) { cancelCooldownExpiry(); val active = loadCooldownPolicies(applicationContext).filter { it.endsAt > now }; if (active.isEmpty()) return; val nearest = active.minOf { it.endsAt }; nearestCooldownExpiryAt = nearest; val r = Runnable { onCooldownExpiryFired() }; cooldownExpiryRunnable = r; handler.postDelayed(r, maxOf(0L, nearest - now)) }
    private fun cancelCooldownExpiry() { cooldownExpiryRunnable?.let { handler.removeCallbacks(it) }; cooldownExpiryRunnable = null; nearestCooldownExpiryAt = null }
    @Synchronized private fun onCooldownExpiryFired() = reconcileExpiredCooldowns(System.currentTimeMillis())

    @Synchronized private fun reconcileExpiredCooldowns(now: Long) {
        rolloverIfNeeded(now)
        val today = getLocalDateKey(now)
        val cooldowns = loadCooldownPolicies(applicationContext)
        val gates = loadReadingGates(applicationContext).toMutableMap()
        val state = loadAttentionExchangeState(applicationContext, now)
        val updatedCooldowns = cooldowns.associateBy { it.groupId }.toMutableMap()
        var ledger = loadGroupUsageLedger(applicationContext).toMutableMap()
        val expiredCooldowns = cooldowns.filter { it.endsAt <= now }
        if (expiredCooldowns.isEmpty()) return

        for (cooldown in expiredCooldowns) {
            val restoredGate = gates[cooldown.groupId] ?: NativeAttentionExchangeLogic.gateForCooldown(cooldown, today)
            if (restoredGate != null && gates[cooldown.groupId] == null) gates[cooldown.groupId] = restoredGate
            val evidence = if (restoredGate != null && cooldown.attentionDateKey == today) queryAndStoreDailyEvidence(today) else null
            val decision = NativeAttentionExchangeLogic.decideCooldownExpiry(cooldown, restoredGate, evidence, now, today)
            when (decision.action) {
                NativeCooldownExpiryAction.KEEP_ACTIVE_TIMER -> Unit
                NativeCooldownExpiryAction.REMOVE_TIMER_KEEP_GATE -> {
                    updatedCooldowns.remove(cooldown.groupId)
                    decision.gate?.let { gates[cooldown.groupId] = it }
                }
                NativeCooldownExpiryAction.COMPLETE_RESTRICTED_CYCLE -> {
                    updatedCooldowns.remove(cooldown.groupId)
                    gates.remove(cooldown.groupId)
                    completeRestrictedCycleInMutation(cooldown.groupId, now, ledger)
                }
            }
        }

        persistAttentionMutation(applicationContext, ledger, updatedCooldowns.values.toList(), state, gates)
        scheduleNearestCooldownExpiry(now)
        lastForegroundPackage?.let { packageName ->
            if (isEffectivelyRestricted(applicationContext, packageName, now)) {
                presentIntervention(packageName, findGroupPolicyForPackage(loadRiskGroupPolicies(applicationContext), packageName), loadCooldownForPackage(packageName, now)?.endsAt)
            } else if (!hasActiveAccessLease(applicationContext, packageName, now)) {
                findGroupPolicyForPackage(loadRiskGroupPolicies(applicationContext), packageName)?.let { startGroupUsage(it, packageName, now) }
            }
        }
    }

    private fun completeRestrictedCycleInMutation(
        groupId: String,
        now: Long,
        ledger: MutableMap<String, NativeGroupAllowanceUsage>,
    ) {
        ledger[groupId] = NativeAttentionExchangeLogic.completeGroupCycle(
            groupId = groupId,
            dateKey = getLocalDateKey(now),
            now = now,
            previous = ledger[groupId],
        )
    }

    /** One shared completion path for free timers and satisfied reading gates. */
    @Synchronized private fun completeRestrictedCycle(groupId: String, now: Long) {
        val ledger = loadGroupUsageLedger(applicationContext).toMutableMap()
        val cooldowns = loadCooldownPolicies(applicationContext).filterNot { it.groupId == groupId }
        val gates = loadReadingGates(applicationContext).toMutableMap().apply { remove(groupId) }
        completeRestrictedCycleInMutation(groupId, now, ledger)
        persistAttentionMutation(
            applicationContext,
            ledger,
            cooldowns,
            loadAttentionExchangeState(applicationContext, now),
            gates,
        )
        scheduleNearestCooldownExpiry(now)
    }

    /** Queries Reader V2 at bounded lifecycle points; synchronous restriction checks never query a provider. */
    @Synchronized private fun reconcileReadingGate(groupId: String, now: Long): NativeAttentionGateEvaluation? {
        val today = getLocalDateKey(now)
        val gate = loadReadingGates(applicationContext)[groupId] ?: return null
        if (gate.attentionDateKey != today) {
            val gates = loadReadingGates(applicationContext).toMutableMap().apply { remove(groupId) }
            val state = loadAttentionExchangeState(applicationContext, now)
            val prefs = applicationContext.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE)
            persistAttentionMutation(applicationContext, loadGroupUsageLedger(applicationContext), loadCooldownPolicies(applicationContext), state, gates)
            prefs.edit().remove(RhythmNativePolicyKeys.DAILY_READING_EVIDENCE_JSON).apply()
            return null
        }
        val evidence = queryAndStoreDailyEvidence(today)
        val evaluation = NativeAttentionExchangeLogic.evaluateGate(gate, evidence, now, today)
        if (evaluation.phase == NativeAttentionGatePhase.SATISFIED && gate.cooldownEndsAt <= now) {
            completeRestrictedCycle(groupId, now)
            return evaluation
        }
        return evaluation
    }

    @Synchronized private fun reconcileAllReadingGates(now: Long) {
        val today = getLocalDateKey(now)
        loadReadingGates(applicationContext).values
            .filter { it.attentionDateKey == today }
            .forEach { reconcileReadingGate(it.groupId, now) }
    }

    fun reconcileAttentionExchange(now: Long = System.currentTimeMillis()) {
        rolloverIfNeeded(now)
        reconcileAttentionExchangeInContext(applicationContext, now)
        scheduleNearestCooldownExpiry(now)
        recheckForeground()
    }

    fun refreshAttentionForOverlay(packageName: String, now: Long = System.currentTimeMillis()): NativeOverlayAttentionInfo? {
        rolloverIfNeeded(now)
        val policy = findGroupPolicyForPackage(loadRiskGroupPolicies(applicationContext), packageName) ?: return null
        val gate = loadReadingGates(applicationContext)[policy.groupId]
        val cooldown = loadCooldownPolicies(applicationContext).firstOrNull { it.groupId == policy.groupId }
        val evaluation = gate?.let { reconcileReadingGate(policy.groupId, now) ?: NativeAttentionExchangeLogic.evaluateGate(it, loadDailyReadingEvidence(applicationContext), now, getLocalDateKey(now)) }
        val currentGate = loadReadingGates(applicationContext)[policy.groupId]
        val currentCooldown = loadCooldownPolicies(applicationContext).firstOrNull { it.groupId == policy.groupId }
        val mode = when {
            currentGate != null && currentGate.cooldownEndsAt <= now -> "PRODUCTIVE_ATTENTION"
            currentCooldown != null || currentGate != null -> "COOLDOWN"
            else -> "ROUTINE"
        }
        val endsAt = currentCooldown?.endsAt ?: currentGate?.cooldownEndsAt ?: cooldown?.endsAt ?: 0L
        return NativeOverlayAttentionInfo(
            groupName = policy.groupName,
            mode = mode,
            cooldownEndsAt = endsAt,
            ordinal = currentGate?.dailyCooldownOrdinal ?: currentCooldown?.dailyCooldownOrdinal,
            requiredReadingSeconds = currentGate?.requiredReadingSeconds ?: currentCooldown?.requiredReadingSeconds ?: 0L,
            requiredQualifiedPages = currentGate?.requiredQualifiedPages ?: currentCooldown?.requiredQualifiedPages ?: 0,
            evaluation = evaluation,
        )
    }

    fun openRhythmicReader(): Boolean {
        return try {
            val launchIntent = packageManager.getLaunchIntentForPackage("com.terinit.rhythmicreader") ?: return false
            launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            startActivity(launchIntent)
            true
        } catch (_: Exception) {
            false
        }
    }

    private fun presentIntervention(packageName: String, policy: NativeRiskGroupPolicy?, cooldownEndsAt: Long?) {
        if (RhythmOverlayActivity.isVisible) return
        val now = System.currentTimeMillis(); if (lastInterventionPackage == packageName && now - lastInterventionAt < DEBOUNCE_MS) return
        lastInterventionPackage = packageName; lastInterventionAt = now
        val activity = policy?.recoveryActivity
        val attentionInfo = policy?.let { buildOverlayAttentionInfo(it, now) }
        if (!isEffectivelyRestricted(applicationContext, packageName, now)) return
        val intent = Intent(this, RhythmOverlayActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(RhythmNativePolicyKeys.EXTRA_PACKAGE_NAME, packageName)
            putExtra(RhythmNativePolicyKeys.EXTRA_GROUP_ID, policy?.groupId)
            putExtra(RhythmNativePolicyKeys.EXTRA_GROUP_NAME, policy?.groupName)
            putExtra(RhythmNativePolicyKeys.EXTRA_COOLDOWN_ENDS_AT, attentionInfo?.cooldownEndsAt ?: cooldownEndsAt ?: 0L)
            putExtra(RhythmNativePolicyKeys.EXTRA_ACTIVITY_TITLE, activity?.title)
            putExtra(RhythmNativePolicyKeys.EXTRA_ACTIVITY_SUBTITLE, activity?.subtitle)
            putExtra(RhythmNativePolicyKeys.EXTRA_ACTIVITY_EMOJI, activity?.iconEmoji)
            putExtra(RhythmNativePolicyKeys.EXTRA_ACTIVITY_DURATION, activity?.durationSuggestion)
            putExtra(RhythmNativePolicyKeys.EXTRA_INTERVENTION_MODE, attentionInfo?.mode ?: "ROUTINE")
            putExtra(RhythmNativePolicyKeys.EXTRA_ATTENTION_ORDINAL, attentionInfo?.ordinal ?: 0)
            putExtra(RhythmNativePolicyKeys.EXTRA_REQUIRED_READING_SECONDS, attentionInfo?.requiredReadingSeconds ?: 0L)
            putExtra(RhythmNativePolicyKeys.EXTRA_REQUIRED_QUALIFIED_PAGES, attentionInfo?.requiredQualifiedPages ?: 0)
            val evaluation = attentionInfo?.evaluation
            putExtra(RhythmNativePolicyKeys.EXTRA_VERIFIED_ACTIVE_SECONDS, evaluation?.verifiedActiveSeconds ?: 0L)
            putExtra(RhythmNativePolicyKeys.EXTRA_VERIFIED_QUALIFIED_PAGES, evaluation?.qualifiedPages ?: 0)
            putExtra(RhythmNativePolicyKeys.EXTRA_REMAINING_READING_SECONDS, evaluation?.remainingSeconds ?: 0L)
            putExtra(RhythmNativePolicyKeys.EXTRA_REMAINING_QUALIFIED_PAGES, evaluation?.remainingPages ?: 0)
            putExtra(RhythmNativePolicyKeys.EXTRA_READER_PROVIDER_AVAILABLE, evaluation?.readerProviderAvailable ?: false)
            putExtra(RhythmNativePolicyKeys.EXTRA_READER_PROTOCOL_COMPATIBLE, evaluation?.readerProtocolCompatible ?: false)
            putExtra(
                RhythmNativePolicyKeys.EXTRA_READER_APP_AVAILABLE,
                packageManager.getLaunchIntentForPackage("com.terinit.rhythmicreader") != null,
            )
        }
        try { startActivity(intent) } catch (e: Exception) { Log.e(TAG, "Failed to launch Touch Grass", e) }
    }

    private fun buildOverlayAttentionInfo(policy: NativeRiskGroupPolicy, now: Long): NativeOverlayAttentionInfo {
        val today = getLocalDateKey(now)
        val gate = loadReadingGates(applicationContext)[policy.groupId]
            ?.takeIf { it.attentionDateKey == today }
        val cooldown = loadCooldownPolicies(applicationContext).firstOrNull { it.groupId == policy.groupId }
        val evidence = loadDailyReadingEvidence(applicationContext)
        val evaluation = gate?.let { NativeAttentionExchangeLogic.evaluateGate(it, evidence, now, today) }
        val mode = when {
            gate != null && gate.cooldownEndsAt <= now -> "PRODUCTIVE_ATTENTION"
            cooldown != null || gate != null -> "COOLDOWN"
            else -> "ROUTINE"
        }
        return NativeOverlayAttentionInfo(
            groupName = policy.groupName,
            mode = mode,
            cooldownEndsAt = cooldown?.endsAt ?: gate?.cooldownEndsAt ?: 0L,
            ordinal = gate?.dailyCooldownOrdinal ?: cooldown?.dailyCooldownOrdinal,
            requiredReadingSeconds = gate?.requiredReadingSeconds ?: cooldown?.requiredReadingSeconds ?: 0L,
            requiredQualifiedPages = gate?.requiredQualifiedPages ?: cooldown?.requiredQualifiedPages ?: 0,
            evaluation = evaluation,
        )
    }

    fun onBaseRestrictionsChanged() = recheckForeground()
    fun resolveRecentForegroundPackage(): String? = resolveCurrentForegroundPackage(applicationContext)
    fun onRiskGroupPoliciesChanged() {
        val now = System.currentTimeMillis()
        activeUsageGroup?.let { finalizeActiveGroupSegment(it, now) }
        cancelAllowanceDeadline()
        rolloverIfNeeded(now)
        scheduleMidnightRollover(now)
        scheduleNextRoutineBoundary(now)
        val foreground = lastForegroundPackage ?: resolveRecentForegroundPackage() ?: return
        val policy = findGroupPolicyForPackage(loadRiskGroupPolicies(applicationContext), foreground)
        if (isEffectivelyRestricted(applicationContext, foreground, now)) {
            presentIntervention(foreground, policy, loadCooldownForPackage(foreground, now)?.endsAt)
        } else if (policy != null && !hasGroupAttentionHold(applicationContext, policy.groupId, now) && !hasActiveAccessLease(applicationContext, foreground, now)) {
            startGroupUsage(policy, foreground, now)
        }
    }
    fun onCooldownPoliciesChanged() { scheduleNearestCooldownExpiry(); recheckForeground() }
    fun onRoutineScheduleChanged() { scheduleNextRoutineBoundary(); recheckForeground() }
    private fun recheckForeground() { val now = System.currentTimeMillis(); lastForegroundPackage?.let { if (isEffectivelyRestricted(applicationContext, it, now)) presentIntervention(it, findGroupPolicyForPackage(loadRiskGroupPolicies(applicationContext), it), loadCooldownForPackage(it, now)?.endsAt) } }

    fun reconcileUsage(fromTime: Long? = null, toTime: Long = System.currentTimeMillis()) {
        try {
            rolloverIfNeeded(toTime)
            val manager = getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager ?: return
            val prefs = applicationContext.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE)
            val from = fromTime ?: maxOf(getLocalMidnight(toTime), prefs.getLong(RhythmNativePolicyKeys.LAST_USAGE_RECONCILED_AT, 0L) - 60000L)
            if (from >= toTime) return
            val policies = loadRiskGroupPolicies(applicationContext); val byPackage = policies.flatMap { p -> p.packageNames.map { it to p } }.toMap()
            val events = manager.queryEvents(from, toTime); val transitions = mutableListOf<UsageTransition>(); val ev = UsageEvents.Event()
            while (events.hasNextEvent()) { events.getNextEvent(ev); if (byPackage[ev.packageName] == null) continue; val fg = ev.eventType == UsageEvents.Event.ACTIVITY_RESUMED || ev.eventType == UsageEvents.Event.MOVE_TO_FOREGROUND; val bg = ev.eventType == UsageEvents.Event.ACTIVITY_PAUSED || ev.eventType == UsageEvents.Event.ACTIVITY_STOPPED || ev.eventType == UsageEvents.Event.MOVE_TO_BACKGROUND; if (fg || bg) transitions += UsageTransition(ev.packageName, ev.timeStamp, fg) }
            val ledger = loadGroupUsageLedger(applicationContext).toMutableMap(); val watermarks = loadAccountedWatermarks(applicationContext).toMutableMap()
            for (policy in policies) {
                val watermark = watermarks[policy.groupId] ?: 0L; var activePackage: String? = null; var start: Long? = null; var delta = 0L
                val localMidnight = getLocalMidnight(toTime)
                transitions.filter { it.packageName in policy.packageNames }.sortedBy { it.timestamp }.forEach { t ->
                    if (t.foreground) {
                        if (activePackage != null && activePackage != t.packageName && start != null) {
                            delta += NativeGroupUsageAccounting.unaccountedIntervalMillis(start!!, t.timestamp, watermark, localMidnight)
                        }
                        if (activePackage != t.packageName) { activePackage = t.packageName; start = t.timestamp }
                    } else if (activePackage == t.packageName && start != null) {
                        delta += NativeGroupUsageAccounting.unaccountedIntervalMillis(start!!, t.timestamp, watermark, localMidnight)
                        activePackage = null; start = null
                    }
                }
                if (start != null && policy.groupId != activeUsageGroup) {
                    delta += NativeGroupUsageAccounting.unaccountedIntervalMillis(start!!, toTime, watermark, localMidnight)
                }
                if (delta > 0L) { val current = ledger[policy.groupId]?.takeIf { it.dateKey == getLocalDateKey(toTime) } ?: NativeGroupAllowanceUsage(policy.groupId, getLocalDateKey(toTime), 0L, null, null, null, 0L); ledger[policy.groupId] = current.copy(usedMillis = current.usedMillis + delta); }
                watermarks[policy.groupId] = maxOf(watermarks[policy.groupId] ?: 0L, toTime)
            }
            persistUsageAccountingState(applicationContext, ledger, watermarks)
            pruneExpiredCooldowns(toTime)
            val reconciledLedger = loadGroupUsageLedger(applicationContext)
            policies.forEach { policy ->
                val usage = reconciledLedger[policy.groupId]
                val exhausted = usage?.dateKey == getLocalDateKey(toTime) && (usage.exhaustedAt != null || usage.usedMillis >= policy.allowanceMinutes * 60_000L || policy.allowanceMinutes == 0)
                if (exhausted && usage?.exhaustedAt == null &&
                    loadCooldownPolicies(applicationContext).none { it.groupId == policy.groupId } &&
                    loadReadingGates(applicationContext)[policy.groupId]?.attentionDateKey != getLocalDateKey(toTime)
                ) {
                    exhaustGroup(policy, lastForegroundPackage ?: policy.packageNames.firstOrNull().orEmpty(), toTime)
                }
            }
            prefs.edit().putLong(RhythmNativePolicyKeys.LAST_USAGE_RECONCILED_AT, toTime).apply(); lastUsageReconciledAt = toTime
        } catch (e: Exception) { Log.w(TAG, "bounded UsageStats reconciliation failed", e) }
    }

    private fun restoreForegroundStateAfterReconnect() {
        val now = System.currentTimeMillis()
        val foreground = resolveCurrentForegroundPackage(applicationContext, now)
        if (foreground != null) {
            lastForegroundPackage = foreground
            val policy = findGroupPolicyForPackage(loadRiskGroupPolicies(applicationContext), foreground)
            if (policy != null && hasGroupAttentionHold(applicationContext, policy.groupId, now)) reconcileReadingGate(policy.groupId, now)
            if (isEffectivelyRestricted(applicationContext, foreground, now)) {
                presentIntervention(foreground, policy, loadCooldownForPackage(foreground, now)?.endsAt)
            } else if (policy != null && !hasGroupAttentionHold(applicationContext, policy.groupId, now) && !hasActiveAccessLease(applicationContext, foreground, now)) {
                startGroupUsage(policy, foreground, now)
            }
        }
    }

    fun scheduleLeaseExpiry(lease: NativeAccessLease) {
        cancelLeaseExpiry(lease.groupId)
        val r = Runnable {
            pruneExpiredLeases(applicationContext)
            val now = System.currentTimeMillis()
            val packageName = lastForegroundPackage
            if (packageName != null && isEffectivelyRestricted(applicationContext, packageName, now)) {
                presentIntervention(packageName, findGroupPolicyForPackage(loadRiskGroupPolicies(applicationContext), packageName), loadCooldownForPackage(packageName, now)?.endsAt)
            } else if (packageName != null) {
                val policy = findGroupPolicyForPackage(loadRiskGroupPolicies(applicationContext), packageName)
                if (policy != null && !hasGroupAttentionHold(applicationContext, policy.groupId, now)) startGroupUsage(policy, packageName, now)
            }
            leaseCallbacks.remove(lease.groupId)
        }
        leaseCallbacks[lease.groupId] = r
        handler.postDelayed(r, maxOf(0L, lease.endsAt - System.currentTimeMillis()))
    }
    fun cancelLeaseExpiry(groupId: String) { leaseCallbacks.remove(groupId)?.let { handler.removeCallbacks(it) } }
    override fun onInterrupt() {}

    fun onNativePolicyReset() {
        cancelAllowanceDeadline()
        cancelMidnightRollover()
        cancelRoutineBoundary()
        cancelCooldownExpiry()
        leaseCallbacks.values.forEach { handler.removeCallbacks(it) }
        leaseCallbacks.clear()
        activeUsageGroup = null
        activeUsagePackage = null
        activeUsageStartedAt = null
        allowanceDeadlineAt = null
        nextRoutineBoundaryAt = null
        nextMidnightRolloverAt = null
        nearestCooldownExpiryAt = null
        lastUsageReconciledAt = 0L
        lastForegroundPackage = null
        lastInterventionPackage = null
        lastInterventionAt = 0L
        // The overlay polls effective restrictions and closes as soon as the cleared
        // policy is observed; no foreground package data is needed here.
    }

    companion object {
        const val TAG = "RhythmEnforcement"; var isRunning = false; var instance: RhythmEnforcementService? = null
        fun getLocalDateKey(timestamp: Long = System.currentTimeMillis()): String = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(Date(timestamp))
        private fun isValidLocalDateKey(value: String): Boolean {
            if (!value.matches(Regex("\\d{4}-\\d{2}-\\d{2}"))) return false
            val formatter = SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).apply {
                isLenient = false
                timeZone = TimeZone.getTimeZone("UTC")
            }
            val position = ParsePosition(0)
            val parsed = formatter.parse(value, position) ?: return false
            return position.index == value.length && formatter.format(parsed) == value
        }
        fun getLocalMidnight(timestamp: Long = System.currentTimeMillis()): Long { val c = Calendar.getInstance(); c.timeInMillis = timestamp; c.set(Calendar.HOUR_OF_DAY, 0); c.set(Calendar.MINUTE, 0); c.set(Calendar.SECOND, 0); c.set(Calendar.MILLISECOND, 0); return c.timeInMillis }
        fun getNextLocalMidnight(timestamp: Long = System.currentTimeMillis()): Long { val c = Calendar.getInstance(); c.timeInMillis = timestamp; c.add(Calendar.DAY_OF_YEAR, 1); c.set(Calendar.HOUR_OF_DAY, 0); c.set(Calendar.MINUTE, 0); c.set(Calendar.SECOND, 0); c.set(Calendar.MILLISECOND, 0); return c.timeInMillis }
        fun hasActiveAccessLease(context: Context, packageName: String, now: Long = System.currentTimeMillis()) = loadActiveLeases(context, now).any { packageName in it.packageNames && it.endsAt > now }
        fun loadActiveLeases(context: Context, now: Long = System.currentTimeMillis()): List<NativeAccessLease> { val json = context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE).getString(RhythmNativePolicyKeys.ACCESS_LEASES_JSON, null) ?: return emptyList(); val out = mutableListOf<NativeAccessLease>(); try { val a = JSONArray(json); for (i in 0 until a.length()) { val o = a.getJSONObject(i); val end = o.optLong("endsAt"); if (end > now) out += NativeAccessLease(o.optString("groupId"), jsonStrings(o.optJSONArray("packageNames")), end) } } catch (_: Exception) {} ; return out }
        fun saveLeases(context: Context, leases: List<NativeAccessLease>) { val a = JSONArray(); leases.forEach { l -> a.put(JSONObject().apply { put("groupId", l.groupId); put("endsAt", l.endsAt); put("packageNames", JSONArray(l.packageNames.toList())) }) }; context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE).edit().putString(RhythmNativePolicyKeys.ACCESS_LEASES_JSON, a.toString()).apply() }
        fun parseAndPruneLeases(json: String, now: Long): Pair<List<NativeAccessLease>, Boolean> {
            val active = mutableListOf<NativeAccessLease>(); var expired = false
            try {
                val array = JSONArray(json)
                for (i in 0 until array.length()) {
                    val item = array.optJSONObject(i) ?: continue
                    val endsAt = item.optLong("endsAt", 0L)
                    if (endsAt > now) active += NativeAccessLease(item.optString("groupId"), jsonStrings(item.optJSONArray("packageNames")), endsAt) else expired = true
                }
            } catch (_: Exception) { expired = true }
            return active to expired
        }
        fun pruneExpiredLeases(context: Context, now: Long = System.currentTimeMillis()) = saveLeases(context, loadActiveLeases(context, now))
        fun loadRiskGroupPolicies(context: Context): List<NativeRiskGroupPolicy> { val json = context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE).getString(RhythmNativePolicyKeys.RISK_GROUP_POLICIES_JSON, null) ?: return emptyList(); val out = mutableListOf<NativeRiskGroupPolicy>(); try { val a = JSONArray(json); for (i in 0 until a.length()) { val o = a.getJSONObject(i); val activity = o.optJSONObject("recoveryActivity"); out += NativeRiskGroupPolicy(o.optString("groupId"), o.optString("groupName"), jsonStrings(o.optJSONArray("packageNames")), maxOf(0, o.optInt("allowanceMinutes", 30)), maxOf(0, o.optInt("cooldownMinutes", 0)), NativeRecoveryActivity(activity?.optString("id", "walk") ?: "walk", activity?.optString("title", "Take a short walk") ?: "Take a short walk", activity?.optString("subtitle", "Fresh air. Clear mind.") ?: "Fresh air. Clear mind.", activity?.optString("iconEmoji", "walk") ?: "walk", activity?.optString("durationSuggestion", null))) } } catch (_: Exception) {} ; return out }
        fun saveRiskGroupPolicies(context: Context, policies: List<NativeRiskGroupPolicy>) { val a = JSONArray(); policies.forEach { p -> a.put(JSONObject().apply { put("groupId", p.groupId); put("groupName", p.groupName); put("packageNames", JSONArray(p.packageNames.toList())); put("allowanceMinutes", p.allowanceMinutes); put("cooldownMinutes", p.cooldownMinutes); put("recoveryActivity", JSONObject().apply { put("id", p.recoveryActivity.id); put("title", p.recoveryActivity.title); put("subtitle", p.recoveryActivity.subtitle); put("iconEmoji", p.recoveryActivity.iconEmoji); p.recoveryActivity.durationSuggestion?.let { put("durationSuggestion", it) } }) }) }; context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE).edit().putString(RhythmNativePolicyKeys.RISK_GROUP_POLICIES_JSON, a.toString()).apply() }
        fun loadGroupUsageLedger(context: Context): Map<String, NativeGroupAllowanceUsage> { val json = context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE).getString(RhythmNativePolicyKeys.GROUP_USAGE_LEDGER_JSON, null) ?: return emptyMap(); val out = mutableMapOf<String, NativeGroupAllowanceUsage>(); try { val a = JSONArray(json); for (i in 0 until a.length()) { val o = a.getJSONObject(i); out[o.optString("groupId")] = NativeGroupAllowanceUsage(o.optString("groupId"), o.optString("dateKey"), o.optLong("usedMillis"), o.optString("activePackageName", null), if (o.has("activeSegmentStartedAt")) o.optLong("activeSegmentStartedAt") else null, if (o.has("exhaustedAt")) o.optLong("exhaustedAt") else null, o.optLong("cycleRevision")) } } catch (_: Exception) {} ; return out }
        fun saveGroupUsageLedger(context: Context, ledger: Map<String, NativeGroupAllowanceUsage>) { val a = JSONArray(); ledger.values.forEach { u -> a.put(JSONObject().apply { put("groupId", u.groupId); put("dateKey", u.dateKey); put("usedMillis", u.usedMillis); u.activePackageName?.let { put("activePackageName", it) }; u.activeSegmentStartedAt?.let { put("activeSegmentStartedAt", it) }; u.exhaustedAt?.let { put("exhaustedAt", it) }; put("cycleRevision", u.cycleRevision) }) }; context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE).edit().putString(RhythmNativePolicyKeys.GROUP_USAGE_LEDGER_JSON, a.toString()).apply() }
        fun loadCooldownPolicies(context: Context): List<NativeCooldownPolicy> {
            val json = context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE)
                .getString(RhythmNativePolicyKeys.COOLDOWN_POLICIES_JSON, null) ?: return emptyList()
            return parseCooldownPolicies(json)
        }

        fun saveCooldownPolicies(context: Context, policies: List<NativeCooldownPolicy>) {
            context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE)
                .edit().putString(RhythmNativePolicyKeys.COOLDOWN_POLICIES_JSON, serializeCooldownPolicies(policies)).apply()
        }

        fun loadAttentionPolicy(context: Context): NativeReadingAttentionPolicy {
            val json = context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE)
                .getString(RhythmNativePolicyKeys.ATTENTION_POLICY_JSON, null) ?: return NativeAttentionExchangeLogic.DEFAULT_POLICY
            return try {
                val value = JSONObject(json)
                NativeReadingAttentionPolicy(
                    freeCooldownCount = value.optInt("freeCooldownCount", 2),
                    baselineActiveSeconds = value.optLong("baselineActiveSeconds", 3600L),
                    baselineQualifiedPages = value.optInt("baselineQualifiedPages", 36),
                    incrementalActiveSeconds = value.optLong("incrementalActiveSeconds", 1800L),
                    incrementalQualifiedPages = value.optInt("incrementalQualifiedPages", 11),
                ).normalized()
            } catch (_: Exception) {
                NativeAttentionExchangeLogic.DEFAULT_POLICY
            }
        }

        fun saveAttentionPolicy(context: Context, policy: NativeReadingAttentionPolicy): Boolean {
            val value = policy.normalized()
            val json = JSONObject().apply {
                put("freeCooldownCount", value.freeCooldownCount)
                put("baselineActiveSeconds", value.baselineActiveSeconds)
                put("baselineQualifiedPages", value.baselineQualifiedPages)
                put("incrementalActiveSeconds", value.incrementalActiveSeconds)
                put("incrementalQualifiedPages", value.incrementalQualifiedPages)
            }.toString()
            return context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE)
                .edit().putString(RhythmNativePolicyKeys.ATTENTION_POLICY_JSON, json).commit()
        }

        fun loadStoredAttentionExchangeState(context: Context): NativeDailyAttentionExchangeState? {
            val json = context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE)
                .getString(RhythmNativePolicyKeys.ATTENTION_EXCHANGE_STATE_JSON, null) ?: return null
            return try {
                val value = JSONObject(json)
                val dateKey = value.optString("dateKey", "")
                if (!isValidLocalDateKey(dateKey)) return null
                NativeDailyAttentionExchangeState(
                    dateKey = dateKey,
                    cooldownsTriggered = value.optInt("cooldownsTriggered", 0).coerceAtLeast(0),
                    highestRequiredActiveSeconds = value.optLong("highestRequiredActiveSeconds", 0L).coerceAtLeast(0L),
                    highestRequiredQualifiedPages = value.optInt("highestRequiredQualifiedPages", 0).coerceAtLeast(0),
                    updatedAt = value.optLong("updatedAt", 0L).coerceAtLeast(0L),
                )
            } catch (_: Exception) {
                null
            }
        }

        fun loadAttentionExchangeState(context: Context, now: Long = System.currentTimeMillis()): NativeDailyAttentionExchangeState {
            val today = getLocalDateKey(now)
            val state = loadStoredAttentionExchangeState(context)?.takeIf { it.dateKey == today }
                ?: NativeAttentionExchangeLogic.newDailyState(today, now)
            val gateOrdinals = loadReadingGates(context).values.filter { it.attentionDateKey == today }
            val cooldowns = loadCooldownPolicies(context).filter { it.attentionDateKey == today }
            return state.copy(
                cooldownsTriggered = maxOf(
                    state.cooldownsTriggered,
                    gateOrdinals.maxOfOrNull { it.dailyCooldownOrdinal } ?: 0,
                    cooldowns.mapNotNull { it.dailyCooldownOrdinal }.maxOrNull() ?: 0,
                ),
                highestRequiredActiveSeconds = maxOf(
                    state.highestRequiredActiveSeconds,
                    gateOrdinals.maxOfOrNull { it.requiredReadingSeconds } ?: 0L,
                    cooldowns.maxOfOrNull { it.requiredReadingSeconds } ?: 0L,
                ),
                highestRequiredQualifiedPages = maxOf(
                    state.highestRequiredQualifiedPages,
                    gateOrdinals.maxOfOrNull { it.requiredQualifiedPages } ?: 0,
                    cooldowns.maxOfOrNull { it.requiredQualifiedPages } ?: 0,
                ),
            )
        }

        fun nextReadingTargetPreview(
            context: Context,
            now: Long = System.currentTimeMillis(),
        ): NativeRoutineReadingTargetPreview {
            val today = getLocalDateKey(now)
            return NativeAttentionExchangeLogic.nextReadingTargetPreview(
                state = loadAttentionExchangeState(context, now),
                dateKey = today,
                policy = loadAttentionPolicy(context),
            )
        }

        fun loadReadingGates(context: Context): Map<String, NativeReadingGate> {
            val json = context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE)
                .getString(RhythmNativePolicyKeys.READING_GATES_JSON, null) ?: return emptyMap()
            val result = mutableMapOf<String, NativeReadingGate>()
            try {
                val root = JSONObject(json)
                val keys = root.keys()
                while (keys.hasNext()) {
                    val key = keys.next()
                    val value = root.optJSONObject(key) ?: continue
                    val dateKey = value.optString("attentionDateKey", "")
                    val ordinal = value.optInt("dailyCooldownOrdinal", 0)
                    val seconds = value.optLong("requiredReadingSeconds", -1L)
                    val pages = value.optInt("requiredQualifiedPages", -1)
                    if (key.isBlank() || !isValidLocalDateKey(dateKey) || ordinal <= 0 || seconds < 0L || pages < 0) continue
                    result[key] = NativeReadingGate(
                        groupId = key,
                        attentionDateKey = dateKey,
                        dailyCooldownOrdinal = ordinal,
                        createdAt = value.optLong("createdAt", 0L).coerceAtLeast(0L),
                        cooldownEndsAt = value.optLong("cooldownEndsAt", 0L).coerceAtLeast(0L),
                        requiredReadingSeconds = seconds,
                        requiredQualifiedPages = pages,
                    )
                }
            } catch (_: Exception) {
                return emptyMap()
            }
            return result
        }

        fun saveReadingGates(context: Context, gates: Map<String, NativeReadingGate>) {
            val root = JSONObject()
            gates.forEach { (groupId, gate) -> root.put(groupId, readingGateJson(gate)) }
            context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE)
                .edit().putString(RhythmNativePolicyKeys.READING_GATES_JSON, root.toString()).commit()
        }

        fun loadDailyReadingEvidence(context: Context): NativeDailyReadingEvidenceResult? {
            val json = context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE)
                .getString(RhythmNativePolicyKeys.DAILY_READING_EVIDENCE_JSON, null) ?: return null
            return try {
                val value = JSONObject(json)
                val dateKey = value.optString("dateKey", "")
                if (!isValidLocalDateKey(dateKey)) return null
                NativeDailyReadingEvidenceResult(
                    providerAvailable = value.optBoolean("providerAvailable", false),
                    protocolCompatible = value.optBoolean("protocolCompatible", false),
                    protocolVersion = if (value.has("protocolVersion") && !value.isNull("protocolVersion")) value.optInt("protocolVersion") else null,
                    dateKey = dateKey,
                    verifiedActiveSeconds = value.optLong("verifiedActiveSeconds", 0L).coerceAtLeast(0L),
                    qualifiedPages = value.optInt("qualifiedPages", 0).coerceAtLeast(0),
                    updatedAtEpochMs = value.optLong("updatedAtEpochMs", 0L).coerceAtLeast(0L),
                )
            } catch (_: Exception) {
                null
            }
        }

        fun saveDailyReadingEvidence(context: Context, evidence: NativeDailyReadingEvidenceResult) {
            val json = evidenceJson(evidence).toString()
            context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE)
                .edit().putString(RhythmNativePolicyKeys.DAILY_READING_EVIDENCE_JSON, json).apply()
        }

        fun queryDailyReadingEvidence(context: Context, dateKey: String) =
            DailyReadingEvidenceProviderClient.query(context, dateKey)

        /** Works with or without the AccessibilityService process, so an app resume can reconcile native authority. */
        @Synchronized fun reconcileAttentionExchangeInContext(context: Context, now: Long): Boolean {
            val today = getLocalDateKey(now)
            val prefs = context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE)
            val storedState = loadStoredAttentionExchangeState(context)
            val priorLedger = loadGroupUsageLedger(context)
            var ledger = priorLedger.toMutableMap()
            var gates = loadReadingGates(context).filterValues { it.attentionDateKey == today }.toMutableMap()
            val persistedCooldowns = loadCooldownPolicies(context).associateBy { it.groupId }.toMutableMap()
            val hasNativeAttentionMetadata = gates.isNotEmpty() || persistedCooldowns.values.any {
                it.attentionDateKey == today && it.dailyCooldownOrdinal != null
            }
            val shouldPersistAttentionState = storedState != null || hasNativeAttentionMetadata
            if (storedState?.dateKey != null && storedState.dateKey != today) {
                ledger = ledger.mapValues { (groupId, usage) ->
                    if (usage.dateKey == today) usage else NativeGroupAllowanceUsage(
                        groupId = groupId,
                        dateKey = today,
                        usedMillis = 0L,
                        activePackageName = null,
                        activeSegmentStartedAt = null,
                        exhaustedAt = null,
                        cycleRevision = usage.cycleRevision,
                    )
                }.toMutableMap()
                prefs.edit().remove(RhythmNativePolicyKeys.DAILY_READING_EVIDENCE_JSON).apply()
            } else {
                ledger = ledger.mapValues { (groupId, usage) ->
                    if (usage.dateKey == today) usage else NativeGroupAllowanceUsage(
                        groupId, today, 0L, null, null, null, usage.cycleRevision
                    )
                }.toMutableMap()
            }

            var state = loadAttentionExchangeState(context, now)
            val cooldowns = persistedCooldowns
            cooldowns.values.forEach { cooldown ->
                NativeAttentionExchangeLogic.gateForCooldown(cooldown, today)?.let { gate ->
                    if (gates[gate.groupId] == null) gates[gate.groupId] = gate
                }
            }

            val hasCurrentDayGates = gates.isNotEmpty()
            val evidence = if (hasCurrentDayGates) {
                DailyReadingEvidenceProviderClient.query(context, today).also { saveDailyReadingEvidence(context, it) }
            } else null

            val completed = mutableSetOf<String>()
            for ((groupId, gate) in gates.toMap()) {
                val cooldown = cooldowns[groupId]
                if (cooldown != null && cooldown.endsAt > now) continue
                val evaluation = NativeAttentionExchangeLogic.evaluateGate(gate, evidence, now, today)
                if (evaluation.phase == NativeAttentionGatePhase.SATISFIED) {
                    gates.remove(groupId)
                    cooldowns.remove(groupId)
                    ledger[groupId] = NativeAttentionExchangeLogic.completeGroupCycle(groupId, today, now, ledger[groupId])
                    completed += groupId
                }
            }

            for (cooldown in cooldowns.values.filter { it.endsAt <= now }.toList()) {
                val gate = gates[cooldown.groupId] ?: NativeAttentionExchangeLogic.gateForCooldown(cooldown, today)
                if (gate != null && gates[cooldown.groupId] == null) gates[cooldown.groupId] = gate
                val decisionEvidence = if (gate != null && cooldown.attentionDateKey == today) {
                    evidence ?: DailyReadingEvidenceProviderClient.query(context, today).also { saveDailyReadingEvidence(context, it) }
                } else null
                val decision = NativeAttentionExchangeLogic.decideCooldownExpiry(cooldown, gate, decisionEvidence, now, today)
                when (decision.action) {
                    NativeCooldownExpiryAction.KEEP_ACTIVE_TIMER -> Unit
                    NativeCooldownExpiryAction.REMOVE_TIMER_KEEP_GATE -> {
                        cooldowns.remove(cooldown.groupId)
                        decision.gate?.let { gates[cooldown.groupId] = it }
                    }
                    NativeCooldownExpiryAction.COMPLETE_RESTRICTED_CYCLE -> {
                        cooldowns.remove(cooldown.groupId)
                        gates.remove(cooldown.groupId)
                        if (completed.add(cooldown.groupId)) {
                            ledger[cooldown.groupId] = NativeAttentionExchangeLogic.completeGroupCycle(cooldown.groupId, today, now, ledger[cooldown.groupId])
                        }
                    }
                }
            }

            state = state.copy(
                cooldownsTriggered = maxOf(
                    state.cooldownsTriggered,
                    gates.values.maxOfOrNull { it.dailyCooldownOrdinal } ?: 0,
                    cooldowns.values.filter { it.attentionDateKey == today }.mapNotNull { it.dailyCooldownOrdinal }.maxOrNull() ?: 0,
                ),
                highestRequiredActiveSeconds = maxOf(
                    state.highestRequiredActiveSeconds,
                    gates.values.maxOfOrNull { it.requiredReadingSeconds } ?: 0L,
                    cooldowns.values.filter { it.attentionDateKey == today }.maxOfOrNull { it.requiredReadingSeconds } ?: 0L,
                ),
                highestRequiredQualifiedPages = maxOf(
                    state.highestRequiredQualifiedPages,
                    gates.values.maxOfOrNull { it.requiredQualifiedPages } ?: 0,
                    cooldowns.values.filter { it.attentionDateKey == today }.maxOfOrNull { it.requiredQualifiedPages } ?: 0,
                ),
            )
            val saved = persistAttentionMutation(
                context,
                ledger,
                cooldowns.values.toList(),
                state.takeIf { shouldPersistAttentionState },
                gates,
            )
            instance?.let { service ->
                service.scheduleNearestCooldownExpiry(now)
                service.recheckForeground()
            }
            return saved
        }

        /** One SharedPreferences editor transaction seeds state or preserves the native same-day authority. */
        fun syncAttentionExchangeState(context: Context, snapshot: Map<String, Any?>, now: Long): Boolean {
            val today = getLocalDateKey(now)
            val incomingState = parseAttentionState(snapshot["dailyAttentionExchange"] as? Map<*, *>)
            val incomingGates = parseReadingGates(snapshot["activeReadingGates"] as? List<*>)
            val incomingCooldowns = parseCooldownInput(snapshot["activeCooldowns"] as? List<*>)
            val nativeState = loadStoredAttentionExchangeState(context)
            val nativeGates = loadReadingGates(context)
            val (nextState, reconciledGates) = NativeAttentionExchangeLogic.reconcileIncomingState(
                nativeState = nativeState,
                nativeGates = nativeGates,
                incomingState = incomingState,
                incomingGates = incomingGates,
                today = today,
                now = now,
            )
            val nextGates = reconciledGates.toMutableMap()
            val cooldownsByGroup = loadCooldownPolicies(context).associateBy { it.groupId }.toMutableMap()
            val existingNativeAttention = nativeGates.values.any { it.attentionDateKey == today } ||
                cooldownsByGroup.values.any { it.attentionDateKey == today && it.dailyCooldownOrdinal != null }
            val storeWasEmpty = nativeState == null && !existingNativeAttention
            for (incoming in incomingCooldowns) {
                val existing = cooldownsByGroup[incoming.groupId]
                if (existing == null) {
                    if (incoming.endsAt > now) {
                        cooldownsByGroup[incoming.groupId] = if (storeWasEmpty) incoming else incoming.copy(
                            attentionDateKey = null,
                            dailyCooldownOrdinal = null,
                            requiredReadingSeconds = 0L,
                            requiredQualifiedPages = 0,
                        )
                    }
                } else {
                    val canSeedMetadata = storeWasEmpty &&
                        existing.attentionDateKey == null &&
                        incoming.attentionDateKey == today &&
                        (incoming.dailyCooldownOrdinal ?: 0) > 0
                    cooldownsByGroup[incoming.groupId] = if (canSeedMetadata) {
                        existing.copy(
                            packageNames = existing.packageNames + incoming.packageNames,
                            startedAt = if (existing.startedAt > 0L) existing.startedAt else incoming.startedAt,
                            endsAt = maxOf(existing.endsAt, incoming.endsAt),
                            attentionDateKey = incoming.attentionDateKey,
                            dailyCooldownOrdinal = incoming.dailyCooldownOrdinal,
                            requiredReadingSeconds = incoming.requiredReadingSeconds.coerceAtLeast(0L),
                            requiredQualifiedPages = incoming.requiredQualifiedPages.coerceAtLeast(0),
                        )
                    } else mergeNativeCooldown(existing, incoming)
                }
            }
            if (storeWasEmpty) {
                cooldownsByGroup.values.forEach { cooldown ->
                    NativeAttentionExchangeLogic.gateForCooldown(cooldown, today)?.let { gate ->
                        if (nextGates[gate.groupId] == null) nextGates[gate.groupId] = gate
                    }
                }
            }
            val completedState = nextState.copy(
                cooldownsTriggered = maxOf(
                    nextState.cooldownsTriggered,
                    nextGates.values.maxOfOrNull { it.dailyCooldownOrdinal } ?: 0,
                    cooldownsByGroup.values.filter { it.attentionDateKey == today }.mapNotNull { it.dailyCooldownOrdinal }.maxOrNull() ?: 0,
                ),
                highestRequiredActiveSeconds = maxOf(
                    nextState.highestRequiredActiveSeconds,
                    nextGates.values.maxOfOrNull { it.requiredReadingSeconds } ?: 0L,
                    cooldownsByGroup.values.filter { it.attentionDateKey == today }.maxOfOrNull { it.requiredReadingSeconds } ?: 0L,
                ),
                highestRequiredQualifiedPages = maxOf(
                    nextState.highestRequiredQualifiedPages,
                    nextGates.values.maxOfOrNull { it.requiredQualifiedPages } ?: 0,
                    cooldownsByGroup.values.filter { it.attentionDateKey == today }.maxOfOrNull { it.requiredQualifiedPages } ?: 0,
                ),
            )
            return persistAttentionMutation(context, loadGroupUsageLedger(context), cooldownsByGroup.values.toList(), completedState, nextGates)
        }

        fun mergeCooldownPoliciesFromJs(context: Context, incoming: List<NativeCooldownPolicy>, now: Long): Boolean {
            val prefs = context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE)
            val current = loadCooldownPolicies(context).associateBy { it.groupId }.toMutableMap()
            for (policy in incoming.filter { it.endsAt > now }) {
                val existing = current[policy.groupId]
                if (existing != null) current[policy.groupId] = mergeNativeCooldown(existing, policy)
                else current[policy.groupId] = policy.copy(
                    attentionDateKey = null,
                    dailyCooldownOrdinal = null,
                    requiredReadingSeconds = 0L,
                    requiredQualifiedPages = 0,
                )
            }
            val saved = prefs.edit().putString(RhythmNativePolicyKeys.COOLDOWN_POLICIES_JSON, serializeCooldownPolicies(current.values.toList())).commit()
            instance?.onCooldownPoliciesChanged()
            return saved
        }

        private fun mergeNativeCooldown(native: NativeCooldownPolicy, incoming: NativeCooldownPolicy): NativeCooldownPolicy {
            // A legacy native timer remains debt-free. A stale JS copy cannot replace any richer native metadata.
            val hasNativeAttention = native.attentionDateKey != null && native.dailyCooldownOrdinal != null
            val values = listOf(native, incoming)
            return native.copy(
                packageNames = native.packageNames + incoming.packageNames,
                startedAt = if (native.startedAt > 0L) minOf(native.startedAt, incoming.startedAt.takeIf { it > 0L } ?: native.startedAt) else incoming.startedAt,
                endsAt = values.maxOf { it.endsAt },
                attentionDateKey = if (hasNativeAttention) native.attentionDateKey else null,
                dailyCooldownOrdinal = if (hasNativeAttention) native.dailyCooldownOrdinal else null,
                requiredReadingSeconds = if (hasNativeAttention) native.requiredReadingSeconds else 0L,
                requiredQualifiedPages = if (hasNativeAttention) native.requiredQualifiedPages else 0,
            )
        }

        private fun parseAttentionState(raw: Map<*, *>?): NativeDailyAttentionExchangeState? {
            if (raw == null) return null
            val dateKey = raw["dateKey"] as? String ?: return null
            if (!isValidLocalDateKey(dateKey)) return null
            val ordinal = (raw["cooldownsTriggered"] as? Number)?.toInt()?.coerceAtLeast(0) ?: return null
            return NativeDailyAttentionExchangeState(
                dateKey = dateKey,
                cooldownsTriggered = ordinal,
                highestRequiredActiveSeconds = ((raw["highestRequiredActiveSeconds"] as? Number)?.toLong() ?: 0L).coerceAtLeast(0L),
                highestRequiredQualifiedPages = ((raw["highestRequiredQualifiedPages"] as? Number)?.toInt() ?: 0).coerceAtLeast(0),
                updatedAt = ((raw["updatedAt"] as? Number)?.toLong() ?: 0L).coerceAtLeast(0L),
            )
        }

        private fun parseReadingGates(raw: List<*>?): Map<String, NativeReadingGate> = raw.orEmpty().mapNotNull { value ->
            val item = value as? Map<*, *> ?: return@mapNotNull null
            val groupId = item["groupId"] as? String ?: return@mapNotNull null
            val dateKey = item["attentionDateKey"] as? String ?: return@mapNotNull null
            val ordinal = (item["dailyCooldownOrdinal"] as? Number)?.toInt() ?: return@mapNotNull null
            val seconds = (item["requiredReadingSeconds"] as? Number)?.toLong() ?: return@mapNotNull null
            val pages = (item["requiredQualifiedPages"] as? Number)?.toInt() ?: return@mapNotNull null
            if (groupId.isBlank() || !isValidLocalDateKey(dateKey) || ordinal <= 0 || seconds < 0L || pages < 0) return@mapNotNull null
            NativeReadingGate(
                groupId,
                dateKey,
                ordinal,
                ((item["createdAt"] as? Number)?.toLong() ?: 0L).coerceAtLeast(0L),
                ((item["cooldownEndsAt"] as? Number)?.toLong() ?: 0L).coerceAtLeast(0L),
                seconds,
                pages,
            )
        }.associateBy { it.groupId }

        private fun parseCooldownInput(raw: List<*>?): List<NativeCooldownPolicy> = raw.orEmpty().mapNotNull { value ->
            val item = value as? Map<*, *> ?: return@mapNotNull null
            val groupId = item["groupId"] as? String ?: return@mapNotNull null
            val endsAt = (item["endsAt"] as? Number)?.toLong() ?: return@mapNotNull null
            NativeCooldownPolicy(
                groupId = groupId,
                packageNames = (item["packageNames"] as? List<*>)?.mapNotNull { it as? String }?.toSet() ?: emptySet(),
                startedAt = (item["startedAt"] as? Number)?.toLong() ?: 0L,
                endsAt = endsAt,
                attentionDateKey = item["attentionDateKey"] as? String,
                dailyCooldownOrdinal = (item["dailyCooldownOrdinal"] as? Number)?.toInt(),
                requiredReadingSeconds = (item["requiredReadingSeconds"] as? Number)?.toLong() ?: 0L,
                requiredQualifiedPages = (item["requiredQualifiedPages"] as? Number)?.toInt() ?: 0,
            )
        }

        private fun parseCooldownPolicies(json: String): List<NativeCooldownPolicy> {
            val result = mutableListOf<NativeCooldownPolicy>()
            try {
                val array = JSONArray(json)
                for (index in 0 until array.length()) {
                    val value = array.optJSONObject(index) ?: continue
                    val groupId = value.optString("groupId", "")
                    if (groupId.isBlank()) continue
                    val attentionDate = value.optString("attentionDateKey", "").takeIf { isValidLocalDateKey(it) }
                    val ordinal = value.optInt("dailyCooldownOrdinal", 0).takeIf { it > 0 }
                    val seconds = value.optLong("requiredReadingSeconds", 0L).coerceAtLeast(0L)
                    val pages = value.optInt("requiredQualifiedPages", 0).coerceAtLeast(0)
                    val hasMetadata = attentionDate != null && ordinal != null
                    result += NativeCooldownPolicy(
                        groupId = groupId,
                        packageNames = jsonStrings(value.optJSONArray("packageNames")),
                        startedAt = value.optLong("startedAt", 0L).coerceAtLeast(0L),
                        endsAt = value.optLong("endsAt", 0L).coerceAtLeast(0L),
                        attentionDateKey = attentionDate.takeIf { hasMetadata },
                        dailyCooldownOrdinal = ordinal.takeIf { hasMetadata },
                        requiredReadingSeconds = seconds.takeIf { hasMetadata } ?: 0L,
                        requiredQualifiedPages = pages.takeIf { hasMetadata } ?: 0,
                    )
                }
            } catch (_: Exception) {
                return emptyList()
            }
            return result
        }

        private fun serializeCooldownPolicies(policies: List<NativeCooldownPolicy>): String = JSONArray().apply {
            policies.forEach { cooldown ->
                put(JSONObject().apply {
                    put("groupId", cooldown.groupId)
                    put("packageNames", JSONArray(cooldown.packageNames.toList()))
                    put("startedAt", cooldown.startedAt)
                    put("endsAt", cooldown.endsAt)
                    if (cooldown.attentionDateKey != null && cooldown.dailyCooldownOrdinal != null) {
                        put("attentionDateKey", cooldown.attentionDateKey)
                        put("dailyCooldownOrdinal", cooldown.dailyCooldownOrdinal)
                        put("requiredReadingSeconds", cooldown.requiredReadingSeconds)
                        put("requiredQualifiedPages", cooldown.requiredQualifiedPages)
                    }
                })
            }
        }.toString()

        private fun serializeAttentionState(state: NativeDailyAttentionExchangeState): String = JSONObject().apply {
            put("dateKey", state.dateKey)
            put("cooldownsTriggered", state.cooldownsTriggered)
            put("highestRequiredActiveSeconds", state.highestRequiredActiveSeconds)
            put("highestRequiredQualifiedPages", state.highestRequiredQualifiedPages)
            put("updatedAt", state.updatedAt)
        }.toString()

        private fun readingGateJson(gate: NativeReadingGate) = JSONObject().apply {
            put("attentionDateKey", gate.attentionDateKey)
            put("dailyCooldownOrdinal", gate.dailyCooldownOrdinal)
            put("createdAt", gate.createdAt)
            put("cooldownEndsAt", gate.cooldownEndsAt)
            put("requiredReadingSeconds", gate.requiredReadingSeconds)
            put("requiredQualifiedPages", gate.requiredQualifiedPages)
        }

        private fun serializeReadingGates(gates: Map<String, NativeReadingGate>): String = JSONObject().apply {
            gates.forEach { (groupId, gate) -> put(groupId, readingGateJson(gate)) }
        }.toString()

        private fun evidenceJson(evidence: NativeDailyReadingEvidenceResult) = JSONObject().apply {
            put("providerAvailable", evidence.providerAvailable)
            put("protocolCompatible", evidence.protocolCompatible)
            evidence.protocolVersion?.let { put("protocolVersion", it) }
            put("dateKey", evidence.dateKey)
            put("verifiedActiveSeconds", evidence.verifiedActiveSeconds)
            put("qualifiedPages", evidence.qualifiedPages)
            put("updatedAtEpochMs", evidence.updatedAtEpochMs)
        }

        private fun serializeGroupUsageLedger(ledger: Map<String, NativeGroupAllowanceUsage>): String = JSONArray().apply {
            ledger.values.forEach { usage ->
                put(JSONObject().apply {
                    put("groupId", usage.groupId)
                    put("dateKey", usage.dateKey)
                    put("usedMillis", usage.usedMillis)
                    usage.activePackageName?.let { put("activePackageName", it) }
                    usage.activeSegmentStartedAt?.let { put("activeSegmentStartedAt", it) }
                    usage.exhaustedAt?.let { put("exhaustedAt", it) }
                    put("cycleRevision", usage.cycleRevision)
                })
            }
        }.toString()

        private fun serializeAccountedWatermarks(watermarks: Map<String, Long>): String = JSONObject().apply {
            watermarks.forEach { (groupId, timestamp) -> put(groupId, timestamp) }
        }.toString()

        fun persistUsageAccountingState(
            context: Context,
            ledger: Map<String, NativeGroupAllowanceUsage>,
            watermarks: Map<String, Long>,
        ): Boolean {
            val prefs = context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE)
            return prefs.edit()
                .putString(RhythmNativePolicyKeys.GROUP_USAGE_LEDGER_JSON, serializeGroupUsageLedger(ledger))
                .putString(RhythmNativePolicyKeys.LAST_USAGE_ACCOUNTED_BY_PACKAGE_JSON, serializeAccountedWatermarks(watermarks))
                .commit()
        }

        internal fun attentionMutationPreferenceValues(
            ledger: Map<String, NativeGroupAllowanceUsage>,
            cooldowns: List<NativeCooldownPolicy>,
            state: NativeDailyAttentionExchangeState?,
            gates: Map<String, NativeReadingGate>,
            existingAccountedWatermarks: Map<String, Long>,
            accountedWatermarkUpdates: Map<String, Long> = emptyMap(),
        ): Map<String, String> = mutableMapOf(
            RhythmNativePolicyKeys.GROUP_USAGE_LEDGER_JSON to serializeGroupUsageLedger(ledger),
            RhythmNativePolicyKeys.COOLDOWN_POLICIES_JSON to serializeCooldownPolicies(cooldowns),
            RhythmNativePolicyKeys.READING_GATES_JSON to serializeReadingGates(gates),
        ).apply {
            if (state != null) {
                put(RhythmNativePolicyKeys.ATTENTION_EXCHANGE_STATE_JSON, serializeAttentionState(state))
            }
            if (accountedWatermarkUpdates.isNotEmpty()) {
                val watermarks = NativeGroupUsageAccounting.withWatermarkUpdates(
                    existingAccountedWatermarks,
                    accountedWatermarkUpdates,
                )
                put(RhythmNativePolicyKeys.LAST_USAGE_ACCOUNTED_BY_PACKAGE_JSON, serializeAccountedWatermarks(watermarks))
            }
        }

        private fun persistAttentionMutation(
            context: Context,
            ledger: Map<String, NativeGroupAllowanceUsage>,
            cooldowns: List<NativeCooldownPolicy>,
            state: NativeDailyAttentionExchangeState?,
            gates: Map<String, NativeReadingGate>,
            accountedWatermarkUpdates: Map<String, Long> = emptyMap(),
        ): Boolean {
            val prefs = context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE)
            val preferenceValues = attentionMutationPreferenceValues(
                ledger = ledger,
                cooldowns = cooldowns,
                state = state,
                gates = gates,
                existingAccountedWatermarks = if (accountedWatermarkUpdates.isEmpty()) {
                    emptyMap()
                } else {
                    loadAccountedWatermarks(context)
                },
                accountedWatermarkUpdates = accountedWatermarkUpdates,
            )
            val editor = prefs.edit()
            preferenceValues.forEach { (key, value) -> editor.putString(key, value) }
            return editor.commit()
        }

        fun hasGroupAttentionHold(context: Context, groupId: String, now: Long = System.currentTimeMillis()): Boolean =
            loadCooldownPolicies(context).any { it.groupId == groupId && it.endsAt > now } ||
                loadReadingGates(context)[groupId]?.attentionDateKey == getLocalDateKey(now)

        fun isRestrictedByCooldown(context: Context, packageName: String, now: Long = System.currentTimeMillis()) = loadCooldownPolicies(context).any { packageName in it.packageNames && it.endsAt > now }
        fun isProtectedByRoutine(context: Context, packageName: String, now: Long = System.currentTimeMillis()): Boolean {
            val schedule = loadRoutineSchedule(context)
            val windows = schedule.windows.filter { it.enabled }
            if (windows.isEmpty()) return false

            val calendar = Calendar.getInstance().apply { timeInMillis = now }
            val day = if (calendar.get(Calendar.DAY_OF_WEEK) == Calendar.SUNDAY) 7 else calendar.get(Calendar.DAY_OF_WEEK) - 1
            val tomorrow = if (day == 7) 1 else day + 1
            val yesterday = if (day == 1) 7 else day - 1
            val minutes = calendar.get(Calendar.HOUR_OF_DAY) * 60 + calendar.get(Calendar.MINUTE)
            val morning = windows.firstOrNull { w -> w.type == "morning-buffer" }
            val evening = windows.firstOrNull { it.type == "evening-wind-down" }

            if (morning != null && day in morning.activeDays && packageName in morning.protectedPackages) {
                if (minutes in parseTime(morning.startTime) until parseTime(morning.endTime)) return true
            }
            if (evening != null && packageName in evening.protectedPackages) {
                val start = parseTime(evening.startTime)
                val end = parseTime(evening.endTime)
                if (start < end && day in evening.activeDays && minutes in start until end) return true
                if (start >= end && ((yesterday in evening.activeDays && minutes < end) || (day in evening.activeDays && minutes >= start))) return true
            }

            if (packageName in schedule.allRiskPackages && morning != null && evening != null) {
                val eveningStart = parseTime(evening.startTime)
                val eveningEnd = parseTime(evening.endTime)
                if (minutes >= 720 && day in evening.activeDays && tomorrow in morning.activeDays) {
                    if (eveningStart < eveningEnd && minutes >= eveningEnd) return true
                } else if (minutes < 720 && yesterday in evening.activeDays && day in morning.activeDays) {
                    val pastEvening = eveningStart < eveningEnd || minutes >= eveningEnd
                    if (minutes < parseTime(morning.startTime) && pastEvening) return true
                }
            }
            return false
        }
        fun isEffectivelyRestricted(context: Context, packageName: String, now: Long = System.currentTimeMillis()): Boolean {
            val base = context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE).getStringSet(RhythmNativePolicyKeys.BASE_RESTRICTED_PACKAGES, emptySet())?.contains(packageName) == true
            val policy = loadRiskGroupPolicies(context).firstOrNull { packageName in it.packageNames }
            val gatePresent = policy?.let { loadReadingGates(context)[it.groupId]?.attentionDateKey == getLocalDateKey(now) } == true
            return NativeAttentionExchangeLogic.isEffectivelyRestricted(
                baseOrRoutineRestricted = base || isProtectedByRoutine(context, packageName, now),
                cooldownActive = isRestrictedByCooldown(context, packageName, now),
                gatePresent = gatePresent,
                accessLeaseActive = hasActiveAccessLease(context, packageName, now),
            )
        }
        fun loadAccountedWatermarks(context: Context): Map<String, Long> { val json = context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE).getString(RhythmNativePolicyKeys.LAST_USAGE_ACCOUNTED_BY_PACKAGE_JSON, null) ?: return emptyMap(); val out = mutableMapOf<String, Long>(); try { val o = JSONObject(json); o.keys().forEach { out[it] = o.optLong(it) } } catch (_: Exception) {}; return out }
        fun saveAccountedWatermarks(context: Context, values: Map<String, Long>) { context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE).edit().putString(RhythmNativePolicyKeys.LAST_USAGE_ACCOUNTED_BY_PACKAGE_JSON, serializeAccountedWatermarks(values)).apply() }
        fun loadRoutineSchedule(context: Context): NativeRoutineSchedule {
            val json = context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE).getString(RhythmNativePolicyKeys.ROUTINE_SCHEDULE_JSON, null) ?: return NativeRoutineSchedule(emptyList(), emptySet())
            return parseRoutineJson(json)
        }
        fun parseRoutineScheduleInput(input: Any): NativeRoutineSchedule {
            val root = input as? Map<*, *> ?: return NativeRoutineSchedule(emptyList(), emptySet())
            val risk = (root["allRiskPackages"] as? List<*>)?.mapNotNull { it as? String }?.toSet() ?: emptySet()
            val windows = (root["windows"] as? List<*>)?.mapNotNull { raw ->
                val item = raw as? Map<*, *> ?: return@mapNotNull null
                val type = item["type"] as? String ?: return@mapNotNull null
                if (type != "morning-buffer" && type != "evening-wind-down") return@mapNotNull null
                NativeRoutineWindow(item["id"] as? String ?: return@mapNotNull null, type, item["startTime"] as? String ?: "00:00", item["endTime"] as? String ?: "00:00", (item["activeDays"] as? List<*>)?.mapNotNull { it as? Number }?.map { it.toInt() }?.toSet() ?: emptySet(), (item["protectedPackages"] as? List<*>)?.mapNotNull { it as? String }?.toSet() ?: emptySet(), item["enabled"] as? Boolean ?: true)
            } ?: emptyList()
            return NativeRoutineSchedule(windows, risk)
        }
        fun saveRoutineSchedule(context: Context, schedule: NativeRoutineSchedule) {
            val root = JSONObject(); root.put("windows", JSONArray().apply { schedule.windows.forEach { w -> put(JSONObject().apply { put("id", w.id); put("type", w.type); put("startTime", w.startTime); put("endTime", w.endTime); put("activeDays", JSONArray(w.activeDays.toList())); put("protectedPackages", JSONArray(w.protectedPackages.toList())); put("enabled", w.enabled) }) } }); root.put("allRiskPackages", JSONArray(schedule.allRiskPackages.toList()))
            context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE).edit().putString(RhythmNativePolicyKeys.ROUTINE_SCHEDULE_JSON, root.toString()).apply()
        }
        private fun parseRoutineJson(json: String): NativeRoutineSchedule {
            val root = try { JSONObject(json) } catch (_: Exception) { return NativeRoutineSchedule(emptyList(), emptySet()) }
            val risk = jsonStrings(root.optJSONArray("allRiskPackages")); val windows = mutableListOf<NativeRoutineWindow>(); val array = root.optJSONArray("windows")
            if (array != null) for (i in 0 until array.length()) { val o = array.optJSONObject(i) ?: continue; val days = mutableSetOf<Int>(); val dayArray = o.optJSONArray("activeDays"); if (dayArray != null) for (j in 0 until dayArray.length()) days += dayArray.optInt(j); windows += NativeRoutineWindow(o.optString("id"), o.optString("type", "custom"), o.optString("startTime", "00:00"), o.optString("endTime", "00:00"), days, jsonStrings(o.optJSONArray("protectedPackages")), o.optBoolean("enabled", true)) }
            return NativeRoutineSchedule(windows, risk)
        }
        fun resolveCurrentForegroundPackage(context: Context, now: Long = System.currentTimeMillis()): String? { val m = context.getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager ?: return null; if (getLocalMidnight(now) >= now) return null; val e = m.queryEvents(getLocalMidnight(now), now); val x = UsageEvents.Event(); var current: String? = null; while (e.hasNextEvent()) { e.getNextEvent(x); val fg = x.eventType == UsageEvents.Event.ACTIVITY_RESUMED || x.eventType == UsageEvents.Event.MOVE_TO_FOREGROUND; val bg = x.eventType == UsageEvents.Event.ACTIVITY_PAUSED || x.eventType == UsageEvents.Event.ACTIVITY_STOPPED || x.eventType == UsageEvents.Event.MOVE_TO_BACKGROUND; if (fg) current = x.packageName else if (bg && current == x.packageName) current = null }; return current?.takeUnless { it == context.packageName || it.startsWith("com.android.systemui") } }
        private fun jsonStrings(a: JSONArray?): Set<String> = buildSet { if (a != null) for (i in 0 until a.length()) add(a.optString(i)) }
        private fun parseTime(value: String): Int = value.split(":").let { (it.getOrNull(0)?.toIntOrNull() ?: 0) * 60 + (it.getOrNull(1)?.toIntOrNull() ?: 0) }
    }

    private fun queryAndStoreDailyEvidence(dateKey: String): NativeDailyReadingEvidenceResult {
        val evidence = queryDailyReadingEvidence(applicationContext, dateKey)
        saveDailyReadingEvidence(applicationContext, evidence)
        return evidence
    }

    private fun loadCooldownForPackage(packageName: String, now: Long) = loadCooldownPolicies(applicationContext).firstOrNull { packageName in it.packageNames && it.endsAt > now }
    fun pruneExpiredCooldowns(now: Long) {
        rolloverIfNeeded(now)
        reconcileExpiredCooldowns(now)
    }
}
