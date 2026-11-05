package expo.modules.rhythmdevice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AccessLeasePersistenceTest {
    private fun lease(group: String, endsAt: Long = 1000L) =
        NativeAccessLease(group, setOf("$group.app"), endsAt)

    @Test
    fun `failed start does not persist or schedule and preserves unrelated leases`() {
        var accepted = listOf(lease("other"))
        var scheduled: NativeAccessLease? = null
        val saved = AccessLeasePersistence.start(
            existingLeases = accepted,
            newLease = lease("social"),
            persist = { updated ->
                if (false) accepted = updated
                false
            },
            scheduleExpiry = { scheduled = it },
        )
        assertFalse(saved)
        assertEquals(listOf("other"), accepted.map { it.groupId })
        assertEquals(null, scheduled)
    }

    @Test
    fun `successful start persists exact lease and schedules once`() {
        var accepted = listOf(lease("other"))
        var scheduled = 0
        val target = lease("social", 2000L)
        val saved = AccessLeasePersistence.start(
            existingLeases = accepted,
            newLease = target,
            persist = { updated -> accepted = updated; true },
            scheduleExpiry = { scheduled += 1 },
        )
        assertTrue(saved)
        assertEquals(setOf("other", "social"), accepted.map { it.groupId }.toSet())
        assertEquals(target, accepted.first { it.groupId == "social" })
        assertEquals(1, scheduled)
    }

    @Test
    fun `failed end preserves live lease and cancels nothing`() {
        var accepted = listOf(lease("other"), lease("social"))
        var cancelled = 0
        val saved = AccessLeasePersistence.end(
            existingLeases = accepted,
            groupId = "social",
            persist = { false },
            cancelExpiry = { cancelled += 1 },
        )
        assertFalse(saved)
        assertEquals(setOf("other", "social"), accepted.map { it.groupId }.toSet())
        assertEquals(0, cancelled)
    }

    @Test
    fun `successful end removes only target lease and cancels once`() {
        var accepted = listOf(lease("other"), lease("social"))
        var cancelled = 0
        val saved = AccessLeasePersistence.end(
            existingLeases = accepted,
            groupId = "social",
            persist = { updated -> accepted = updated; true },
            cancelExpiry = { cancelled += 1 },
        )
        assertTrue(saved)
        assertEquals(listOf("other"), accepted.map { it.groupId })
        assertEquals(1, cancelled)
    }

    @Test
    fun `ending an absent lease is an idempotent acknowledged no-op`() {
        val accepted = listOf(lease("other"))
        var persisted = 0
        var cancelled = 0
        val saved = AccessLeasePersistence.end(
            existingLeases = accepted,
            groupId = "social",
            persist = { persisted += 1; true },
            cancelExpiry = { cancelled += 1 },
        )
        assertTrue(saved)
        assertEquals(0, persisted)
        assertEquals(0, cancelled)
    }
}
