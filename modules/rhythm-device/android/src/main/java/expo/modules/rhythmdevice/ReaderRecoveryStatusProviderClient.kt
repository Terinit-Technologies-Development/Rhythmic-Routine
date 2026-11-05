package expo.modules.rhythmdevice

import android.content.Context
import android.database.Cursor
import android.net.Uri

/**
 * Reader Recovery Protocol V1 status client.
 *
 * The legacy nullable `queryRecoveryStatus` bridge remains for compatibility.
 * This additive result preserves why a query failed (trust, permission,
 * protocol, missing session, malformed row, provider exception) and only
 * returns evidence after exact session/protocol validation. It never grants a
 * completion on a failed or partial result.
 */
enum class NativeReaderRecoveryAvailability {
    AVAILABLE,
    NOT_INSTALLED,
    UNTRUSTED_SIGNATURE,
    PERMISSION_DENIED,
    PROTOCOL_INCOMPATIBLE,
    SESSION_MISSING,
    CORRUPT,
    QUERY_FAILED,
    UNAVAILABLE,
}

data class NativeReaderRecoveryEvidence(
    val sessionId: String,
    val protocolVersion: Int,
    val status: String,
    val activeSeconds: Long,
    val qualifiedPages: Int,
    val completedAtEpochMs: Long,
)

data class NativeReaderRecoveryResult(
    val availability: NativeReaderRecoveryAvailability,
    val evidence: NativeReaderRecoveryEvidence?,
)

object ReaderRecoveryStatusProviderClient {
    const val READER_PACKAGE = "com.terinit.rhythmicreader"
    const val PROTOCOL_VERSION = 1

    private val requiredColumns = listOf(
        "sessionId",
        "protocolVersion",
        "status",
        "activeSeconds",
        "qualifiedPages",
        "completedAtEpochMs",
    )

    private val knownStatuses = setOf("ACTIVE", "COMPLETE", "ABANDONED", "EXPIRED")

    fun query(context: Context, sessionId: String): NativeReaderRecoveryResult {
        val trust = CompanionTrust.verify(context, READER_PACKAGE)
        if (trust != CompanionTrustResult.TRUSTED) {
            return NativeReaderRecoveryResult(availabilityForTrust(trust), null)
        }
        if (sessionId.isEmpty()) {
            return NativeReaderRecoveryResult(NativeReaderRecoveryAvailability.CORRUPT, null)
        }
        return try {
            val cursor = context.contentResolver.query(
                statusUri(sessionId),
                requiredColumns.toTypedArray(),
                null,
                null,
                null,
            ) ?: return NativeReaderRecoveryResult(
                NativeReaderRecoveryAvailability.UNAVAILABLE,
                null,
            )
            cursor.use {
                if (!it.moveToFirst()) {
                    return NativeReaderRecoveryResult(
                        NativeReaderRecoveryAvailability.SESSION_MISSING,
                        null,
                    )
                }
                val row = it.columnNames.associateWith { column -> it.readString(column) }
                parseSessionRow(sessionId, it.columnNames.toList(), row)
            }
        } catch (_: SecurityException) {
            NativeReaderRecoveryResult(NativeReaderRecoveryAvailability.PERMISSION_DENIED, null)
        } catch (_: IllegalArgumentException) {
            NativeReaderRecoveryResult(
                NativeReaderRecoveryAvailability.PROTOCOL_INCOMPATIBLE,
                null,
            )
        } catch (_: Exception) {
            NativeReaderRecoveryResult(NativeReaderRecoveryAvailability.QUERY_FAILED, null)
        }
    }

    internal fun parseSessionRow(
        requestedSessionId: String,
        columns: List<String>,
        row: Map<String, String?>?,
    ): NativeReaderRecoveryResult {
        if (requiredColumns.any { it !in columns }) {
            return NativeReaderRecoveryResult(
                NativeReaderRecoveryAvailability.PROTOCOL_INCOMPATIBLE,
                null,
            )
        }
        if (row == null) {
            return NativeReaderRecoveryResult(
                NativeReaderRecoveryAvailability.SESSION_MISSING,
                null,
            )
        }

        val sessionId = row["sessionId"]
        if (sessionId.isNullOrEmpty() || sessionId != requestedSessionId) return corrupt()
        val protocolVersion = row["protocolVersion"]?.toIntOrNull() ?: return corrupt()
        if (protocolVersion != PROTOCOL_VERSION) {
            return NativeReaderRecoveryResult(
                NativeReaderRecoveryAvailability.PROTOCOL_INCOMPATIBLE,
                null,
            )
        }
        val status = row["status"]
        if (status == null || status !in knownStatuses) return corrupt()
        val activeSeconds = row["activeSeconds"]?.toLongOrNull() ?: return corrupt()
        if (activeSeconds < 0L) return corrupt()
        val qualifiedPages = row["qualifiedPages"]?.toIntOrNull() ?: return corrupt()
        if (qualifiedPages < 0) return corrupt()
        val completedAtRaw = row["completedAtEpochMs"]
        val completedAtEpochMs = if (completedAtRaw.isNullOrEmpty()) 0L
        else completedAtRaw.toLongOrNull() ?: return corrupt()
        if (completedAtEpochMs < 0L) return corrupt()

        return NativeReaderRecoveryResult(
            NativeReaderRecoveryAvailability.AVAILABLE,
            NativeReaderRecoveryEvidence(
                sessionId = sessionId,
                protocolVersion = protocolVersion,
                status = status,
                activeSeconds = activeSeconds,
                qualifiedPages = qualifiedPages,
                completedAtEpochMs = completedAtEpochMs,
            ),
        )
    }

