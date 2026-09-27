package expo.modules.rhythmdevice

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Pass 3 — native enforcement projection for the Restorative Gate policy.
 *
 * The JS policy layer is authoritative; this layer only persists and enforces
 * the minimal policy data it needs:
 *   - Attention Day identity
 *   - Restorative Gate presence + completion status per Risk Group
 *   - Morning Meditation requirement (Meditation Focus)
 *   - the official companion package allowlist
 *
 * Fail-closed by construction: missing or malformed data never widens
 * enforcement. All data is SharedPreferences-backed so native persisted
 * enforcement survives Routine JS/app process death.
 */

data class NativeRestorativeGateState(
    val gateId: String,
    val groupId: String,
    val attentionDayId: String,
    val requirementKind: String,
    val status: String
) {
    val satisfied: Boolean get() = status == "satisfied"
    val holdsGroup: Boolean get() = requirementKind != "none" && !satisfied
}

data class NativeAttentionDayState(val id: String)

data class NativeMorningMeditationState(
    val attentionDayId: String,
    val sessionId: String,
    val requiredQualifiedSeconds: Int,
    val satisfied: Boolean
)

data class RestorativeEnforcementSnapshot(
    val restorativeGates: Map<String, NativeRestorativeGateState>,
    val attentionDay: NativeAttentionDayState?,
    val morningMeditation: NativeMorningMeditationState?,
    val companionPackages: Set<String>
) {
    /** Morning Meditation Focus holds every nonessential, non-companion app. */
    val morningFocusActive: Boolean
        get() = morningMeditation != null && !morningMeditation.satisfied

    fun isCompanionPackage(packageName: String): Boolean = companionPackages.contains(packageName)

    /**
     * Restorative hold for a group: an unsatisfied (non-none) gate keeps the
     * group held after its cooldown timer expires. Central invariant:
     *   canReenter = cooldownElapsed && gateSatisfiedOrAbsent
     */
    fun hasRestorativeHold(groupId: String): Boolean =
        restorativeGates[groupId]?.holdsGroup == true
}

object RestorativeEnforcement {

    val DEFAULT_COMPANION_PACKAGES: Set<String> = setOf(
        "com.terinit.rhythmicmeditation",
        "com.terinit.rhythmicroutine"
    )

    /** Parses the additive Pass 3 fields from the JS `attentionState` map. */
    fun parse(snapshot: Map<String, Any?>): RestorativeEnforcementSnapshot {
        val gates = LinkedHashMap<String, NativeRestorativeGateState>()
        val rawGates = snapshot["activeRestorativeGates"] as? List<*>
        if (rawGates != null) {
            for (entry in rawGates) {
                val map = entry as? Map<*, *> ?: continue
                val gateId = map["gateId"] as? String ?: continue
                val groupId = map["groupId"] as? String ?: continue
                val attentionDayId = map["attentionDayId"] as? String ?: continue
                val requirementKind = map["requirementKind"] as? String ?: continue
                val status = map["status"] as? String ?: continue
                if (requirementKind !in KNOWN_KINDS) continue
                if (status !in KNOWN_STATUSES) continue
                gates[groupId] = NativeRestorativeGateState(
                    gateId = gateId,
                    groupId = groupId,
                    attentionDayId = attentionDayId,
                    requirementKind = requirementKind,
                    status = status
                )
            }
        }

        val attentionDay = (snapshot["attentionDay"] as? Map<*, *>)?.let { map ->
            (map["id"] as? String)?.let { NativeAttentionDayState(it) }
        }

        val morning = (snapshot["morningMeditation"] as? Map<*, *>)?.let { map ->
            val attentionDayId = map["attentionDayId"] as? String ?: return@let null
            val sessionId = map["sessionId"] as? String ?: return@let null
            val required = (map["requiredQualifiedSeconds"] as? Number)?.toInt() ?: return@let null
            if (required <= 0) return@let null
            NativeMorningMeditationState(
                attentionDayId = attentionDayId,
                sessionId = sessionId,
                requiredQualifiedSeconds = required,
                satisfied = map["satisfied"] == true
            )
        }

        val companions = LinkedHashSet<String>()
        val rawCompanions = snapshot["officialCompanionPackages"] as? List<*>
        if (rawCompanions != null) {
            for (entry in rawCompanions) {
                val name = entry as? String ?: continue
                if (name.isNotBlank()) companions.add(name)
            }
        }
        // Deny-by-default: the official companions are ALWAYS reachable when
        // Meditation Focus is active, regardless of payload contents.
        companions.addAll(DEFAULT_COMPANION_PACKAGES)

        return RestorativeEnforcementSnapshot(gates, attentionDay, morning, companions)
    }

