package expo.modules.rhythmdevice

import android.content.Context
import android.database.Cursor
import android.net.Uri
import java.util.UUID

enum class NativeMeditationAvailability {
    NOT_INSTALLED,
    UNTRUSTED_SIGNATURE,
    PROTOCOL_INCOMPATIBLE,
    SESSION_MISSING,
    CORRUPT,
    AVAILABLE,
    UNAVAILABLE,
}

data class NativeMeditationSessionEvidence(
    val sessionId: String,
    val protocolVersion: Int,
    val status: String,
    val requiredQualifiedSeconds: Int,
    val completedQualifiedSeconds: Int,
    val completedAtEpochMs: Long?,
    val lastUpdatedAtEpochMs: Long?,
)

data class NativeMeditationSessionResult(
    val availability: NativeMeditationAvailability,
    val evidence: NativeMeditationSessionEvidence?,
)

/** Shared Meditation Protocol V1 status client used by the Expo module. */
object MeditationStatusProviderClient {
    private val requiredColumns = setOf(
        MeditationContract.COLUMN_SESSION_ID,
        MeditationContract.COLUMN_PROTOCOL_VERSION,
        MeditationContract.COLUMN_STATUS,
        MeditationContract.COLUMN_REQUIRED_QUALIFIED_SECONDS,
        MeditationContract.COLUMN_COMPLETED_QUALIFIED_SECONDS,
        MeditationContract.COLUMN_COMPLETED_AT_EPOCH_MS,
        MeditationContract.COLUMN_LAST_UPDATED_AT_EPOCH_MS,
    )

    private val knownStatuses = setOf(
        "PENDING",
        "ACTIVE",
        "PAUSED",
        "COMPLETED",
        "CANCELLED",
        "EXPIRED",
        "INVALID",
    )

    fun checkAvailability(context: Context): NativeMeditationAvailability {
        val trust = CompanionTrust.verify(context, MeditationContract.MEDITATION_PACKAGE)
        if (trust != CompanionTrustResult.TRUSTED) return availabilityForTrust(trust)
        return probeProtocol(context)
    }

    fun query(context: Context, sessionId: String): NativeMeditationSessionResult {
        val trust = CompanionTrust.verify(context, MeditationContract.MEDITATION_PACKAGE)
        if (trust != CompanionTrustResult.TRUSTED) {
            return NativeMeditationSessionResult(availabilityForTrust(trust), null)
        }
        if (sessionId.isEmpty()) return NativeMeditationSessionResult(NativeMeditationAvailability.CORRUPT, null)
        return try {
            // Ask for all columns so an older responding provider can be distinguished from a failed query.
            val cursor = context.contentResolver.query(statusUri(sessionId), null, null, arrayOf(sessionId), null)
                ?: return NativeMeditationSessionResult(NativeMeditationAvailability.UNAVAILABLE, null)
            cursor.use { parseSessionRow(sessionId, it.columnNames.toList(), it.readRow()) }
        } catch (_: Exception) {
            NativeMeditationSessionResult(NativeMeditationAvailability.UNAVAILABLE, null)
        }
    }

    internal fun parseSessionRow(
        requestedSessionId: String,
        columns: List<String>,
        row: Map<String, String?>?,
    ): NativeMeditationSessionResult {
        if (!hasRequiredColumns(columns)) {
            return NativeMeditationSessionResult(NativeMeditationAvailability.PROTOCOL_INCOMPATIBLE, null)
        }
        if (row == null) {
            return NativeMeditationSessionResult(NativeMeditationAvailability.SESSION_MISSING, null)
        }

        val sessionId = row[MeditationContract.COLUMN_SESSION_ID]
        if (sessionId.isNullOrEmpty() || sessionId != requestedSessionId) return corrupt()
        val protocolVersion = row[MeditationContract.COLUMN_PROTOCOL_VERSION]?.toIntOrNull() ?: return corrupt()
        if (protocolVersion != MeditationContract.PROTOCOL_VERSION) {
            return NativeMeditationSessionResult(NativeMeditationAvailability.PROTOCOL_INCOMPATIBLE, null)
        }
        val status = row[MeditationContract.COLUMN_STATUS]
        if (status == null || status !in knownStatuses) return corrupt()
        val requiredQualifiedSeconds = row[MeditationContract.COLUMN_REQUIRED_QUALIFIED_SECONDS]?.toIntOrNull()
        if (requiredQualifiedSeconds == null || requiredQualifiedSeconds < 0) return corrupt()
        val completedQualifiedSeconds = row[MeditationContract.COLUMN_COMPLETED_QUALIFIED_SECONDS]?.toIntOrNull()
        if (completedQualifiedSeconds == null || completedQualifiedSeconds < 0) return corrupt()
        val completedAtRaw = row[MeditationContract.COLUMN_COMPLETED_AT_EPOCH_MS]
        val completedAtEpochMs = completedAtRaw?.toLongOrNull()
        if (completedAtRaw != null && (completedAtEpochMs == null || completedAtEpochMs < 0L)) return corrupt()
        val lastUpdatedRaw = row[MeditationContract.COLUMN_LAST_UPDATED_AT_EPOCH_MS]
        val lastUpdatedAtEpochMs = lastUpdatedRaw?.toLongOrNull()
        if (lastUpdatedRaw != null && (lastUpdatedAtEpochMs == null || lastUpdatedAtEpochMs < 0L)) return corrupt()

        return NativeMeditationSessionResult(
            NativeMeditationAvailability.AVAILABLE,
            NativeMeditationSessionEvidence(
                sessionId = sessionId,
                protocolVersion = protocolVersion,
                status = status,
                requiredQualifiedSeconds = requiredQualifiedSeconds,
                completedQualifiedSeconds = completedQualifiedSeconds,
                completedAtEpochMs = completedAtEpochMs,
                lastUpdatedAtEpochMs = lastUpdatedAtEpochMs,
            ),
        )
    }

