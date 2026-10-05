package expo.modules.rhythmdevice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class MeditationStatusProviderClientTest {
    private val sessionId = "1f0d0d1e-6a5b-4c2a-9d1e-2b3c4d5e6f70"

    private val columns = listOf(
        MeditationContract.COLUMN_SESSION_ID,
        MeditationContract.COLUMN_PROTOCOL_VERSION,
        MeditationContract.COLUMN_STATUS,
        MeditationContract.COLUMN_REQUIRED_QUALIFIED_SECONDS,
        MeditationContract.COLUMN_COMPLETED_QUALIFIED_SECONDS,
        MeditationContract.COLUMN_COMPLETED_AT_EPOCH_MS,
        MeditationContract.COLUMN_LAST_UPDATED_AT_EPOCH_MS,
    )

    private fun row(
        sessionId: String? = this.sessionId,
        protocolVersion: String? = "1",
        status: String? = "COMPLETED",
        requiredQualifiedSeconds: String? = "1800",
        completedQualifiedSeconds: String? = "1800",
        completedAtEpochMs: String? = "1790243200000",
        lastUpdatedAtEpochMs: String? = "1790243260000",
    ) = mapOf(
        MeditationContract.COLUMN_SESSION_ID to sessionId,
        MeditationContract.COLUMN_PROTOCOL_VERSION to protocolVersion,
        MeditationContract.COLUMN_STATUS to status,
        MeditationContract.COLUMN_REQUIRED_QUALIFIED_SECONDS to requiredQualifiedSeconds,
        MeditationContract.COLUMN_COMPLETED_QUALIFIED_SECONDS to completedQualifiedSeconds,
        MeditationContract.COLUMN_COMPLETED_AT_EPOCH_MS to completedAtEpochMs,
        MeditationContract.COLUMN_LAST_UPDATED_AT_EPOCH_MS to lastUpdatedAtEpochMs,
    )

    @Test
    fun `valid row parses into available evidence`() {
        val result = MeditationStatusProviderClient.parseSessionRow(sessionId, columns, row())

        assertEquals(NativeMeditationAvailability.AVAILABLE, result.availability)
        assertNotNull(result.evidence)
        assertEquals(sessionId, result.evidence!!.sessionId)
        assertEquals(1, result.evidence!!.protocolVersion)
        assertEquals("COMPLETED", result.evidence!!.status)
        assertEquals(1800, result.evidence!!.requiredQualifiedSeconds)
        assertEquals(1800, result.evidence!!.completedQualifiedSeconds)
        assertEquals(1790243200000L, result.evidence!!.completedAtEpochMs)
        assertEquals(1790243260000L, result.evidence!!.lastUpdatedAtEpochMs)
    }

    @Test
    fun `missing row is session missing and never trusted`() {
        val result = MeditationStatusProviderClient.parseSessionRow(sessionId, columns, null)

        assertEquals(NativeMeditationAvailability.SESSION_MISSING, result.availability)
        assertNull(result.evidence)
    }

    @Test
    fun `missing columns are protocol incompatible`() {
        val truncated = columns - MeditationContract.COLUMN_COMPLETED_QUALIFIED_SECONDS

        val withRow = MeditationStatusProviderClient.parseSessionRow(sessionId, truncated, row())
        assertEquals(NativeMeditationAvailability.PROTOCOL_INCOMPATIBLE, withRow.availability)
        assertNull(withRow.evidence)

        val withoutRow = MeditationStatusProviderClient.parseSessionRow(sessionId, truncated, null)
        assertEquals(NativeMeditationAvailability.PROTOCOL_INCOMPATIBLE, withoutRow.availability)
        assertNull(withoutRow.evidence)
    }

    @Test
    fun `evidence for another session id is corrupt`() {
        val result = MeditationStatusProviderClient.parseSessionRow(sessionId, columns, row(sessionId = "other-session"))

        assertEquals(NativeMeditationAvailability.CORRUPT, result.availability)
        assertNull(result.evidence)
    }

    @Test
    fun `protocol version other than one is incompatible`() {
        val result = MeditationStatusProviderClient.parseSessionRow(sessionId, columns, row(protocolVersion = "2"))

        assertEquals(NativeMeditationAvailability.PROTOCOL_INCOMPATIBLE, result.availability)
        assertNull(result.evidence)
    }

    @Test
    fun `malformed protocol version is corrupt`() {
        val result = MeditationStatusProviderClient.parseSessionRow(sessionId, columns, row(protocolVersion = "one"))

        assertEquals(NativeMeditationAvailability.CORRUPT, result.availability)
        assertNull(result.evidence)
    }

    @Test
    fun `unknown or missing status is corrupt`() {
        val unknown = MeditationStatusProviderClient.parseSessionRow(sessionId, columns, row(status = "DONE"))
        assertEquals(NativeMeditationAvailability.CORRUPT, unknown.availability)
        assertNull(unknown.evidence)

        val missing = MeditationStatusProviderClient.parseSessionRow(sessionId, columns, row(status = null))
        assertEquals(NativeMeditationAvailability.CORRUPT, missing.availability)
        assertNull(missing.evidence)
    }

    @Test
    fun `malformed numeric fields are corrupt`() {
        val cases = listOf(
            row(requiredQualifiedSeconds = "abc"),
            row(requiredQualifiedSeconds = "-1"),
            row(completedQualifiedSeconds = "12.5"),
            row(completedAtEpochMs = "soon"),
            row(completedAtEpochMs = "-1790243200000"),
            row(lastUpdatedAtEpochMs = ""),
        )
        for (candidate in cases) {
            val result = MeditationStatusProviderClient.parseSessionRow(sessionId, columns, candidate)
            assertEquals(NativeMeditationAvailability.CORRUPT, result.availability)
            assertNull(result.evidence)
        }
    }

    @Test
    fun `nullable timestamps may be null but required fields may not`() {
        val result = MeditationStatusProviderClient.parseSessionRow(
            sessionId,
            columns,
            row(completedAtEpochMs = null, lastUpdatedAtEpochMs = null),
        )

        assertEquals(NativeMeditationAvailability.AVAILABLE, result.availability)
        assertNotNull(result.evidence)
        assertNull(result.evidence!!.completedAtEpochMs)
        assertNull(result.evidence!!.lastUpdatedAtEpochMs)

        val missingSession = MeditationStatusProviderClient.parseSessionRow(sessionId, columns, row(sessionId = null))
        assertEquals(NativeMeditationAvailability.CORRUPT, missingSession.availability)
        assertNull(missingSession.evidence)
    }

    @Test
    fun `trust results map to availability states`() {
        assertEquals(NativeMeditationAvailability.AVAILABLE, MeditationStatusProviderClient.availabilityForTrust(CompanionTrustResult.TRUSTED))
        assertEquals(NativeMeditationAvailability.NOT_INSTALLED, MeditationStatusProviderClient.availabilityForTrust(CompanionTrustResult.NOT_INSTALLED))
        assertEquals(NativeMeditationAvailability.UNTRUSTED_SIGNATURE, MeditationStatusProviderClient.availabilityForTrust(CompanionTrustResult.UNTRUSTED_SIGNATURE))
        assertEquals(NativeMeditationAvailability.UNAVAILABLE, MeditationStatusProviderClient.availabilityForTrust(CompanionTrustResult.UNAVAILABLE))
    }

    @Test
    fun `availability strings match the bridge contract`() {
        assertEquals("available", MeditationStatusProviderClient.availabilityString(NativeMeditationAvailability.AVAILABLE))
        assertEquals("not-installed", MeditationStatusProviderClient.availabilityString(NativeMeditationAvailability.NOT_INSTALLED))
        assertEquals("untrusted-signature", MeditationStatusProviderClient.availabilityString(NativeMeditationAvailability.UNTRUSTED_SIGNATURE))
        assertEquals("protocol-incompatible", MeditationStatusProviderClient.availabilityString(NativeMeditationAvailability.PROTOCOL_INCOMPATIBLE))
        assertEquals("unavailable", MeditationStatusProviderClient.availabilityString(NativeMeditationAvailability.SESSION_MISSING))
        assertEquals("unavailable", MeditationStatusProviderClient.availabilityString(NativeMeditationAvailability.CORRUPT))
        assertEquals("unavailable", MeditationStatusProviderClient.availabilityString(NativeMeditationAvailability.UNAVAILABLE))
    }
}
