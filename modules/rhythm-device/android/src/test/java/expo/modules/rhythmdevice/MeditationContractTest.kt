package expo.modules.rhythmdevice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class MeditationContractTest {
    private val request = mapOf<String, Any?>(
        MeditationContract.KEY_SESSION_ID to "1f0d0d1e-6a5b-4c2a-9d1e-2b3c4d5e6f70",
        MeditationContract.KEY_PROTOCOL_VERSION to 1,
        MeditationContract.KEY_SESSION_KIND to MeditationContract.SESSION_KIND_COOLDOWN_RESTORATIVE,
        MeditationContract.KEY_REQUIRED_QUALIFIED_SECONDS to 1800,
        MeditationContract.KEY_CREATED_AT_EPOCH_MS to 1790243200000L,
        MeditationContract.KEY_EXPIRES_AT_EPOCH_MS to 1790246800000L,
        MeditationContract.KEY_SOURCE_COOLDOWN_ID to "cooldown-1",
        MeditationContract.KEY_SOURCE_RISK_GROUP_ID to "social",
        MeditationContract.KEY_SOURCE_RHYTHMIC_DAY_ID to "2026-09-24",
    )

    @Test
    fun `valid request parses all payload fields`() {
        val parsed = MeditationContract.parseRequest(request)

        assertNotNull(parsed)
        assertEquals("1f0d0d1e-6a5b-4c2a-9d1e-2b3c4d5e6f70", parsed!!.sessionId)
        assertEquals(MeditationContract.SESSION_KIND_COOLDOWN_RESTORATIVE, parsed.sessionKind)
        assertEquals(1800, parsed.requiredQualifiedSeconds)
        assertEquals(1790243200000L, parsed.createdAtEpochMs)
        assertEquals(1790246800000L, parsed.expiresAtEpochMs)
        assertEquals("cooldown-1", parsed.sourceCooldownId)
        assertEquals("social", parsed.sourceRiskGroupId)
        assertEquals("2026-09-24", parsed.sourceRhythmicDayId)
    }

    @Test
    fun `optional fields are omitted when absent`() {
        val parsed = MeditationContract.parseRequest(request - setOf(
            MeditationContract.KEY_EXPIRES_AT_EPOCH_MS,
            MeditationContract.KEY_SOURCE_COOLDOWN_ID,
            MeditationContract.KEY_SOURCE_RISK_GROUP_ID,
            MeditationContract.KEY_SOURCE_RHYTHMIC_DAY_ID,
        ))

        assertNotNull(parsed)
        assertNull(parsed!!.expiresAtEpochMs)
        assertNull(parsed.sourceCooldownId)
        assertNull(parsed.sourceRiskGroupId)
        assertNull(parsed.sourceRhythmicDayId)
    }

    @Test
    fun `malformed optional fields are dropped without rejecting the request`() {
        val parsed = MeditationContract.parseRequest(request + mapOf<String, Any?>(
            MeditationContract.KEY_EXPIRES_AT_EPOCH_MS to -5L,
            MeditationContract.KEY_SOURCE_COOLDOWN_ID to 42,
        ))

        assertNotNull(parsed)
        assertNull(parsed!!.expiresAtEpochMs)
        assertNull(parsed.sourceCooldownId)
    }

    @Test
    fun `missing or malformed required fields reject the request`() {
        val cases = listOf(
            request - MeditationContract.KEY_SESSION_ID,
            request + (MeditationContract.KEY_SESSION_ID to ""),
            request + (MeditationContract.KEY_SESSION_ID to 7),
            request - MeditationContract.KEY_SESSION_KIND,
            request + (MeditationContract.KEY_SESSION_KIND to "EVENING_OPTIONAL"),
            request - MeditationContract.KEY_REQUIRED_QUALIFIED_SECONDS,
            request + (MeditationContract.KEY_REQUIRED_QUALIFIED_SECONDS to "1800"),
            request + (MeditationContract.KEY_REQUIRED_QUALIFIED_SECONDS to -1),
            request - MeditationContract.KEY_CREATED_AT_EPOCH_MS,
            request + (MeditationContract.KEY_CREATED_AT_EPOCH_MS to "now"),
            request + (MeditationContract.KEY_CREATED_AT_EPOCH_MS to -1L),
        )
        for (candidate in cases) {
            assertNull(MeditationContract.parseRequest(candidate))
        }
    }

    @Test
    fun `wire contract values are pinned`() {
        assertEquals("com.terinit.rhythmicmeditation.action.START_MEDITATION_RECOVERY", MeditationContract.ACTION_START_MEDITATION_RECOVERY)
        assertEquals("extra_request_payload", MeditationContract.EXTRA_REQUEST_PAYLOAD)
        assertEquals("com.terinit.rhythmicmeditation.status", MeditationContract.STATUS_AUTHORITY)
        assertEquals("com.terinit.rhythmicmeditation.app.MainActivity", MeditationContract.MEDITATION_ACTIVITY)
        assertEquals(1, MeditationContract.PROTOCOL_VERSION)
        assertEquals("MORNING_REQUIRED", MeditationContract.SESSION_KIND_MORNING_REQUIRED)
        assertEquals("COOLDOWN_RESTORATIVE", MeditationContract.SESSION_KIND_COOLDOWN_RESTORATIVE)
    }
}
