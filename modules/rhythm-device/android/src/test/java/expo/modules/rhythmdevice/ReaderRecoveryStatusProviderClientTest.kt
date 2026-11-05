package expo.modules.rhythmdevice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ReaderRecoveryStatusProviderClientTest {
    private val sessionId = "reader-bound-session"

    private val columns = listOf(
        "sessionId",
        "protocolVersion",
        "status",
        "activeSeconds",
        "qualifiedPages",
        "completedAtEpochMs",
    )

    private fun row(
        sessionId: String? = this.sessionId,
        protocolVersion: String? = "1",
        status: String? = "COMPLETE",
        activeSeconds: String? = "1800",
        qualifiedPages: String? = "11",
        completedAtEpochMs: String? = "1790243200000",
    ) = mapOf(
        "sessionId" to sessionId,
        "protocolVersion" to protocolVersion,
        "status" to status,
        "activeSeconds" to activeSeconds,
        "qualifiedPages" to qualifiedPages,
        "completedAtEpochMs" to completedAtEpochMs,
    )

    private fun parse(
        columns: List<String> = this.columns,
        values: Map<String, String?> = row(),
    ) = ReaderRecoveryStatusProviderClient.parseSessionRow(
        sessionId,
        columns,
        values.filterKeys { it in columns },
    )

    @Test
    fun `valid complete row yields evidence`() {
        val result = parse()

        assertEquals(NativeReaderRecoveryAvailability.AVAILABLE, result.availability)
        assertNotNull(result.evidence)
        assertEquals(sessionId, result.evidence!!.sessionId)
        assertEquals(1, result.evidence!!.protocolVersion)
        assertEquals("COMPLETE", result.evidence!!.status)
        assertEquals(1800L, result.evidence!!.activeSeconds)
        assertEquals(11, result.evidence!!.qualifiedPages)

        val wire = ReaderRecoveryDetailedResultWire.toWireMap(result)
        assertEquals("available", wire["queryStatus"])
        assertEquals("available", wire["availability"])
        assertNotNull(wire["evidence"])
    }

    @Test
    fun `valid active row stays available but is not complete`() {
        val result = parse(values = row(status = "ACTIVE", completedAtEpochMs = "0"))

        assertEquals(NativeReaderRecoveryAvailability.AVAILABLE, result.availability)
        assertEquals("ACTIVE", result.evidence!!.status)
        assertEquals(0L, result.evidence!!.completedAtEpochMs)
    }

    @Test
    fun `missing row is session missing not completion`() {
        val result = ReaderRecoveryStatusProviderClient.parseSessionRow(sessionId, columns, null)

        assertEquals(NativeReaderRecoveryAvailability.SESSION_MISSING, result.availability)
        assertNull(result.evidence)
        assertEquals("session-missing", ReaderRecoveryDetailedResultWire.toWireMap(result)["queryStatus"])
    }

    @Test
    fun `missing required column is protocol incompatible`() {
        val result = parse(columns = columns - "qualifiedPages")

        assertEquals(NativeReaderRecoveryAvailability.PROTOCOL_INCOMPATIBLE, result.availability)
        assertNull(result.evidence)
    }

    @Test
    fun `wrong session id and protocol are rejected`() {
        val wrongSession = parse(values = row(sessionId = "other-session"))
        assertEquals(NativeReaderRecoveryAvailability.CORRUPT, wrongSession.availability)
        assertNull(wrongSession.evidence)

        val wrongProtocol = parse(values = row(protocolVersion = "2"))
        assertEquals(NativeReaderRecoveryAvailability.PROTOCOL_INCOMPATIBLE, wrongProtocol.availability)
        assertNull(wrongProtocol.evidence)
    }

    @Test
    fun `unknown status and malformed numbers are corrupt`() {
        for (values in listOf(
            row(status = "DONE"),
            row(activeSeconds = "abc"),
            row(activeSeconds = "-1"),
            row(qualifiedPages = "10.5"),
            row(completedAtEpochMs = "soon"),
        )) {
            val result = parse(values = values)
            assertEquals(NativeReaderRecoveryAvailability.CORRUPT, result.availability)
            assertNull(result.evidence)
        }
    }

    @Test
    fun `trust taxonomy is explicit and never treated as evidence`() {
        assertEquals(
            NativeReaderRecoveryAvailability.NOT_INSTALLED,
            ReaderRecoveryStatusProviderClient.availabilityForTrust(CompanionTrustResult.NOT_INSTALLED),
        )
        assertEquals(
            NativeReaderRecoveryAvailability.UNTRUSTED_SIGNATURE,
            ReaderRecoveryStatusProviderClient.availabilityForTrust(CompanionTrustResult.UNTRUSTED_SIGNATURE),
        )
        assertEquals(
            NativeReaderRecoveryAvailability.UNAVAILABLE,
            ReaderRecoveryStatusProviderClient.availabilityForTrust(CompanionTrustResult.UNAVAILABLE),
        )
        assertNull(
            ReaderRecoveryDetailedResultWire.toWireMap(
                ReaderRecoveryStatusProviderClient.parseSessionRow(
                    sessionId,
                    columns,
                    row(status = "DONE"),
                )
            )["evidence"]
        )
        assertTrue(
            ReaderRecoveryDetailedResultWire.unavailable()["queryStatus"] == "unavailable"
        )
    }
}
