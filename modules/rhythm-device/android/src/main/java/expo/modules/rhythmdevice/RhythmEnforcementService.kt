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
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

data class NativeAccessLease(
    val groupId: String,
    val packageNames: Set<String>,
    val endsAt: Long
)

data class NativeCooldownPolicy(
    val groupId: String,
    val packageNames: Set<String>,
    val endsAt: Long
)

data class NativeDailyAllowancePolicy(
    val packageName: String,
    val allowanceMinutes: Int
)

data class NativeDailyUsage(
    val packageName: String,
    val dateKey: String,
    val usedMillis: Long,
    val activeSegmentStartedAt: Long?,
    val exhaustedAt: Long?
)

data class NativeDailyAppSnapshot(
    val packageName: String,
    val usedSeconds: Int,
    val allowanceMinutes: Int,
    val remainingSeconds: Int,
    val exhausted: Boolean,
    val activeSegmentStartedAt: Long?
)

data class NativeDailyUsageSnapshot(
    val dateKey: String,
    val apps: List<NativeDailyAppSnapshot>,
    val lastReconciledAt: Long?
)

data class NativeRoutineWindow(
    val id: String,
    val type: String, // "morning-buffer" or "evening-wind-down"
    val startTime: String,
    val endTime: String,
    val activeDays: Set<Int>,
    val protectedPackages: Set<String>,
    val enabled: Boolean
)

data class NativeRoutineSchedule(
    val windows: List<NativeRoutineWindow>,
    val allRiskPackages: Set<String>
)

private data class UsageTransition(
    val packageName: String,
    val timestamp: Long,
    val isForeground: Boolean
)

class RhythmEnforcementService : AccessibilityService() {

    private val mainHandler = Handler(Looper.getMainLooper())
    private val leaseCallbacks = mutableMapOf<String, Runnable>()
    private var allowanceDeadlineRunnable: Runnable? = null
    private var midnightRolloverRunnable: Runnable? = null
    private var routineBoundaryRunnable: Runnable? = null
    private var cooldownExpiryRunnable: Runnable? = null

    var lastForegroundPackage: String? = null
        private set

    var lastInterventionPackage: String? = null
        private set

    var lastInterventionAt: Long = 0L
        private set

    var activeUsagePackage: String? = null
        private set

    var activeUsageStartedAt: Long? = null
        private set

    var allowanceDeadlineAt: Long? = null
        private set

    var nextRoutineBoundaryAt: Long? = null
        private set

    var nearestCooldownExpiryAt: Long? = null
        private set

    var lastUsageReconciledAt: Long = 0L
        private set

    override fun onServiceConnected() {
        super.onServiceConnected()
        isRunning = true
        instance = this
        Log.i(TAG, "RhythmEnforcementService connected")

        val prefs = applicationContext.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE)
        lastUsageReconciledAt = prefs.getLong(RhythmNativePolicyKeys.LAST_USAGE_RECONCILED_AT, 0L)

        val activeLeases = loadActiveLeases(applicationContext, System.currentTimeMillis())
        for (lease in activeLeases) {
            scheduleLeaseExpiry(lease)
        }

        // 1. Bounded UsageStats reconciliation on service connect
        reconcileUsage()

        // 2. Schedule nearest cooldown expiry callback
        scheduleNearestCooldownExpiry()

        // 3. Schedule next routine boundary callback
        scheduleNextRoutineBoundary()

