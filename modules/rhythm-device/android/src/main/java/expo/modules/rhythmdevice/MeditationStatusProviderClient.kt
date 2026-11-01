package expo.modules.rhythmdevice

import android.content.Context
import android.database.Cursor
import android.net.Uri
import java.util.UUID

enum class NativeMeditationAvailability {
    NOT_INSTALLED,
    UNTRUSTED_SIGNATURE,
    PERMISSION_DENIED,
    PROTOCOL_INCOMPATIBLE,
    SESSION_MISSING,
    CORRUPT,
    AVAILABLE,
    QUERY_FAILED,
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
    val sessionKind: String? = null,
    val sourceCooldownId: String? = null,
    val sourceRhythmicDayId: String? = null,
)

data class NativeMeditationSessionResult(
    val availability: NativeMeditationAvailability,
    val evidence: NativeMeditationSessionEvidence?,
    val identityMetadataAvailable: Boolean = false,
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

    private val identityColumns = listOf(
        MeditationContract.COLUMN_SESSION_KIND,
        MeditationContract.COLUMN_SOURCE_COOLDOWN_ID,
        MeditationContract.COLUMN_SOURCE_RHYTHMIC_DAY_ID,
    )

    /** Explicitly request the 7 base columns plus the 3 additive identity columns. */
    private val identityProjection = (requiredColumns.toList() + identityColumns).toTypedArray()

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
            queryWithProjection(context, sessionId, identityProjection)
                ?: fallbackBaseProjection(context, sessionId)
        } catch (_: SecurityException) {
            NativeMeditationSessionResult(NativeMeditationAvailability.PERMISSION_DENIED, null)
        } catch (_: Exception) {
            // An older provider may reject additive columns. Re-query the frozen
            // seven-column shape ONLY to classify the capability limitation; it
            // never yields identity metadata and can never satisfy a gate.
            fallbackBaseProjection(context, sessionId)
        }
    }

    private fun queryWithProjection(
        context: Context,
        sessionId: String,
        projection: Array<String>,
    ): NativeMeditationSessionResult? {
        val cursor = context.contentResolver.query(statusUri(sessionId), projection, null, arrayOf(sessionId), null)
            ?: return NativeMeditationSessionResult(NativeMeditationAvailability.UNAVAILABLE, null)
        return cursor.use { parseSessionRow(sessionId, it.columnNames.toList(), it.readRow()) }
    }

    private fun fallbackBaseProjection(
        context: Context,
        sessionId: String,
    ): NativeMeditationSessionResult {
        val base = requiredColumns.toTypedArray()
        return try {
            val cursor = context.contentResolver.query(statusUri(sessionId), base, null, arrayOf(sessionId), null)
                ?: return NativeMeditationSessionResult(NativeMeditationAvailability.UNAVAILABLE, null)
            cursor.use {
                val parsed = parseSessionRow(sessionId, it.columnNames.toList(), it.readRow())
                parsed.copy(identityMetadataAvailable = false)
            }
        } catch (_: SecurityException) {
            NativeMeditationSessionResult(NativeMeditationAvailability.PERMISSION_DENIED, null)
        } catch (_: Exception) {
            NativeMeditationSessionResult(NativeMeditationAvailability.QUERY_FAILED, null)
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

        val identityMetadataAvailable = identityColumns.all { it in columns }
        val sessionKind = row[MeditationContract.COLUMN_SESSION_KIND]?.takeIf { it.isNotEmpty() }
        val sourceCooldownId = row[MeditationContract.COLUMN_SOURCE_COOLDOWN_ID]?.takeIf { it.isNotEmpty() }
        val sourceRhythmicDayId = row[MeditationContract.COLUMN_SOURCE_RHYTHMIC_DAY_ID]?.takeIf { it.isNotEmpty() }

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
                sessionKind = sessionKind,
                sourceCooldownId = sourceCooldownId,
                sourceRhythmicDayId = sourceRhythmicDayId,
            ),
            identityMetadataAvailable = identityMetadataAvailable,
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
        NativeMeditationAvailability.PERMISSION_DENIED -> "permission-denied"
        NativeMeditationAvailability.PROTOCOL_INCOMPATIBLE -> "protocol-incompatible"
        NativeMeditationAvailability.SESSION_MISSING,
        NativeMeditationAvailability.CORRUPT,
        NativeMeditationAvailability.QUERY_FAILED,
        NativeMeditationAvailability.UNAVAILABLE -> "unavailable"
    }

    /** Additive detailed query status; distinguishes failures from absence. */
    internal fun queryStatusString(availability: NativeMeditationAvailability): String = when (availability) {
        NativeMeditationAvailability.AVAILABLE -> "available"
        NativeMeditationAvailability.NOT_INSTALLED -> "not-installed"
        NativeMeditationAvailability.UNTRUSTED_SIGNATURE -> "untrusted-signature"
        NativeMeditationAvailability.PERMISSION_DENIED -> "permission-denied"
        NativeMeditationAvailability.PROTOCOL_INCOMPATIBLE -> "protocol-incompatible"
        NativeMeditationAvailability.SESSION_MISSING -> "session-missing"
        NativeMeditationAvailability.CORRUPT -> "corrupt"
        NativeMeditationAvailability.QUERY_FAILED -> "query-failed"
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
