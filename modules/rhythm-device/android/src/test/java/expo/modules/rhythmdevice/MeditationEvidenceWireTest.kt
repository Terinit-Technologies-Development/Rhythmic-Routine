package expo.modules.rhythmdevice

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MeditationEvidenceWireTest {
    private val baseColumns = listOf(
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

    private fun row(
        sessionKind: String? = "MORNING_REQUIRED",
        sourceCooldownId: String? = null,
        sourceDay: String? = "ad-20260928-0830",
        sessionId: String = "morning-ad-20260928-0830",
        protocolVersion: String = "1",
        status: String = "COMPLETED",
    ): Map<String, String?> = mapOf(
        MeditationContract.COLUMN_SESSION_ID to sessionId,
        MeditationContract.COLUMN_PROTOCOL_VERSION to protocolVersion,
        MeditationContract.COLUMN_STATUS to status,
        MeditationContract.COLUMN_REQUIRED_QUALIFIED_SECONDS to "1800",
        MeditationContract.COLUMN_COMPLETED_QUALIFIED_SECONDS to "1800",
        MeditationContract.COLUMN_COMPLETED_AT_EPOCH_MS to "1790243200000",
        MeditationContract.COLUMN_LAST_UPDATED_AT_EPOCH_MS to "1790243260000",
        MeditationContract.COLUMN_SESSION_KIND to sessionKind,
        MeditationContract.COLUMN_SOURCE_COOLDOWN_ID to sourceCooldownId,
        MeditationContract.COLUMN_SOURCE_RHYTHMIC_DAY_ID to sourceDay,
    )

    private fun parse(
        columns: List<String>,
        values: Map<String, String?> = row(),
    ): NativeMeditationSessionResult =
        MeditationStatusProviderClient.parseSessionRow(
            "morning-ad-20260928-0830",
            columns,
            values,
        )

    private fun assertNoIdentity(wire: Map<String, Any?>) {
        assertFalse(wire.containsKey(MeditationContract.COLUMN_SESSION_KIND))
        assertFalse(wire.containsKey(MeditationContract.COLUMN_SOURCE_COOLDOWN_ID))
        assertFalse(wire.containsKey(MeditationContract.COLUMN_SOURCE_RHYTHMIC_DAY_ID))
        assertEquals(1, wire[MeditationContract.COLUMN_PROTOCOL_VERSION])
        assertEquals(1800, wire[MeditationContract.COLUMN_REQUIRED_QUALIFIED_SECONDS])
    }

    @Test
    fun `ten-column morning with explicit null cooldown preserves identity`() {
        val result = parse(baseColumns + identityColumns)
        assertTrue(result.identityMetadataAvailable)
        val wire = MeditationEvidenceWire.toWireMap(result.evidence!!, result.identityMetadataAvailable)
        assertTrue(wire.containsKey(MeditationContract.COLUMN_SOURCE_COOLDOWN_ID))
        assertNull(wire[MeditationContract.COLUMN_SOURCE_COOLDOWN_ID])
        assertEquals("MORNING_REQUIRED", wire[MeditationContract.COLUMN_SESSION_KIND])
        assertEquals("ad-20260928-0830", wire[MeditationContract.COLUMN_SOURCE_RHYTHMIC_DAY_ID])
    }

    @Test
    fun `ten-column cooldown preserves non-null source`() {
        val result = parse(
            baseColumns + identityColumns,
            row(sessionKind = "COOLDOWN_RESTORATIVE", sourceCooldownId = "gate-social-o4"),
        )
        assertTrue(result.identityMetadataAvailable)
        val wire = MeditationEvidenceWire.toWireMap(result.evidence!!, result.identityMetadataAvailable)
        assertEquals("gate-social-o4", wire[MeditationContract.COLUMN_SOURCE_COOLDOWN_ID])
    }

    @Test
    fun `seven-column legacy is not upgraded`() {
        val result = parse(baseColumns)
        assertTrue(result.availability == NativeMeditationAvailability.AVAILABLE)
        assertFalse(result.identityMetadataAvailable)
        assertNoIdentity(MeditationEvidenceWire.toWireMap(result.evidence!!, result.identityMetadataAvailable))
    }

    @Test
    fun `partial identity columns present fields are not upgraded`() {
        val missingCooldownColumn = baseColumns + MeditationContract.COLUMN_SESSION_KIND +
            MeditationContract.COLUMN_SOURCE_RHYTHMIC_DAY_ID
        val result = parse(missingCooldownColumn, row(sourceCooldownId = "should-not-count"))
        assertFalse(result.identityMetadataAvailable)
        assertNoIdentity(MeditationEvidenceWire.toWireMap(result.evidence!!, result.identityMetadataAvailable))

        val missingKindAndDay = baseColumns + MeditationContract.COLUMN_SOURCE_COOLDOWN_ID
        val second = parse(missingKindAndDay)
        assertFalse(second.identityMetadataAvailable)
        assertNoIdentity(MeditationEvidenceWire.toWireMap(second.evidence!!, second.identityMetadataAvailable))
    }

    @Test
    fun `explicit fallback false is honored even with populated identity fields`() {
        val result = parse(baseColumns + identityColumns)
        val forcedFallback = result.copy(identityMetadataAvailable = false)
        assertNoIdentity(
            MeditationEvidenceWire.toWireMap(
                forcedFallback.evidence!!,
                forcedFallback.identityMetadataAvailable,
            )
        )
    }

    @Test
    fun `malformed wrong id protocol and unknown session produce no evidence`() {
        for (result in listOf(
            parse(baseColumns, row(sessionId = "other-session")),
            parse(baseColumns, row(protocolVersion = "2")),
            parse(baseColumns, row(status = "DONE")),
            Meditations.empty(),
        )) {
            assertNull(result.evidence)
        }
    }

    private object Meditations {
        fun empty(): NativeMeditationSessionResult = NativeMeditationSessionResult(
            NativeMeditationAvailability.SESSION_MISSING,
            null,
        )
    }

    @Test
    fun `shared golden fixture matches actual production converter`() {
        val values = fixtureValues()
        val result = parse(baseColumns + identityColumns)
        val wire = MeditationEvidenceWire.toWireMap(result.evidence!!, result.identityMetadataAvailable)
        assertEquals(values.keys, wire.keys)
        for ((key, expected) in values) {
            if (expected == "null") {
                assertNull(wire[key])
            } else {
                val actual = wire[key]
                assertNotNull(actual)
                val rendered = if (actual is Number) actual.toLong().toString() else actual.toString()
                assertEquals(expected, rendered)
            }
        }
    }

    private fun fixtureValues(): Map<String, String> {
        var dir: File? = File(System.getProperty("user.dir") ?: ".")
        while (dir != null) {
            for (candidate in listOf(
                File(dir, "test-fixtures/meditation-wire-morning-null.txt"),
                File(dir, "modules/rhythm-device/test-fixtures/meditation-wire-morning-null.txt"),
            )) {
                if (candidate.isFile) {
                    return candidate.readLines()
                        .filter { it.contains('=') }
                        .associate { line ->
                            val separator = line.indexOf('=')
                            line.substring(0, separator) to line.substring(separator + 1)
                        }
                }
            }
            dir = dir.parentFile
        }
        error("shared meditation wire fixture not found")
    }
}
