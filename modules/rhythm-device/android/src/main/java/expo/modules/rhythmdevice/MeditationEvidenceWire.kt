package expo.modules.rhythmdevice

/**
 * Native evidence -> Expo bridge wire conversion.
 *
 * The seven base columns remain unchanged. The three additive identity columns
 * are emitted only when the provider actually supplied self-describing identity
 * metadata. `sourceCooldownId` is intentionally nullable for MORNING_REQUIRED
 * and must be present as an explicit null, not omitted.
 */
object MeditationEvidenceWire {
    fun toWireMap(
        evidence: NativeMeditationSessionEvidence,
        identityMetadataAvailable: Boolean,
    ): Map<String, Any?> = buildMap {
        put(MeditationContract.COLUMN_SESSION_ID, evidence.sessionId)
        put(MeditationContract.COLUMN_PROTOCOL_VERSION, evidence.protocolVersion)
        put(MeditationContract.COLUMN_STATUS, evidence.status)
        put(MeditationContract.COLUMN_REQUIRED_QUALIFIED_SECONDS, evidence.requiredQualifiedSeconds)
        put(MeditationContract.COLUMN_COMPLETED_QUALIFIED_SECONDS, evidence.completedQualifiedSeconds)
        put(MeditationContract.COLUMN_COMPLETED_AT_EPOCH_MS, evidence.completedAtEpochMs?.toDouble())
        put(MeditationContract.COLUMN_LAST_UPDATED_AT_EPOCH_MS, evidence.lastUpdatedAtEpochMs?.toDouble())

        val sessionKind = evidence.sessionKind?.takeIf { it.isNotBlank() }
        val sourceDay = evidence.sourceRhythmicDayId?.takeIf { it.isNotBlank() }
        if (identityMetadataAvailable && sessionKind != null && sourceDay != null) {
            put(MeditationContract.COLUMN_SESSION_KIND, sessionKind)
            // Explicit null is part of the morning identity contract.
            put(MeditationContract.COLUMN_SOURCE_COOLDOWN_ID, evidence.sourceCooldownId)
            put(MeditationContract.COLUMN_SOURCE_RHYTHMIC_DAY_ID, sourceDay)
        }
    }
}
