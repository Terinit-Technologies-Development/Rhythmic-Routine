package expo.modules.rhythmdevice

import android.content.Intent
import android.os.Bundle

/** Wire contract for the Rhythmic Meditation recovery IPC (protocol v1). */
object MeditationContract {
    const val MEDITATION_PACKAGE = "com.terinit.rhythmicmeditation"
    const val MEDITATION_ACTIVITY = "com.terinit.rhythmicmeditation.app.MainActivity"
    const val ACTION_START_MEDITATION_RECOVERY = "com.terinit.rhythmicmeditation.action.START_MEDITATION_RECOVERY"
    const val EXTRA_REQUEST_PAYLOAD = "extra_request_payload"
    const val STATUS_AUTHORITY = "com.terinit.rhythmicmeditation.status"
    const val PROTOCOL_VERSION = 1

    const val COLUMN_SESSION_ID = "sessionId"
    const val COLUMN_PROTOCOL_VERSION = "protocolVersion"
    const val COLUMN_STATUS = "status"
    const val COLUMN_REQUIRED_QUALIFIED_SECONDS = "requiredQualifiedSeconds"
    const val COLUMN_COMPLETED_QUALIFIED_SECONDS = "completedQualifiedSeconds"
    const val COLUMN_COMPLETED_AT_EPOCH_MS = "completedAtEpochMs"
    const val COLUMN_LAST_UPDATED_AT_EPOCH_MS = "lastUpdatedAtEpochMs"

    const val KEY_SESSION_ID = "session_id"
    const val KEY_PROTOCOL_VERSION = "protocol_version"
    const val KEY_SESSION_KIND = "session_kind"
    const val KEY_REQUIRED_QUALIFIED_SECONDS = "required_qualified_seconds"
    const val KEY_CREATED_AT_EPOCH_MS = "created_at_epoch_ms"
    const val KEY_EXPIRES_AT_EPOCH_MS = "expires_at_epoch_ms"
    const val KEY_SOURCE_COOLDOWN_ID = "source_cooldown_id"
    const val KEY_SOURCE_RISK_GROUP_ID = "source_risk_group_id"
    const val KEY_SOURCE_RHYTHMIC_DAY_ID = "source_rhythmic_day_id"

    const val SESSION_KIND_MORNING_REQUIRED = "MORNING_REQUIRED"
    const val SESSION_KIND_COOLDOWN_RESTORATIVE = "COOLDOWN_RESTORATIVE"

    /** Validated recovery request fields written into the payload Bundle. */
    data class MeditationRecoveryRequest(
        val sessionId: String,
        val sessionKind: String,
        val requiredQualifiedSeconds: Int,
        val createdAtEpochMs: Long,
        val expiresAtEpochMs: Long?,
        val sourceCooldownId: String?,
        val sourceRiskGroupId: String?,
        val sourceRhythmicDayId: String?,
    )

    fun buildRecoveryIntent(request: Map<String, Any?>): Intent? {
        val payload = buildRequestPayload(request) ?: return null
        return Intent(ACTION_START_MEDITATION_RECOVERY).apply {
            setClassName(MEDITATION_PACKAGE, MEDITATION_ACTIVITY)
            putExtra(EXTRA_REQUEST_PAYLOAD, payload)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
        }
    }

    fun buildRequestPayload(request: Map<String, Any?>): Bundle? {
        val parsed = parseRequest(request) ?: return null
        return Bundle().apply {
            putString(KEY_SESSION_ID, parsed.sessionId)
            putInt(KEY_PROTOCOL_VERSION, PROTOCOL_VERSION)
            putString(KEY_SESSION_KIND, parsed.sessionKind)
            putInt(KEY_REQUIRED_QUALIFIED_SECONDS, parsed.requiredQualifiedSeconds)
            putLong(KEY_CREATED_AT_EPOCH_MS, parsed.createdAtEpochMs)
            parsed.expiresAtEpochMs?.let { putLong(KEY_EXPIRES_AT_EPOCH_MS, it) }
            parsed.sourceCooldownId?.let { putString(KEY_SOURCE_COOLDOWN_ID, it) }
            parsed.sourceRiskGroupId?.let { putString(KEY_SOURCE_RISK_GROUP_ID, it) }
            parsed.sourceRhythmicDayId?.let { putString(KEY_SOURCE_RHYTHMIC_DAY_ID, it) }
        }
    }

    /**
     * Pure field extraction for the payload Bundle. Null when a required field is
     * missing or invalid; optional fields are omitted when absent or malformed.
     */
    internal fun parseRequest(request: Map<String, Any?>): MeditationRecoveryRequest? {
        val sessionId = (request[KEY_SESSION_ID] as? String)?.takeIf { it.isNotEmpty() } ?: return null
        val sessionKind = request[KEY_SESSION_KIND] as? String
        if (sessionKind != SESSION_KIND_MORNING_REQUIRED && sessionKind != SESSION_KIND_COOLDOWN_RESTORATIVE) return null
        val requiredQualifiedSeconds = (request[KEY_REQUIRED_QUALIFIED_SECONDS] as? Number)?.toInt()
        if (requiredQualifiedSeconds == null || requiredQualifiedSeconds < 0) return null
        val createdAtEpochMs = (request[KEY_CREATED_AT_EPOCH_MS] as? Number)?.toLong()
        if (createdAtEpochMs == null || createdAtEpochMs < 0L) return null
        return MeditationRecoveryRequest(
            sessionId = sessionId,
            sessionKind = sessionKind,
            requiredQualifiedSeconds = requiredQualifiedSeconds,
            createdAtEpochMs = createdAtEpochMs,
            expiresAtEpochMs = (request[KEY_EXPIRES_AT_EPOCH_MS] as? Number)?.toLong()?.takeIf { it >= 0L },
            sourceCooldownId = (request[KEY_SOURCE_COOLDOWN_ID] as? String)?.takeIf { it.isNotEmpty() },
            sourceRiskGroupId = (request[KEY_SOURCE_RISK_GROUP_ID] as? String)?.takeIf { it.isNotEmpty() },
            sourceRhythmicDayId = (request[KEY_SOURCE_RHYTHMIC_DAY_ID] as? String)?.takeIf { it.isNotEmpty() },
        )
    }
}
