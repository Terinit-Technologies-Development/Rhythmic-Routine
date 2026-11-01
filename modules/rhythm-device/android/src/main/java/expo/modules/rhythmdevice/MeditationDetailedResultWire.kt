package expo.modules.rhythmdevice

/** Additive Expo wire result for detailed Meditation status queries. */
object MeditationDetailedResultWire {
    fun toWireMap(result: NativeMeditationSessionResult): Map<String, Any?> = linkedMapOf(
        "queryStatus" to MeditationStatusProviderClient.queryStatusString(result.availability),
        "availability" to MeditationStatusProviderClient.availabilityString(result.availability),
        "identityMetadataAvailable" to result.identityMetadataAvailable,
        "evidence" to result.evidence?.let {
            MeditationEvidenceWire.toWireMap(it, result.identityMetadataAvailable)
        },
    )

    fun unavailable(): Map<String, Any?> = toWireMap(
        NativeMeditationSessionResult(
            NativeMeditationAvailability.UNAVAILABLE,
            null,
            identityMetadataAvailable = false,
        )
    )
}