    internal fun availabilityForTrust(trust: CompanionTrustResult): NativeReaderRecoveryAvailability =
        when (trust) {
            CompanionTrustResult.TRUSTED -> NativeReaderRecoveryAvailability.AVAILABLE
            CompanionTrustResult.NOT_INSTALLED -> NativeReaderRecoveryAvailability.NOT_INSTALLED
            CompanionTrustResult.UNTRUSTED_SIGNATURE ->
                NativeReaderRecoveryAvailability.UNTRUSTED_SIGNATURE
            CompanionTrustResult.UNAVAILABLE -> NativeReaderRecoveryAvailability.UNAVAILABLE
        }

    internal fun availabilityString(availability: NativeReaderRecoveryAvailability): String =
        when (availability) {
            NativeReaderRecoveryAvailability.AVAILABLE -> "available"
            NativeReaderRecoveryAvailability.NOT_INSTALLED -> "not-installed"
            NativeReaderRecoveryAvailability.UNTRUSTED_SIGNATURE -> "untrusted-signature"
            NativeReaderRecoveryAvailability.PERMISSION_DENIED -> "permission-denied"
            NativeReaderRecoveryAvailability.PROTOCOL_INCOMPATIBLE -> "protocol-incompatible"
            NativeReaderRecoveryAvailability.SESSION_MISSING,
            NativeReaderRecoveryAvailability.CORRUPT,
            NativeReaderRecoveryAvailability.QUERY_FAILED,
            NativeReaderRecoveryAvailability.UNAVAILABLE -> "unavailable"
        }

    internal fun queryStatusString(availability: NativeReaderRecoveryAvailability): String =
        when (availability) {
            NativeReaderRecoveryAvailability.AVAILABLE -> "available"
            NativeReaderRecoveryAvailability.NOT_INSTALLED -> "not-installed"
            NativeReaderRecoveryAvailability.UNTRUSTED_SIGNATURE -> "untrusted-signature"
            NativeReaderRecoveryAvailability.PERMISSION_DENIED -> "permission-denied"
            NativeReaderRecoveryAvailability.PROTOCOL_INCOMPATIBLE -> "protocol-incompatible"
            NativeReaderRecoveryAvailability.SESSION_MISSING -> "session-missing"
            NativeReaderRecoveryAvailability.CORRUPT -> "corrupt"
            NativeReaderRecoveryAvailability.QUERY_FAILED -> "query-failed"
            NativeReaderRecoveryAvailability.UNAVAILABLE -> "unavailable"
        }

    private fun corrupt() =
        NativeReaderRecoveryResult(NativeReaderRecoveryAvailability.CORRUPT, null)

    private fun statusUri(sessionId: String): Uri = Uri.Builder()
        .scheme("content")
        .authority("com.terinit.rhythmicreader.recovery")
        .appendPath("sessions")
        .appendPath(sessionId)
        .build()

    private fun Cursor.readString(column: String): String? {
        val index = getColumnIndex(column)
        if (index < 0 || isNull(index)) return null
        return getString(index)
    }
}

/** Additive Expo wire result for detailed Reader recovery status queries. */
object ReaderRecoveryDetailedResultWire {
    fun toWireMap(result: NativeReaderRecoveryResult): Map<String, Any?> = linkedMapOf(
        "queryStatus" to ReaderRecoveryStatusProviderClient.queryStatusString(result.availability),
        "availability" to ReaderRecoveryStatusProviderClient.availabilityString(result.availability),
        "evidence" to result.evidence?.let {
            mapOf(
                "sessionId" to it.sessionId,
                "protocolVersion" to it.protocolVersion,
                "status" to it.status,
                "activeSeconds" to it.activeSeconds.toDouble(),
                "qualifiedPages" to it.qualifiedPages,
                "completedAtEpochMs" to it.completedAtEpochMs.toDouble(),
            )
        },
    )

    fun unavailable(): Map<String, Any?> = toWireMap(
        NativeReaderRecoveryResult(NativeReaderRecoveryAvailability.UNAVAILABLE, null)
    )
}
