package expo.modules.rhythmdevice

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri

/**
 * Pass 4 — minimal read-only Attention Insight projection for the signed
 * Rhythmic Meditation Insights surface (spec 28).
 *
 * Ownership stays strict: Routine publishes ONLY its own policy facts
 * (Attention Day, cooldown/gate counts, provider completions, substitution
 * accounting). Meditation session truth stays in Meditation; reading evidence
 * stays in Reader. No database is copied across apps.
 *
 * Contract: versioned ([PROTOCOL_VERSION]), narrow, read-only, signature
 * protected (Meditation's STATUS_ACCESS permission), and gracefully
 * unavailable — an optional Insights chart must never become a policy failure.
 *
 * "firstRiskUseAt" is deliberately NOT included: Routine has no single
 * reliable event to derive it from on this layer, and it must not be
 * manufactured.
 */
class AttentionInsightProvider : ContentProvider() {

    companion object {
        const val PROTOCOL_VERSION = 1
        const val PATH = "attention-day"

        const val COLUMN_PROTOCOL_VERSION = "protocolVersion"
        const val COLUMN_ATTENTION_DAY_ID = "attentionDayId"
        const val COLUMN_COOLDOWNS_TRIGGERED = "cooldownsTriggered"
        const val COLUMN_RESTORATIVE_GATES_CREATED = "restorativeGatesCreated"
        const val COLUMN_RESTORATIVE_GATES_SATISFIED = "restorativeGatesSatisfied"
        const val COLUMN_READER_RESTORATIVE_COMPLETIONS = "readerRestorativeCompletions"
        const val COLUMN_MEDITATION_RESTORATIVE_COMPLETIONS = "meditationRestorativeCompletions"
        const val COLUMN_MEDITATION_SUBSTITUTIONS_USED = "meditationSubstitutionsUsed"
        const val COLUMN_MEDITATION_SUBSTITUTIONS_REMAINING = "meditationSubstitutionsRemaining"

        /** Mirrors the JS policy cap (spec 2 / Pass 3). */
        const val MAX_MEDITATION_SUBSTITUTIONS = 2

        val ALL_COLUMNS = arrayOf(
            COLUMN_PROTOCOL_VERSION,
            COLUMN_ATTENTION_DAY_ID,
            COLUMN_COOLDOWNS_TRIGGERED,
            COLUMN_RESTORATIVE_GATES_CREATED,
            COLUMN_RESTORATIVE_GATES_SATISFIED,
            COLUMN_READER_RESTORATIVE_COMPLETIONS,
            COLUMN_MEDITATION_RESTORATIVE_COMPLETIONS,
            COLUMN_MEDITATION_SUBSTITUTIONS_USED,
            COLUMN_MEDITATION_SUBSTITUTIONS_REMAINING,
        )

        private val allowedColumns = ALL_COLUMNS.toSet()

        /**
         * Pure projection over the persisted enforcement snapshot.
         *
         * A meditation substitution is consumed exactly once per satisfied
         * meditation gate, so "used" is exactly the count of satisfied
         * meditation restorative gates for the Attention Day. Morning/Evening/
         * Standalone meditation never create gates and never consume the cap.
         */
        fun deriveValues(
            snapshot: RestorativeEnforcementSnapshot,
            attentionDayId: String?,
            cooldownsTriggered: Int,
        ): Map<String, Any?> {
            val gates = snapshot.restorativeGates.values
                .filter { it.attentionDayId == attentionDayId }
            val satisfied = gates.filter { it.satisfied }
            val readerCompletions = satisfied.count { it.selectedProviderLabel() == "reader" }
            val meditationCompletions = satisfied.count { it.selectedProviderLabel() == "meditation" }
            return mapOf(
                COLUMN_PROTOCOL_VERSION to PROTOCOL_VERSION,
                COLUMN_ATTENTION_DAY_ID to (attentionDayId ?: "unknown"),
                COLUMN_COOLDOWNS_TRIGGERED to cooldownsTriggered.coerceAtLeast(0),
                COLUMN_RESTORATIVE_GATES_CREATED to gates.size,
                COLUMN_RESTORATIVE_GATES_SATISFIED to satisfied.size,
                COLUMN_READER_RESTORATIVE_COMPLETIONS to readerCompletions,
                COLUMN_MEDITATION_RESTORATIVE_COMPLETIONS to meditationCompletions,
                COLUMN_MEDITATION_SUBSTITUTIONS_USED to meditationCompletions,
                COLUMN_MEDITATION_SUBSTITUTIONS_REMAINING to
                    (MAX_MEDITATION_SUBSTITUTIONS - meditationCompletions).coerceAtLeast(0),
            )
        }
    }

    override fun onCreate(): Boolean = true

    override fun query(
        uri: Uri,
        projection: Array<out String>?,
        selection: String?,
        selectionArgs: Array<out String>?,
        sortOrder: String?,
    ): Cursor? {
        if (uri.pathSegments.size != 2 || uri.pathSegments[0] != PATH) return null
        if (selection != null || selectionArgs != null || sortOrder != null) return null
        val requestedDayId = uri.pathSegments[1]
        if (requestedDayId.isBlank() || uri.query != null || uri.fragment != null) return null

        val columns = projection?.toList() ?: ALL_COLUMNS.toList()
        if (columns.any { it !in allowedColumns } || columns.distinct().size != columns.size) return null

        val appContext = context?.applicationContext ?: return null
        val restorative = RestorativeEnforcement.load(appContext)
        val state = RhythmEnforcementService.loadAttentionExchangeState(appContext)
        val currentDayId = restorative.attentionDay?.id ?: state.dateKey

        // Fail closed for policy, gracefully empty for Insights: only the
        // requested Attention Day's facts are ever returned.
        val cursor = MatrixCursor(columns.toTypedArray())
        if (requestedDayId == currentDayId) {
            val values = deriveValues(restorative, currentDayId, state.cooldownsTriggered)
            cursor.addRow(columns.map { values[it] }.toTypedArray())
        }
        context?.contentResolver?.let { cursor.setNotificationUri(it, uri) }
        return cursor
    }

    override fun getType(uri: Uri): String? =
        if (uri.pathSegments.size == 2 && uri.pathSegments[0] == PATH) {
            "vnd.android.cursor.item/vnd.rhythmicroutine.attention-insight"
        } else {
            null
        }

    override fun insert(uri: Uri, values: ContentValues?): Uri? =
        throw UnsupportedOperationException("AttentionInsightProvider is read-only")

    override fun update(
        uri: Uri,
        values: ContentValues?,
        selection: String?,
        selectionArgs: Array<out String>?,
    ): Int = throw UnsupportedOperationException("AttentionInsightProvider is read-only")

    override fun delete(
        uri: Uri,
        selection: String?,
        selectionArgs: Array<out String>?,
    ): Int = throw UnsupportedOperationException("AttentionInsightProvider is read-only")
}