    /** Serializes for SharedPreferences persistence (survives process death). */
    fun toJson(snapshot: RestorativeEnforcementSnapshot): JSONObject {
        val root = JSONObject()
        val gates = JSONArray()
        for (gate in snapshot.restorativeGates.values) {
            gates.put(
                JSONObject()
                    .put("gateId", gate.gateId)
                    .put("groupId", gate.groupId)
                    .put("attentionDayId", gate.attentionDayId)
                    .put("requirementKind", gate.requirementKind)
                    .put("status", gate.status)
            )
        }
        root.put("restorativeGates", gates)
        root.put("attentionDay", snapshot.attentionDay?.let { JSONObject().put("id", it.id) })
        root.put(
            "morningMeditation",
            snapshot.morningMeditation?.let {
                JSONObject()
                    .put("attentionDayId", it.attentionDayId)
                    .put("sessionId", it.sessionId)
                    .put("requiredQualifiedSeconds", it.requiredQualifiedSeconds)
                    .put("satisfied", it.satisfied)
            }
        )
        root.put("companionPackages", JSONArray(snapshot.companionPackages.toList()))
        return root
    }

    /** Parses persisted state; corrupt storage yields an empty (fail-closed) snapshot. */
    fun fromJson(raw: String?): RestorativeEnforcementSnapshot {
        if (raw.isNullOrBlank()) return parse(emptyMap())
        return try {
            val root = JSONObject(raw)
            val map = HashMap<String, Any?>()
            val gateList = ArrayList<Map<String, Any?>>()
            root.optJSONArray("restorativeGates")?.let { array ->
                for (i in 0 until array.length()) {
                    val obj = array.optJSONObject(i) ?: continue
                    gateList.add(
                        mapOf(
                            "gateId" to obj.optString("gateId"),
                            "groupId" to obj.optString("groupId"),
                            "attentionDayId" to obj.optString("attentionDayId"),
                            "requirementKind" to obj.optString("requirementKind"),
                            "status" to obj.optString("status")
                        )
                    )
                }
            }
            map["activeRestorativeGates"] = gateList
            root.optJSONObject("attentionDay")?.let {
                map["attentionDay"] = mapOf("id" to it.optString("id"))
            }
            root.optJSONObject("morningMeditation")?.let {
                map["morningMeditation"] = mapOf(
                    "attentionDayId" to it.optString("attentionDayId"),
                    "sessionId" to it.optString("sessionId"),
                    "requiredQualifiedSeconds" to it.optInt("requiredQualifiedSeconds"),
                    "satisfied" to it.optBoolean("satisfied")
                )
            }
            root.optJSONArray("companionPackages")?.let { array ->
                val list = ArrayList<String>()
                for (i in 0 until array.length()) {
                    array.optString(i)?.let { name -> list.add(name) }
                }
                map["officialCompanionPackages"] = list
            }
            parse(map)
        } catch (_: Throwable) {
            parse(emptyMap())
        }
    }

    fun persist(context: Context, snapshot: RestorativeEnforcementSnapshot) {
        context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(RhythmNativePolicyKeys.RESTORATIVE_GATES_JSON, toJson(snapshot).toString())
            .apply()
    }

    fun load(context: Context): RestorativeEnforcementSnapshot {
        val raw = context.getSharedPreferences(RhythmNativePolicyKeys.PREFS, Context.MODE_PRIVATE)
            .getString(RhythmNativePolicyKeys.RESTORATIVE_GATES_JSON, null)
        return fromJson(raw)
    }

    private val KNOWN_KINDS = setOf(
        "none", "baseline-reading", "restorative-choice", "legacy-reading"
    )
    private val KNOWN_STATUSES = setOf("pending-selection", "in-progress", "satisfied")
}
