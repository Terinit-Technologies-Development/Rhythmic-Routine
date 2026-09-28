package expo.modules.rhythmdevice

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import java.util.Calendar

/**
 * Pass 4 — narrow, read-only Evening Wind-Down projection for Rhythmic
 * Meditation (spec 12, approach 1: signature-protected Routine projection).
 *
 * Routine owns Evening Wind-Down timing; Meditation must never build a second
 * schedule engine. This provider answers exactly one question: is the Evening
 * Meditation due right now, for which Attention Day, and when did/does that
 * evening transition start and end. Nothing else crosses the boundary.
 *
 * Fail-closed for policy, gracefully empty for the evening feature: an
 * unavailable projection simply means "not due" — it never blocks Meditation.
 */
class EveningSignalProvider : ContentProvider() {

    companion object {
        const val PROTOCOL_VERSION = 1
        const val PATH = "current"

        const val COLUMN_PROTOCOL_VERSION = "protocolVersion"
        const val COLUMN_ATTENTION_DAY_ID = "attentionDayId"
        const val COLUMN_DUE_AT_EPOCH_MS = "dueAtEpochMs"
        const val COLUMN_TRANSITION_AT_EPOCH_MS = "transitionAtEpochMs"
        const val COLUMN_STATE = "state"

        val ALL_COLUMNS = arrayOf(
            COLUMN_PROTOCOL_VERSION,
            COLUMN_ATTENTION_DAY_ID,
            COLUMN_DUE_AT_EPOCH_MS,
            COLUMN_TRANSITION_AT_EPOCH_MS,
            COLUMN_STATE,
        )

        private val allowedColumns = ALL_COLUMNS.toSet()

        /** The projection values for an active evening window. */
        data class EveningSignalValues(
            val attentionDayId: String,
            val dueAtEpochMs: Long,
            val transitionAtEpochMs: Long,
            val state: String, // "due" while inside the window, else "not-due"
        )

        /**
         * Pure derivation from Routine's own schedule. Returns null when no
         * usable evening window exists (never manufactures an obligation).
         */
        fun deriveSignal(
            window: NativeRoutineWindow?,
            attentionDayId: String,
            now: Long,
        ): EveningSignalValues? {
            if (window == null || !window.enabled) return null
            if (window.type != "evening-wind-down") return null
            val start = parseTime(window.startTime) ?: return null
            val end = parseTime(window.endTime) ?: return null

            val occurrence = eveningOccurrence(window, start, end, now) ?: return null
            return EveningSignalValues(
                attentionDayId = attentionDayId,
                dueAtEpochMs = occurrence.first,
                transitionAtEpochMs = occurrence.second,
                state = "due",
            )
        }

        /** (dueAt, transitionAt) for the active occurrence, or null when outside. */
        private fun eveningOccurrence(
            window: NativeRoutineWindow,
            start: Int,
            end: Int,
            now: Long,
        ): Pair<Long, Long>? {
            val calendar = Calendar.getInstance().apply { timeInMillis = now }
            val isoDay = if (calendar.get(Calendar.DAY_OF_WEEK) == Calendar.SUNDAY) 7
            else calendar.get(Calendar.DAY_OF_WEEK) - 1
            val yesterday = if (isoDay == 1) 7 else isoDay - 1
            val todayMidnight = Calendar.getInstance().apply {
                timeInMillis = now
                set(Calendar.HOUR_OF_DAY, 0)
                set(Calendar.MINUTE, 0)
                set(Calendar.SECOND, 0)
                set(Calendar.MILLISECOND, 0)
            }.timeInMillis
            val yesterdayMidnight = todayMidnight - 24L * 60L * 60L * 1000L

            return if (start < end) {
                // Same-day window (e.g. 20:00-23:00) on an active day.
                val windowStart = todayMidnight + start * 60_000L
                val windowEnd = todayMidnight + end * 60_000L
                if (isoDay in window.activeDays && now in windowStart until windowEnd) {
                    windowStart to windowEnd
                } else {
                    null
                }
            } else {
                // Cross-midnight window (e.g. 21:00-01:00): the tail after
                // midnight belongs to the previous day's occurrence.
                val headStart = todayMidnight + start * 60_000L
                val headEnd = todayMidnight + 24L * 60L * 60L * 1000L
                val tailEnd = todayMidnight + end * 60_000L
                when {
                    isoDay in window.activeDays && now >= headStart ->
                        headStart to (headEnd + end * 60_000L)
                    yesterday in window.activeDays && now < tailEnd ->
                        (yesterdayMidnight + start * 60_000L) to tailEnd
                    else -> null
                }
            }
        }

        private fun parseTime(value: String): Int? {
            val parts = value.split(":")
            if (parts.size != 2) return null
            val hours = parts[0].toIntOrNull() ?: return null
            val minutes = parts[1].toIntOrNull() ?: return null
            if (hours !in 0..23 || minutes !in 0..59) return null
            return hours * 60 + minutes
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
        if (uri.pathSegments.size != 1 || uri.pathSegments[0] != PATH) return null
        if (selection != null || selectionArgs != null || sortOrder != null) return null
        if (uri.query != null || uri.fragment != null) return null

        val columns = projection?.toList() ?: ALL_COLUMNS.toList()
        if (columns.any { it !in allowedColumns } || columns.distinct().size != columns.size) return null

        val appContext = context?.applicationContext ?: return null
        val now = System.currentTimeMillis()
        val attentionDayId = RestorativeEnforcement.load(appContext).attentionDay?.id
            ?: RhythmEnforcementService.loadAttentionExchangeState(appContext).dateKey
        val eveningWindow = RhythmEnforcementService.loadRoutineSchedule(appContext).windows
            .firstOrNull { it.type == "evening-wind-down" }

        val cursor = MatrixCursor(columns.toTypedArray())
        val signal = deriveSignal(eveningWindow, attentionDayId, now)
        if (signal != null) {
            val values: Map<String, Any> = mapOf(
                COLUMN_PROTOCOL_VERSION to PROTOCOL_VERSION,
                COLUMN_ATTENTION_DAY_ID to signal.attentionDayId,
                COLUMN_DUE_AT_EPOCH_MS to signal.dueAtEpochMs,
                COLUMN_TRANSITION_AT_EPOCH_MS to signal.transitionAtEpochMs,
                COLUMN_STATE to signal.state,
            )
            cursor.addRow(columns.map { values[it] }.toTypedArray())
        }
        context?.contentResolver?.let { cursor.setNotificationUri(it, uri) }
        return cursor
    }

    override fun getType(uri: Uri): String? =
        if (uri.pathSegments.size == 1 && uri.pathSegments[0] == PATH) {
            "vnd.android.cursor.item/vnd.rhythmicroutine.evening-signal"
        } else {
            null
        }

    override fun insert(uri: Uri, values: ContentValues?): Uri? =
        throw UnsupportedOperationException("EveningSignalProvider is read-only")

    override fun update(
        uri: Uri,
        values: ContentValues?,
        selection: String?,
        selectionArgs: Array<out String>?,
    ): Int = throw UnsupportedOperationException("EveningSignalProvider is read-only")

    override fun delete(
        uri: Uri,
        selection: String?,
        selectionArgs: Array<out String>?,
    ): Int = throw UnsupportedOperationException("EveningSignalProvider is read-only")
}