        // 4. Authoritative current foreground recovery across local day
        restoreForegroundStateAfterReconnect()
    }

    override fun onDestroy() {
        Log.i(TAG, "RhythmEnforcementService destroying")
        for (callback in leaseCallbacks.values) {
            mainHandler.removeCallbacks(callback)
        }
        leaseCallbacks.clear()

        cancelAllowanceDeadline()
        cancelMidnightRollover()
        cancelRoutineBoundary()
        cancelCooldownExpiry()

        val activePkg = activeUsagePackage
        if (activePkg != null) {
            finalizeActiveSegment(activePkg, System.currentTimeMillis())
        }

        isRunning = false
        instance = null
        super.onDestroy()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null || event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            return
        }

        val packageName = event.packageName?.toString() ?: return
        val now = System.currentTimeMillis()

        // Explicitly finalize Risk accounting when Rhythm's own activity/overlay or system UI becomes foreground
        if (packageName == applicationContext.packageName || packageName.startsWith("com.android.systemui")) {
            val prev = lastForegroundPackage
            lastForegroundPackage = packageName
            if (prev != null && activeUsagePackage == prev) {
                finalizeActiveSegment(prev, now)
            }
            cancelAllowanceDeadline()
            cancelMidnightRollover()
            return
        }

        // Duplicate foreground protection: preserve segment start if same package re-emits
        if (packageName == lastForegroundPackage) {
            return
        }

        val previousPackage = lastForegroundPackage
        lastForegroundPackage = packageName

        // 1. Finalize previous Risk app segment if active
        if (previousPackage != null && activeUsagePackage == previousPackage) {
            finalizeActiveSegment(previousPackage, now)
        }

        // 2. Cancel previous allowance deadline and midnight callbacks
        cancelAllowanceDeadline()
        cancelMidnightRollover()

        // 3. Prune expired leases
        pruneExpiredLeases(applicationContext, now)

        // 4. Evaluate explicit restriction sources for new package
        val restricted = isEffectivelyRestricted(applicationContext, packageName, now)
        val policies = loadDailyAllowancePolicies(applicationContext)
        val policy = policies.find { it.packageName == packageName }

        if (restricted) {
            presentIntervention(packageName)
            // NEVER count Touch Grass time as Risk-app usage! Do not start usage segment.
        } else if (policy != null) {
            startRiskUsageSegment(packageName, policy, now)
        }
    }

    fun startRiskUsageSegment(packageName: String, policy: NativeDailyAllowancePolicy, now: Long) {
        val todayKey = getLocalDateKey(now)
        val ledger = loadDailyUsageLedger(applicationContext).toMutableMap()
        val existing = ledger[packageName]

        val currentUsed = if (existing != null && existing.dateKey == todayKey) existing.usedMillis else 0L
        val isAlreadyExhausted = existing != null && existing.dateKey == todayKey && existing.exhaustedAt != null

        activeUsagePackage = packageName
        activeUsageStartedAt = now

        ledger[packageName] = NativeDailyUsage(
            packageName = packageName,
            dateKey = todayKey,
            usedMillis = currentUsed,
            activeSegmentStartedAt = now,
            exhaustedAt = if (isAlreadyExhausted) existing?.exhaustedAt else null
        )
        saveDailyUsageLedger(applicationContext, ledger)

        val allowanceMillis = policy.allowanceMinutes * 60_000L
        val remainingMs = allowanceMillis - currentUsed

        if (remainingMs <= 0L || policy.allowanceMinutes == 0 || isAlreadyExhausted) {
            val isLeaseActive = hasActiveAccessLease(applicationContext, packageName, now)
            val exhaustedTimestamp = existing?.exhaustedAt ?: now

            if (!isLeaseActive) {
                ledger[packageName] = ledger[packageName]!!.copy(
                    usedMillis = maxOf(allowanceMillis, currentUsed),
                    activeSegmentStartedAt = null,
                    exhaustedAt = exhaustedTimestamp
                )
                saveDailyUsageLedger(applicationContext, ledger)

                activeUsagePackage = null
                activeUsageStartedAt = null
                advancePackageWatermark(applicationContext, packageName, now)

                presentIntervention(packageName)
            } else {
                ledger[packageName] = ledger[packageName]!!.copy(
                    usedMillis = currentUsed,
                    activeSegmentStartedAt = now,
                    exhaustedAt = exhaustedTimestamp
                )
                saveDailyUsageLedger(applicationContext, ledger)
                scheduleMidnightRollover(packageName, now)
            }
        } else {
            scheduleAllowanceDeadline(packageName, remainingMs, now + remainingMs)
            scheduleMidnightRollover(packageName, now)
        }
    }

    fun finalizeActiveSegment(packageName: String, now: Long) {
        val ledger = loadDailyUsageLedger(applicationContext).toMutableMap()
        val todayKey = getLocalDateKey(now)
        val existing = ledger[packageName]
        val startedAt = activeUsageStartedAt ?: existing?.activeSegmentStartedAt

        if (startedAt != null) {
            val todayStart = getLocalMidnight(now)
            val effectiveStart = maxOf(todayStart, startedAt)
            val elapsed = maxOf(0L, now - effectiveStart)
            val prevUsed = if (existing != null && existing.dateKey == todayKey) existing.usedMillis else 0L
            val newUsed = prevUsed + elapsed

            ledger[packageName] = NativeDailyUsage(
                packageName = packageName,
                dateKey = todayKey,
                usedMillis = newUsed,
                activeSegmentStartedAt = null,
                exhaustedAt = existing?.exhaustedAt
            )
            saveDailyUsageLedger(applicationContext, ledger)
            advancePackageWatermark(applicationContext, packageName, now)
        }

        if (activeUsagePackage == packageName) {
            activeUsagePackage = null
            activeUsageStartedAt = null
        }
    }

    fun scheduleAllowanceDeadline(packageName: String, remainingMs: Long, deadlineTimestamp: Long) {
        cancelAllowanceDeadline()

        allowanceDeadlineAt = deadlineTimestamp
        val callback = Runnable {
            onAllowanceDeadlineFired(packageName, deadlineTimestamp)
        }
        allowanceDeadlineRunnable = callback
        mainHandler.postDelayed(callback, maxOf(0L, remainingMs))
    }

    fun cancelAllowanceDeadline() {
        allowanceDeadlineRunnable?.let {
            mainHandler.removeCallbacks(it)
            allowanceDeadlineRunnable = null
        }
        allowanceDeadlineAt = null
    }

    private fun onAllowanceDeadlineFired(packageName: String, scheduledDeadline: Long) {
        if (lastForegroundPackage != packageName || activeUsagePackage != packageName) {
            return
        }

        val now = System.currentTimeMillis()
        val todayKey = getLocalDateKey(now)

        val ledger = loadDailyUsageLedger(applicationContext).toMutableMap()
        val currentUsage = ledger[packageName]
        if (currentUsage == null || currentUsage.dateKey != todayKey) {
            return
        }

        val policies = loadDailyAllowancePolicies(applicationContext)
        val policy = policies.find { it.packageName == packageName } ?: return

        val startedAt = activeUsageStartedAt ?: currentUsage.activeSegmentStartedAt ?: now
        val elapsed = maxOf(0L, now - startedAt)
        val totalUsed = currentUsage.usedMillis + elapsed
        val allowanceMillis = policy.allowanceMinutes * 60_000L

        if (totalUsed >= allowanceMillis || policy.allowanceMinutes == 0) {
            val isLeaseActive = hasActiveAccessLease(applicationContext, packageName, now)

            if (!isLeaseActive) {
                val updatedUsage = currentUsage.copy(
                    usedMillis = maxOf(allowanceMillis, totalUsed),
                    activeSegmentStartedAt = null,
                    exhaustedAt = now
                )
                ledger[packageName] = updatedUsage
                saveDailyUsageLedger(applicationContext, ledger)

                activeUsagePackage = null
                activeUsageStartedAt = null
                advancePackageWatermark(applicationContext, packageName, now)

                Log.i(TAG, "Daily allowance exhausted for $packageName (used=$totalUsed ms, allowance=$allowanceMillis ms)")
                presentIntervention(packageName)
            } else {
                val updatedUsage = currentUsage.copy(
                    usedMillis = totalUsed,
                    activeSegmentStartedAt = now,
                    exhaustedAt = currentUsage.exhaustedAt ?: now
                )
                ledger[packageName] = updatedUsage
                saveDailyUsageLedger(applicationContext, ledger)
                activeUsageStartedAt = now
                advancePackageWatermark(applicationContext, packageName, now)

                Log.i(TAG, "Daily allowance reached during active lease for $packageName; continuing usage accounting until lease expiry")
            }
        }
    }

    fun scheduleMidnightRollover(packageName: String, now: Long) {
        cancelMidnightRollover()
        val nextMidnight = getNextLocalMidnight(now)
        val delay = maxOf(0L, nextMidnight - now)
        val runnable = Runnable {
            onMidnightRolloverFired(packageName, nextMidnight)
        }
        midnightRolloverRunnable = runnable
        mainHandler.postDelayed(runnable, delay)
    }

    fun cancelMidnightRollover() {
        midnightRolloverRunnable?.let {
            mainHandler.removeCallbacks(it)
            midnightRolloverRunnable = null
        }
    }

    fun onMidnightRolloverFired(packageName: String, midnightTime: Long) {
        if (lastForegroundPackage != packageName || activeUsagePackage != packageName) {
            return
        }

        val policies = loadDailyAllowancePolicies(applicationContext)
        val policy = policies.find { it.packageName == packageName } ?: return

        val prevDayKey = getLocalDateKey(midnightTime - 1000L)
        val newDayKey = getLocalDateKey(midnightTime)
        val ledger = loadDailyUsageLedger(applicationContext).toMutableMap()
        val existing = ledger[packageName]

        val startedAt = activeUsageStartedAt ?: existing?.activeSegmentStartedAt
        if (startedAt != null && startedAt < midnightTime) {
            val elapsedDay1 = maxOf(0L, midnightTime - startedAt)
            val prevUsed = if (existing != null && existing.dateKey == prevDayKey) existing.usedMillis else 0L
            ledger[packageName] = NativeDailyUsage(
                packageName = packageName,
                dateKey = prevDayKey,
                usedMillis = prevUsed + elapsedDay1,
                activeSegmentStartedAt = null,
                exhaustedAt = existing?.exhaustedAt
            )
        }

        ledger[packageName] = NativeDailyUsage(
            packageName = packageName,
            dateKey = newDayKey,
            usedMillis = 0L,
            activeSegmentStartedAt = midnightTime,
            exhaustedAt = null
        )
        saveDailyUsageLedger(applicationContext, ledger)

        activeUsageStartedAt = midnightTime
        advancePackageWatermark(applicationContext, packageName, midnightTime)

        if (policy.allowanceMinutes == 0) {
            ledger[packageName] = ledger[packageName]!!.copy(exhaustedAt = midnightTime)
            saveDailyUsageLedger(applicationContext, ledger)
            if (isEffectivelyRestricted(applicationContext, packageName, midnightTime)) {
                presentIntervention(packageName)
            }
        } else {
            scheduleAllowanceDeadline(packageName, policy.allowanceMinutes * 60_000L, midnightTime + policy.allowanceMinutes * 60_000L)
        }

        scheduleMidnightRollover(packageName, midnightTime + 1000L)
    }

    fun scheduleNextRoutineBoundary(now: Long = System.currentTimeMillis()) {
        cancelRoutineBoundary()
        val schedule = loadRoutineSchedule(applicationContext)
        val windows = schedule.windows.filter { it.enabled }
        if (windows.isEmpty()) return

        val cal = Calendar.getInstance()
        cal.timeInMillis = now
        val currentMins = cal.get(Calendar.HOUR_OF_DAY) * 60 + cal.get(Calendar.MINUTE)

        val targetMinutes = mutableSetOf<Int>()
        targetMinutes.add(1440) // Midnight

        for (w in windows) {
            val s = parseTimeToMinutes(w.startTime)
            val e = parseTimeToMinutes(w.endTime)
            if (s > currentMins) targetMinutes.add(s)
            if (e > currentMins) targetMinutes.add(e)
        }

        val nextMins = targetMinutes.filter { it > currentMins }.minOrNull() ?: 1440
        val boundaryTime: Long
        if (nextMins >= 1440) {
            boundaryTime = getNextLocalMidnight(now)
        } else {
            val targetCal = Calendar.getInstance()
            targetCal.timeInMillis = now
            targetCal.set(Calendar.HOUR_OF_DAY, nextMins / 60)
            targetCal.set(Calendar.MINUTE, nextMins % 60)
            targetCal.set(Calendar.SECOND, 0)
            targetCal.set(Calendar.MILLISECOND, 0)
            boundaryTime = targetCal.timeInMillis
        }

        val delay = maxOf(0L, boundaryTime - now)
        nextRoutineBoundaryAt = boundaryTime
        val runnable = Runnable {
            onRoutineBoundaryFired()
        }
        routineBoundaryRunnable = runnable
        mainHandler.postDelayed(runnable, delay)
    }

    fun cancelRoutineBoundary() {
        routineBoundaryRunnable?.let {
            mainHandler.removeCallbacks(it)
            routineBoundaryRunnable = null
        }
        nextRoutineBoundaryAt = null
    }

    fun onRoutineBoundaryFired() {
        val now = System.currentTimeMillis()
        val foreground = resolveCurrentForegroundPackage(applicationContext, now = now)
        if (foreground != null) {
            lastForegroundPackage = foreground
            if (isEffectivelyRestricted(applicationContext, foreground, now)) {
                presentIntervention(foreground)
            }
        }
        scheduleNextRoutineBoundary(now + 1000L)
    }

    fun scheduleNearestCooldownExpiry(now: Long = System.currentTimeMillis()) {
        cancelCooldownExpiry()
        val cooldowns = loadCooldownPolicies(applicationContext)
        val active = cooldowns.filter { it.endsAt > now }
        if (active.isEmpty()) {
            nearestCooldownExpiryAt = null
            return
        }

        val nearest = active.minOf { it.endsAt }
        nearestCooldownExpiryAt = nearest
        val delay = maxOf(0L, nearest - now)
        val runnable = Runnable {
            onCooldownExpiryFired(nearest)
        }
        cooldownExpiryRunnable = runnable
        mainHandler.postDelayed(runnable, delay)
    }

    fun cancelCooldownExpiry() {
        cooldownExpiryRunnable?.let {
            mainHandler.removeCallbacks(it)
            cooldownExpiryRunnable = null
        }
        nearestCooldownExpiryAt = null
    }

    fun onCooldownExpiryFired(scheduledExpiry: Long) {
        val now = System.currentTimeMillis()
        val foreground = resolveCurrentForegroundPackage(applicationContext, now = now)
        if (foreground != null) {
            lastForegroundPackage = foreground
            if (isEffectivelyRestricted(applicationContext, foreground, now)) {
                presentIntervention(foreground)
            }
        }
        scheduleNearestCooldownExpiry(now)
    }

    fun presentIntervention(packageName: String) {
        if (RhythmOverlayActivity.isVisible) {
            Log.d(TAG, "Intervention skipped: overlay is already visible")
            return
        }

        val now = System.currentTimeMillis()
        if (packageName == lastInterventionPackage && (now - lastInterventionAt) < DEBOUNCE_MS) {
            Log.d(TAG, "Intervention debounced for package: $packageName")
            return
        }

        lastInterventionPackage = packageName
        lastInterventionAt = now

        try {
            val intent = Intent(this, RhythmOverlayActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra(RhythmNativePolicyKeys.EXTRA_PACKAGE_NAME, packageName)
            }
            startActivity(intent)
            Log.i(TAG, "Intervention presented for package: $packageName")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to launch RhythmOverlayActivity for $packageName", e)
        }
    }

    fun onBaseRestrictionsChanged() {
        val now = System.currentTimeMillis()
        val packageName = lastForegroundPackage ?: resolveRecentForegroundPackage() ?: return
        Log.d(TAG, "onBaseRestrictionsChanged: rechecking package=$packageName")
        if (isEffectivelyRestricted(applicationContext, packageName, now)) {
            presentIntervention(packageName)
        }
    }

    fun resolveRecentForegroundPackage(): String? {
        return resolveCurrentForegroundPackage(applicationContext)
    }

    fun onCooldownPoliciesChanged() {
        val now = System.currentTimeMillis()
        scheduleNearestCooldownExpiry(now)
        val foreground = resolveCurrentForegroundPackage(applicationContext, now = now)
        if (foreground != null) {
            lastForegroundPackage = foreground
            if (isEffectivelyRestricted(applicationContext, foreground, now)) {
                presentIntervention(foreground)
            }
        }
    }

    fun onRoutineScheduleChanged() {
        val now = System.currentTimeMillis()
        scheduleNextRoutineBoundary(now)
        val foreground = resolveCurrentForegroundPackage(applicationContext, now = now)
        if (foreground != null) {
            lastForegroundPackage = foreground
            if (isEffectivelyRestricted(applicationContext, foreground, now)) {
                presentIntervention(foreground)
            }
        }
    }

    fun onDailyAllowancePoliciesChanged() {
        val now = System.currentTimeMillis()
        val todayKey = getLocalDateKey(now)
        val policies = loadDailyAllowancePolicies(applicationContext)
        val ledger = loadDailyUsageLedger(applicationContext).toMutableMap()
        var ledgerMutated = false

        for (policy in policies) {
            val usage = ledger[policy.packageName]
            if (usage != null && usage.dateKey == todayKey && usage.exhaustedAt != null) {
                val activeStart = if (activeUsagePackage == policy.packageName) (activeUsageStartedAt ?: usage.activeSegmentStartedAt) else usage.activeSegmentStartedAt
                val elapsed = if (activeUsagePackage == policy.packageName && activeStart != null) maxOf(0L, now - activeStart) else 0L
                val totalUsed = usage.usedMillis + elapsed
                val allowanceMillis = policy.allowanceMinutes * 60_000L

                if (totalUsed < allowanceMillis && policy.allowanceMinutes > 0) {
                    ledger[policy.packageName] = usage.copy(
                        usedMillis = totalUsed,
                        activeSegmentStartedAt = if (activeUsagePackage == policy.packageName) now else null,
                        exhaustedAt = null
                    )
                    if (activeUsagePackage == policy.packageName) {
                        activeUsageStartedAt = now
                    }
                    ledgerMutated = true
                    Log.i(TAG, "Cleared stale exhaustion for ${policy.packageName} after allowance increase (used=$totalUsed ms, allowance=$allowanceMillis ms)")
                }
            }
        }
        if (ledgerMutated) {
            saveDailyUsageLedger(applicationContext, ledger)
        }

        val foreground = resolveCurrentForegroundPackage(applicationContext, now = now)
        if (foreground != null) {
            lastForegroundPackage = foreground
            val policy = policies.find { it.packageName == foreground }

            if (policy == null) {
                if (activeUsagePackage == foreground) {
                    finalizeActiveSegment(foreground, now)
                }
                cancelAllowanceDeadline()
                cancelMidnightRollover()
            } else {
                val usage = ledger[foreground]
                val prevUsed = if (usage != null && usage.dateKey == todayKey) usage.usedMillis else 0L
                val activeStart = activeUsageStartedAt ?: now
                val elapsed = if (activeUsagePackage == foreground) maxOf(0L, now - activeStart) else 0L
                val totalUsed = prevUsed + elapsed
                val allowanceMillis = policy.allowanceMinutes * 60_000L
                val remainingMs = allowanceMillis - totalUsed

                if (remainingMs <= 0L || policy.allowanceMinutes == 0) {
                    cancelAllowanceDeadline()
                    val isLeaseActive = hasActiveAccessLease(applicationContext, foreground, now)
                    val updatedLedger = ledger.toMutableMap()

                    if (!isLeaseActive) {
                        updatedLedger[foreground] = NativeDailyUsage(
                            packageName = foreground,
                            dateKey = todayKey,
                            usedMillis = maxOf(allowanceMillis, totalUsed),
                            activeSegmentStartedAt = null,
                            exhaustedAt = usage?.exhaustedAt ?: now
                        )
                        saveDailyUsageLedger(applicationContext, updatedLedger)
                        activeUsagePackage = null
                        activeUsageStartedAt = null
                        advancePackageWatermark(applicationContext, foreground, now)

                        if (isEffectivelyRestricted(applicationContext, foreground, now)) {
                            presentIntervention(foreground)
                        }
                    } else {
                        updatedLedger[foreground] = NativeDailyUsage(
                            packageName = foreground,
                            dateKey = todayKey,
                            usedMillis = totalUsed,
                            activeSegmentStartedAt = now,
                            exhaustedAt = usage?.exhaustedAt ?: now
                        )
                        saveDailyUsageLedger(applicationContext, updatedLedger)
                        activeUsageStartedAt = now
                        advancePackageWatermark(applicationContext, foreground, now)
                    }
                } else {
                    if (activeUsagePackage == foreground) {
                        scheduleAllowanceDeadline(foreground, remainingMs, now + remainingMs)
                        scheduleMidnightRollover(foreground, now)
                    }
                }
            }
        }
    }

    fun reconcileUsage(fromTime: Long? = null, toTime: Long = System.currentTimeMillis()) {
        try {
            val manager = getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager ?: return
            val prefs = applicationContext.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE)
            val lastReconciled = prefs.getLong(RhythmNativePolicyKeys.LAST_USAGE_RECONCILED_AT, 0L)
            val todayStart = getLocalMidnight(toTime)

            val from = fromTime ?: maxOf(lastReconciled - 60_000L, todayStart)
            if (from >= toTime) return

            val events = manager.queryEvents(from, toTime)
            val policies = loadDailyAllowancePolicies(applicationContext)
            val riskPackages = policies.map { it.packageName }.toSet()
            if (riskPackages.isEmpty()) {
                prefs.edit().putLong(RhythmNativePolicyKeys.LAST_USAGE_RECONCILED_AT, toTime).apply()
                lastUsageReconciledAt = toTime
                return
            }

            val event = UsageEvents.Event()
            val riskTransitions = mutableListOf<UsageTransition>()

            while (events.hasNextEvent()) {
                events.getNextEvent(event)
                val pkg = event.packageName ?: continue
                if (!riskPackages.contains(pkg)) continue

                val isFg = event.eventType == UsageEvents.Event.ACTIVITY_RESUMED ||
                    event.eventType == UsageEvents.Event.MOVE_TO_FOREGROUND
                val isBg = event.eventType == UsageEvents.Event.ACTIVITY_PAUSED ||
                    event.eventType == UsageEvents.Event.ACTIVITY_STOPPED ||
                    event.eventType == UsageEvents.Event.MOVE_TO_BACKGROUND

                if (isFg) {
                    riskTransitions.add(UsageTransition(pkg, event.timeStamp, true))
                } else if (isBg) {
                    riskTransitions.add(UsageTransition(pkg, event.timeStamp, false))
                }
            }

            riskTransitions.sortBy { it.timestamp }

            val todayKey = getLocalDateKey(toTime)
            val ledger = loadDailyUsageLedger(applicationContext).toMutableMap()
            val watermarks = loadAccountedWatermarks(applicationContext).toMutableMap()
            var mutated = false

            for (pkg in riskPackages) {
                val pkgEvents = riskTransitions.filter { it.packageName == pkg }
                val pkgWatermark = watermarks[pkg] ?: 0L

                var segStart: Long? = null
                var deltaUsed = 0L

                for (ev in pkgEvents) {
                    if (ev.isForeground) {
                        segStart = ev.timestamp
                    } else if (!ev.isForeground && segStart != null) {
                        val tFg = segStart
                        val tBg = ev.timestamp
                        segStart = null

                        if (tBg <= pkgWatermark) {
                            continue
                        }

                        val effectiveStart = maxOf(tFg, pkgWatermark, todayStart)
                        if (tBg > effectiveStart) {
                            deltaUsed += (tBg - effectiveStart)
                        }
                    }
                }

                if (segStart != null && activeUsagePackage != pkg) {
                    val effectiveStart = maxOf(segStart, pkgWatermark, todayStart)
                    if (toTime > effectiveStart) {
                        deltaUsed += (toTime - effectiveStart)
                    }
                }

                if (deltaUsed > 0L) {
                    val existing = ledger[pkg]
                    val currentUsed = if (existing != null && existing.dateKey == todayKey) existing.usedMillis else 0L
                    val updatedUsed = currentUsed + deltaUsed
                    val policy = policies.find { it.packageName == pkg }
                    val isExhausted = policy != null && (updatedUsed >= policy.allowanceMinutes * 60_000L || policy.allowanceMinutes == 0)

                    ledger[pkg] = NativeDailyUsage(
                        packageName = pkg,
                        dateKey = todayKey,
                        usedMillis = updatedUsed,
                        activeSegmentStartedAt = existing?.activeSegmentStartedAt,
                        exhaustedAt = if (isExhausted) existing?.exhaustedAt ?: toTime else existing?.exhaustedAt
                    )
                    mutated = true
                }

                watermarks[pkg] = maxOf(pkgWatermark, toTime)
            }

            if (mutated) {
                saveDailyUsageLedger(applicationContext, ledger)
            }
            saveAccountedWatermarks(applicationContext, watermarks)

            prefs.edit().putLong(RhythmNativePolicyKeys.LAST_USAGE_RECONCILED_AT, toTime).apply()
            lastUsageReconciledAt = toTime
        } catch (e: Exception) {
            Log.w(TAG, "reconcileUsage failed (non-fatal)", e)
        }
    }

    private fun restoreForegroundStateAfterReconnect() {
        val now = System.currentTimeMillis()
        try {
            val currentFgPkg = resolveCurrentForegroundPackage(applicationContext, fromTime = getLocalMidnight(now), toTime = now)

            if (currentFgPkg != null) {
                lastForegroundPackage = currentFgPkg
                val policies = loadDailyAllowancePolicies(applicationContext)
                val policy = policies.find { it.packageName == currentFgPkg }

                val restricted = isEffectivelyRestricted(applicationContext, currentFgPkg, now)
                if (restricted) {
                    presentIntervention(currentFgPkg)
                } else if (policy != null) {
                    startRiskUsageSegment(currentFgPkg, policy, now)
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "restoreForegroundStateAfterReconnect failed (non-fatal)", e)
        }
    }

    fun scheduleLeaseExpiry(lease: NativeAccessLease) {
        cancelLeaseExpiry(lease.groupId)

        val scheduledEndsAt = lease.endsAt
        val callback = Runnable {
            pruneExpiredLeases(applicationContext, System.currentTimeMillis())

            val currentLeases = loadActiveLeases(applicationContext, System.currentTimeMillis())
            val currentLease = currentLeases.find { it.groupId == lease.groupId }
            if (currentLease == null || currentLease.endsAt <= scheduledEndsAt) {
                val now = System.currentTimeMillis()
                val foreground = resolveCurrentForegroundPackage(applicationContext, now = now)
                if (foreground != null) {
                    lastForegroundPackage = foreground
                    if (isEffectivelyRestricted(applicationContext, foreground, now)) {
                        presentIntervention(foreground)
                    }
                }
            }

            leaseCallbacks.remove(lease.groupId)
        }

        leaseCallbacks[lease.groupId] = callback
        val delay = maxOf(0L, lease.endsAt - System.currentTimeMillis())
        mainHandler.postDelayed(callback, delay)
    }

    fun cancelLeaseExpiry(groupId: String) {
        leaseCallbacks.remove(groupId)?.let {
            mainHandler.removeCallbacks(it)
        }
    }

    override fun onInterrupt() {
        // Required lifecycle method
    }

    companion object {
        const val TAG = "RhythmEnforcement"
        private const val DEBOUNCE_MS = 850L

        var isRunning = false
            private set

        var instance: RhythmEnforcementService? = null
            private set

        fun getLocalDateKey(timestamp: Long = System.currentTimeMillis()): String {
            val sdf = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
            return sdf.format(Date(timestamp))
        }

        fun getLocalMidnight(timestamp: Long = System.currentTimeMillis()): Long {
            val cal = Calendar.getInstance()
            cal.timeInMillis = timestamp
            cal.set(Calendar.HOUR_OF_DAY, 0)
            cal.set(Calendar.MINUTE, 0)
            cal.set(Calendar.SECOND, 0)
            cal.set(Calendar.MILLISECOND, 0)
            return cal.timeInMillis
        }

        fun getNextLocalMidnight(now: Long = System.currentTimeMillis()): Long {
            val cal = Calendar.getInstance()
            cal.timeInMillis = now
            cal.add(Calendar.DAY_OF_YEAR, 1)
            cal.set(Calendar.HOUR_OF_DAY, 0)
            cal.set(Calendar.MINUTE, 0)
            cal.set(Calendar.SECOND, 0)
            cal.set(Calendar.MILLISECOND, 0)
            return cal.timeInMillis
        }

        fun parseTimeToMinutes(timeStr: String): Int {
            return try {
                val parts = timeStr.split(":")
                parts[0].toInt() * 60 + parts[1].toInt()
            } catch (_: Exception) {
                0
            }
        }

        fun resolveCurrentForegroundPackage(
            context: Context,
            fromTime: Long = getLocalMidnight(System.currentTimeMillis()),
            toTime: Long = System.currentTimeMillis()
        ): String? {
            try {
                val manager = context.getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager ?: return null
                if (fromTime >= toTime) return null
                val events = manager.queryEvents(fromTime, toTime)
                val eventList = mutableListOf<UsageEvents.Event>()

                while (events.hasNextEvent()) {
                    val ev = UsageEvents.Event()
                    events.getNextEvent(ev)
                    eventList.add(ev)
                }

                eventList.sortBy { it.timeStamp }

                var currentFg: String? = null

                for (ev in eventList) {
                    val pkg = ev.packageName ?: continue
                    val isFg = ev.eventType == UsageEvents.Event.ACTIVITY_RESUMED ||
                        ev.eventType == UsageEvents.Event.MOVE_TO_FOREGROUND
                    val isBg = ev.eventType == UsageEvents.Event.ACTIVITY_PAUSED ||
                        ev.eventType == UsageEvents.Event.ACTIVITY_STOPPED ||
                        ev.eventType == UsageEvents.Event.MOVE_TO_BACKGROUND

                    if (isFg) {
                        currentFg = pkg
                    } else if (isBg && pkg == currentFg) {
                        currentFg = null
                    }
                }

                if (currentFg != null &&
                    currentFg != context.packageName &&
                    !currentFg.startsWith("com.android.systemui")
                ) {
                    return currentFg
                }
            } catch (e: Exception) {
                Log.w(TAG, "resolveCurrentForegroundPackage failed", e)
            }
            return null
        }

        fun hasActiveAccessLease(context: Context, packageName: String, now: Long = System.currentTimeMillis()): Boolean {
            val leases = loadActiveLeases(context, now)
            return leases.any { it.packageNames.contains(packageName) && it.endsAt > now }
        }

        fun loadActiveLeases(context: Context, now: Long = System.currentTimeMillis()): List<NativeAccessLease> {
            val prefs = context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE)
            val leasesJson = prefs.getString(RhythmNativePolicyKeys.ACCESS_LEASES_JSON, null) ?: return emptyList()
            val (activeLeases, hasExpired) = parseAndPruneLeases(leasesJson, now)
            if (hasExpired) {
                saveLeases(context, activeLeases)
            }
            return activeLeases
        }

        fun loadCooldownPolicies(context: Context): List<NativeCooldownPolicy> {
            val prefs = context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE)
            val json = prefs.getString(RhythmNativePolicyKeys.COOLDOWN_POLICIES_JSON, null) ?: return emptyList()
            val list = mutableListOf<NativeCooldownPolicy>()
            try {
                val array = JSONArray(json)
                for (i in 0 until array.length()) {
                    val obj = array.getJSONObject(i)
                    val gid = obj.optString("groupId", "")
                    val endsAt = obj.optLong("endsAt", 0L)
                    val pkgsArray = obj.optJSONArray("packageNames")
                    val pkgSet = mutableSetOf<String>()
                    if (pkgsArray != null) {
                        for (j in 0 until pkgsArray.length()) {
                            pkgSet.add(pkgsArray.getString(j))
                        }
                    }
                    if (gid.isNotEmpty() && endsAt > 0L) {
                        list.add(NativeCooldownPolicy(gid, pkgSet, endsAt))
                    }
                }
            } catch (_: Exception) {
                // Ignore malformed
            }
            return list
        }

        fun saveCooldownPolicies(context: Context, policies: List<NativeCooldownPolicy>) {
            val array = JSONArray()
            for (p in policies) {
                val obj = JSONObject()
                obj.put("groupId", p.groupId)
                obj.put("endsAt", p.endsAt)
                val pkgs = JSONArray()
                for (pkg in p.packageNames) pkgs.put(pkg)
                obj.put("packageNames", pkgs)
                array.put(obj)
            }
            val prefs = context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE)
            prefs.edit().putString(RhythmNativePolicyKeys.COOLDOWN_POLICIES_JSON, array.toString()).apply()
        }

        fun isRestrictedByCooldown(context: Context, packageName: String, now: Long = System.currentTimeMillis()): Boolean {
            val cooldowns = loadCooldownPolicies(context)
            return cooldowns.any { it.packageNames.contains(packageName) && it.endsAt > now }
        }

        fun isDailyAllowanceExhausted(context: Context, packageName: String, now: Long = System.currentTimeMillis()): Boolean {
            val policies = loadDailyAllowancePolicies(context)
            val policy = policies.find { it.packageName == packageName } ?: return false

            if (policy.allowanceMinutes == 0) {
                return true
            }

            val ledger = loadDailyUsageLedger(context)
            val todayKey = getLocalDateKey(now)
            val usage = ledger[packageName] ?: return false

            if (usage.dateKey != todayKey) {
                return false
            }

            if (usage.exhaustedAt != null) {
                return true
            }

            val activeStart = if (instance?.activeUsagePackage == packageName) {
                instance?.activeUsageStartedAt ?: usage.activeSegmentStartedAt
            } else {
                usage.activeSegmentStartedAt
            }

            val elapsed = if (activeStart != null) maxOf(0L, now - activeStart) else 0L
            val totalUsed = usage.usedMillis + elapsed

            return totalUsed >= policy.allowanceMinutes * 60_000L
        }

        fun isProtectedByRoutine(context: Context, packageName: String, now: Long = System.currentTimeMillis()): Boolean {
            val schedule = loadRoutineSchedule(context)
            val windows = schedule.windows.filter { it.enabled }
            if (windows.isEmpty()) return false

            val cal = Calendar.getInstance()
            cal.timeInMillis = now
            val dow = cal.get(Calendar.DAY_OF_WEEK)
            val isoToday = if (dow == Calendar.SUNDAY) 7 else dow - 1
            val isoTomorrow = if (isoToday == 7) 1 else isoToday + 1
            val isoYesterday = if (isoToday == 1) 7 else isoToday - 1
            val currentMins = cal.get(Calendar.HOUR_OF_DAY) * 60 + cal.get(Calendar.MINUTE)

            val morning = windows.find { it.type == "morning-buffer" || it.id.contains("morning") }
            val evening = windows.find { it.type == "evening-wind-down" || it.id.contains("evening") }

            // 1. Morning Buffer window
            if (morning != null && morning.enabled && morning.activeDays.contains(isoToday)) {
                val mStart = parseTimeToMinutes(morning.startTime)
                val mEnd = parseTimeToMinutes(morning.endTime)
                if (currentMins in mStart until mEnd && morning.protectedPackages.contains(packageName)) {
                    return true
                }
            }

            // 2. Evening Wind-Down window
            if (evening != null && evening.enabled) {
                val eStart = parseTimeToMinutes(evening.startTime)
                val eEnd = parseTimeToMinutes(evening.endTime)

                if (eStart < eEnd) {
                    // Same-day evening window
                    if (evening.activeDays.contains(isoToday) && currentMins in eStart until eEnd) {
                        if (evening.protectedPackages.contains(packageName)) return true
                    }
                } else {
                    // Cross-midnight evening window
                    if (evening.activeDays.contains(isoYesterday) && currentMins < eEnd) {
                        if (evening.protectedPackages.contains(packageName)) return true
                    }
                    if (evening.activeDays.contains(isoToday) && currentMins >= eStart) {
                        if (evening.protectedPackages.contains(packageName)) return true
                    }
                }
            }

            // 3. Overnight Protection Continuity (exact Pass 01 semantics)
            // Evaluated strictly for all Risk apps
            val isRiskApp = schedule.allRiskPackages.contains(packageName) ||
                (morning?.protectedPackages?.contains(packageName) == true) ||
                (evening?.protectedPackages?.contains(packageName) == true)

            if (isRiskApp) {
                val isPreMidnight = currentMins >= 720
                if (isPreMidnight) {
                    val eveningActiveToday = evening != null && evening.enabled && evening.activeDays.contains(isoToday)
                    val morningActiveTomorrow = morning != null && morning.enabled && morning.activeDays.contains(isoTomorrow)

                    if (eveningActiveToday && morningActiveTomorrow) {
                        val eStart = evening?.let { parseTimeToMinutes(it.startTime) } ?: 1260
                        val eEnd = evening?.let { parseTimeToMinutes(it.endTime) } ?: 1380
                        val eveningWindowEnded = if (eStart < eEnd) currentMins >= eEnd else false
                        if (eveningWindowEnded) {
                            return true
                        }
                    }
                } else {
                    val eveningActiveYesterday = evening != null && evening.enabled && evening.activeDays.contains(isoYesterday)
                    val morningActiveToday = morning != null && morning.enabled && morning.activeDays.contains(isoToday)

                    if (eveningActiveYesterday && morningActiveToday) {
                        val mStart = morning?.let { parseTimeToMinutes(it.startTime) } ?: 360
                        val eStart = evening?.let { parseTimeToMinutes(it.startTime) } ?: 1260
                        val eEnd = evening?.let { parseTimeToMinutes(it.endTime) } ?: 1380
                        val pastCrossMidnightEvening = if (eStart >= eEnd) currentMins >= eEnd else true

                        if (currentMins < mStart && pastCrossMidnightEvening) {
                            return true
                        }
                    }
                }
            }

            return false
        }

        fun isEffectivelyRestricted(context: Context, packageName: String, now: Long = System.currentTimeMillis()): Boolean {
            val isAllowanceExhausted = isDailyAllowanceExhausted(context, packageName, now)
            val isRoutineProtected = isProtectedByRoutine(context, packageName, now)
            val isCooldownRestricted = isRestrictedByCooldown(context, packageName, now)

            val prefs = context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE)
            val baseSet = prefs.getStringSet(RhythmNativePolicyKeys.BASE_RESTRICTED_PACKAGES, emptySet()) ?: emptySet()
            val isBaseRestricted = baseSet.contains(packageName)

            if (!isAllowanceExhausted && !isRoutineProtected && !isCooldownRestricted && !isBaseRestricted) {
                return false
            }

            val leasesJson = prefs.getString(RhythmNativePolicyKeys.ACCESS_LEASES_JSON, null) ?: return true
            val (activeLeases, hasExpired) = parseAndPruneLeases(leasesJson, now)

            if (hasExpired) {
                saveLeases(context, activeLeases)
            }

            val isSuppressed = activeLeases.any { lease ->
                lease.packageNames.contains(packageName) && lease.endsAt > now
            }

            return !isSuppressed
        }

        fun pruneExpiredLeases(context: Context, now: Long = System.currentTimeMillis()) {
            val prefs = context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE)
            val leasesJson = prefs.getString(RhythmNativePolicyKeys.ACCESS_LEASES_JSON, null) ?: return
            val (activeLeases, hasExpired) = parseAndPruneLeases(leasesJson, now)
            if (hasExpired) {
                saveLeases(context, activeLeases)
            }
        }

        fun parseAndPruneLeases(jsonString: String, now: Long): Pair<List<NativeAccessLease>, Boolean> {
            val activeList = mutableListOf<NativeAccessLease>()
            var hasExpired = false
            try {
                val array = JSONArray(jsonString)
                for (i in 0 until array.length()) {
                    val obj = array.getJSONObject(i)
                    val endsAt = obj.optLong("endsAt", 0L)
                    if (endsAt > now) {
                        val groupId = obj.optString("groupId", "")
                        val pkgsArray = obj.optJSONArray("packageNames")
                        val pkgSet = mutableSetOf<String>()
                        if (pkgsArray != null) {
                            for (j in 0 until pkgsArray.length()) {
                                pkgSet.add(pkgsArray.getString(j))
                            }
                        }
                        activeList.add(NativeAccessLease(groupId, pkgSet, endsAt))
                    } else {
                        hasExpired = true
                    }
                }
            } catch (_: Exception) {
                // Ignore malformed
            }
            return Pair(activeList, hasExpired)
        }

        fun saveLeases(context: Context, leases: List<NativeAccessLease>) {
            val array = JSONArray()
            for (lease in leases) {
                val obj = JSONObject()
                obj.put("groupId", lease.groupId)
                obj.put("endsAt", lease.endsAt)
                val pkgs = JSONArray()
                for (pkg in lease.packageNames) {
                    pkgs.put(pkg)
                }
                obj.put("packageNames", pkgs)
                array.put(obj)
            }
            val prefs = context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE)
            prefs.edit().putString(RhythmNativePolicyKeys.ACCESS_LEASES_JSON, array.toString()).apply()
        }

        fun loadAccountedWatermarks(context: Context): Map<String, Long> {
            val prefs = context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE)
            val json = prefs.getString(RhythmNativePolicyKeys.LAST_USAGE_ACCOUNTED_BY_PACKAGE_JSON, null) ?: return emptyMap()
            val map = mutableMapOf<String, Long>()
            try {
                val obj = JSONObject(json)
                val keys = obj.keys()
                while (keys.hasNext()) {
                    val pkg = keys.next()
                    map[pkg] = obj.optLong(pkg, 0L)
                }
            } catch (_: Exception) {
                // Ignore malformed
            }
            return map
        }

        fun saveAccountedWatermarks(context: Context, watermarks: Map<String, Long>) {
            val obj = JSONObject()
            for ((pkg, ts) in watermarks) {
                obj.put(pkg, ts)
            }
            val prefs = context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE)
            prefs.edit().putString(RhythmNativePolicyKeys.LAST_USAGE_ACCOUNTED_BY_PACKAGE_JSON, obj.toString()).apply()
        }

        fun advancePackageWatermark(context: Context, packageName: String, timestamp: Long) {
            val map = loadAccountedWatermarks(context).toMutableMap()
            map[packageName] = maxOf(map[packageName] ?: 0L, timestamp)
            saveAccountedWatermarks(context, map)
        }

        fun loadDailyAllowancePolicies(context: Context): List<NativeDailyAllowancePolicy> {
            val prefs = context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE)
            val json = prefs.getString(RhythmNativePolicyKeys.DAILY_ALLOWANCE_POLICIES_JSON, null) ?: return emptyList()
            val list = mutableListOf<NativeDailyAllowancePolicy>()
            try {
                val array = JSONArray(json)
                for (i in 0 until array.length()) {
                    val obj = array.getJSONObject(i)
                    val pkg = obj.optString("packageName", "")
                    val mins = obj.optInt("allowanceMinutes", 30)
                    if (pkg.isNotEmpty()) {
                        list.add(NativeDailyAllowancePolicy(pkg, mins))
                    }
                }
            } catch (_: Exception) {
                // Ignore malformed
            }
            return list
        }

        fun saveDailyAllowancePolicies(context: Context, policies: List<NativeDailyAllowancePolicy>) {
            val array = JSONArray()
            for (policy in policies) {
                val obj = JSONObject()
                obj.put("packageName", policy.packageName)
                obj.put("allowanceMinutes", policy.allowanceMinutes)
                array.put(obj)
            }
            val prefs = context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE)
            prefs.edit().putString(RhythmNativePolicyKeys.DAILY_ALLOWANCE_POLICIES_JSON, array.toString()).apply()
        }

        fun parseRoutineScheduleInput(input: Any): NativeRoutineSchedule {
            val windows = mutableListOf<NativeRoutineWindow>()
            val allRiskPackages = mutableSetOf<String>()

            if (input is Map<*, *>) {
                val rawWindows = input["windows"] as? List<*> ?: emptyList<Any>()
                val rawRisk = input["allRiskPackages"] as? List<*> ?: emptyList<Any>()
                for (p in rawRisk) {
                    if (p is String) allRiskPackages.add(p)
                }
                for (item in rawWindows) {
                    if (item is Map<*, *>) {
                        val id = item["id"] as? String ?: continue
                        val type = item["type"] as? String ?: if (id.contains("morning")) "morning-buffer" else "evening-wind-down"
                        val start = item["startTime"] as? String ?: "00:00"
                        val end = item["endTime"] as? String ?: "00:00"
                        val enabled = item["enabled"] as? Boolean ?: true
                        val days = (item["activeDays"] as? List<*>)?.mapNotNull { (it as? Number)?.toInt() }?.toSet() ?: emptySet()
                        val pkgs = (item["protectedPackages"] as? List<*>)?.mapNotNull { it as? String }?.toSet() ?: emptySet()
                        windows.add(NativeRoutineWindow(id, type, start, end, days, pkgs, enabled))
                    }
                }
            } else if (input is List<*>) {
                for (item in input) {
                    if (item is Map<*, *>) {
                        val id = item["id"] as? String ?: continue
                        val type = item["type"] as? String ?: if (id.contains("morning")) "morning-buffer" else "evening-wind-down"
                        val start = item["startTime"] as? String ?: "00:00"
                        val end = item["endTime"] as? String ?: "00:00"
                        val enabled = item["enabled"] as? Boolean ?: true
                        val days = (item["activeDays"] as? List<*>)?.mapNotNull { (it as? Number)?.toInt() }?.toSet() ?: emptySet()
                        val pkgs = (item["protectedPackages"] as? List<*>)?.mapNotNull { it as? String }?.toSet() ?: emptySet()
                        windows.add(NativeRoutineWindow(id, type, start, end, days, pkgs, enabled))
                        allRiskPackages.addAll(pkgs)
                    }
                }
            }
            return NativeRoutineSchedule(windows, allRiskPackages)
        }

        fun loadRoutineSchedule(context: Context): NativeRoutineSchedule {
            val prefs = context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE)
            val json = prefs.getString(RhythmNativePolicyKeys.ROUTINE_SCHEDULE_JSON, null) ?: return NativeRoutineSchedule(emptyList(), emptySet())
            val windows = mutableListOf<NativeRoutineWindow>()
            val allRiskPackages = mutableSetOf<String>()

            try {
                if (json.startsWith("{")) {
                    val root = JSONObject(json)
                    val rawWindows = root.optJSONArray("windows")
                    val rawRisk = root.optJSONArray("allRiskPackages")
                    if (rawRisk != null) {
                        for (i in 0 until rawRisk.length()) {
                            allRiskPackages.add(rawRisk.getString(i))
                        }
                    }
                    if (rawWindows != null) {
                        for (i in 0 until rawWindows.length()) {
                            val obj = rawWindows.getJSONObject(i)
                            val id = obj.optString("id", "")
                            val type = obj.optString("type", if (id.contains("morning")) "morning-buffer" else "evening-wind-down")
                            val start = obj.optString("startTime", "00:00")
                            val end = obj.optString("endTime", "00:00")
                            val enabled = obj.optBoolean("enabled", true)
                            val daysArray = obj.optJSONArray("activeDays")
                            val daysSet = mutableSetOf<Int>()
                            if (daysArray != null) {
                                for (j in 0 until daysArray.length()) daysSet.add(daysArray.getInt(j))
                            }
                            val pkgsArray = obj.optJSONArray("protectedPackages")
                            val pkgsSet = mutableSetOf<String>()
                            if (pkgsArray != null) {
                                for (j in 0 until pkgsArray.length()) pkgsSet.add(pkgsArray.getString(j))
                            }
                            windows.add(NativeRoutineWindow(id, type, start, end, daysSet, pkgsSet, enabled))
                        }
                    }
                } else if (json.startsWith("[")) {
                    val array = JSONArray(json)
                    for (i in 0 until array.length()) {
                        val obj = array.getJSONObject(i)
                        val id = obj.optString("id", "")
                        val type = obj.optString("type", if (id.contains("morning")) "morning-buffer" else "evening-wind-down")
                        val start = obj.optString("startTime", "00:00")
                        val end = obj.optString("endTime", "00:00")
                        val enabled = obj.optBoolean("enabled", true)
                        val daysArray = obj.optJSONArray("activeDays")
                        val daysSet = mutableSetOf<Int>()
                        if (daysArray != null) {
                            for (j in 0 until daysArray.length()) daysSet.add(daysArray.getInt(j))
                        }
                        val pkgsArray = obj.optJSONArray("protectedPackages")
                        val pkgsSet = mutableSetOf<String>()
                        if (pkgsArray != null) {
                            for (j in 0 until pkgsArray.length()) pkgsSet.add(pkgsArray.getString(j))
                        }
                        windows.add(NativeRoutineWindow(id, type, start, end, daysSet, pkgsSet, enabled))
                        allRiskPackages.addAll(pkgsSet)
                    }
                }
            } catch (_: Exception) {
                // Ignore malformed
            }
            return NativeRoutineSchedule(windows, allRiskPackages)
        }

        fun saveRoutineSchedule(context: Context, schedule: NativeRoutineSchedule) {
            val root = JSONObject()
            val windowsArray = JSONArray()
            for (w in schedule.windows) {
                val obj = JSONObject()
                obj.put("id", w.id)
                obj.put("type", w.type)
                obj.put("startTime", w.startTime)
                obj.put("endTime", w.endTime)
                obj.put("enabled", w.enabled)
                val days = JSONArray()
                for (d in w.activeDays) days.put(d)
                obj.put("activeDays", days)
                val pkgs = JSONArray()
                for (p in w.protectedPackages) pkgs.put(p)
                obj.put("protectedPackages", pkgs)
                windowsArray.put(obj)
            }
            root.put("windows", windowsArray)
            val riskArray = JSONArray()
            for (p in schedule.allRiskPackages) riskArray.put(p)
            root.put("allRiskPackages", riskArray)

            val prefs = context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE)
            prefs.edit().putString(RhythmNativePolicyKeys.ROUTINE_SCHEDULE_JSON, root.toString()).apply()
        }

        fun loadDailyUsageLedger(context: Context): Map<String, NativeDailyUsage> {
            val prefs = context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE)
            val json = prefs.getString(RhythmNativePolicyKeys.DAILY_USAGE_LEDGER_JSON, null) ?: return emptyMap()
            val ledger = mutableMapOf<String, NativeDailyUsage>()
            try {
                val array = JSONArray(json)
                for (i in 0 until array.length()) {
                    val obj = array.getJSONObject(i)
                    val pkg = obj.optString("packageName", "")
                    val dateKey = obj.optString("dateKey", "")
                    val usedMillis = obj.optLong("usedMillis", 0L)
                    val activeStart = if (obj.has("activeSegmentStartedAt") && !obj.isNull("activeSegmentStartedAt")) obj.getLong("activeSegmentStartedAt") else null
                    val exhaustedAt = if (obj.has("exhaustedAt") && !obj.isNull("exhaustedAt")) obj.getLong("exhaustedAt") else null

                    if (pkg.isNotEmpty() && dateKey.isNotEmpty()) {
                        ledger[pkg] = NativeDailyUsage(pkg, dateKey, usedMillis, activeStart, exhaustedAt)
                    }
                }
            } catch (_: Exception) {
                // Ignore malformed
            }
            return ledger
        }

        fun saveDailyUsageLedger(context: Context, ledger: Map<String, NativeDailyUsage>) {
            val array = JSONArray()
            for (usage in ledger.values) {
                val obj = JSONObject()
                obj.put("packageName", usage.packageName)
                obj.put("dateKey", usage.dateKey)
                obj.put("usedMillis", usage.usedMillis)
                if (usage.activeSegmentStartedAt != null) {
                    obj.put("activeSegmentStartedAt", usage.activeSegmentStartedAt)
                }
                if (usage.exhaustedAt != null) {
                    obj.put("exhaustedAt", usage.exhaustedAt)
                }
                array.put(obj)
            }
            val prefs = context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE)
            prefs.edit().putString(RhythmNativePolicyKeys.DAILY_USAGE_LEDGER_JSON, array.toString()).apply()
        }

        fun getDailyUsageSnapshot(context: Context, now: Long = System.currentTimeMillis()): NativeDailyUsageSnapshot {
            val todayKey = getLocalDateKey(now)
            val policies = loadDailyAllowancePolicies(context)
            val ledger = loadDailyUsageLedger(context)
            val prefs = context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE)
            val lastReconciled = prefs.getLong(RhythmNativePolicyKeys.LAST_USAGE_RECONCILED_AT, 0L)

            val appsList = policies.map { policy ->
                val usage = ledger[policy.packageName]
                val isToday = usage != null && usage.dateKey == todayKey
                val baseUsed = if (isToday) usage!!.usedMillis else 0L

                val activeStart = if (instance?.activeUsagePackage == policy.packageName) {
                    instance?.activeUsageStartedAt ?: usage?.activeSegmentStartedAt
                } else {
                    usage?.activeSegmentStartedAt
                }

                val elapsed = if (activeStart != null && isToday) maxOf(0L, now - activeStart) else 0L
                val totalUsedMs = baseUsed + elapsed
                val totalUsedSec = (totalUsedMs / 1000L).toInt()

                val allowanceSec = policy.allowanceMinutes * 60
                val remainingSec = maxOf(0, allowanceSec - totalUsedSec)
                val exhausted = (usage?.exhaustedAt != null && isToday) || totalUsedSec >= allowanceSec || policy.allowanceMinutes == 0

                NativeDailyAppSnapshot(
                    packageName = policy.packageName,
                    usedSeconds = totalUsedSec,
                    allowanceMinutes = policy.allowanceMinutes,
                    remainingSeconds = remainingSec,
                    exhausted = exhausted,
                    activeSegmentStartedAt = if (instance?.activeUsagePackage == policy.packageName) activeStart else null
                )
            }

            return NativeDailyUsageSnapshot(
                dateKey = todayKey,
                apps = appsList,
                lastReconciledAt = if (lastReconciled > 0L) lastReconciled else null
            )
        }
    }
}
