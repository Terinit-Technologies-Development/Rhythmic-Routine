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
    val status: String,
    val selectedProvider: String? = null,
    val dailyCooldownOrdinal: Int = 0,
    /** Baseline/legacy compatibility numbers (CD3 aggregate evidence + migrated v1.2). */
    val requiredReadingSeconds: Long = 0L,
    val requiredQualifiedPages: Int = 0,
    val createdAt: Long = 0L,
    /** CD4+ restorative choice numbers. */
    val restorativeReadingSeconds: Long = 0L,
    val restorativeReadingPages: Int = 0,
    val requiredMeditationSeconds: Long = 0L,
) {
    val satisfied: Boolean get() = status == "satisfied"
    val holdsGroup: Boolean get() = requirementKind != "none" && !satisfied

    /** Wire label for previews: 'reader' | 'meditation' | 'none'. */
    fun selectedProviderLabel(): String = when (selectedProvider) {
        "reader", "meditation" -> selectedProvider
        else -> "none"
    }
}

data class NativeAttentionDayState(val id: String, val nextBoundaryAt: Long = 0L)

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

    fun hasRestorativeHold(groupId: String, currentAttentionDayId: String): Boolean =
        attentionDay?.id == currentAttentionDayId &&
            restorativeGates[groupId]?.let {
                it.attentionDayId == currentAttentionDayId && it.holdsGroup
            } == true
}

object RestorativeEnforcement {

    val DEFAULT_COMPANION_PACKAGES: Set<String> = setOf(
        "com.terinit.rhythmicmeditation",
        "com.terinit.rhythmicroutine"
    )

    /** CD4+ discrete Reader path requirement (per bound recovery session). */
    const val RESTORATIVE_READING_SECONDS = 1800L
    const val RESTORATIVE_QUALIFIED_PAGES = 11

    /** CD4+ Meditation path requirement (per bound recovery session). */
    const val RESTORATIVE_MEDITATION_SECONDS = 1800L

    /** CD3 daily Reader baseline (cumulative Daily Evidence V2 target). */
    const val BASELINE_READING_SECONDS = 3600L
    const val BASELINE_QUALIFIED_PAGES = 36

    /**
     * Deterministic gate identity — the SAME formula the JS engine uses
     * (`deterministicGateId`): one gate per (Attention Day, group, ordinal),
     * so a native allowance exhaustion and the later JS reconciliation refer
     * to the same logical gate. Never two gates for one cooldown.
     */
    fun gateIdFor(attentionDayId: String, groupId: String, ordinal: Int): String =
        "gate-$attentionDayId-$groupId-o$ordinal"

    /** Kotlin mirror of the Pass 3 policy (spec 2: frozen; single authority). */
    fun requirementKindForOrdinal(ordinal: Int): String =
        NativeAttentionExchangeLogic.requirementKindForOrdinal(ordinal).wireLabel

