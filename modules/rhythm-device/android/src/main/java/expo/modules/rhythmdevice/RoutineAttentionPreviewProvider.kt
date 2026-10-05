package expo.modules.rhythmdevice

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import java.time.LocalDate
import java.time.format.DateTimeFormatter

/**
 * Read-only preview of Routine's next reading requirement for its signed
 * Reader client.
 *
 * Protocol V2 (Pass 4) — additive and versioned. The V1 columns keep their
 * exact meaning; the restorative model is exposed through new columns so a
 * reader can distinguish:
 *   - the CD3 daily baseline (cumulative Daily Evidence V2 target), from
 *   - a CD4+ discrete restorative choice (per bound recovery session),
 * and see whether a restorative gate is awaiting selection, has the reader
 * selected, is in progress, or is complete while the cooldown still runs.
 *
 * Unknown protocol versions must degrade gracefully on the client: this
 * provider simply reports [PROTOCOL_VERSION] and the columns below. It is
 * read-only and signature protected; it never shares private history.
 */
class RoutineAttentionPreviewProvider : ContentProvider() {

    companion object {
        const val PROTOCOL_VERSION = 2
        const val PATH = "next"

        const val COLUMN_PROTOCOL_VERSION = "protocolVersion"
        const val COLUMN_DATE_KEY = "dateKey"
        const val COLUMN_NEXT_COOLDOWN_ORDINAL = "nextCooldownOrdinal"
        const val COLUMN_REQUIRED_ACTIVE_SECONDS = "requiredActiveSeconds"
        const val COLUMN_REQUIRED_QUALIFIED_PAGES = "requiredQualifiedPages"

        // Pass 4 — restorative model projection (additive).
        const val COLUMN_REQUIREMENT_KIND = "requirementKind"
        const val COLUMN_GATE_STATUS = "gateStatus"
        const val COLUMN_SELECTED_PROVIDER = "selectedProvider"
        const val COLUMN_COOLDOWN_ACTIVE = "cooldownActive"
        const val COLUMN_RESTORATIVE_READING_SECONDS = "restorativeReadingSeconds"
        const val COLUMN_RESTORATIVE_QUALIFIED_PAGES = "restorativeQualifiedPages"

        val ALL_COLUMNS = arrayOf(
            COLUMN_PROTOCOL_VERSION,
            COLUMN_DATE_KEY,
            COLUMN_NEXT_COOLDOWN_ORDINAL,
            COLUMN_REQUIRED_ACTIVE_SECONDS,
            COLUMN_REQUIRED_QUALIFIED_PAGES,
            COLUMN_REQUIREMENT_KIND,
            COLUMN_GATE_STATUS,
            COLUMN_SELECTED_PROVIDER,
            COLUMN_COOLDOWN_ACTIVE,
            COLUMN_RESTORATIVE_READING_SECONDS,
            COLUMN_RESTORATIVE_QUALIFIED_PAGES,
        )

        private val allowedColumns = ALL_COLUMNS.toSet()
    }

    override fun onCreate(): Boolean = true

    override fun query(
        uri: Uri,
        projection: Array<out String>?,
        selection: String?,
        selectionArgs: Array<out String>?,
        sortOrder: String?,
    ): Cursor? {
        val requestedDateKey = validatedDateKey(uri) ?: return null
        if (selection != null || selectionArgs != null || sortOrder != null) return null

        val columns = projection?.toList() ?: ALL_COLUMNS.toList()
        if (columns.any { it !in allowedColumns } || columns.distinct().size != columns.size) return null

        val appContext = context?.applicationContext ?: return null
        val target = RhythmEnforcementService.nextReadingTargetPreview(appContext)
        val restorative = RestorativeEnforcement.load(appContext)
            .copy(restorativeGates = RhythmEnforcementService.loadCurrentAttentionRestorativeGates(appContext))
        val kind = RestorativeEnforcement.requirementKindForOrdinal(target.nextCooldownOrdinal)
        val gate = RestorativeEnforcement.selectPreviewGate(
            gates = restorative.restorativeGates.values.toList(),
            nextOrdinal = target.nextCooldownOrdinal,
            requirementKind = kind,
        )
        val cooldownActive = RhythmEnforcementService.loadCooldownPolicies(appContext)
            .any { it.endsAt > System.currentTimeMillis() }

        val cursor = MatrixCursor(columns.toTypedArray())
        if (target.dateKey == requestedDateKey) {
            val values: Map<String, Any> = mapOf(
                COLUMN_PROTOCOL_VERSION to PROTOCOL_VERSION,
                COLUMN_DATE_KEY to target.dateKey,
                COLUMN_NEXT_COOLDOWN_ORDINAL to target.nextCooldownOrdinal,
                COLUMN_REQUIRED_ACTIVE_SECONDS to target.requiredActiveSeconds,
                COLUMN_REQUIRED_QUALIFIED_PAGES to target.requiredQualifiedPages,
                COLUMN_REQUIREMENT_KIND to kind,
                COLUMN_GATE_STATUS to (gate?.status ?: "none"),
                COLUMN_SELECTED_PROVIDER to (gate?.selectedProviderLabel() ?: "none"),
                COLUMN_COOLDOWN_ACTIVE to if (cooldownActive) 1 else 0,
                COLUMN_RESTORATIVE_READING_SECONDS to
                    if (kind == "restorative-choice") RestorativeEnforcement.RESTORATIVE_READING_SECONDS else 0,
                COLUMN_RESTORATIVE_QUALIFIED_PAGES to
                    if (kind == "restorative-choice") RestorativeEnforcement.RESTORATIVE_QUALIFIED_PAGES else 0,
            )
            cursor.addRow(columns.map { column -> values[column] }.toTypedArray())
        }
        context?.contentResolver?.let { cursor.setNotificationUri(it, uri) }
        return cursor
    }

    override fun getType(uri: Uri): String? =
        if (validatedDateKey(uri) != null) {
            "vnd.android.cursor.item/vnd.rhythmicroutine.attention-preview"
        } else {
            null
        }

    override fun insert(uri: Uri, values: ContentValues?): Uri? =
        throw UnsupportedOperationException("RoutineAttentionPreviewProvider is read-only")

    override fun update(
        uri: Uri,
        values: ContentValues?,
        selection: String?,
        selectionArgs: Array<out String>?,
    ): Int = throw UnsupportedOperationException("RoutineAttentionPreviewProvider is read-only")

    override fun delete(
        uri: Uri,
        selection: String?,
        selectionArgs: Array<out String>?,
    ): Int = throw UnsupportedOperationException("RoutineAttentionPreviewProvider is read-only")

    private fun validatedDateKey(uri: Uri): String? {
        if (uri.pathSegments.size != 2 || uri.pathSegments[0] != PATH) return null
        if (uri.query != null || uri.fragment != null) return null
        val raw = uri.pathSegments[1]
        return try {
            val parsed = LocalDate.parse(raw, DateTimeFormatter.ISO_LOCAL_DATE)
            if (parsed.toString() == raw) raw else null
        } catch (_: Exception) {
            null
        }
    }
}
