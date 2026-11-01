package expo.modules.rhythmdevice

import java.util.concurrent.ConcurrentHashMap

/**
 * Bounded fail-closed retry controller for a failed exhaustion commit. It keeps
 * the original immutable deadline, coalesces repeated failures for one group,
 * and schedules exactly one retry callback per group.
 */
internal class ExhaustionRetryController(
    private val delayMs: Long = 5_000L,
    private val schedule: (groupId: String, delayMs: Long, action: Runnable) -> Unit,
    private val cancel: (groupId: String, action: Runnable) -> Unit,
) {
    data class Pending(
        val groupId: String,
        val foregroundPackage: String,
        val startedAt: Long,
        val endsAt: Long,
        val attentionDayId: String,
    )

    private val pending = ConcurrentHashMap<String, Pending>()
    private val runnables = ConcurrentHashMap<String, Runnable>()

    fun pendingFor(groupId: String): Pending? = pending[groupId]
    fun isPending(groupId: String): Boolean = pending.containsKey(groupId)

    fun markFailed(
        intent: Pending,
        attempt: (Pending) -> Unit,
    ) {
        pending[intent.groupId] = intent
        runnables.remove(intent.groupId)?.let { cancel(intent.groupId, it) }
        val action = Runnable {
            runnables.remove(intent.groupId)
            val current = pending[intent.groupId] ?: intent
            attempt(current)
        }
        runnables[intent.groupId] = action
        schedule(intent.groupId, delayMs, action)
    }

    fun markConverged(groupId: String) {
        pending.remove(groupId)
        runnables.remove(groupId)?.let { cancel(groupId, it) }
    }

    fun clearAll() {
        runnables.forEach { (groupId, action) -> cancel(groupId, action) }
        runnables.clear()
        pending.clear()
    }
}

internal data class ExhaustionAttemptOutcome(
    val saved: Boolean,
    val converged: Boolean,
)

/**
 * Production attempt seam used for both the first exhaustion write and every
 * bounded retry. It catches commit throws as a failed attempt, retains the exact
 * pending deadline, coalesces retries, and invokes accepted/hold callbacks only
 * after the attempt outcome is known.
 */
internal object ExhaustionAttempt {
    fun run(
        intent: ExhaustionRetryController.Pending,
        retryController: ExhaustionRetryController,
        attempt: (ExhaustionRetryController.Pending) -> ExhaustionAttemptOutcome,
        onHold: (ExhaustionRetryController.Pending) -> Unit,
        onConverged: (ExhaustionRetryController.Pending, Boolean) -> Unit,
    ): ExhaustionAttemptOutcome {
        val outcome = try {
            attempt(intent)
        } catch (_: Throwable) {
            ExhaustionAttemptOutcome(saved = false, converged = false)
        }
        if (outcome.saved || outcome.converged) {
            retryController.markConverged(intent.groupId)
            onConverged(intent, outcome.saved)
        } else {
            onHold(intent)
            retryController.markFailed(intent) { retry ->
                run(retry, retryController, attempt, onHold, onConverged)
            }
        }
        return outcome
    }
}
