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

data class NativeAccessLease(
    val groupId: String,
    val packageNames: Set<String>,
    val endsAt: Long
)

class RhythmEnforcementService : AccessibilityService() {

    private val mainHandler = Handler(Looper.getMainLooper())
    private val leaseCallbacks = mutableMapOf<String, Runnable>()

    var lastForegroundPackage: String? = null
        private set

    var lastInterventionPackage: String? = null
        private set

    var lastInterventionAt: Long = 0L
        private set

    override fun onServiceConnected() {
        super.onServiceConnected()
        isRunning = true
        instance = this
        Log.i(TAG, "RhythmEnforcementService connected")

        val activeLeases = loadActiveLeases(applicationContext, System.currentTimeMillis())
        for (lease in activeLeases) {
            scheduleLeaseExpiry(lease)
        }
    }

    override fun onDestroy() {
        Log.i(TAG, "RhythmEnforcementService destroying")
        for (callback in leaseCallbacks.values) {
            mainHandler.removeCallbacks(callback)
        }
        leaseCallbacks.clear()
        isRunning = false
        instance = null
        super.onDestroy()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null || event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            return
        }

        val packageName = event.packageName?.toString() ?: return

        // Skip our own app, launcher, and system UI
        if (packageName == applicationContext.packageName || packageName.startsWith("com.android.systemui")) {
            return
        }

        lastForegroundPackage = packageName

        pruneExpiredLeases(applicationContext)

        val now = System.currentTimeMillis()
        if (isEffectivelyRestricted(applicationContext, packageName, now)) {
            presentIntervention(packageName)
        }
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

            // Stale callback protection: ensure lease wasn't replaced/extended
            val currentLeases = loadActiveLeases(applicationContext, System.currentTimeMillis())
            val currentLease = currentLeases.find { it.groupId == lease.groupId }
            if (currentLease == null || currentLease.endsAt <= scheduledEndsAt) {
                val foreground = lastForegroundPackage ?: resolveRecentForegroundPackage()
                if (foreground != null && isEffectivelyRestricted(applicationContext, foreground, System.currentTimeMillis())) {
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

        fun loadActiveLeases(context: Context, now: Long = System.currentTimeMillis()): List<NativeAccessLease> {
            val prefs = context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE)
            val leasesJson = prefs.getString(RhythmNativePolicyKeys.ACCESS_LEASES_JSON, null) ?: return emptyList()
            val (activeLeases, hasExpired) = parseAndPruneLeases(leasesJson, now)
            if (hasExpired) {
                saveLeases(context, activeLeases)
            }
            return activeLeases
        }

        fun isEffectivelyRestricted(context: Context, packageName: String, now: Long = System.currentTimeMillis()): Boolean {
            val prefs = context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE)
            val baseSet = prefs.getStringSet(RhythmNativePolicyKeys.BASE_RESTRICTED_PACKAGES, emptySet()) ?: emptySet()
            if (!baseSet.contains(packageName)) {
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
    }
}
