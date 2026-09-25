package expo.modules.rhythmdevice

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import java.time.LocalDate
import java.time.format.DateTimeFormatter

/** Read-only preview of Routine's next daily reading requirement for its signed Reader client. */
class RoutineAttentionPreviewProvider : ContentProvider() {

    companion object {
        const val PROTOCOL_VERSION = 1
        const val PATH = "next"

        const val COLUMN_PROTOCOL_VERSION = "protocolVersion"
        const val COLUMN_DATE_KEY = "dateKey"
        const val COLUMN_NEXT_COOLDOWN_ORDINAL = "nextCooldownOrdinal"
        const val COLUMN_REQUIRED_ACTIVE_SECONDS = "requiredActiveSeconds"
        const val COLUMN_REQUIRED_QUALIFIED_PAGES = "requiredQualifiedPages"

        val ALL_COLUMNS = arrayOf(
            COLUMN_PROTOCOL_VERSION,
            COLUMN_DATE_KEY,
            COLUMN_NEXT_COOLDOWN_ORDINAL,
            COLUMN_REQUIRED_ACTIVE_SECONDS,
            COLUMN_REQUIRED_QUALIFIED_PAGES,
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
        val cursor = MatrixCursor(columns.toTypedArray())
        if (target.dateKey == requestedDateKey) {
            val values: Map<String, Any> = mapOf(
                COLUMN_PROTOCOL_VERSION to PROTOCOL_VERSION,
                COLUMN_DATE_KEY to target.dateKey,
                COLUMN_NEXT_COOLDOWN_ORDINAL to target.nextCooldownOrdinal,
                COLUMN_REQUIRED_ACTIVE_SECONDS to target.requiredActiveSeconds,
                COLUMN_REQUIRED_QUALIFIED_PAGES to target.requiredQualifiedPages,
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

    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int =
        throw UnsupportedOperationException("RoutineAttentionPreviewProvider is read-only")

    private fun validatedDateKey(uri: Uri): String? {
        if (uri.scheme != "content" || uri.authority != "${context?.packageName}.attention-preview" ||
            uri.query != null || uri.fragment != null
        ) {
            return null
        }
        val segments = uri.pathSegments
        if (segments.size != 2 || segments[0] != PATH) return null
        val dateKey = segments[1]
        return runCatching {
            LocalDate.parse(dateKey, DateTimeFormatter.ISO_LOCAL_DATE)
                .takeIf { it.toString() == dateKey }
                ?.toString()
        }.getOrNull()
    }
}
