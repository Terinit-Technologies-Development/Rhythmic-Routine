package com.terinit.rhythmicroutine.sw005probe

import android.content.Context
import android.os.Bundle
import androidx.test.platform.app.InstrumentationRegistry
import expo.modules.rhythmdevice.RestorativeEnforcement
import expo.modules.rhythmdevice.RhythmEnforcementService
import expo.modules.rhythmdevice.RhythmNativePolicyKeys
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * SW-2026-005 C3 TEST-ONLY read-only native snapshot probe.
 *
 * Reads the already-persisted Routine native policy projection and emits ONE
 * compact JSON line via the instrumentation status Bundle. It performs no
 * writes, no reset, no seeding, no reconciliation, no activity launch and no
 * accessibility/permission change. Every API used below is a public
 * read accessor (RestorativeEnforcement.load/toJson, shared-preference reads).
 *
 * Scope guards: no managed/essential package inventory, no usage history and
 * no allRiskPackages. Only counts plus two watched-package booleans.
 */
class NativeSnapshotProbeTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private val context get() = instrumentation.targetContext

    @Test
    fun readOnlyNativeSnapshot() {
        // Guard against running the probe against the wrong AUT: a snapshot of
        // an empty probe-app policy store must never be reported as Routine's.
        assertEquals(EXPECTED_TARGET_PACKAGE, context.packageName)

        val now = System.currentTimeMillis()
        val todayKey = RhythmEnforcementService.getLocalDateKey(now)
        val restorative = RestorativeEnforcement.load(context)
        val persisted = RestorativeEnforcement.toJson(restorative)
        val service = RhythmEnforcementService.instance
        val cooldowns = RhythmEnforcementService.loadCooldownPolicies(context)
        val gates = RhythmEnforcementService.loadCurrentAttentionReadingGates(context, now)
        val prefs = context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE)

        val root = JSONObject()
        root.put("marker", MARKER)
        root.put("nowEpochMs", now)
        root.put("localDateKey", todayKey)
        root.put("targetPackage", context.packageName)

        val serviceJson = JSONObject()
        serviceJson.put("serviceRunning", RhythmEnforcementService.isRunning)
        serviceJson.put("serviceInstancePresent", service != null)
        service?.lastForegroundPackage?.let { serviceJson.put("lastForegroundPackage", it) }
        service?.lastInterventionPackage?.let { serviceJson.put("lastInterventionPackage", it) }
        service?.nextRoutineBoundaryAt?.takeIf { it > 0L }
            ?.let { serviceJson.put("nextRoutineBoundaryAt", it) }
        root.put("service", serviceJson)

        // attentionDay / morningMeditation / morningRequirements / morningMigration
        // are the only accepted projection fields; everything else is discarded.
        val persistedAttentionDay = persisted.optJSONObject("attentionDay")
        val attentionDay = persistedAttentionDay ?: run {
            val day = RhythmEnforcementService.loadAttentionDayState(context, now)
            JSONObject()
                .put("id", day.id)
                .put("nextBoundaryAt", day.nextBoundaryAt)
                .put("startedAt", day.startedAt)
        }
        root.put("attentionDay", attentionDay)
        whitelist(persisted.optJSONObject("morningMeditation"), MORNING_KEYS)
            ?.let { root.put("morningMeditation", it) }
        root.put("morningRequirements", whitelistArray(persisted.optJSONArray("morningRequirements"), MORNING_KEYS))
        whitelist(persisted.optJSONObject("morningMigration"), MIGRATION_KEYS)
            ?.let { root.put("morningMigration", it) }

        val classification = JSONObject()
        classification.put("essentialCount", restorative.essentialPackages.size)
        classification.put("managedCount", restorative.managedPackages.size)
        classification.put("hasEssentialProjection", restorative.hasEssentialProjection)
        classification.put("hasManagedProjection", restorative.hasManagedProjection)
        val watched = JSONArray()
        for (packageName in WATCHED_PACKAGES) {
            watched.put(
                JSONObject()
                    .put("packageName", packageName)
                    .put("essential", restorative.essentialPackages.contains(packageName))
                    .put("managed", restorative.managedPackages.contains(packageName))
            )
        }
        classification.put("watchedPackages", watched)
        root.put("classification", classification)

        val scheduleJson = JSONObject()
        val rawSchedule = prefs.getString(RhythmNativePolicyKeys.ROUTINE_SCHEDULE_JSON, null)
        scheduleJson.put("rawPresent", rawSchedule != null)
        val windowsOut = JSONArray()
        val windowArray = runCatching { JSONObject(rawSchedule ?: "{}").optJSONArray("windows") }.getOrNull()
        if (windowArray != null) {
            for (index in 0 until windowArray.length()) {
                val window = windowArray.optJSONObject(index) ?: continue
                val out = JSONObject()
                out.put("id", window.optString("id"))
                out.put("type", window.optString("type"))
                out.put("startTime", window.optString("startTime"))
                out.put("endTime", window.optString("endTime"))
                out.put("enabled", window.optBoolean("enabled", true))
                out.put("activeDays", optIntArray(window.optJSONArray("activeDays")))
                // Native persistence stores protectedPackages; protectedGroupIds
                // is copied only if a future writer actually emits it.
                window.optJSONArray("protectedGroupIds")?.let { out.put("protectedGroupIds", it) }
                windowsOut.put(out)
            }
        }
        scheduleJson.put("windows", windowsOut)
        root.put("routineSchedule", scheduleJson)

        root.put("cooldownRowCount", cooldowns.size)
        root.put("gateRowCount", gates.size)
        root.put("currentDayCooldowns", JSONArray().apply {
            cooldowns.filter { it.attentionDateKey == todayKey }.forEach { cooldown ->
                put(
                    JSONObject()
                        .put("groupId", cooldown.groupId)
                        .put("attentionDateKey", cooldown.attentionDateKey)
                        .put("dailyCooldownOrdinal", cooldown.dailyCooldownOrdinal ?: 0)
                        .put("endsAt", cooldown.endsAt)
                        .put("requirementKind", cooldown.requirementKind)
                )
            }
        })
        root.put("currentDayGates", JSONArray().apply {
            gates.values.filter { it.attentionDateKey == todayKey }.forEach { gate ->
                put(
                    JSONObject()
                        .put("groupId", gate.groupId)
                        .put("attentionDateKey", gate.attentionDateKey)
                        .put("dailyCooldownOrdinal", gate.dailyCooldownOrdinal)
                        .put("cooldownEndsAt", gate.cooldownEndsAt)
                )
            }
        })

        instrumentation.sendStatus(STATUS_CODE, Bundle().apply { putString(MARKER, root.toString()) })
    }

    private fun whitelist(source: JSONObject?, keys: List<String>): JSONObject? {
        if (source == null) return null
        val out = JSONObject()
        for (key in keys) {
            if (!source.has(key)) continue
            val value = source.opt(key)
            if (value != null && value != JSONObject.NULL) out.put(key, value)
        }
        return out
    }

    private fun whitelistArray(source: JSONArray?, keys: List<String>): JSONArray {
        val out = JSONArray()
        if (source != null) {
            for (index in 0 until source.length()) {
                whitelist(source.optJSONObject(index), keys)?.let { out.put(it) }
            }
        }
        return out
    }

    private fun optIntArray(source: JSONArray?): JSONArray {
        val out = JSONArray()
        if (source != null) {
            for (index in 0 until source.length()) {
                out.put(source.optInt(index))
            }
        }
        return out
    }

    private companion object {
        const val MARKER = "SW005_NATIVE_SNAPSHOT"
        const val STATUS_CODE = 2
        const val EXPECTED_TARGET_PACKAGE = "com.terinit.rhythmicroutine"

        val MORNING_KEYS = listOf(
            "attentionDayId",
            "sessionId",
            "requiredQualifiedSeconds",
            "createdAt",
            "satisfied",
            "satisfiedAt",
            "sourceRhythmicDayId",
            "sessionKind",
            "sourceCooldownId",
            "expiresAtEpochMs",
        )
        val MIGRATION_KEYS = listOf(
            "migratedAt",
            "migrationAttentionDayId",
            "enforceableFromAttentionDayId",
        )
        val WATCHED_PACKAGES = listOf("com.block.juggle", "com.android.settings")
    }
}
