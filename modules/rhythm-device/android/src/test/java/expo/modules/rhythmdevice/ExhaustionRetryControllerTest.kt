package expo.modules.rhythmdevice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ExhaustionRetryControllerTest {
    private class FakeScheduler {
        val scheduled = mutableListOf<Pair<String, Long>>()
        val actions = mutableMapOf<String, Runnable>()
        val cancelled = mutableListOf<String>()

        fun controller() = ExhaustionRetryController(
            delayMs = 5_000L,
            schedule = { groupId, delay, action ->
                scheduled += groupId to delay
                actions[groupId] = action
            },
            cancel = { groupId, _ ->
                cancelled += groupId
                actions.remove(groupId)
            },
        )
    }

    private fun intent(groupId: String = "social") = ExhaustionRetryController.Pending(
        groupId = groupId,
        foregroundPackage = "$groupId.app",
        startedAt = 1_000L,
        endsAt = 91_000L,
        attentionDayId = "ad-20260924-0730",
    )

    @Test
    fun `failed commit keeps original deadline and schedules one bounded retry`() {
        val fake = FakeScheduler()
        val controller = fake.controller()
        var attempted: ExhaustionRetryController.Pending? = null
        controller.markFailed(intent()) { attempted = it }

        assertEquals(intent(), controller.pendingFor("social"))
        assertEquals(listOf("social" to 5_000L), fake.scheduled)
        assertNotNull(fake.actions["social"])

        // Repeated failure coalesces onto one callback and preserves original deadline.
        controller.markFailed(intent()) { attempted = it }
        assertEquals(1, fake.actions.size)
        assertEquals(2, fake.scheduled.size)
        fake.actions.remove("social")!!.run()
        assertEquals(intent(), attempted)
        assertTrue(controller.isPending("social"))
    }

    @Test
    fun `retry success clears pending and cancels no later callback`() {
        val fake = FakeScheduler()
        val controller = fake.controller()
        controller.markFailed(intent()) { retry ->
            assertEquals(intent(), retry)
            controller.markConverged(retry.groupId)
        }
        fake.actions.remove("social")!!.run()
        assertFalse(controller.isPending("social"))
        assertEquals(null, controller.pendingFor("social"))
    }

    @Test
    fun `attempt seam false then successful retry converges with original deadline`() {
        val fake = FakeScheduler()
        val controller = fake.controller()
        var attempts = 0
        var holds = 0
        var converged = 0
        val outcome = ExhaustionAttempt.run(
            intent = intent(),
            retryController = controller,
            attempt = {
                attempts += 1
                assertEquals(91_000L, it.endsAt)
                if (attempts == 1) ExhaustionAttemptOutcome(false, false)
                else ExhaustionAttemptOutcome(true, false)
            },
            onHold = { holds += 1 },
            onConverged = { _, _ -> converged += 1 },
        )
        assertEquals(ExhaustionAttemptOutcome(false, false), outcome)
        assertEquals(1, holds)
        assertEquals(0, converged)
        assertEquals(1, fake.scheduled.size)
        assertEquals(intent(), controller.pendingFor("social"))
        fake.actions.remove("social")!!.run()
        assertEquals(2, attempts)
        assertEquals(1, converged)
        assertFalse(controller.isPending("social"))
        assertEquals(0, fake.actions.size)
    }

    @Test
    fun `attempt seam catches throw and retains one pending deadline`() {
        val fake = FakeScheduler()
        val controller = fake.controller()
        var holds = 0
        val outcome = ExhaustionAttempt.run(
            intent = intent(),
            retryController = controller,
            attempt = { throw IllegalStateException("disk") },
            onHold = { holds += 1 },
            onConverged = { _, _ -> error("must not converge") },
        )
        assertEquals(ExhaustionAttemptOutcome(false, false), outcome)
        assertEquals(1, holds)
        assertEquals(intent(), controller.pendingFor("social"))
        assertEquals(listOf("social" to 5_000L), fake.scheduled)
    }

    @Test
    fun `converged attempt clears pending without hold`() {
        val fake = FakeScheduler()
        val controller = fake.controller()
        var holds = 0
        ExhaustionAttempt.run(
            intent = intent(),
            retryController = controller,
            attempt = { ExhaustionAttemptOutcome(false, true) },
            onHold = { holds += 1 },
            onConverged = { _, _ -> },
        )
        assertEquals(0, holds)
        assertFalse(controller.isPending("social"))
        assertTrue(fake.scheduled.isEmpty())
    }

    @Test
    fun `groups are independent and clearAll cancels pending callbacks`() {
        val fake = FakeScheduler()
        val controller = fake.controller()
        controller.markFailed(intent("social")) {}
        controller.markFailed(intent("video")) {}
        assertEquals(setOf("social", "video"), fake.actions.keys)
        controller.clearAll()
        assertFalse(controller.isPending("social"))
        assertFalse(controller.isPending("video"))
        assertTrue(fake.actions.isEmpty())
    }
}