    internal fun availabilityForTrust(trust: CompanionTrustResult): NativeMeditationAvailability = when (trust) {
        CompanionTrustResult.TRUSTED -> NativeMeditationAvailability.AVAILABLE
        CompanionTrustResult.NOT_INSTALLED -> NativeMeditationAvailability.NOT_INSTALLED
        CompanionTrustResult.UNTRUSTED_SIGNATURE -> NativeMeditationAvailability.UNTRUSTED_SIGNATURE
        CompanionTrustResult.UNAVAILABLE -> NativeMeditationAvailability.UNAVAILABLE
    }

    internal fun availabilityString(availability: NativeMeditationAvailability): String = when (availability) {
        NativeMeditationAvailability.AVAILABLE -> "available"
        NativeMeditationAvailability.NOT_INSTALLED -> "not-installed"
        NativeMeditationAvailability.UNTRUSTED_SIGNATURE -> "untrusted-signature"
        NativeMeditationAvailability.PROTOCOL_INCOMPATIBLE -> "protocol-incompatible"
        NativeMeditationAvailability.SESSION_MISSING,
        NativeMeditationAvailability.CORRUPT,
        NativeMeditationAvailability.UNAVAILABLE -> "unavailable"
    }

    /** Probes the provider with an unknown session id to validate the v1 schema. */
    private fun probeProtocol(context: Context): NativeMeditationAvailability {
        val probeId = UUID.randomUUID().toString()
        return try {
            val cursor = context.contentResolver.query(statusUri(probeId), null, null, arrayOf(probeId), null)
                ?: return NativeMeditationAvailability.UNAVAILABLE
            cursor.use { probeAvailability(it) }
        } catch (_: Exception) {
            NativeMeditationAvailability.UNAVAILABLE
        }
    }

    private fun probeAvailability(cursor: Cursor): NativeMeditationAvailability {
        if (!hasRequiredColumns(cursor.columnNames.toList())) {
            return NativeMeditationAvailability.PROTOCOL_INCOMPATIBLE
        }
        if (cursor.moveToFirst()) {
            val version = cursor.readString(MeditationContract.COLUMN_PROTOCOL_VERSION)?.toIntOrNull()
            if (version != MeditationContract.PROTOCOL_VERSION) {
                return NativeMeditationAvailability.PROTOCOL_INCOMPATIBLE
            }
        }
        return NativeMeditationAvailability.AVAILABLE
    }

    private fun corrupt() = NativeMeditationSessionResult(NativeMeditationAvailability.CORRUPT, null)

    private fun hasRequiredColumns(columns: List<String>): Boolean = requiredColumns.all { it in columns }

    private fun statusUri(sessionId: String): Uri = Uri.Builder()
        .scheme("content")
        .authority(MeditationContract.STATUS_AUTHORITY)
        .appendPath("sessions")
        .appendPath(sessionId)
        .build()

    private fun Cursor.readRow(): Map<String, String?>? {
        if (!moveToFirst()) return null
        return columnNames.associateWith { readString(it) }
    }

    private fun Cursor.readString(column: String): String? {
        val index = getColumnIndex(column)
        if (index < 0 || isNull(index)) return null
        return getString(index)
    }
}
