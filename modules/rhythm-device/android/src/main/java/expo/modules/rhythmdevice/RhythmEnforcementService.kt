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
    val startTime: String,
    val endTime: String,
    val activeDays: Set<Int>,
    val protectedPackages: Set<String>,
    val enabled: Boolean
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

    var lastUsageReconciledAt: Long = 0L
        private set

    var lastUsageAccountedAt: Long = 0L
        private set

    override fun onServiceConnected() {
        super.onServiceConnected()
        isRunning = true
        instance = this
        Log.i(TAG, "RhythmEnforcementService connected")

        val prefs = applicationContext.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE)
        lastUsageAccountedAt = prefs.getLong(RhythmNativePolicyKeys.LAST_USAGE_ACCOUNTED_AT, 0L)
        lastUsageReconciledAt = prefs.getLong(RhythmNativePolicyKeys.LAST_USAGE_RECONCILED_AT, 0L)

        val activeLeases = loadActiveLeases(applicationContext, System.currentTimeMillis())
        for (lease in activeLeases) {
            scheduleLeaseExpiry(lease)
        }

        // 1. Bounded UsageStats reconciliation on service connect
        reconcileUsage()

        // 2. Schedule next routine boundary callback
        scheduleNextRoutineBoundary()

        // 3. Restore actual foreground Risk app tracking if present
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

        // Duplicate foreground protection:
        // If the same package is reported again while already active, preserve existing segment start.
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

        // 4. Evaluate restrictions for new package
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

        // Handle day rollover if existing is from previous day
        val currentUsed = if (existing != null && existing.dateKey == todayKey) existing.usedMillis else 0L
        val isAlreadyExhausted = existing != null && existing.dateKey == todayKey && existing.exhaustedAt != null

        activeUsagePackage = packageName
        activeUsageStartedAt = now

        // Persist active segment start
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
                // Allowance expired and no lease active:
                // Commit allowance usage, mark exhausted, terminate active segment, present Touch Grass
                ledger[packageName] = ledger[packageName]!!.copy(
                    usedMillis = maxOf(allowanceMillis, currentUsed),
                    activeSegmentStartedAt = null,
                    exhaustedAt = exhaustedTimestamp
                )
                saveDailyUsageLedger(applicationContext, ledger)

                activeUsagePackage = null
                activeUsageStartedAt = null
                advanceWatermark(now)

                presentIntervention(packageName)
            } else {
                // Lease is active: mark exhausted, continue counting, do not overlay until lease expiry
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
            advanceWatermark(now)
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
            Log.d(TAG, "Deadline skipped: package no longer foreground ($packageName vs $lastForegroundPackage)")
            return
        }

        val now = System.currentTimeMillis()
        val todayKey = getLocalDateKey(now)

        val ledger = loadDailyUsageLedger(applicationContext).toMutableMap()
        val currentUsage = ledger[packageName]
        if (currentUsage == null || currentUsage.dateKey != todayKey) {
            Log.d(TAG, "Deadline skipped: usage dateKey mismatch")
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
                // Allowance expired and no lease active:
                // Commit allowance usage, mark exhausted, terminate active Risk usage segment, present Touch Grass
                val updatedUsage = currentUsage.copy(
                    usedMillis = maxOf(allowanceMillis, totalUsed),
                    activeSegmentStartedAt = null,
                    exhaustedAt = now
                )
                ledger[packageName] = updatedUsage
                saveDailyUsageLedger(applicationContext, ledger)

                activeUsagePackage = null
                activeUsageStartedAt = null
                advanceWatermark(now)

                Log.i(TAG, "Daily allowance exhausted for $packageName (used=$totalUsed ms, allowance=$allowanceMillis ms)")
                presentIntervention(packageName)
            } else {
                // If a lease is active: mark exhausted, continue counting, do not overlay until lease expiry
                val updatedUsage = currentUsage.copy(
                    usedMillis = totalUsed,
                    activeSegmentStartedAt = now,
                    exhaustedAt = currentUsage.exhaustedAt ?: now
                )
                ledger[packageName] = updatedUsage
                saveDailyUsageLedger(applicationContext, ledger)
                activeUsageStartedAt = now
                advanceWatermark(now)

                Log.i(TAG, "Daily allowance reached during active lease for $packageName; continuing usage accounting until lease expiry")
            }
        }
    }

    fun scheduleMidnightRollover(packageName: String, now: Long) {
        cancelMidnightRollover()
        val nextMidnight = getLocalMidnight(now) + 86_400_000L
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
        advanceWatermark(midnightTime)

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
        val routines = loadRoutineWindows(applicationContext)
        if (routines.isEmpty()) return

        val cal = Calendar.getInstance()
        cal.timeInMillis = now
        val currentMins = cal.get(Calendar.HOUR_OF_DAY) * 60 + cal.get(Calendar.MINUTE)

        val morning = routines.find { it.id.contains("morning") || it.startTime < "12:00" }
        val evening = routines.find { it.id.contains("evening") || it.startTime >= "12:00" }

        val morningStart = morning?.let { parseTimeToMinutes(it.startTime) } ?: 360
        val morningEnd = morning?.let { parseTimeToMinutes(it.endTime) } ?: 540
        val eveningStart = evening?.let { parseTimeToMinutes(it.startTime) } ?: 1260
        val eveningEnd = evening?.let { parseTimeToMinutes(it.endTime) } ?: 1380

        val nextMins = when {
            currentMins < morningStart -> morningStart
            currentMins < morningEnd -> morningEnd
            currentMins < eveningStart -> eveningStart
            currentMins < eveningEnd -> eveningEnd
            else -> 1440
        }

        val todayMidnight = getLocalMidnight(now)
        val boundaryTime = todayMidnight + nextMins * 60_000L
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
        val foreground = lastForegroundPackage ?: resolveRecentForegroundPackage()
        if (foreground != null) {
            if (isEffectivelyRestricted(applicationContext, foreground, now)) {
                presentIntervention(foreground)
            }
        }
        scheduleNextRoutineBoundary(now + 1000L)
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
        val packageName = lastForegroundPackage ?: resolveRecentForegroundPackage() ?: return
        val now = System.currentTimeMillis()
        Log.d(TAG, "onBaseRestrictionsChanged: rechecking package=$packageName")
        if (isEffectivelyRestricted(applicationContext, packageName, now)) {
            presentIntervention(packageName)
        }
    }

    fun onDailyAllowancePoliciesChanged() {
        val now = System.currentTimeMillis()
        val todayKey = getLocalDateKey(now)
        val policies = loadDailyAllowancePolicies(applicationContext)
        val ledger = loadDailyUsageLedger(applicationContext).toMutableMap()
        var ledgerMutated = false

        // Correction 2: Clear stale exhaustion after a valid allowance increase
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

        val foreground = lastForegroundPackage ?: resolveRecentForegroundPackage()
        if (foreground != null) {
            val policy = policies.find { it.packageName == foreground }

            if (policy == null) {
                // Reclassified to Normal or Essential:
                // Cancel deadline, finalize active segment, clear daily exhaustion enforcement
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
                        advanceWatermark(now)

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
                        advanceWatermark(now)
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
            val lastAccounted = prefs.getLong(RhythmNativePolicyKeys.LAST_USAGE_ACCOUNTED_AT, 0L)
            val todayStart = getLocalMidnight(toTime)

            val from = fromTime ?: maxOf(lastAccounted - 60_000L, todayStart)
            if (from >= toTime) return

            val events = manager.queryEvents(from, toTime)
            val policies = loadDailyAllowancePolicies(applicationContext)
            val riskPackages = policies.map { it.packageName }.toSet()
            if (riskPackages.isEmpty()) {
                val newWatermark = maxOf(lastAccounted, toTime)
                prefs.edit()
                    .putLong(RhythmNativePolicyKeys.LAST_USAGE_RECONCILED_AT, toTime)
                    .putLong(RhythmNativePolicyKeys.LAST_USAGE_ACCOUNTED_AT, newWatermark)
                    .apply()
                lastUsageReconciledAt = toTime
                lastUsageAccountedAt = newWatermark
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
            var mutated = false

            for (pkg in riskPackages) {
                val pkgEvents = riskTransitions.filter { it.packageName == pkg }
                if (pkgEvents.isEmpty()) continue

                var segStart: Long? = null
                var deltaUsed = 0L

                for (ev in pkgEvents) {
                    if (ev.isForeground) {
                        segStart = ev.timestamp
                    } else if (!ev.isForeground && segStart != null) {
                        val tFg = segStart
                        val tBg = ev.timestamp
                        segStart = null

                        if (tBg <= lastAccounted) {
                            // Entire interval occurred before or at watermark: already accounted!
                            continue
                        }

                        // Interval ends after watermark: only count the delta strictly after watermark
                        val effectiveStart = maxOf(tFg, lastAccounted, todayStart)
                        if (tBg > effectiveStart) {
                            deltaUsed += (tBg - effectiveStart)
                        }
                    }
                }

                // If an unclosed foreground segment remains at toTime
                if (segStart != null) {
                    if (activeUsagePackage != pkg) {
                        val effectiveStart = maxOf(segStart, lastAccounted, todayStart)
                        if (toTime > effectiveStart) {
                            deltaUsed += (toTime - effectiveStart)
                        }
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
            }

            if (mutated) {
                saveDailyUsageLedger(applicationContext, ledger)
            }

            val newWatermark = maxOf(lastAccounted, toTime)
            prefs.edit()
                .putLong(RhythmNativePolicyKeys.LAST_USAGE_RECONCILED_AT, toTime)
                .putLong(RhythmNativePolicyKeys.LAST_USAGE_ACCOUNTED_AT, newWatermark)
                .apply()
            lastUsageReconciledAt = toTime
            lastUsageAccountedAt = newWatermark
        } catch (e: Exception) {
            Log.w(TAG, "reconcileUsage failed (non-fatal)", e)
        }
    }

    private fun advanceWatermark(timestamp: Long) {
        lastUsageAccountedAt = maxOf(lastUsageAccountedAt, timestamp)
        val prefs = applicationContext.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE)
        prefs.edit().putLong(RhythmNativePolicyKeys.LAST_USAGE_ACCOUNTED_AT, lastUsageAccountedAt).apply()
    }

    private fun restoreForegroundStateAfterReconnect() {
        val now = System.currentTimeMillis()
        try {
            val manager = getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager ?: return
            val events = manager.queryEvents(now - 300_000L, now)
            val event = UsageEvents.Event()
            val eventList = mutableListOf<UsageEvents.Event>()

            while (events.hasNextEvent()) {
                val ev = UsageEvents.Event()
                events.getNextEvent(ev)
                eventList.add(ev)
            }

            eventList.sortBy { it.timeStamp }

            var currentFgPkg: String? = null

            for (ev in eventList) {
                val pkg = ev.packageName ?: continue
                val isFg = ev.eventType == UsageEvents.Event.ACTIVITY_RESUMED ||
                    ev.eventType == UsageEvents.Event.MOVE_TO_FOREGROUND
                val isBg = ev.eventType == UsageEvents.Event.ACTIVITY_PAUSED ||
                    ev.eventType == UsageEvents.Event.ACTIVITY_STOPPED ||
                    ev.eventType == UsageEvents.Event.MOVE_TO_BACKGROUND

                if (isFg) {
                    currentFgPkg = pkg
                } else if (isBg && pkg == currentFgPkg) {
                    currentFgPkg = null
                }
            }

            if (currentFgPkg != null &&
                currentFgPkg != applicationContext.packageName &&
                !currentFgPkg.startsWith("com.android.systemui")
            ) {
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

    private fun resolveRecentForegroundPackage(): String? {
        try {
            val manager = getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager ?: return null
            val now = System.currentTimeMillis()
            val events = manager.queryEvents(now - 60_000L, now)
            val event = UsageEvents.Event()
            var recentPackage: String? = null
            var recentTime = 0L

            while (events.hasNextEvent()) {
                events.getNextEvent(event)
                val isForeground = event.eventType == UsageEvents.Event.ACTIVITY_RESUMED ||
                    event.eventType == UsageEvents.Event.MOVE_TO_FOREGROUND
                if (isForeground && event.timeStamp >= recentTime) {
                    recentTime = event.timeStamp
                    recentPackage = event.packageName
                }
            }

            if (recentPackage != null &&
                recentPackage != applicationContext.packageName &&
                !recentPackage.startsWith("com.android.systemui")
            ) {
                lastForegroundPackage = recentPackage
                return recentPackage
            }
        } catch (e: Exception) {
            Log.w(TAG, "resolveRecentForegroundPackage failed (non-fatal)", e)
        }
        return null
    }

    fun scheduleLeaseExpiry(lease: NativeAccessLease) {
        cancelLeaseExpiry(lease.groupId)

        val scheduledEndsAt = lease.endsAt
        val callback = Runnable {
            pruneExpiredLeases(applicationContext, System.currentTimeMillis())

            val currentLeases = loadActiveLeases(applicationContext, System.currentTimeMillis())
            val currentLease = currentLeases.find { it.groupId == lease.groupId }
            if (currentLease == null || currentLease.endsAt <= scheduledEndsAt) {
                val foreground = lastForegroundPackage ?: resolveRecentForegroundPackage()
                val now = System.currentTimeMillis()
                if (foreground != null && isEffectivelyRestricted(applicationContext, foreground, now)) {
                    presentIntervention(foreground)
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
            val routines = loadRoutineWindows(context)
            if (routines.isEmpty()) return false

            val matching = routines.filter { it.enabled && it.protectedPackages.contains(packageName) }
            if (matching.isEmpty()) return false

            val cal = Calendar.getInstance()
            cal.timeInMillis = now
            val dow = cal.get(Calendar.DAY_OF_WEEK)
            val isoDay = if (dow == Calendar.SUNDAY) 7 else dow - 1
            val currentMins = cal.get(Calendar.HOUR_OF_DAY) * 60 + cal.get(Calendar.MINUTE)

            val morning = matching.find { it.id.contains("morning") || it.startTime < "12:00" }
            val evening = matching.find { it.id.contains("evening") || it.startTime >= "12:00" }

            val morningActiveToday = morning != null && morning.activeDays.contains(isoDay)
            val eveningActiveToday = evening != null && evening.activeDays.contains(isoDay)

            val morningStart = morning?.let { parseTimeToMinutes(it.startTime) } ?: 360
            val morningEnd = morning?.let { parseTimeToMinutes(it.endTime) } ?: 540
            val eveningStart = evening?.let { parseTimeToMinutes(it.startTime) } ?: 1260
            val eveningEnd = evening?.let { parseTimeToMinutes(it.endTime) } ?: 1380

            // 1. Morning Buffer
            if (morningActiveToday && currentMins in morningStart until morningEnd) {
                return true
            }

            // 2. Evening Wind-Down
            if (eveningActiveToday && currentMins in eveningStart until eveningEnd) {
                return true
            }

            // 3. Overnight protection continuity (no unlock gap)
            if (eveningActiveToday && currentMins >= eveningEnd) {
                return true
            }
            if (morningActiveToday && currentMins < morningStart) {
                return true
            }

            return false
        }

        private fun parseTimeToMinutes(timeStr: String): Int {
            return try {
                val parts = timeStr.split(":")
                parts[0].toInt() * 60 + parts[1].toInt()
            } catch (_: Exception) {
                0
            }
        }

        fun isEffectivelyRestricted(context: Context, packageName: String, now: Long = System.currentTimeMillis()): Boolean {
            val prefs = context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE)
            val baseSet = prefs.getStringSet(RhythmNativePolicyKeys.BASE_RESTRICTED_PACKAGES, emptySet()) ?: emptySet()
            val isBaseRestricted = baseSet.contains(packageName)
            val isAllowanceExhausted = isDailyAllowanceExhausted(context, packageName, now)
            val isRoutineProtected = isProtectedByRoutine(context, packageName, now)

            if (!isBaseRestricted && !isAllowanceExhausted && !isRoutineProtected) {
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

        fun loadRoutineWindows(context: Context): List<NativeRoutineWindow> {
            val prefs = context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE)
            val json = prefs.getString(RhythmNativePolicyKeys.ROUTINE_SCHEDULE_JSON, null) ?: return emptyList()
            val list = mutableListOf<NativeRoutineWindow>()
            try {
                val array = JSONArray(json)
                for (i in 0 until array.length()) {
                    val obj = array.getJSONObject(i)
                    val id = obj.optString("id", "")
                    val start = obj.optString("startTime", "00:00")
                    val end = obj.optString("endTime", "00:00")
                    val enabled = obj.optBoolean("enabled", true)
                    val daysArray = obj.optJSONArray("activeDays")
                    val daysSet = mutableSetOf<Int>()
                    if (daysArray != null) {
                        for (j in 0 until daysArray.length()) {
                            daysSet.add(daysArray.getInt(j))
                        }
                    }
                    val pkgsArray = obj.optJSONArray("protectedPackages")
                    val pkgsSet = mutableSetOf<String>()
                    if (pkgsArray != null) {
                        for (j in 0 until pkgsArray.length()) {
                            pkgsSet.add(pkgsArray.getString(j))
                        }
                    }
                    list.add(NativeRoutineWindow(id, start, end, daysSet, pkgsSet, enabled))
                }
            } catch (_: Exception) {
                // Ignore malformed
            }
            return list
        }

        fun saveRoutineWindows(context: Context, windows: List<NativeRoutineWindow>) {
            val array = JSONArray()
            for (w in windows) {
                val obj = JSONObject()
                obj.put("id", w.id)
                obj.put("startTime", w.startTime)
                obj.put("endTime", w.endTime)
                obj.put("enabled", w.enabled)
                val days = JSONArray()
                for (d in w.activeDays) days.put(d)
                obj.put("activeDays", days)
                val pkgs = JSONArray()
                for (p in w.protectedPackages) pkgs.put(p)
                obj.put("protectedPackages", pkgs)
                array.put(obj)
            }
            val prefs = context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE)
            prefs.edit().putString(RhythmNativePolicyKeys.ROUTINE_SCHEDULE_JSON, array.toString()).apply()
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
