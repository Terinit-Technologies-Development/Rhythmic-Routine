package expo.modules.rhythmdevice

import android.content.ContentResolver
import android.content.Context
import android.database.Cursor
import android.net.Uri
import java.text.ParsePosition
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

/** Shared Reader Protocol V2 client used by both the Expo module and enforcement service. */
object DailyReadingEvidenceProviderClient {
    private const val PROTOCOL_VERSION = 2
    private val requiredColumns = setOf(
        "protocolVersion",
        "dateKey",
        "verifiedActiveSeconds",
        "qualifiedPages",
        "updatedAtEpochMs",
    )

    fun query(context: Context, dateKey: String): NativeDailyReadingEvidenceResult {
        if (!isValidDateKey(dateKey)) return unavailable(dateKey)
        val uri = Uri.Builder()
            .scheme("content")
            .authority("com.terinit.rhythmicreader.evidence")
            .appendPath("daily")
            .appendPath(dateKey)
            .build()
        return query(context.contentResolver, uri, dateKey)
    }

    internal fun query(resolver: ContentResolver, uri: Uri, dateKey: String): NativeDailyReadingEvidenceResult = try {
        // Ask for all columns so an older responding provider can be distinguished from a failed query.
        val cursor = resolver.query(uri, null, null, null, null) ?: return unavailable(dateKey)
        cursor.use { parseResponse(dateKey, it.columnNames.toList(), it) }
    } catch (_: Exception) {
        unavailable(dateKey)
    }

    internal fun parseResponse(
        requestedDateKey: String,
        columns: List<String>,
        cursor: Cursor?,
    ): NativeDailyReadingEvidenceResult {
        if (requiredColumns.any { it !in columns }) {
            return incompatible(requestedDateKey)
        }
        if (cursor == null || !cursor.moveToFirst()) {
            return NativeDailyReadingEvidenceResult(
                providerAvailable = true,
                protocolCompatible = true,
                protocolVersion = PROTOCOL_VERSION,
                dateKey = requestedDateKey,
                verifiedActiveSeconds = 0L,
                qualifiedPages = 0,
                updatedAtEpochMs = 0L,
            )
        }

        val protocolVersion = cursor.readString("protocolVersion")?.toIntOrNull()
        val returnedDateKey = cursor.readString("dateKey")
        val seconds = cursor.readString("verifiedActiveSeconds")?.toLongOrNull()
        val pages = cursor.readString("qualifiedPages")?.toLongOrNull()
        val updatedAt = cursor.readString("updatedAtEpochMs")?.toLongOrNull()
        val compatible = protocolVersion == PROTOCOL_VERSION &&
            returnedDateKey == requestedDateKey &&
            seconds != null && seconds >= 0L &&
            pages != null && pages in 0L..Int.MAX_VALUE.toLong() &&
            updatedAt != null && updatedAt >= 0L

        return NativeDailyReadingEvidenceResult(
            providerAvailable = true,
            protocolCompatible = compatible,
            protocolVersion = protocolVersion,
            dateKey = returnedDateKey ?: requestedDateKey,
            verifiedActiveSeconds = if (compatible) seconds!! else 0L,
            qualifiedPages = if (compatible) pages!!.toInt() else 0,
            updatedAtEpochMs = if (compatible) updatedAt!! else 0L,
        )
    }

    fun unavailable(dateKey: String) = NativeDailyReadingEvidenceResult(
        providerAvailable = false,
        protocolCompatible = false,
        protocolVersion = null,
        dateKey = dateKey,
        verifiedActiveSeconds = 0L,
        qualifiedPages = 0,
        updatedAtEpochMs = 0L,
    )

    private fun incompatible(dateKey: String) = NativeDailyReadingEvidenceResult(
        providerAvailable = true,
        protocolCompatible = false,
        protocolVersion = null,
        dateKey = dateKey,
        verifiedActiveSeconds = 0L,
        qualifiedPages = 0,
        updatedAtEpochMs = 0L,
    )

    private fun Cursor.readString(column: String): String? {
        val index = getColumnIndex(column)
        if (index < 0 || isNull(index)) return null
        return getString(index)
    }

    private fun isValidDateKey(value: String): Boolean {
        if (!value.matches(Regex("\\d{4}-\\d{2}-\\d{2}"))) return false
        val formatter = SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).apply {
            isLenient = false
            timeZone = TimeZone.getTimeZone("UTC")
        }
        val position = ParsePosition(0)
        val parsed = formatter.parse(value, position) ?: return false
        return position.index == value.length && formatter.format(parsed) == value
    }
}
