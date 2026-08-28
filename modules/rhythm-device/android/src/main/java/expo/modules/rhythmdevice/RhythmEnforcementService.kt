package expo.modules.rhythmdevice

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.content.Intent
import android.view.accessibility.AccessibilityEvent
import org.json.JSONArray
import org.json.JSONObject

data class NativeAccessLease(
    val groupId: String,
    val packageNames: Set<String>,
    val endsAt: Long
)

class RhythmEnforcementService : AccessibilityService() {

    override fun onServiceConnected() {
        super.onServiceConnected()
        isRunning = true
        pruneExpiredLeases(applicationContext)
    }

    override fun onDestroy() {
        super.onDestroy()
        isRunning = false
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

        val now = System.currentTimeMillis()
        if (isEffectivelyRestricted(applicationContext, packageName, now)) {
            val intent = Intent(this, RhythmOverlayActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra(RhythmNativePolicyKeys.EXTRA_PACKAGE_NAME, packageName)
            }
            startActivity(intent)
        }
    }

    override fun onInterrupt() {
        // Required lifecycle method
    }

    companion object {
        var isRunning = false
            private set

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
