package expo.modules.rhythmdevice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Calendar

class RoutineScheduleUpdateOrderTest {
    @Test
    fun `accepted schedule rechecks foreground only after morning reconciliation`() {
        val order = mutableListOf<String>()
        val committed = applyAcceptedRoutineScheduleChange(
            scheduleNextBoundary = { order += "reschedule" },
            reconcileMorning = {
                order += "reconcile"
                true
            },
            recheckForeground = { order += "recheck" },
        )

        assertTrue(committed)
        assertEquals(listOf("reschedule", "reconcile", "recheck"), order)
    }

    @Test
    fun `failed or throwing morning commit still rechecks the effective hold`() {
        var failedHoldEffective = false
        val failedOrder = mutableListOf<String>()
        val failed = applyAcceptedRoutineScheduleChange(
            scheduleNextBoundary = { failedOrder += "reschedule" },
            reconcileMorning = {
                failedOrder += "reconcile-false"
                failedHoldEffective = true
                false
            },
            recheckForeground = {
                failedOrder += "recheck"
                assertTrue(failedHoldEffective)
            },
        )
        assertFalse(failed)
        assertEquals(listOf("reschedule", "reconcile-false", "recheck"), failedOrder)

        var committedHoldEffective = false
        val committed = applyAcceptedRoutineScheduleChange(
            scheduleNextBoundary = {},
            reconcileMorning = {
                committedHoldEffective = true
                true
            },
            recheckForeground = { assertTrue(committedHoldEffective) },
        )
        assertTrue(committed)

        val threwOrder = mutableListOf<String>()
        val threw = applyAcceptedRoutineScheduleChange(
            scheduleNextBoundary = { threwOrder += "reschedule" },
            reconcileMorning = {
                threwOrder += "reconcile-throw"
                throw IllegalStateException("provider")
            },
            recheckForeground = { threwOrder += "recheck" },
        )
        assertFalse(threw)
        assertEquals(listOf("reschedule", "reconcile-throw", "recheck"), threwOrder)
    }

    @Test
    fun `native parser keeps semantic window order instead of sorting by id`() {
        val schedule = RhythmEnforcementService.parseRoutineScheduleInput(
            mapOf(
                "windows" to listOf(
                    window("z", "08:30"),
                    window("a", "07:30"),
                ),
                "allRiskPackages" to listOf("social.app"),
            )
        )

        assertEquals(listOf("z", "a"), schedule.windows.map { it.id })
    }

    @Test
    fun `first configured morning clock wins at the same boundary instant`() {
        val schedule = RhythmEnforcementService.parseRoutineScheduleInput(
            mapOf(
                "windows" to listOf(
                    window("z", "08:30"),
                    window("a", "07:30"),
                ),
                "allRiskPackages" to listOf("social.app"),
            )
        )
        val beforeBoundary = Calendar.getInstance().apply {
            set(2026, Calendar.SEPTEMBER, 28, 8, 0, 0)
            set(Calendar.MILLISECOND, 0)
        }.timeInMillis
        val current = NativeAttentionExchangeLogic.resolveAttentionDayState(
            beforeBoundary,
            schedule,
        )
        val next = Calendar.getInstance().apply {
            timeInMillis = current.nextBoundaryAt
        }

        assertEquals(8, next.get(Calendar.HOUR_OF_DAY))
        assertEquals(30, next.get(Calendar.MINUTE))
        assertEquals("ad-20260927-0830", current.id)
    }

    private fun window(id: String, endTime: String): Map<String, Any> = mapOf(
        "id" to id,
        "type" to "morning-buffer",
        "startTime" to "07:00",
        "endTime" to endTime,
        "activeDays" to listOf(1, 2, 3, 4, 5, 6, 7),
        "protectedPackages" to listOf("social.app"),
        "enabled" to true,
    )
}
