package expo.modules.rhythmdevice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.locks.ReentrantLock

/**
 * F23 regression: the first attempt, scheduled retry, and already-committed
 * recovery branch must all acquire the production service monitor BEFORE the
 * NativePolicyPersistence monitor. The legacy opposite order is also exercised
 * with a bounded, non-leaking acquisition attempt.
 */
class ExhaustionLockOrderTest {
    private class FakeScheduler {
        val scheduled = mutableListOf<Pair<String, Long>>()
        val actions = mutableMapOf<String, Runnable>()
        fun controller() = ExhaustionRetryController(
            delayMs = 5_000L,
            schedule = { groupId, delay, action ->
                scheduled += groupId to delay
                actions[groupId] = action
            },
            cancel = { groupId, _ -> actions.remove(groupId) },
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
    fun `production retry holds service monitor before persistence and recovery progresses`() {
        val serviceMonitor = Any()
        val fake = FakeScheduler()
        val controller = fake.controller()
        val retryInPersistence = CountDownLatch(1)
        val releaseRetry = CountDownLatch(1)
        val initialStarted = CountDownLatch(1)
        val initialAttemptEntered = CountDownLatch(1)
        val recoveryBranchReached = AtomicBoolean(false)
        val attempts = AtomicInteger(0)

        val retryAttempt: (ExhaustionRetryController.Pending) -> ExhaustionAttemptOutcome = {
            val attempt = attempts.incrementAndGet()
            if (attempt == 1) {
                ExhaustionAttemptOutcome(saved = false, converged = false)
            } else {
                // This is the already-committed cooldown/recovery branch: the
                // attempt already holds the service monitor, then persistence,
                // and re-enters the monitor for recovery without inversion.
                NativePolicyPersistence.withReadSnapshot {
                    retryInPersistence.countDown()
                    assertTrue(releaseRetry.await(2, TimeUnit.SECONDS))
                    synchronized(serviceMonitor) {
                        recoveryBranchReached.set(true)
                    }
                }
                ExhaustionAttemptOutcome(saved = false, converged = true)
            }
        }

        val first = runExhaustionAttemptUnderServiceMonitor(
            serviceMonitor = serviceMonitor,
            intent = intent(),
            retryController = controller,
            attempt = retryAttempt,
            onHold = {},
            onConverged = { _, _ -> },
        )
        assertEquals(ExhaustionAttemptOutcome(false, false), first)
        assertEquals(listOf("social" to 5_000L), fake.scheduled)
        assertNotNull(fake.actions["social"])

        val retryThread = Thread {
            fake.actions.remove("social")?.run()
        }.apply {
            isDaemon = true
            start()
        }
        assertTrue(retryInPersistence.await(2, TimeUnit.SECONDS))

        val initialController = FakeScheduler().controller()
        val initialThread = Thread {
            initialStarted.countDown()
            runExhaustionAttemptUnderServiceMonitor(
                serviceMonitor = serviceMonitor,
                intent = intent(),
                retryController = initialController,
                attempt = {
                    initialAttemptEntered.countDown()
                    ExhaustionAttemptOutcome(saved = false, converged = true)
                },
                onHold = {},
                onConverged = { _, _ -> },
            )
        }.apply {
            isDaemon = true
            start()
        }

        assertTrue(initialStarted.await(2, TimeUnit.SECONDS))
        // The retry holds the production service monitor. A concurrent initial
        // attempt must not enter its persistence/attempt section yet.
        val initialEnteredWhileRetryHeldLock =
            initialAttemptEntered.await(500, TimeUnit.MILLISECONDS)
        releaseRetry.countDown()
        retryThread.join(2_000)
        initialThread.join(2_000)

        assertFalse(initialEnteredWhileRetryHeldLock)
        assertFalse(retryThread.isAlive)
        assertFalse(initialThread.isAlive)
        assertTrue(initialAttemptEntered.await(1, TimeUnit.SECONDS))
        assertTrue(recoveryBranchReached.get())
        assertFalse(controller.isPending("social"))
    }

    @Test
    fun `legacy persistence then service order cannot acquire service while initial holds it`() {
        val legacyServiceLock = ReentrantLock()
        val persistenceHeld = CountDownLatch(1)
        val serviceHeld = CountDownLatch(1)
        val legacyAcquiredService = AtomicBoolean(false)
        val initialCompleted = AtomicBoolean(false)

        val legacyRetry = Thread {
            NativePolicyPersistence.withReadSnapshot {
                persistenceHeld.countDown()
                assertTrue(serviceHeld.await(2, TimeUnit.SECONDS))
                // Bounded legacy acquisition: this is exactly the old
                // persistence -> service direction that could deadlock.
                legacyAcquiredService.set(
                    legacyServiceLock.tryLock(300, TimeUnit.MILLISECONDS)
                )
                if (legacyAcquiredService.get()) legacyServiceLock.unlock()
            }
        }.apply {
            isDaemon = true
            start()
        }

        val initial = Thread {
            legacyServiceLock.lock()
            serviceHeld.countDown()
            try {
                assertTrue(persistenceHeld.await(2, TimeUnit.SECONDS))
                NativePolicyPersistence.withReadSnapshot {
                    initialCompleted.set(true)
                }
            } finally {
                legacyServiceLock.unlock()
            }
        }.apply {
            isDaemon = true
            start()
        }

        legacyRetry.join(3_000)
        initial.join(3_000)

        assertFalse(legacyRetry.isAlive)
        assertFalse(initial.isAlive)
        assertFalse(legacyAcquiredService.get())
        assertTrue(initialCompleted.get())
    }
}
