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

data class NativeAttentionDayState(
    val id: String,
    val nextBoundaryAt: Long = 0L,
    val startedAt: Long = 0L,
)

data class NativeMorningMeditationState(
    val attentionDayId: String,
    val sessionId: String,
    val requiredQualifiedSeconds: Int,
    val satisfied: Boolean,
    val createdAt: Long = 0L,
    val satisfiedAt: Long? = null,
    val sourceRhythmicDayId: String? = null,
    val sessionKind: String? = null,
    val sourceCooldownId: String? = null,
    val expiresAtEpochMs: Long? = null,
)

data class RestorativeEnforcementSnapshot(
    val restorativeGates: Map<String, NativeRestorativeGateState>,
    val attentionDay: NativeAttentionDayState?,
    val morningMeditation: NativeMorningMeditationState?,
    val companionPackages: Set<String>,
    val morningMigration: NativeMorningMigrationState? = null,
    val essentialPackages: Set<String> = emptySet(),
    val managedPackages: Set<String> = emptySet(),
    val morningRequirements: List<NativeMorningMeditationState> = emptyList(),
    /** Distinguishes an explicit accepted classification set from an absent projection. */
    val hasEssentialProjection: Boolean = false,
    val hasManagedProjection: Boolean = false,
) {
    /** Morning Meditation Focus holds every nonessential, non-companion app. */
    val morningFocusActive: Boolean
        get() = allMorningRequirements().any { !it.satisfied && it.satisfiedAt == null }

    /** Deterministic oldest-first pending carried/current binding. */
    fun oldestPendingMorning(): NativeMorningMeditationState? =
        allMorningRequirements()
            .filter { !it.satisfied && it.satisfiedAt == null }
            .minWithOrNull(compareBy({ it.createdAt }, { it.attentionDayId }))

    fun allMorningRequirements(): List<NativeMorningMeditationState> =
        if (morningRequirements.isNotEmpty()) morningRequirements
        else listOfNotNull(morningMeditation)

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
    fun parse(
        snapshot: Map<String, Any?>,
        trustNativeCompletionMarker: Boolean = false,
    ): RestorativeEnforcementSnapshot {
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
                    startedAt = (map["startedAt"] as? Number)?.toLong()?.coerceAtLeast(0L) ?: 0L,
                )
            }
        }

        val morningRequirements = LinkedHashMap<String, NativeMorningMeditationState>()
        val rawMorningList = snapshot["morningRequirements"] as? List<*>
        if (rawMorningList != null) {
            for (entry in rawMorningList) {
                parseMorning(entry as? Map<*, *>, trustNativeCompletionMarker)
                    ?.let { morningRequirements[it.attentionDayId] = it }
            }
        }
        val morning = parseMorning(
            snapshot["morningMeditation"] as? Map<*, *>,
            trustNativeCompletionMarker,
        ) ?: morningRequirements.values.minWithOrNull(
            compareBy({ it.createdAt }, { it.attentionDayId })
        )
        if (morning != null) morningRequirements.putIfAbsent(morning.attentionDayId, morning)

        val migration = (snapshot["morningMigration"] as? Map<*, *>)?.let { map ->
            val migratedAt = (map["migratedAt"] as? Number)?.toLong() ?: return@let null
            val migrationDay = map["migrationAttentionDayId"] as? String ?: return@let null
            if (migratedAt < 0L || migrationDay.isBlank()) return@let null
            NativeMorningMigrationState(
                migratedAt = migratedAt,
                migrationAttentionDayId = migrationDay,
                enforceableFromAttentionDayId =
                    (map["enforceableFromAttentionDayId"] as? String)?.takeIf { it.isNotBlank() },
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

        val essential = LinkedHashSet<String>()
        (snapshot["essentialPackages"] as? List<*>)?.forEach { name ->
            (name as? String)?.takeIf { it.isNotBlank() }?.let { essential.add(it) }
        }
        val managed = LinkedHashSet<String>()
        (snapshot["managedPackages"] as? List<*>)?.forEach { name ->
            (name as? String)?.takeIf { it.isNotBlank() }?.let { managed.add(it) }
        }
        val hasEssentialProjection = snapshot["essentialPackages"] is List<*>
        val hasManagedProjection = snapshot["managedPackages"] is List<*>

        return RestorativeEnforcementSnapshot(
            gates,
            attentionDay,
            morning,
            companions,
            migration,
            essential,
            managed,
            morningRequirements.values.sortedWith(
                compareBy({ it.createdAt }, { it.attentionDayId })
            ),
            hasEssentialProjection,
            hasManagedProjection,
        )
    }

    private fun parseMorning(
        map: Map<*, *>?,
        trustNativeCompletionMarker: Boolean,
    ): NativeMorningMeditationState? {
        if (map == null) return null
        val attentionDayId = map["attentionDayId"] as? String ?: return null
        val sessionId = map["sessionId"] as? String ?: return null
        val required = (map["requiredQualifiedSeconds"] as? Number)?.toInt() ?: return null
        if (attentionDayId.isBlank() || sessionId.isBlank() || required <= 0) return null
        val rawSatisfiedAt = (map["satisfiedAt"] as? Number)?.toLong()?.takeIf { it > 0L }
        val satisfiedAt = rawSatisfiedAt.takeIf { trustNativeCompletionMarker }
        return NativeMorningMeditationState(
            attentionDayId = attentionDayId,
            sessionId = sessionId,
            requiredQualifiedSeconds = required,
            // A naked JS `satisfied` flag or timestamp is never proof; only a
            // retained native marker (persisted state) can mark satisfaction.
            satisfied = map["satisfied"] == true && satisfiedAt != null,
            createdAt = (map["createdAt"] as? Number)?.toLong()?.coerceAtLeast(0L) ?: 0L,
            satisfiedAt = satisfiedAt,
            sourceRhythmicDayId = (map["sourceRhythmicDayId"] as? String)?.takeIf { it.isNotBlank() },
            sessionKind = (map["sessionKind"] as? String)?.takeIf { it.isNotBlank() },
            sourceCooldownId = (map["sourceCooldownId"] as? String)?.takeIf { it.isNotBlank() },
            expiresAtEpochMs = (map["expiresAtEpochMs"] as? Number)?.toLong()?.takeIf { it > 0L },
        )
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
                .put("startedAt", it.startedAt)
        })
        root.put(
            "morningMeditation",
            (snapshot.oldestPendingMorning() ?: snapshot.allMorningRequirements().firstOrNull())?.let {
                JSONObject()
                    .put("attentionDayId", it.attentionDayId)
                    .put("sessionId", it.sessionId)
                    .put("requiredQualifiedSeconds", it.requiredQualifiedSeconds)
                    .put("createdAt", it.createdAt)
                    .put("satisfied", it.satisfied)
                    .put("satisfiedAt", it.satisfiedAt)
                    .put("sourceRhythmicDayId", it.sourceRhythmicDayId)
                    .put("sessionKind", it.sessionKind)
                    .put("sourceCooldownId", it.sourceCooldownId)
                    .put("expiresAtEpochMs", it.expiresAtEpochMs)
            }
        )
        root.put(
            "morningRequirements",
            JSONArray().apply {
                for (item in snapshot.allMorningRequirements()) {
                    put(
                        JSONObject()
                            .put("attentionDayId", item.attentionDayId)
                            .put("sessionId", item.sessionId)
                            .put("requiredQualifiedSeconds", item.requiredQualifiedSeconds)
                            .put("createdAt", item.createdAt)
                            .put("satisfied", item.satisfied)
                            .put("satisfiedAt", item.satisfiedAt)
                            .put("sourceRhythmicDayId", item.sourceRhythmicDayId)
                            .put("sessionKind", item.sessionKind)
                            .put("sourceCooldownId", item.sourceCooldownId)
                            .put("expiresAtEpochMs", item.expiresAtEpochMs)
                    )
                }
            }
        )
        root.put(
            "morningMigration",
            snapshot.morningMigration?.let {
                JSONObject()
                    .put("migratedAt", it.migratedAt)
                    .put("migrationAttentionDayId", it.migrationAttentionDayId)
                    .put("enforceableFromAttentionDayId", it.enforceableFromAttentionDayId)
            }
        )
        root.put("essentialPackages", JSONArray(snapshot.essentialPackages.toList()))
        root.put("managedPackages", JSONArray(snapshot.managedPackages.toList()))
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
                    "startedAt" to it.optLong("startedAt", 0L),
                )
            }
            root.optJSONObject("morningMeditation")?.let {
                map["morningMeditation"] = mapOf(
                    "attentionDayId" to it.optString("attentionDayId"),
                    "sessionId" to it.optString("sessionId"),
                    "requiredQualifiedSeconds" to it.optInt("requiredQualifiedSeconds"),
                    "createdAt" to it.optLong("createdAt", 0L),
                    "satisfied" to it.optBoolean("satisfied"),
                    "satisfiedAt" to if (it.has("satisfiedAt") && !it.isNull("satisfiedAt")) it.optLong("satisfiedAt") else null,
                    "sourceRhythmicDayId" to it.optString("sourceRhythmicDayId").takeIf { value -> value.isNotBlank() },
                    "sessionKind" to it.optString("sessionKind").takeIf { value -> value.isNotBlank() },
                    "sourceCooldownId" to it.optString("sourceCooldownId").takeIf { value -> value.isNotBlank() },
                    "expiresAtEpochMs" to if (it.has("expiresAtEpochMs") && !it.isNull("expiresAtEpochMs")) it.optLong("expiresAtEpochMs") else null,
                )
            }
            root.optJSONArray("morningRequirements")?.let { array ->
                val list = ArrayList<Map<String, Any?>>()
                for (i in 0 until array.length()) {
                    val obj = array.optJSONObject(i) ?: continue
                    list.add(
                        mapOf(
                            "attentionDayId" to obj.optString("attentionDayId"),
                            "sessionId" to obj.optString("sessionId"),
                            "requiredQualifiedSeconds" to obj.optInt("requiredQualifiedSeconds"),
                            "createdAt" to obj.optLong("createdAt", 0L),
                            "satisfied" to obj.optBoolean("satisfied"),
                            "satisfiedAt" to if (obj.has("satisfiedAt") && !obj.isNull("satisfiedAt")) obj.optLong("satisfiedAt") else null,
                            "sourceRhythmicDayId" to obj.optString("sourceRhythmicDayId").takeIf { value -> value.isNotBlank() },
                            "sessionKind" to obj.optString("sessionKind").takeIf { value -> value.isNotBlank() },
                            "sourceCooldownId" to obj.optString("sourceCooldownId").takeIf { value -> value.isNotBlank() },
                            "expiresAtEpochMs" to if (obj.has("expiresAtEpochMs") && !obj.isNull("expiresAtEpochMs")) obj.optLong("expiresAtEpochMs") else null,
                        )
                    )
                }
                map["morningRequirements"] = list
            }
            root.optJSONObject("morningMigration")?.let {
                map["morningMigration"] = mapOf(
                    "migratedAt" to it.optLong("migratedAt", 0L),
                    "migrationAttentionDayId" to it.optString("migrationAttentionDayId"),
                    "enforceableFromAttentionDayId" to it.optString("enforceableFromAttentionDayId").takeIf { value -> value.isNotBlank() },
                )
            }
            root.optJSONArray("essentialPackages")?.let { array ->
                val list = ArrayList<String>()
                for (i in 0 until array.length()) {
                    array.optString(i)?.takeIf { value -> value.isNotBlank() }?.let { list.add(it) }
                }
                map["essentialPackages"] = list
            }
            root.optJSONArray("managedPackages")?.let { array ->
                val list = ArrayList<String>()
                for (i in 0 until array.length()) {
                    array.optString(i)?.takeIf { value -> value.isNotBlank() }?.let { list.add(it) }
                }
                map["managedPackages"] = list
            }
            root.optJSONArray("companionPackages")?.let { array ->
                val list = ArrayList<String>()
                for (i in 0 until array.length()) {
                    array.optString(i)?.let { name -> list.add(name) }
                }
                map["officialCompanionPackages"] = list
            }
            parse(map, trustNativeCompletionMarker = true)
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
        val migration = existing.morningMigration ?: incoming.morningMigration
        val incomingManaged = incoming.managedPackages
        // Missing projection is not an explicit empty policy. An explicit
        // classification may remove an Essential exemption only by naming the
        // package in the managed set (deliberate reclassification); a stale
        // projection that omits both sets cannot silently widen access.
        val essential = if (incoming.hasEssentialProjection) {
            (existing.essentialPackages - incomingManaged) + incoming.essentialPackages
        } else {
            existing.essentialPackages
        }
        val managed = if (incoming.hasManagedProjection) {
            incomingManaged
        } else {
            existing.managedPackages
        }
        val hasEssentialProjection =
            existing.hasEssentialProjection || incoming.hasEssentialProjection
        val hasManagedProjection =
            existing.hasManagedProjection || incoming.hasManagedProjection
        val morning = mergeMorningLists(
            existing.allMorningRequirements(),
            incoming.allMorningRequirements(),
        )
        val oldestPending = morning.filter { !it.satisfied && it.satisfiedAt == null }
            .minWithOrNull(compareBy({ it.createdAt }, { it.attentionDayId }))
            ?: morning.firstOrNull()
        if (!sameAttentionDay) {
            return incoming.copy(
                morningMeditation = oldestPending,
                morningRequirements = morning,
                morningMigration = migration,
                essentialPackages = essential,
                managedPackages = managed,
                hasEssentialProjection = hasEssentialProjection,
                hasManagedProjection = hasManagedProjection,
            )
        }

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
        val attentionDay = incoming.attentionDay?.copy(
            startedAt = if (incoming.attentionDay.startedAt > 0L) {
                incoming.attentionDay.startedAt
            } else {
                existing.attentionDay?.startedAt ?: 0L
            }
        )
        return incoming.copy(
            restorativeGates = merged,
            attentionDay = attentionDay,
            morningMeditation = oldestPending,
            morningRequirements = morning,
            morningMigration = migration,
            essentialPackages = essential,
            managedPackages = managed,
            hasEssentialProjection = hasEssentialProjection,
            hasManagedProjection = hasManagedProjection,
        )
    }

    private fun mergeMorningLists(
        existing: List<NativeMorningMeditationState>,
        incoming: List<NativeMorningMeditationState>,
    ): List<NativeMorningMeditationState> {
        val byDay = LinkedHashMap<String, NativeMorningMeditationState>()
        for (item in existing) byDay[item.attentionDayId] = item
        for (candidate in incoming) {
            val current = byDay[candidate.attentionDayId]
            if (current == null) {
                val wellFormed = candidate.sessionId == MorningEnforcement.sessionId(candidate.attentionDayId) &&
                    candidate.requiredQualifiedSeconds > 0 &&
                    candidate.sessionKind == MorningEnforcement.MORNING_SESSION_KIND &&
                    candidate.sourceRhythmicDayId == candidate.attentionDayId &&
                    candidate.sourceCooldownId == null
                if (wellFormed) byDay[candidate.attentionDayId] = candidate
                continue
            }
            if (
                current.satisfiedAt == null &&
                candidate.satisfiedAt != null &&
                candidate.sessionId == current.sessionId &&
                candidate.sessionKind == MorningEnforcement.MORNING_SESSION_KIND &&
                candidate.sourceRhythmicDayId == current.attentionDayId &&
                candidate.sourceCooldownId == null
            ) {
                // Immutable tuple retained; only the retained trusted marker moves.
                byDay[candidate.attentionDayId] = current.copy(
                    satisfied = true,
                    satisfiedAt = candidate.satisfiedAt,
                )
            }
        }
        return byDay.values.sortedWith(compareBy({ it.createdAt }, { it.attentionDayId }))
    }

    /** Persists an incoming projection without losing native gate truth. */
    fun persistMerged(context: Context, incoming: RestorativeEnforcementSnapshot): Boolean {
        return persist(context, incoming)
    }

    /**
     * Real persistence acknowledgement: commit() returns whether the write was
     * durably accepted. apply() is deliberately not used for enforcement truth.
     *
     * Rebased under the accepted-snapshot lock so a stale caller cannot clear a
     * newer morning binding or regress a newer verified completion.
     */
    fun persist(
        context: Context,
        snapshot: RestorativeEnforcementSnapshot,
        applyClassification: Boolean = false,
    ): Boolean =
        NativePolicyPersistence.withReadSnapshot {
            val latest = load(context)
            // Native gate/morning publishers carry a stale copy of the
            // classification sets. Only an explicitly authoritative JS
            // publication may replace them; native mutations preserve the
            // latest accepted classification.
            val incoming = if (applyClassification) {
                snapshot
            } else {
                snapshot.copy(
                    hasEssentialProjection = false,
                    hasManagedProjection = false,
                )
            }
            val rebased = reconcileIncoming(latest, incoming)
            NativePolicyPersistence.persistPrefs(
                context,
                mapOf(
                    RhythmNativePolicyKeys.RESTORATIVE_GATES_JSON to
                        toJson(rebased).toString(),
                ),
            )
        }

    fun load(context: Context): RestorativeEnforcementSnapshot {
        val raw = NativePolicyPersistence.get(
            context,
            RhythmNativePolicyKeys.RESTORATIVE_GATES_JSON,
        )
        return fromJson(raw)
    }

    private val KNOWN_KINDS = setOf(
        "none", "baseline-reading", "restorative-choice", "legacy-reading"
    )
    private val KNOWN_STATUSES = setOf("pending-selection", "in-progress", "satisfied")
}
