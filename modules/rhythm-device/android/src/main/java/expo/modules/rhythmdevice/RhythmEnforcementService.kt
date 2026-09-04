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

data class NativeRecoveryActivity(val id: String, val title: String, val subtitle: String, val iconEmoji: String, val durationSuggestion: String?)
data class NativeRiskGroupPolicy(val groupId: String, val groupName: String, val packageNames: Set<String>, val allowanceMinutes: Int, val cooldownMinutes: Int, val recoveryActivity: NativeRecoveryActivity)
data class NativeGroupAllowanceUsage(val groupId: String, val dateKey: String, val usedMillis: Long, val activePackageName: String?, val activeSegmentStartedAt: Long?, val exhaustedAt: Long?, val cycleRevision: Long)
data class NativeGroupAllowanceSnapshot(val groupId: String, val dateKey: String, val usedSeconds: Int, val allowanceMinutes: Int, val remainingSeconds: Int, val exhausted: Boolean, val activePackageName: String?, val activeSegmentStartedAt: Long?, val exhaustedAt: Long?, val cycleRevision: Long)
data class NativeAccessLease(val groupId: String, val packageNames: Set<String>, val endsAt: Long)
data class NativeCooldownPolicy(val groupId: String, val packageNames: Set<String>, val endsAt: Long)
data class NativeRoutineWindow(val id: String, val type: String, val startTime: String, val endTime: String, val activeDays: Set<Int>, val protectedPackages: Set<String>, val enabled: Boolean)
data class NativeRoutineSchedule(val windows: List<NativeRoutineWindow>, val allRiskPackages: Set<String>)

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
    var nearestCooldownExpiryAt: Long? = null; private set
    var lastUsageReconciledAt: Long = 0L; private set

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        isRunning = true
        val prefs = applicationContext.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE)
        lastUsageReconciledAt = prefs.getLong(RhythmNativePolicyKeys.LAST_USAGE_RECONCILED_AT, 0L)
        loadActiveLeases(applicationContext).forEach { scheduleLeaseExpiry(it) }
        reconcileUsage()
        rolloverIfNeeded(System.currentTimeMillis())
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
            cancelAllowanceDeadline(); cancelMidnightRollover()
            return
        }
        if (packageName == lastForegroundPackage) return
        val previousGroup = activeUsageGroup
        val previousPackage = activeUsagePackage
        lastForegroundPackage = packageName
        if (previousGroup != null && previousPackage != null) finalizeActiveGroupSegment(previousGroup, now)
        cancelAllowanceDeadline(); cancelMidnightRollover()
        pruneExpiredLeases(applicationContext, now)
        pruneExpiredCooldowns(now)
        val policy = findGroupPolicyForPackage(loadRiskGroupPolicies(applicationContext), packageName)
        if (isEffectivelyRestricted(applicationContext, packageName, now)) {
            presentIntervention(packageName, policy, loadCooldownForPackage(packageName, now)?.endsAt)
        } else if (policy != null && !isRestrictedByCooldown(applicationContext, packageName, now)) {
            startGroupUsage(policy, packageName, now)
        } else {
            activeUsageGroup = null; activeUsagePackage = null; activeUsageStartedAt = null
        }
    }

    private fun findGroupPolicyForPackage(policies: List<NativeRiskGroupPolicy>, packageName: String): NativeRiskGroupPolicy? = policies.firstOrNull { packageName in it.packageNames }

    @Synchronized private fun startGroupUsage(policy: NativeRiskGroupPolicy, packageName: String, now: Long) {
        rolloverIfNeeded(now)
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
            saveGroupUsageLedger(applicationContext, ledger)
            advanceWatermark(groupId, now)
        }
        if (activeUsageGroup == groupId) { activeUsageGroup = null; activeUsagePackage = null; activeUsageStartedAt = null }
    }

    @Synchronized private fun exhaustGroup(policy: NativeRiskGroupPolicy, foregroundPackage: String, now: Long) {
        finalizeActiveGroupSegment(policy.groupId, now)
        val ledger = loadGroupUsageLedger(applicationContext).toMutableMap()
        val current = ledger[policy.groupId] ?: NativeGroupAllowanceUsage(policy.groupId, getLocalDateKey(now), 0L, null, null, null, 0L)
        if (current.exhaustedAt != null && loadCooldownPolicies(applicationContext).any { it.groupId == policy.groupId && it.endsAt > now }) return
        val allowance = policy.allowanceMinutes * 60_000L
        ledger[policy.groupId] = current.copy(usedMillis = maxOf(current.usedMillis, allowance), activePackageName = null, activeSegmentStartedAt = null, exhaustedAt = now)
        saveGroupUsageLedger(applicationContext, ledger)
        val endsAt = now + policy.cooldownMinutes * 60_000L
        val cooldowns = loadCooldownPolicies(applicationContext).filterNot { it.groupId == policy.groupId } + NativeCooldownPolicy(policy.groupId, policy.packageNames, endsAt)
        saveCooldownPolicies(applicationContext, cooldowns)
        activeUsageGroup = null; activeUsagePackage = null; activeUsageStartedAt = null
        scheduleNearestCooldownExpiry(now)
        if (!hasActiveAccessLease(applicationContext, foregroundPackage, now)) presentIntervention(foregroundPackage, policy, endsAt)
        Log.i(TAG, "Risk group exhausted: ${policy.groupId}; cooldown ends $endsAt")
    }

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
        val callback = Runnable { onMidnightRolloverFired(next) }
        midnightRolloverRunnable = callback
        handler.postDelayed(callback, maxOf(0L, next - now))
    }
    private fun cancelMidnightRollover() { midnightRolloverRunnable?.let { handler.removeCallbacks(it) }; midnightRolloverRunnable = null }

    private fun rolloverIfNeeded(now: Long) {
        val ledger = loadGroupUsageLedger(applicationContext)
        if (ledger.values.any { it.dateKey != getLocalDateKey(now) }) onMidnightRolloverFired(getLocalMidnight(now))
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
        saveGroupUsageLedger(applicationContext, next)
        val cooldowns = loadCooldownPolicies(applicationContext).filterNot { cooldown -> cooldown.packageNames.all { isProtectedByRoutine(applicationContext, it, now) } }
        saveCooldownPolicies(applicationContext, cooldowns)
        cancelAllowanceDeadline()
        val foreground = lastForegroundPackage
        val policy = foreground?.let { findGroupPolicyForPackage(loadRiskGroupPolicies(applicationContext), it) }
        if (foreground != null && policy != null && !isEffectivelyRestricted(applicationContext, foreground, now)) startGroupUsage(policy, foreground, now)
        scheduleMidnightRollover(now + 1000L)
    }

    private fun scheduleNextRoutineBoundary(now: Long = System.currentTimeMillis()) { cancelRoutineBoundary(); val next = getNextLocalMidnight(now); nextRoutineBoundaryAt = next; val r = Runnable { onRoutineBoundaryFired() }; routineBoundaryRunnable = r; handler.postDelayed(r, maxOf(0L, next - now)) }
    private fun cancelRoutineBoundary() { routineBoundaryRunnable?.let { handler.removeCallbacks(it) }; routineBoundaryRunnable = null; nextRoutineBoundaryAt = null }
    private fun onRoutineBoundaryFired() { val now = System.currentTimeMillis(); lastForegroundPackage?.let { if (isEffectivelyRestricted(applicationContext, it, now)) presentIntervention(it, findGroupPolicyForPackage(loadRiskGroupPolicies(applicationContext), it), loadCooldownForPackage(it, now)?.endsAt) }; scheduleNextRoutineBoundary(now + 1000L) }

    private fun scheduleNearestCooldownExpiry(now: Long = System.currentTimeMillis()) { cancelCooldownExpiry(); val active = loadCooldownPolicies(applicationContext).filter { it.endsAt > now }; if (active.isEmpty()) return; val nearest = active.minOf { it.endsAt }; nearestCooldownExpiryAt = nearest; val r = Runnable { onCooldownExpiryFired() }; cooldownExpiryRunnable = r; handler.postDelayed(r, maxOf(0L, nearest - now)) }
    private fun cancelCooldownExpiry() { cooldownExpiryRunnable?.let { handler.removeCallbacks(it) }; cooldownExpiryRunnable = null; nearestCooldownExpiryAt = null }
    @Synchronized private fun onCooldownExpiryFired() {
        val now = System.currentTimeMillis(); val cooldowns = loadCooldownPolicies(applicationContext); val expired = cooldowns.filter { it.endsAt <= now }
        val ledger = loadGroupUsageLedger(applicationContext).toMutableMap()
        for (cooldown in expired) {
            val current = ledger[cooldown.groupId]
            ledger[cooldown.groupId] = NativeGroupAllowanceUsage(cooldown.groupId, getLocalDateKey(now), 0L, null, null, null, (current?.cycleRevision ?: 0L) + 1L)
        }
        saveGroupUsageLedger(applicationContext, ledger)
        saveCooldownPolicies(applicationContext, cooldowns.filter { it.endsAt > now })
        scheduleNearestCooldownExpiry(now)
        lastForegroundPackage?.let { if (isEffectivelyRestricted(applicationContext, it, now)) presentIntervention(it, findGroupPolicyForPackage(loadRiskGroupPolicies(applicationContext), it), loadCooldownForPackage(it, now)?.endsAt) else findGroupPolicyForPackage(loadRiskGroupPolicies(applicationContext), it)?.let { p -> startGroupUsage(p, it, now) } }
    }

    private fun presentIntervention(packageName: String, policy: NativeRiskGroupPolicy?, cooldownEndsAt: Long?) {
        if (RhythmOverlayActivity.isVisible) return
        val now = System.currentTimeMillis(); if (lastInterventionPackage == packageName && now - lastInterventionAt < DEBOUNCE_MS) return
        lastInterventionPackage = packageName; lastInterventionAt = now
        val activity = policy?.recoveryActivity
        val intent = Intent(this, RhythmOverlayActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(RhythmNativePolicyKeys.EXTRA_PACKAGE_NAME, packageName)
            putExtra(RhythmNativePolicyKeys.EXTRA_GROUP_ID, policy?.groupId)
            putExtra(RhythmNativePolicyKeys.EXTRA_GROUP_NAME, policy?.groupName)
            putExtra(RhythmNativePolicyKeys.EXTRA_COOLDOWN_ENDS_AT, cooldownEndsAt ?: 0L)
            putExtra(RhythmNativePolicyKeys.EXTRA_ACTIVITY_TITLE, activity?.title)
            putExtra(RhythmNativePolicyKeys.EXTRA_ACTIVITY_SUBTITLE, activity?.subtitle)
            putExtra(RhythmNativePolicyKeys.EXTRA_ACTIVITY_EMOJI, activity?.iconEmoji)
            putExtra(RhythmNativePolicyKeys.EXTRA_ACTIVITY_DURATION, activity?.durationSuggestion)
        }
        try { startActivity(intent) } catch (e: Exception) { Log.e(TAG, "Failed to launch Touch Grass", e) }
    }

    fun onBaseRestrictionsChanged() = recheckForeground()
    fun resolveRecentForegroundPackage(): String? = resolveCurrentForegroundPackage(applicationContext)
    fun onRiskGroupPoliciesChanged() { rolloverIfNeeded(System.currentTimeMillis()); recheckForeground() }
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
            while (events.hasNextEvent()) { events.getNextEvent(ev); val p = byPackage[ev.packageName] ?: continue; val fg = ev.eventType == UsageEvents.Event.ACTIVITY_RESUMED || ev.eventType == UsageEvents.Event.MOVE_TO_FOREGROUND; val bg = ev.eventType == UsageEvents.Event.ACTIVITY_PAUSED || ev.eventType == UsageEvents.Event.ACTIVITY_STOPPED || ev.eventType == UsageEvents.Event.MOVE_TO_BACKGROUND; if (fg || bg) transitions += UsageTransition(ev.packageName, ev.timeStamp, fg) }
            val ledger = loadGroupUsageLedger(applicationContext).toMutableMap(); val watermarks = loadAccountedWatermarks(applicationContext).toMutableMap()
            for (policy in policies) {
                var start: Long? = null; var delta = 0L
                transitions.filter { it.packageName in policy.packageNames }.sortedBy { it.timestamp }.forEach { t -> if (t.foreground) start = t.timestamp else if (start != null) { val watermark = watermarks[policy.groupId] ?: 0L; delta += maxOf(0L, t.timestamp - maxOf(start!!, watermark, getLocalMidnight(toTime))); start = null } }
                if (start != null && policy.groupId != activeUsageGroup) delta += maxOf(0L, toTime - maxOf(start!!, watermarks[policy.groupId] ?: 0L, getLocalMidnight(toTime)))
                if (delta > 0L) { val current = ledger[policy.groupId]?.takeIf { it.dateKey == getLocalDateKey(toTime) } ?: NativeGroupAllowanceUsage(policy.groupId, getLocalDateKey(toTime), 0L, null, null, null, 0L); ledger[policy.groupId] = current.copy(usedMillis = current.usedMillis + delta); }
                watermarks[policy.groupId] = maxOf(watermarks[policy.groupId] ?: 0L, toTime)
            }
            saveGroupUsageLedger(applicationContext, ledger); saveAccountedWatermarks(applicationContext, watermarks)
            prefs.edit().putLong(RhythmNativePolicyKeys.LAST_USAGE_RECONCILED_AT, toTime).apply(); lastUsageReconciledAt = toTime
        } catch (e: Exception) { Log.w(TAG, "bounded UsageStats reconciliation failed", e) }
    }

    private fun restoreForegroundStateAfterReconnect() { val now = System.currentTimeMillis(); val foreground = resolveCurrentForegroundPackage(applicationContext, now); if (foreground != null) { lastForegroundPackage = foreground; val policy = findGroupPolicyForPackage(loadRiskGroupPolicies(applicationContext), foreground); if (isEffectivelyRestricted(applicationContext, foreground, now)) presentIntervention(foreground, policy, loadCooldownForPackage(foreground, now)?.endsAt) else policy?.let { startGroupUsage(it, foreground, now) } } }

    fun scheduleLeaseExpiry(lease: NativeAccessLease) { cancelLeaseExpiry(lease.groupId); val r = Runnable { pruneExpiredLeases(applicationContext); recheckForeground(); leaseCallbacks.remove(lease.groupId) }; leaseCallbacks[lease.groupId] = r; handler.postDelayed(r, maxOf(0L, lease.endsAt - System.currentTimeMillis())) }
    fun cancelLeaseExpiry(groupId: String) { leaseCallbacks.remove(groupId)?.let { handler.removeCallbacks(it) } }
    override fun onInterrupt() {}

    companion object {
        const val TAG = "RhythmEnforcement"; var isRunning = false; var instance: RhythmEnforcementService? = null
        fun getLocalDateKey(timestamp: Long = System.currentTimeMillis()): String = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(Date(timestamp))
        fun getLocalMidnight(timestamp: Long = System.currentTimeMillis()): Long { val c = Calendar.getInstance(); c.timeInMillis = timestamp; c.set(Calendar.HOUR_OF_DAY, 0); c.set(Calendar.MINUTE, 0); c.set(Calendar.SECOND, 0); c.set(Calendar.MILLISECOND, 0); return c.timeInMillis }
        fun getNextLocalMidnight(timestamp: Long = System.currentTimeMillis()): Long { val c = Calendar.getInstance(); c.timeInMillis = timestamp; c.add(Calendar.DAY_OF_YEAR, 1); c.set(Calendar.HOUR_OF_DAY, 0); c.set(Calendar.MINUTE, 0); c.set(Calendar.SECOND, 0); c.set(Calendar.MILLISECOND, 0); return c.timeInMillis }
        fun hasActiveAccessLease(context: Context, packageName: String, now: Long = System.currentTimeMillis()) = loadActiveLeases(context, now).any { packageName in it.packageNames && it.endsAt > now }
        fun loadActiveLeases(context: Context, now: Long = System.currentTimeMillis()): List<NativeAccessLease> { val json = context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE).getString(RhythmNativePolicyKeys.ACCESS_LEASES_JSON, null) ?: return emptyList(); val out = mutableListOf<NativeAccessLease>(); try { val a = JSONArray(json); for (i in 0 until a.length()) { val o = a.getJSONObject(i); val end = o.optLong("endsAt"); if (end > now) out += NativeAccessLease(o.optString("groupId"), jsonStrings(o.optJSONArray("packageNames")), end) } } catch (_: Exception) {} ; return out }
        fun saveLeases(context: Context, leases: List<NativeAccessLease>) { val a = JSONArray(); leases.forEach { l -> a.put(JSONObject().apply { put("groupId", l.groupId); put("endsAt", l.endsAt); put("packageNames", JSONArray(l.packageNames.toList())) }) }; context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE).edit().putString(RhythmNativePolicyKeys.ACCESS_LEASES_JSON, a.toString()).apply() }
        fun pruneExpiredLeases(context: Context, now: Long = System.currentTimeMillis()) = saveLeases(context, loadActiveLeases(context, now))
        fun loadRiskGroupPolicies(context: Context): List<NativeRiskGroupPolicy> { val json = context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE).getString(RhythmNativePolicyKeys.RISK_GROUP_POLICIES_JSON, null) ?: return emptyList(); val out = mutableListOf<NativeRiskGroupPolicy>(); try { val a = JSONArray(json); for (i in 0 until a.length()) { val o = a.getJSONObject(i); val activity = o.optJSONObject("recoveryActivity"); out += NativeRiskGroupPolicy(o.optString("groupId"), o.optString("groupName"), jsonStrings(o.optJSONArray("packageNames")), maxOf(0, o.optInt("allowanceMinutes", 30)), maxOf(0, o.optInt("cooldownMinutes", 0)), NativeRecoveryActivity(activity?.optString("id", "walk") ?: "walk", activity?.optString("title", "Take a short walk") ?: "Take a short walk", activity?.optString("subtitle", "Fresh air. Clear mind.") ?: "Fresh air. Clear mind.", activity?.optString("iconEmoji", "walk") ?: "walk", activity?.optString("durationSuggestion", null))) } } catch (_: Exception) {} ; return out }
        fun saveRiskGroupPolicies(context: Context, policies: List<NativeRiskGroupPolicy>) { val a = JSONArray(); policies.forEach { p -> a.put(JSONObject().apply { put("groupId", p.groupId); put("groupName", p.groupName); put("packageNames", JSONArray(p.packageNames.toList())); put("allowanceMinutes", p.allowanceMinutes); put("cooldownMinutes", p.cooldownMinutes); put("recoveryActivity", JSONObject().apply { put("id", p.recoveryActivity.id); put("title", p.recoveryActivity.title); put("subtitle", p.recoveryActivity.subtitle); put("iconEmoji", p.recoveryActivity.iconEmoji); p.recoveryActivity.durationSuggestion?.let { put("durationSuggestion", it) } }) }) }; context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE).edit().putString(RhythmNativePolicyKeys.RISK_GROUP_POLICIES_JSON, a.toString()).apply() }
        fun loadGroupUsageLedger(context: Context): Map<String, NativeGroupAllowanceUsage> { val json = context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE).getString(RhythmNativePolicyKeys.GROUP_USAGE_LEDGER_JSON, null) ?: return emptyMap(); val out = mutableMapOf<String, NativeGroupAllowanceUsage>(); try { val a = JSONArray(json); for (i in 0 until a.length()) { val o = a.getJSONObject(i); out[o.optString("groupId")] = NativeGroupAllowanceUsage(o.optString("groupId"), o.optString("dateKey"), o.optLong("usedMillis"), o.optString("activePackageName", null), if (o.has("activeSegmentStartedAt")) o.optLong("activeSegmentStartedAt") else null, if (o.has("exhaustedAt")) o.optLong("exhaustedAt") else null, o.optLong("cycleRevision")) } } catch (_: Exception) {} ; return out }
        fun saveGroupUsageLedger(context: Context, ledger: Map<String, NativeGroupAllowanceUsage>) { val a = JSONArray(); ledger.values.forEach { u -> a.put(JSONObject().apply { put("groupId", u.groupId); put("dateKey", u.dateKey); put("usedMillis", u.usedMillis); u.activePackageName?.let { put("activePackageName", it) }; u.activeSegmentStartedAt?.let { put("activeSegmentStartedAt", it) }; u.exhaustedAt?.let { put("exhaustedAt", it) }; put("cycleRevision", u.cycleRevision) }) }; context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE).edit().putString(RhythmNativePolicyKeys.GROUP_USAGE_LEDGER_JSON, a.toString()).apply() }
        fun loadCooldownPolicies(context: Context): List<NativeCooldownPolicy> { val json = context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE).getString(RhythmNativePolicyKeys.COOLDOWN_POLICIES_JSON, null) ?: return emptyList(); val out = mutableListOf<NativeCooldownPolicy>(); try { val a = JSONArray(json); for (i in 0 until a.length()) { val o = a.getJSONObject(i); out += NativeCooldownPolicy(o.optString("groupId"), jsonStrings(o.optJSONArray("packageNames")), o.optLong("endsAt")) } } catch (_: Exception) {} ; return out }
        fun saveCooldownPolicies(context: Context, policies: List<NativeCooldownPolicy>) { val a = JSONArray(); policies.forEach { p -> a.put(JSONObject().apply { put("groupId", p.groupId); put("packageNames", JSONArray(p.packageNames.toList())); put("endsAt", p.endsAt) }) }; context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE).edit().putString(RhythmNativePolicyKeys.COOLDOWN_POLICIES_JSON, a.toString()).apply() }
        fun isRestrictedByCooldown(context: Context, packageName: String, now: Long = System.currentTimeMillis()) = loadCooldownPolicies(context).any { packageName in it.packageNames && it.endsAt > now }
        fun isProtectedByRoutine(context: Context, packageName: String, now: Long = System.currentTimeMillis()): Boolean {
            val s = loadRoutineSchedule(context); val c = Calendar.getInstance(); c.timeInMillis = now
            val day = if (c.get(Calendar.DAY_OF_WEEK) == Calendar.SUNDAY) 7 else c.get(Calendar.DAY_OF_WEEK) - 1
            val yesterday = if (day == 1) 7 else day - 1; val tomorrow = if (day == 7) 1 else day + 1
            val mins = c.get(Calendar.HOUR_OF_DAY) * 60 + c.get(Calendar.MINUTE)
            val morning = s.windows.firstOrNull { it.enabled && it.type == "morning-buffer" }
            val evening = s.windows.firstOrNull { it.enabled && it.type == "evening-wind-down" }
            if (s.windows.any { w -> if (!w.enabled || packageName !in w.protectedPackages || day !in w.activeDays) false else { val start = parseTime(w.startTime); val end = parseTime(w.endTime); if (w.type == "morning-buffer") mins in start until end else if (start < end) mins in start until end else mins >= start || mins < end } }) return true
            if (packageName in s.allRiskPackages && morning != null && evening != null) {
                val eveningStart = parseTime(evening.startTime); val eveningEnd = parseTime(evening.endTime); val morningStart = parseTime(morning.startTime)
                val eveningToday = day in evening.activeDays; val morningTomorrow = tomorrow in morning.activeDays
                val eveningYesterday = yesterday in evening.activeDays; val morningToday = day in morning.activeDays
                if (eveningToday && morningTomorrow && mins >= eveningEnd && eveningStart < eveningEnd) return true
                if (eveningYesterday && morningToday && mins < morningStart && eveningStart >= eveningEnd && mins >= eveningEnd) return true
            }
            return false
        }
        fun isEffectivelyRestricted(context: Context, packageName: String, now: Long = System.currentTimeMillis()): Boolean {
            val base = context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE).getStringSet(RhythmNativePolicyKeys.BASE_RESTRICTED_PACKAGES, emptySet())?.contains(packageName) == true
            val restricted = base || isProtectedByRoutine(context, packageName, now) || isRestrictedByCooldown(context, packageName, now)
            if (!restricted) return false
            return !hasActiveAccessLease(context, packageName, now)
        }
        fun loadAccountedWatermarks(context: Context): Map<String, Long> { val json = context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE).getString(RhythmNativePolicyKeys.LAST_USAGE_ACCOUNTED_BY_PACKAGE_JSON, null) ?: return emptyMap(); val out = mutableMapOf<String, Long>(); try { val o = JSONObject(json); o.keys().forEach { out[it] = o.optLong(it) } } catch (_: Exception) {}; return out }
        fun saveAccountedWatermarks(context: Context, values: Map<String, Long>) { val o = JSONObject(); values.forEach { (k, v) -> o.put(k, v) }; context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE).edit().putString(RhythmNativePolicyKeys.LAST_USAGE_ACCOUNTED_BY_PACKAGE_JSON, o.toString()).apply() }
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

    private fun advanceWatermark(groupId: String, timestamp: Long) { val m = loadAccountedWatermarks(applicationContext).toMutableMap(); m[groupId] = maxOf(m[groupId] ?: 0L, timestamp); saveAccountedWatermarks(applicationContext, m) }
    private fun loadCooldownForPackage(packageName: String, now: Long) = loadCooldownPolicies(applicationContext).firstOrNull { packageName in it.packageNames && it.endsAt > now }
    private fun pruneExpiredCooldowns(now: Long) { saveCooldownPolicies(applicationContext, loadCooldownPolicies(applicationContext).filter { it.endsAt > now }) }
}
