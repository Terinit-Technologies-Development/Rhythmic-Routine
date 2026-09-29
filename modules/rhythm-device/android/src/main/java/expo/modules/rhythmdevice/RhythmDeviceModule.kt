package expo.modules.rhythmdevice

import android.accessibilityservice.AccessibilityServiceInfo
import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Process
import android.provider.Settings
import android.view.accessibility.AccessibilityManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

internal fun finishNativePolicyReset(cleared: Boolean, resetRuntime: () -> Unit): Boolean {
  if (!cleared) return false
  resetRuntime()
  return true
}

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
      val saved = prefs.edit().putStringSet(RhythmNativePolicyKeys.BASE_RESTRICTED_PACKAGES, packageNames.toSet()).commit()
      RhythmEnforcementService.instance?.onBaseRestrictionsChanged()
      // Honest save semantics: the write result, not a capability report.
      return@AsyncFunction saved
    }

    AsyncFunction("resetEnforcementState") {
      val context = appContext.reactContext ?: return@AsyncFunction false
      val cleared = context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE)
        .edit()
        .clear()
        .commit()
      return@AsyncFunction finishNativePolicyReset(cleared) {
        RhythmEnforcementService.instance?.onNativePolicyReset()
      }
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

    AsyncFunction("setAttentionExchangePolicy") { input: Map<String, Any> ->
      val context = appContext.reactContext ?: return@AsyncFunction false
      val policy = NativeReadingAttentionPolicy(
        freeCooldownCount = (input["freeCooldownCount"] as? Number)?.toInt() ?: 2,
        baselineActiveSeconds = (input["baselineActiveSeconds"] as? Number)?.toLong() ?: 3600L,
        baselineQualifiedPages = (input["baselineQualifiedPages"] as? Number)?.toInt() ?: 36,
        incrementalActiveSeconds = (input["incrementalActiveSeconds"] as? Number)?.toLong() ?: 1800L,
        incrementalQualifiedPages = (input["incrementalQualifiedPages"] as? Number)?.toInt() ?: 11,
      )
      return@AsyncFunction RhythmEnforcementService.saveAttentionPolicy(context, policy)
    }

    AsyncFunction("setAttentionExchangeState") { snapshot: Map<String, Any?> ->
      val context = appContext.reactContext ?: return@AsyncFunction false
      return@AsyncFunction RhythmEnforcementService.syncAttentionExchangeState(context, snapshot, System.currentTimeMillis())
    }

    AsyncFunction("getAttentionExchangeSnapshot") {
      val context = appContext.reactContext ?: return@AsyncFunction null
      val now = System.currentTimeMillis()
      RhythmEnforcementService.reconcileAttentionExchangeInContext(context, now)
      return@AsyncFunction attentionExchangeSnapshot(context, now)
    }

    AsyncFunction("reconcileAttentionExchange") {
      val context = appContext.reactContext ?: return@AsyncFunction false
      return@AsyncFunction RhythmEnforcementService.reconcileAttentionExchangeInContext(context, System.currentTimeMillis())
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
        NativeCooldownPolicy(
          groupId = gid,
          packageNames = pkgsList,
          startedAt = (it["startedAt"] as? Number)?.toLong() ?: 0L,
          endsAt = endsAt,
          attentionDateKey = it["attentionDateKey"] as? String,
          dailyCooldownOrdinal = (it["dailyCooldownOrdinal"] as? Number)?.toInt(),
          requiredReadingSeconds = (it["requiredReadingSeconds"] as? Number)?.toLong() ?: 0L,
          requiredQualifiedPages = (it["requiredQualifiedPages"] as? Number)?.toInt() ?: 0,
        )
      }
      val normalized = parsed.groupBy { it.groupId }.values.map { values ->
        val latest = values.maxBy { it.endsAt }
        latest.copy(
          packageNames = values.flatMap { it.packageNames }.toSet(),
          endsAt = values.maxOf { it.endsAt },
        )
      }
      val now = System.currentTimeMillis()
      RhythmEnforcementService.instance?.pruneExpiredCooldowns(now)
      return@AsyncFunction RhythmEnforcementService.mergeCooldownPoliciesFromJs(context, normalized, now)
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
      val attentionState = RhythmEnforcementService.loadAttentionExchangeState(context)
      val gates = RhythmEnforcementService.loadReadingGates(context).values
        .filter { it.attentionDateKey == RhythmEnforcementService.getLocalDateKey() }
      val evidence = RhythmEnforcementService.loadDailyReadingEvidence(context)
        ?.takeIf { it.dateKey == RhythmEnforcementService.getLocalDateKey() }
      // Blocker remediation: projection-proof of what native enforcement
      // actually holds (bounded sample only; never the installed-app inventory).
      val riskPolicies = RhythmEnforcementService.loadRiskGroupPolicies(context)
      val riskPackages = riskPolicies.flatMap { it.packageNames }.toSet()
      val routineRiskPackages = schedule.allRiskPackages

      val result = mutableMapOf<String, Any?>(
        "serviceRunning" to RhythmEnforcementService.isRunning,
        "baseRestrictedPackageCount" to baseSet.size,
        "activeLeaseCount" to leases.size,
        "cooldownCount" to cooldowns.size,
        "routineWindowCount" to schedule.windows.size,
        "overlayVisible" to RhythmOverlayActivity.isVisible,
        "groupUsageLedgerCount" to ledger.size,
        "attentionDateKey" to attentionState.dateKey,
        "dailyCooldownOrdinal" to attentionState.cooldownsTriggered,
        "readingGateCount" to gates.size,
        "readerProviderAvailable" to evidence?.providerAvailable,
        "readerProtocolCompatible" to evidence?.protocolCompatible,
        "riskPolicyCount" to riskPolicies.size,
        "riskPackageCount" to riskPackages.size,
        "routineRiskPackageCount" to routineRiskPackages.size,
        "riskPackageSample" to riskPackages.sorted().take(10),
      )
      val foregroundPolicy = service?.lastForegroundPackage?.let { pkg ->
        RhythmEnforcementService.loadRiskGroupPolicies(context).firstOrNull { pkg in it.packageNames }
      }
      val primaryGate = foregroundPolicy?.let { policy -> gates.firstOrNull { it.groupId == policy.groupId } }
        ?: gates.maxByOrNull { it.dailyCooldownOrdinal }
      if (primaryGate != null) {
        result["activeReadingGateGroupId"] = primaryGate.groupId
        result["activeReadingGateOrdinal"] = primaryGate.dailyCooldownOrdinal
        result["activeReadingRequiredSeconds"] = primaryGate.requiredReadingSeconds
        result["activeReadingRequiredPages"] = primaryGate.requiredQualifiedPages
      }
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

    /**
     * QA-only (debuggable builds): seeds the group usage ledger to its allowance
     * boundary and re-enters the PRODUCTION allowance-exhaustion transition.
     * Every returned field is read back from production-allocated state — the
     * hook never constructs cooldowns, ordinals, gates, or evidence.
     */
    AsyncFunction("seedGroupAllowanceExhaustionForQa") { groupId: String, packageName: String ->
      val context = appContext.reactContext ?: return@AsyncFunction mapOf<String, Any?>(
        "enabled" to false,
        "error" to "no-react-context"
      )
      val service = RhythmEnforcementService.instance ?: return@AsyncFunction mapOf<String, Any?>(
        "enabled" to false,
        "error" to "enforcement-service-not-bound"
      )
      return@AsyncFunction service.runQaAllowanceExhaustion(groupId, packageName)
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

    AsyncFunction("isMeditationAvailable") {
      val context = appContext.reactContext ?: return@AsyncFunction "unavailable"
      return@AsyncFunction MeditationStatusProviderClient.availabilityString(
        MeditationStatusProviderClient.checkAvailability(context)
      )
    }

    AsyncFunction("startMeditationRecoverySession") { request: Map<String, Any?> ->
      val context = appContext.reactContext ?: return@AsyncFunction false
      if (CompanionTrust.verify(context, MeditationContract.MEDITATION_PACKAGE) != CompanionTrustResult.TRUSTED) {
        return@AsyncFunction false
      }
      try {
        val intent = MeditationContract.buildRecoveryIntent(request) ?: return@AsyncFunction false
        context.startActivity(intent)
        true
      } catch (_: Exception) {
        false
      }
    }

    AsyncFunction("queryMeditationStatus") { sessionId: String ->
      val context = appContext.reactContext ?: return@AsyncFunction null
      val result = MeditationStatusProviderClient.query(context, sessionId)
      return@AsyncFunction result.evidence?.let { meditationEvidenceMap(it) }
    }

    AsyncFunction("queryDailyReadingEvidence") { dateKey: String ->
      val context = appContext.reactContext
        ?: return@AsyncFunction unavailableDailyEvidence(dateKey)
      return@AsyncFunction evidenceMap(RhythmEnforcementService.queryDailyReadingEvidence(context, dateKey))
    }

    AsyncFunction("openRhythmicReader") {
      val context = appContext.reactContext ?: return@AsyncFunction false
      try {
        val launchIntent = context.packageManager.getLaunchIntentForPackage("com.terinit.rhythmicreader")
          ?: return@AsyncFunction false
        launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(launchIntent)
        true
      } catch (_: Exception) {
        false
      }
    }
  }

  private fun unavailableDailyEvidence(dateKey: String): Map<String, Any> =
    evidenceMap(DailyReadingEvidenceProviderClient.unavailable(dateKey))

  private fun evidenceMap(evidence: NativeDailyReadingEvidenceResult): Map<String, Any> = buildMap {
    put("providerAvailable", evidence.providerAvailable)
    put("protocolCompatible", evidence.protocolCompatible)
    evidence.protocolVersion?.let { put("protocolVersion", it) }
    put("dateKey", evidence.dateKey)
    put("verifiedActiveSeconds", evidence.verifiedActiveSeconds.toDouble())
    put("qualifiedPages", evidence.qualifiedPages)
    put("updatedAtEpochMs", evidence.updatedAtEpochMs.toDouble())
  }

  private fun meditationEvidenceMap(evidence: NativeMeditationSessionEvidence): Map<String, Any?> = buildMap {
    put(MeditationContract.COLUMN_SESSION_ID, evidence.sessionId)
    put(MeditationContract.COLUMN_PROTOCOL_VERSION, evidence.protocolVersion)
    put(MeditationContract.COLUMN_STATUS, evidence.status)
    put(MeditationContract.COLUMN_REQUIRED_QUALIFIED_SECONDS, evidence.requiredQualifiedSeconds)
    put(MeditationContract.COLUMN_COMPLETED_QUALIFIED_SECONDS, evidence.completedQualifiedSeconds)
    put(MeditationContract.COLUMN_COMPLETED_AT_EPOCH_MS, evidence.completedAtEpochMs?.toDouble())
    put(MeditationContract.COLUMN_LAST_UPDATED_AT_EPOCH_MS, evidence.lastUpdatedAtEpochMs?.toDouble())
  }

  private fun attentionExchangeSnapshot(context: Context, now: Long): Map<String, Any?> {
    val dateKey = RhythmEnforcementService.getLocalDateKey(now)
    val state = RhythmEnforcementService.loadAttentionExchangeState(context, now)
    val cooldowns = RhythmEnforcementService.loadCooldownPolicies(context)
      .filter { it.endsAt > now }
      .map { cooldown ->
        buildMap<String, Any> {
          put("groupId", cooldown.groupId)
          put("packageNames", cooldown.packageNames.sorted())
          put("startedAt", cooldown.startedAt.toDouble())
          put("endsAt", cooldown.endsAt.toDouble())
          cooldown.attentionDateKey?.let { put("attentionDateKey", it) }
          cooldown.dailyCooldownOrdinal?.let { put("dailyCooldownOrdinal", it) }
          put("requiredReadingSeconds", cooldown.requiredReadingSeconds.toDouble())
          put("requiredQualifiedPages", cooldown.requiredQualifiedPages)
        }
      }
    val gates = RhythmEnforcementService.loadReadingGates(context).values
      .filter { it.attentionDateKey == dateKey }
      .map { gate ->
        mapOf(
          "groupId" to gate.groupId,
          "attentionDateKey" to gate.attentionDateKey,
          "dailyCooldownOrdinal" to gate.dailyCooldownOrdinal,
          "createdAt" to gate.createdAt.toDouble(),
          "cooldownEndsAt" to gate.cooldownEndsAt.toDouble(),
          "requiredReadingSeconds" to gate.requiredReadingSeconds.toDouble(),
          "requiredQualifiedPages" to gate.requiredQualifiedPages,
        )
      }
    val result = mutableMapOf<String, Any?>(
      "attentionStateInitialized" to context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE)
        .contains(RhythmNativePolicyKeys.ATTENTION_EXCHANGE_STATE_JSON),
      "dateKey" to state.dateKey,
      "cooldownsTriggered" to state.cooldownsTriggered,
      "highestRequiredActiveSeconds" to state.highestRequiredActiveSeconds.toDouble(),
      "highestRequiredQualifiedPages" to state.highestRequiredQualifiedPages,
      "cooldowns" to cooldowns,
      "readingGates" to gates,
      "groupUsage" to groupSnapshots(context),
      "activeAccessLeases" to RhythmEnforcementService.loadActiveLeases(context, now).map { lease ->
        mapOf("groupId" to lease.groupId, "packageNames" to lease.packageNames.sorted(), "endsAt" to lease.endsAt.toDouble())
      },
      "updatedAt" to now.toDouble(),
    )
    val foregroundPackage = RhythmEnforcementService.instance?.lastForegroundPackage
    val foregroundGroup = foregroundPackage?.let { pkg ->
      RhythmEnforcementService.loadRiskGroupPolicies(context).firstOrNull { pkg in it.packageNames }?.groupId
    }
    if (foregroundGroup != null) result["foregroundGroupId"] = foregroundGroup
    RhythmEnforcementService.loadDailyReadingEvidence(context)
      ?.takeIf { it.dateKey == dateKey }
      ?.let { result["evidence"] = evidenceMap(it) }
    return result
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

  /**
   * Verifies that Routine's OWN enforcement service is enabled. Two sources:
   * the AccessibilityManager service list (primary) and the system secure
   * settings value (compatibility fallback for OEM builds where the manager
   * list is filtered while the service is genuinely enabled and bound). Both
   * must identify Routine's exact service — never "any accessibility service".
   */
  private fun checkAccessibilityPermission(context: Context): Boolean {
    val expected = ComponentName(context, RhythmEnforcementService::class.java)

    val managerMatch = (
      context.getSystemService(Context.ACCESSIBILITY_SERVICE) as? AccessibilityManager
    )
      ?.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK)
      ?.any { info ->
        val serviceInfo = info.resolveInfo?.serviceInfo
        serviceInfo != null &&
          ComponentName(serviceInfo.packageName, serviceInfo.name) == expected
      } == true

    if (managerMatch) return true

    val accessibilityEnabled = Settings.Secure.getInt(
      context.contentResolver,
      Settings.Secure.ACCESSIBILITY_ENABLED,
      0
    ) == 1

    if (!accessibilityEnabled) return false

    val enabled = Settings.Secure.getString(
      context.contentResolver,
      Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
    ).orEmpty()

    return enabledServiceListContains(enabled, expected.flattenToString())
  }
}

/**
 * Normalizes one ENABLED_ACCESSIBILITY_SERVICES entry to "package/class" and
 * compares against the expected flattened ComponentName. Relative class names
 * (".Service") are expanded against the entry's package. Pure — unit-testable
 * without Android framework classes.
 */
internal fun enabledServiceListContains(enabledServices: String, expectedFlattened: String): Boolean {
  val expected = expectedFlattened.trim()
  return enabledServices.split(':')
    .mapNotNull { normalizeEnabledServiceEntry(it) }
    .any { it.equals(expected, ignoreCase = true) }
}

internal fun normalizeEnabledServiceEntry(entry: String): String? {
  val trimmed = entry.trim()
  if (trimmed.isEmpty()) return null
  val separator = trimmed.indexOf('/')
  if (separator <= 0 || separator == trimmed.length - 1) return null
  val pkg = trimmed.substring(0, separator)
  var cls = trimmed.substring(separator + 1)
  if (cls.startsWith(".")) cls = pkg + cls
  return "$pkg/$cls"
}
