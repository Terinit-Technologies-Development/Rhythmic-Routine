package expo.modules.rhythmdevice

import android.accessibilityservice.AccessibilityServiceInfo
import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Process
import android.provider.Settings
import android.view.accessibility.AccessibilityManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class RhythmDeviceModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("RhythmDevice")

    AsyncFunction("checkPermissions") {
      val context = appContext.reactContext ?: return@AsyncFunction mapOf(
        "hasUsagePermission" to false,
        "hasRestrictionPermission" to false,
        "familyControlsStatus" to "unsupported"
      )

      val hasUsage = checkUsageStatsPermission(context)
      val hasRestriction = checkAccessibilityPermission(context)

      return@AsyncFunction mapOf(
        "hasUsagePermission" to hasUsage,
        "hasRestrictionPermission" to hasRestriction,
        "familyControlsStatus" to "unsupported"
      )
    }

    AsyncFunction("requestUsagePermission") {
      val context = appContext.reactContext ?: return@AsyncFunction
      val intent = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).apply {
        flags = Intent.FLAG_ACTIVITY_NEW_TASK
      }
      context.startActivity(intent)
    }

    AsyncFunction("requestRestrictionPermission") {
      val context = appContext.reactContext ?: return@AsyncFunction
      val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).apply {
        flags = Intent.FLAG_ACTIVITY_NEW_TASK
      }
      context.startActivity(intent)
    }

    AsyncFunction("getInstalledApps") {
      val context = appContext.reactContext ?: return@AsyncFunction emptyList<Map<String, Any>>()
      val pm = context.packageManager
      val packages = pm.getInstalledApplications(PackageManager.GET_META_DATA)

      val result = mutableListOf<Map<String, Any>>()
      for (appInfo in packages) {
        // Filter out system apps without launcher intent
        val isSystem = (appInfo.flags and ApplicationInfo.FLAG_SYSTEM) != 0
        val isUpdatedSystem = (appInfo.flags and ApplicationInfo.FLAG_UPDATED_SYSTEM_APP) != 0
        if (!isSystem || isUpdatedSystem || pm.getLaunchIntentForPackage(appInfo.packageName) != null) {
          val appName = pm.getApplicationLabel(appInfo).toString()
          result.add(
            mapOf(
              "packageName" to appInfo.packageName,
              "appName" to appName,
              "category" to (appInfo.category.toString())
            )
          )
        }
      }
      return@AsyncFunction result
    }

    AsyncFunction("queryUsageEvents") { startTime: Double, endTime: Double ->
      val context = appContext.reactContext ?: return@AsyncFunction emptyList<Map<String, Any>>()
      val manager = context.getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager
        ?: return@AsyncFunction emptyList<Map<String, Any>>()

      val events = manager.queryEvents(startTime.toLong(), endTime.toLong())
      val result = mutableListOf<Map<String, Any>>()
      val event = UsageEvents.Event()

      while (events.hasNextEvent()) {
        events.getNextEvent(event)
        val eventType = when (event.eventType) {
          UsageEvents.Event.ACTIVITY_RESUMED,
          UsageEvents.Event.MOVE_TO_FOREGROUND -> "foreground"
          UsageEvents.Event.ACTIVITY_PAUSED,
          UsageEvents.Event.ACTIVITY_STOPPED,
          UsageEvents.Event.MOVE_TO_BACKGROUND -> "background"
          else -> null
        }

        if (eventType != null) {
          result.add(
            mapOf(
              "packageName" to event.packageName,
              "timestamp" to event.timeStamp.toDouble(),
              "eventType" to eventType
            )
          )
        }
      }
      return@AsyncFunction result
    }

    AsyncFunction("setBaseRestrictions") { packageNames: List<String> ->
      val context = appContext.reactContext ?: return@AsyncFunction false
      val prefs = context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE)
      prefs.edit().putStringSet(RhythmNativePolicyKeys.BASE_RESTRICTED_PACKAGES, packageNames.toSet()).apply()
      return@AsyncFunction checkAccessibilityPermission(context)
    }

    AsyncFunction("applyShieldRestrictions") { _: List<String> ->
      val context = appContext.reactContext ?: return@AsyncFunction false
      // Base restrictions are written exclusively through setBaseRestrictions(...)
      return@AsyncFunction checkAccessibilityPermission(context)
    }

    AsyncFunction("clearShieldRestrictions") { _: List<String> ->
      val context = appContext.reactContext ?: return@AsyncFunction false
      // Base restrictions are written exclusively through setBaseRestrictions(...)
      return@AsyncFunction checkAccessibilityPermission(context)
    }

    AsyncFunction("startAccessLease") { groupId: String, packageNames: List<String>, endsAt: Double ->
      val context = appContext.reactContext ?: return@AsyncFunction false
      val now = System.currentTimeMillis()
      val prefs = context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE)
      val leasesJson = prefs.getString(RhythmNativePolicyKeys.ACCESS_LEASES_JSON, null)
      val (existingLeases, _) = if (leasesJson != null) RhythmEnforcementService.parseAndPruneLeases(leasesJson, now) else Pair(emptyList(), false)

      val updatedList = existingLeases.filter { it.groupId != groupId }.toMutableList()
      val newLease = NativeAccessLease(groupId, packageNames.toSet(), endsAt.toLong())
      updatedList.add(newLease)
      RhythmEnforcementService.saveLeases(context, updatedList)
      RhythmEnforcementService.instance?.scheduleLeaseExpiry(newLease)
      return@AsyncFunction true
    }

    AsyncFunction("endAccessLease") { groupId: String ->
      val context = appContext.reactContext ?: return@AsyncFunction false
      val now = System.currentTimeMillis()
      val prefs = context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE)
      val leasesJson = prefs.getString(RhythmNativePolicyKeys.ACCESS_LEASES_JSON, null)
      val (existingLeases, _) = if (leasesJson != null) RhythmEnforcementService.parseAndPruneLeases(leasesJson, now) else Pair(emptyList(), false)

      val updatedList = existingLeases.filter { it.groupId != groupId }
      RhythmEnforcementService.saveLeases(context, updatedList)
      RhythmEnforcementService.instance?.cancelLeaseExpiry(groupId)
      return@AsyncFunction true
    }
  }

  private fun checkUsageStatsPermission(context: Context): Boolean {
    val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as? AppOpsManager ?: return false
    val mode = appOps.checkOpNoThrow(
      AppOpsManager.OPSTR_GET_USAGE_STATS,
      Process.myUid(),
      context.packageName
    )
    return mode == AppOpsManager.MODE_ALLOWED
  }

  private fun checkAccessibilityPermission(context: Context): Boolean {
    val am = context.getSystemService(Context.ACCESSIBILITY_SERVICE) as? AccessibilityManager ?: return false
    val enabledServices = am.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK)
    val expectedServiceName = "${context.packageName}/${RhythmEnforcementService::class.java.name}"
    for (service in enabledServices) {
      if (service.id.equals(expectedServiceName, ignoreCase = true) || service.id.endsWith(RhythmEnforcementService::class.java.simpleName)) {
        return true
      }
    }
    return false
  }
}
