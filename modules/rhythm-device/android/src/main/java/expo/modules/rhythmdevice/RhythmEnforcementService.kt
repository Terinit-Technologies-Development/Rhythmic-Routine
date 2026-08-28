package expo.modules.rhythmdevice

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.content.Intent
import android.view.accessibility.AccessibilityEvent

class RhythmEnforcementService : AccessibilityService() {

    override fun onServiceConnected() {
        super.onServiceConnected()
        isRunning = true
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

        val prefs = applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val restrictedSet = prefs.getStringSet(KEY_RESTRICTED_PACKAGES, emptySet()) ?: emptySet()

        if (restrictedSet.contains(packageName)) {
            val intent = Intent(this, RhythmOverlayActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra(EXTRA_PACKAGE_NAME, packageName)
            }
            startActivity(intent)
        }
    }

    override fun onInterrupt() {
        // Required lifecycle method
    }

    companion object {
        const val PREFS_NAME = "rhythm_restrictions"
        const val KEY_RESTRICTED_PACKAGES = "restricted_packages"
        const val EXTRA_PACKAGE_NAME = "extra_package_name"

        var isRunning = false
            private set
    }
}
