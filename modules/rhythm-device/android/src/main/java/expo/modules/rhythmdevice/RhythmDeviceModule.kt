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
import android.net.Uri
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.text.ParsePosition
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

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
      val context = appContext.reactContext ?: return@AsyncFunction false
      val intent = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).apply {
        flags = Intent.FLAG_ACTIVITY_NEW_TASK
      }
      context.startActivity(intent)
      return@AsyncFunction true
    }

    AsyncFunction("requestRestrictionPermission") {
      val context = appContext.reactContext ?: return@AsyncFunction false
      val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).apply {
        flags = Intent.FLAG_ACTIVITY_NEW_TASK
      }
      context.startActivity(intent)
      return@AsyncFunction true
    }

    AsyncFunction("getInstalledApps") {
      val context = appContext.reactContext ?: return@AsyncFunction emptyList<Map<String, Any>>()
      val pm = context.packageManager
      val launcherIntent = Intent(Intent.ACTION_MAIN).apply {
        addCategory(Intent.CATEGORY_LAUNCHER)
      }

      val activities = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
        pm.queryIntentActivities(
          launcherIntent,
          PackageManager.ResolveInfoFlags.of(PackageManager.MATCH_ALL.toLong())
        )
      } else {
        @Suppress("DEPRECATION")
        pm.queryIntentActivities(launcherIntent, PackageManager.MATCH_ALL)
      }

      val packageMap = LinkedHashMap<String, Map<String, Any>>()
      val myPackageName = context.packageName

      for (resolveInfo in activities) {
        val appInfo = resolveInfo.activityInfo?.applicationInfo ?: continue
        val pkgName = appInfo.packageName ?: continue

        // Exclude Rhythm itself (both debug and QA package variants)
        if (pkgName == myPackageName) {
          continue
        }

        if (!packageMap.containsKey(pkgName)) {
          val appName = pm.getApplicationLabel(appInfo).toString()
          val category = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            val catInt = appInfo.category
            if (catInt >= 0) ApplicationInfo.getCategoryTitle(context, catInt)?.toString() ?: "App" else "App"
          } else {
            "App"
          }

          packageMap[pkgName] = mapOf(
            "packageName" to pkgName,
            "appName" to appName,
            "category" to category
          )
        }
      }

      // Sort case-insensitively by app label
      val sorted = packageMap.values.sortedBy {
        (it["appName"] as? String)?.lowercase() ?: ""
      }
      return@AsyncFunction sorted
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
      RhythmEnforcementService.instance?.onBaseRestrictionsChanged()
      return@AsyncFunction checkAccessibilityPermission(context)
    }

    AsyncFunction("setRiskGroupPolicies") { policiesList: List<Map<String, Any>> ->
      val context = appContext.reactContext ?: return@AsyncFunction false
      val parsedPolicies = policiesList.mapNotNull { item ->
        val groupId = item["groupId"] as? String ?: return@mapNotNull null
        val activity = item["recoveryActivity"] as? Map<*, *>
        NativeRiskGroupPolicy(
          groupId,
          item["groupName"] as? String ?: groupId,
          (item["packageNames"] as? List<*>)?.mapNotNull { it as? String }?.toSet() ?: emptySet(),
          maxOf(0, (item["allowanceMinutes"] as? Number)?.toInt() ?: 30),
          maxOf(0, (item["cooldownMinutes"] as? Number)?.toInt() ?: 0),
          NativeRecoveryActivity(
            activity?.get("id") as? String ?: "walk",
            activity?.get("title") as? String ?: "Take a short walk",
            activity?.get("subtitle") as? String ?: "Fresh air. Clear mind.",
            activity?.get("iconEmoji") as? String ?: "walk",
            activity?.get("durationSuggestion") as? String
          )
        )
      }
      RhythmEnforcementService.saveRiskGroupPolicies(context, parsedPolicies)
      RhythmEnforcementService.instance?.onRiskGroupPoliciesChanged()
      return@AsyncFunction true
    }

    AsyncFunction("getGroupUsageSnapshot") {
      val context = appContext.reactContext ?: return@AsyncFunction emptyList<Map<String, Any?>>()
      return@AsyncFunction groupSnapshots(context)
    }

    AsyncFunction("getGroupAllowanceSnapshot") {
      val context = appContext.reactContext ?: return@AsyncFunction emptyList<Map<String, Any?>>()
      return@AsyncFunction groupSnapshots(context)
    }

    AsyncFunction("reconcileGroupUsage") {
      val context = appContext.reactContext ?: return@AsyncFunction emptyList<Map<String, Any?>>()
      RhythmEnforcementService.instance?.reconcileUsage()
      return@AsyncFunction groupSnapshots(context)
    }

    AsyncFunction("setRoutineSchedule") { scheduleInput: Any ->
      val context = appContext.reactContext ?: return@AsyncFunction false
      val schedule = RhythmEnforcementService.parseRoutineScheduleInput(scheduleInput)
      RhythmEnforcementService.saveRoutineSchedule(context, schedule)
      RhythmEnforcementService.instance?.onRoutineScheduleChanged()
      return@AsyncFunction true
    }

    AsyncFunction("setCooldownPolicies") { policiesList: List<Map<String, Any>> ->
      val context = appContext.reactContext ?: return@AsyncFunction false
      val parsed = policiesList.mapNotNull {
        val gid = it["groupId"] as? String ?: return@mapNotNull null
        val endsAt = (it["endsAt"] as? Number)?.toLong() ?: return@mapNotNull null
        val pkgsList = (it["packageNames"] as? List<*>)?.mapNotNull { p -> p as? String }?.toSet() ?: emptySet()
        NativeCooldownPolicy(gid, pkgsList, endsAt)
      }
      // Expiry resets the ledger before any cooldown is removed or merged.
      RhythmEnforcementService.instance?.pruneExpiredCooldowns(System.currentTimeMillis())
      // A stale JS projection may not delete a native-created cooldown.
      val native = RhythmEnforcementService.loadCooldownPolicies(context)
      val merged = (native + parsed).groupBy { it.groupId }.map { (_, values) ->
        NativeCooldownPolicy(
          values.first().groupId,
          values.flatMap { it.packageNames }.toSet(),
          values.maxOf { it.endsAt }
        )
      }
      RhythmEnforcementService.saveCooldownPolicies(context, merged)
      RhythmEnforcementService.instance?.onCooldownPoliciesChanged()
      return@AsyncFunction true
    }

    AsyncFunction("getEnforcementDiagnostics") {
      val context = appContext.reactContext ?: return@AsyncFunction mapOf(
        "serviceRunning" to false,
        "baseRestrictedPackageCount" to 0,
        "activeLeaseCount" to 0,
        "overlayVisible" to false
      )
      val prefs = context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE)
      val baseSet = prefs.getStringSet(RhythmNativePolicyKeys.BASE_RESTRICTED_PACKAGES, emptySet()) ?: emptySet()
      val leases = RhythmEnforcementService.loadActiveLeases(context)
      val cooldowns = RhythmEnforcementService.loadCooldownPolicies(context)
      val schedule = RhythmEnforcementService.loadRoutineSchedule(context)
      val service = RhythmEnforcementService.instance
      val ledger = RhythmEnforcementService.loadGroupUsageLedger(context)
      val lastReconciledAt = prefs.getLong(RhythmNativePolicyKeys.LAST_USAGE_RECONCILED_AT, 0L)
      val watermarks = RhythmEnforcementService.loadAccountedWatermarks(context)

      val result = mutableMapOf<String, Any?>(
        "serviceRunning" to RhythmEnforcementService.isRunning,
        "baseRestrictedPackageCount" to baseSet.size,
        "activeLeaseCount" to leases.size,
        "cooldownCount" to cooldowns.size,
        "routineWindowCount" to schedule.windows.size,
        "overlayVisible" to RhythmOverlayActivity.isVisible,
        "groupUsageLedgerCount" to ledger.size
      )
      if (service?.lastForegroundPackage != null) {
        result["lastForegroundPackage"] = service.lastForegroundPackage
      }
      if (service?.lastInterventionPackage != null) {
        result["lastInterventionPackage"] = service.lastInterventionPackage
      }
      if (service?.lastInterventionAt != null && service.lastInterventionAt > 0L) {
        result["lastInterventionAt"] = service.lastInterventionAt.toDouble()
      }
      if (service?.activeUsagePackage != null) {
        result["activeUsagePackage"] = service.activeUsagePackage
      }
      if (service?.activeUsageGroup != null) {
        result["activeGroupId"] = service.activeUsageGroup
      }
      if (service?.activeUsageStartedAt != null && service.activeUsageStartedAt!! > 0L) {
        result["activeUsageStartedAt"] = service.activeUsageStartedAt!!.toDouble()
      }
      if (service?.allowanceDeadlineAt != null && service.allowanceDeadlineAt!! > 0L) {
        result["allowanceDeadlineAt"] = service.allowanceDeadlineAt!!.toDouble()
      }
      if (service?.activeUsageStartedAt != null && service.activeUsageStartedAt!! > 0L) {
        result["activeGroupUsageStartedAt"] = service.activeUsageStartedAt!!.toDouble()
      }
      if (service?.nextRoutineBoundaryAt != null && service.nextRoutineBoundaryAt!! > 0L) {
        result["nextRoutineBoundaryAt"] = service.nextRoutineBoundaryAt!!.toDouble()
      }
      if (service?.nextMidnightRolloverAt != null && service.nextMidnightRolloverAt!! > 0L) {
        result["nextMidnightRolloverAt"] = service.nextMidnightRolloverAt!!.toDouble()
      }
      if (service?.nearestCooldownExpiryAt != null && service.nearestCooldownExpiryAt!! > 0L) {
        result["nearestCooldownExpiryAt"] = service.nearestCooldownExpiryAt!!.toDouble()
      }
      if (lastReconciledAt > 0L) {
        result["lastUsageReconciledAt"] = lastReconciledAt.toDouble()
      }
      if (watermarks.isNotEmpty()) {
        result["accountedWatermarkCount"] = watermarks.size
      }
      return@AsyncFunction result
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

    AsyncFunction("isReaderAvailable") {
      val context = appContext.reactContext ?: return@AsyncFunction false
      val pm = context.packageManager
      try {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
          pm.getPackageInfo("com.terinit.rhythmicreader", PackageManager.PackageInfoFlags.of(0L))
        } else {
          @Suppress("DEPRECATION")
          pm.getPackageInfo("com.terinit.rhythmicreader", 0)
        }
        true
      } catch (_: PackageManager.NameNotFoundException) {
        false
      }
    }

    AsyncFunction("startRecoverySession") { sessionId: String, requiredSeconds: Int, requiredPages: Int, createdAt: Double, expiresAt: Double ->
      val context = appContext.reactContext ?: return@AsyncFunction false
      try {
        val intent = Intent("com.terinit.rhythmicreader.action.START_RECOVERY").apply {
          setClassName("com.terinit.rhythmicreader", "com.terinit.rhythmicreader.integration.rhythmic.RecoveryEntryActivity")
          putExtra("recovery.session_id", sessionId)
          putExtra("recovery.protocol_version", 1)
          putExtra("recovery.required_seconds", requiredSeconds)
          putExtra("recovery.required_pages", requiredPages)
          putExtra("recovery.created_at", createdAt.toLong())
          putExtra("recovery.expires_at", expiresAt.toLong())
          flags = Intent.FLAG_ACTIVITY_NEW_TASK
        }
        context.startActivity(intent)
        true
      } catch (e: Exception) {
        false
      }
    }

    AsyncFunction("queryRecoveryStatus") { sessionId: String ->
      val context = appContext.reactContext ?: return@AsyncFunction null
      val uri = android.net.Uri.parse("content://com.terinit.rhythmicreader.recovery/sessions/$sessionId")
      try {
        context.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
          if (cursor.moveToFirst()) {
            val sid = cursor.getString(cursor.getColumnIndexOrThrow("sessionId"))
            val proto = cursor.getInt(cursor.getColumnIndexOrThrow("protocolVersion"))
            val status = cursor.getString(cursor.getColumnIndexOrThrow("status"))
            val activeSec = cursor.getInt(cursor.getColumnIndexOrThrow("activeSeconds"))
            val qualifiedPages = cursor.getInt(cursor.getColumnIndexOrThrow("qualifiedPages"))
            val completedAt = cursor.getLong(cursor.getColumnIndexOrThrow("completedAtEpochMs"))

            mapOf(
              "sessionId" to sid,
              "protocolVersion" to proto,
              "status" to status,
              "activeSeconds" to activeSec,
              "qualifiedPages" to qualifiedPages,
              "completedAtEpochMs" to completedAt.toDouble()
            )
          } else {
            null
          }
        }
      } catch (e: Exception) {
        null
      }
    }

    AsyncFunction("queryDailyReadingEvidence") { dateKey: String ->
      val context = appContext.reactContext
        ?: return@AsyncFunction unavailableDailyEvidence(dateKey)
      if (!isValidLocalDateKey(dateKey)) {
        return@AsyncFunction unavailableDailyEvidence(dateKey)
      }

      val uri = Uri.Builder()
        .scheme("content")
        .authority("com.terinit.rhythmicreader.evidence")
        .appendPath("daily")
        .appendPath(dateKey)
        .build()
      val projection = arrayOf(
        "protocolVersion",
        "dateKey",
        "verifiedActiveSeconds",
        "qualifiedPages",
        "updatedAtEpochMs"
      )

      try {
        val cursor = context.contentResolver.query(uri, projection, null, null, null)
          ?: return@AsyncFunction unavailableDailyEvidence(dateKey)
        cursor.use {
          // Reader defines an empty cursor for a valid date with no evidence.
          // Preserve that distinction from provider/query failure.
          if (!it.moveToFirst()) {
            return@AsyncFunction mapOf(
              "providerAvailable" to true,
              "protocolCompatible" to true,
              "protocolVersion" to 2,
              "dateKey" to dateKey,
              "verifiedActiveSeconds" to 0,
              "qualifiedPages" to 0,
              "updatedAtEpochMs" to 0
            )
          }

          val protocolIndex = it.getColumnIndex("protocolVersion")
          val dateIndex = it.getColumnIndex("dateKey")
          val secondsIndex = it.getColumnIndex("verifiedActiveSeconds")
          val pagesIndex = it.getColumnIndex("qualifiedPages")
          val updatedIndex = it.getColumnIndex("updatedAtEpochMs")
          if (protocolIndex < 0 || dateIndex < 0 || secondsIndex < 0 || pagesIndex < 0 || updatedIndex < 0) {
            return@AsyncFunction unavailableDailyEvidence(dateKey)
          }

          val protocolVersion = it.getInt(protocolIndex)
          val returnedDateKey = it.getString(dateIndex) ?: ""
          val seconds = it.getLong(secondsIndex)
          val pages = it.getLong(pagesIndex)
          val updatedAt = it.getLong(updatedIndex)
          val compatible = protocolVersion == 2 &&
            returnedDateKey == dateKey &&
            seconds >= 0L && pages in 0L..Int.MAX_VALUE.toLong() && updatedAt >= 0L

          mapOf(
            "providerAvailable" to true,
            "protocolCompatible" to compatible,
            "protocolVersion" to protocolVersion,
            "dateKey" to returnedDateKey,
            "verifiedActiveSeconds" to if (compatible) seconds.toDouble() else 0.0,
            "qualifiedPages" to if (compatible) pages.toInt() else 0,
            "updatedAtEpochMs" to if (compatible) updatedAt.toDouble() else 0.0
          )
        }
      } catch (_: Exception) {
        unavailableDailyEvidence(dateKey)
      }
    }
  }

  private fun unavailableDailyEvidence(dateKey: String): Map<String, Any> = mapOf(
    "providerAvailable" to false,
    "protocolCompatible" to false,
    "dateKey" to dateKey,
    "verifiedActiveSeconds" to 0,
    "qualifiedPages" to 0,
    "updatedAtEpochMs" to 0
  )

  private fun isValidLocalDateKey(dateKey: String): Boolean {
    if (!dateKey.matches(Regex("\\d{4}-\\d{2}-\\d{2}"))) return false
    val formatter = SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).apply {
      isLenient = false
      timeZone = TimeZone.getTimeZone("UTC")
    }
    val position = ParsePosition(0)
    val date = formatter.parse(dateKey, position) ?: return false
    return position.index == dateKey.length && formatter.format(date) == dateKey
  }

  private fun groupSnapshots(context: Context): List<Map<String, Any?>> {
    val now = System.currentTimeMillis()
    val ledger = RhythmEnforcementService.loadGroupUsageLedger(context)
    val cooldowns = RhythmEnforcementService.loadCooldownPolicies(context)
    return RhythmEnforcementService.loadRiskGroupPolicies(context).map { policy ->
      val usage = ledger[policy.groupId]
      val usedMillis = if (usage?.dateKey == RhythmEnforcementService.getLocalDateKey(now)) {
        usage.usedMillis + if (usage.activeSegmentStartedAt != null) maxOf(0L, now - usage.activeSegmentStartedAt) else 0L
      } else 0L
      val allowanceSeconds = policy.allowanceMinutes * 60
      mutableMapOf<String, Any?>(
        "groupId" to policy.groupId,
        "dateKey" to RhythmEnforcementService.getLocalDateKey(now),
        "usedSeconds" to (usedMillis / 1000L).toInt(),
        "allowanceMinutes" to policy.allowanceMinutes,
        "remainingSeconds" to maxOf(0, allowanceSeconds - (usedMillis / 1000L).toInt()),
        "exhausted" to (usage?.exhaustedAt != null || policy.allowanceMinutes == 0 || usedMillis >= policy.allowanceMinutes * 60_000L),
        "cooldownEndsAt" to cooldowns.firstOrNull { it.groupId == policy.groupId && it.endsAt > now }?.endsAt,
        "cycleRevision" to (usage?.cycleRevision ?: 0L)
      )
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