    /**
     * The gate a preview should describe: the gate matching the next ordinal
     * if one exists, else the oldest unsatisfied gate of the same requirement
     * kind, else none. A prior baseline gate must never lend its provider or
     * status to a later restorative-choice preview (or vice versa).
     */
    fun selectPreviewGate(
        gates: List<NativeRestorativeGateState>,
        nextOrdinal: Int,
        requirementKind: String? = null,
    ): NativeRestorativeGateState? {
        val compatibleGates = gates.filter {
            it.requirementKind != "none" &&
                (requirementKind == null || it.requirementKind == requirementKind)
        }
        return compatibleGates.firstOrNull { it.dailyCooldownOrdinal == nextOrdinal }
            ?: compatibleGates.filter { it.holdsGroup }.minByOrNull { it.dailyCooldownOrdinal }
    }

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
                    status = status,
                    selectedProvider = map["selectedProvider"] as? String,
                    dailyCooldownOrdinal = (map["dailyCooldownOrdinal"] as? Number)?.toInt() ?: 0,
                    requiredReadingSeconds = (map["requiredReadingSeconds"] as? Number)?.toLong() ?: 0L,
                    requiredQualifiedPages = (map["requiredQualifiedPages"] as? Number)?.toInt() ?: 0,
                    createdAt = (map["createdAt"] as? Number)?.toLong()?.coerceAtLeast(0L) ?: 0L,
                    restorativeReadingSeconds = (map["restorativeReadingSeconds"] as? Number)?.toLong() ?: 0L,
                    restorativeReadingPages = (map["restorativeReadingPages"] as? Number)?.toInt() ?: 0,
                    requiredMeditationSeconds = (map["requiredMeditationSeconds"] as? Number)?.toLong() ?: 0L,
                )
            }
        }

        val attentionDay = (snapshot["attentionDay"] as? Map<*, *>)?.let { map ->
            (map["id"] as? String)?.let {
                NativeAttentionDayState(
                    id = it,
                    nextBoundaryAt = (map["nextBoundaryAt"] as? Number)?.toLong()?.coerceAtLeast(0L) ?: 0L,
                )
            }
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
                    .put("selectedProvider", gate.selectedProvider)
                    .put("dailyCooldownOrdinal", gate.dailyCooldownOrdinal)
                    .put("requiredReadingSeconds", gate.requiredReadingSeconds)
                    .put("requiredQualifiedPages", gate.requiredQualifiedPages)
                    .put("createdAt", gate.createdAt)
                    .put("restorativeReadingSeconds", gate.restorativeReadingSeconds)
                    .put("restorativeReadingPages", gate.restorativeReadingPages)
                    .put("requiredMeditationSeconds", gate.requiredMeditationSeconds)
            )
        }
        root.put("restorativeGates", gates)
        root.put("attentionDay", snapshot.attentionDay?.let {
            JSONObject()
                .put("id", it.id)
                .put("nextBoundaryAt", it.nextBoundaryAt)
        })
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
                            "status" to obj.optString("status"),
                            "selectedProvider" to obj.optString("selectedProvider", "none"),
                            "dailyCooldownOrdinal" to obj.optInt("dailyCooldownOrdinal"),
                            "requiredReadingSeconds" to obj.optLong("requiredReadingSeconds", 0L),
                            "requiredQualifiedPages" to obj.optInt("requiredQualifiedPages", 0),
                            "createdAt" to obj.optLong("createdAt", 0L),
                            "restorativeReadingSeconds" to obj.optLong("restorativeReadingSeconds", 0L),
                            "restorativeReadingPages" to obj.optInt("restorativeReadingPages", 0),
                            "requiredMeditationSeconds" to obj.optLong("requiredMeditationSeconds", 0L),
                        )
                    )
                }
            }
            map["activeRestorativeGates"] = gateList
            root.optJSONObject("attentionDay")?.let {
                map["attentionDay"] = mapOf(
                    "id" to it.optString("id"),
                    "nextBoundaryAt" to it.optLong("nextBoundaryAt", 0L),
                )
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

    /**
     * Native <-> JS reconciliation (Pass 5A): the native store and the JS
     * projection converge on ONE gate per (Attention Day, group, ordinal) with
     * the SAME deterministic identity. JS may add provider selection and
     * session binding; a completed (satisfied) gate is never downgraded; a
     * native-created gate survives until the JS projection catches up. A new
     * Attention Day replaces the store wholesale.
     */
    fun reconcileIncoming(
        existing: RestorativeEnforcementSnapshot,
        incoming: RestorativeEnforcementSnapshot,
    ): RestorativeEnforcementSnapshot {
        val sameAttentionDay = existing.attentionDay?.id != null &&
            existing.attentionDay.id == incoming.attentionDay?.id
        if (!sameAttentionDay) return incoming

        val merged = LinkedHashMap<String, NativeRestorativeGateState>()
        for ((groupId, gate) in existing.restorativeGates) {
            merged[groupId] = gate
        }
        for ((groupId, gate) in incoming.restorativeGates) {
            val current = merged[groupId]
            merged[groupId] = when {
                current == null -> gate
                current.gateId == gate.gateId &&
                    current.status == "satisfied" &&
                    gate.status != "satisfied" -> current
                else -> gate
            }
        }
        return incoming.copy(restorativeGates = merged)
    }

    /** Persists an incoming projection without losing native gate truth. */
    fun persistMerged(context: Context, incoming: RestorativeEnforcementSnapshot) {
        persist(context, reconcileIncoming(load(context), incoming))
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
