package expo.modules.rhythmdevice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.Calendar

/**
 * Pass 4 — Evening Wind-Down projection tests (pure JVM).
 *
 * Routine owns evening timing; the projection must never invent an
 * obligation and must handle cross-midnight windows correctly.
 */
class EveningSignalProviderTest {

    private fun window(
        startTime: String,
        endTime: String,
        activeDays: Set<Int> = setOf(1, 2, 3, 4, 5, 6, 7),
        enabled: Boolean = true,
        type: String = "evening-wind-down"
    ) = NativeRoutineWindow(
        id = "evening",
        type = type,
        startTime = startTime,
        endTime = endTime,
        activeDays = activeDays,
        protectedPackages = emptySet(),
        enabled = enabled
    )

    /** 2026-09-28 is a Monday (ISO day 1). 21:00 local. */
    private fun at(day: Int, hour: Int, minute: Int = 0): Long =
        Calendar.getInstance().apply {
            set(2026, 8, day, hour, minute, 0)
            set(Calendar.MILLISECOND, 0)
        }.timeInMillis

    @Test
    fun `inside a same-day evening window the signal is due`() {
        val signal = EveningSignalProvider.deriveSignal(
            window("20:00", "23:00"),
            "ad-20260928-0730",
            at(28, 21, 0)
        )
        assertNotNull(signal)
        assertEquals("ad-20260928-0730", signal!!.attentionDayId)
        assertEquals("due", signal.state)
        assertEquals(at(28, 20, 0), signal.dueAtEpochMs)
        assertEquals(at(28, 23, 0), signal.transitionAtEpochMs)
    }

    @Test
    fun `outside the window there is no signal (never an invented obligation)`() {
        assertNull(
            EveningSignalProvider.deriveSignal(
                window("20:00", "23:00"),
                "ad-20260928-0730",
                at(28, 14, 0)
            )
        )
    }

    @Test
    fun `cross-midnight window still covers the tail after midnight`() {
        // 21:00-01:00: at 00:30 on the 29th we are inside the 28th's window.
        val tail = EveningSignalProvider.deriveSignal(
            window("21:00", "01:00"),
            "ad-20260928-0730",
            at(29, 0, 30)
        )
        assertNotNull(tail)
        assertEquals(at(28, 21, 0), tail!!.dueAtEpochMs)
        assertEquals(at(29, 1, 0), tail.transitionAtEpochMs)

        // The head before midnight is covered too.
        val head = EveningSignalProvider.deriveSignal(
            window("21:00", "01:00"),
            "ad-20260928-0730",
            at(28, 22, 0)
        )
        assertNotNull(head)
        assertEquals(at(28, 21, 0), head!!.dueAtEpochMs)

        // After the tail ends, nothing.
        assertNull(
            EveningSignalProvider.deriveSignal(
                window("21:00", "01:00"),
                "ad-20260928-0730",
                at(29, 2, 0)
            )
        )
    }

    @Test
    fun `inactive days and disabled windows never signal`() {
        // 2026-09-28 is a Monday (ISO 1) — excluded here.
        assertNull(
            EveningSignalProvider.deriveSignal(
                window("20:00", "23:00", activeDays = setOf(2, 3, 4, 5, 6, 7)),
                "ad-20260928-0730",
                at(28, 21, 0)
            )
        )
        assertNull(
            EveningSignalProvider.deriveSignal(
                window("20:00", "23:00", enabled = false),
                "ad-20260928-0730",
                at(28, 21, 0)
            )
        )
    }

    @Test
    fun `missing or malformed windows never signal`() {
        assertNull(EveningSignalProvider.deriveSignal(null, "ad-20260928-0730", at(28, 21, 0)))
        assertNull(
            EveningSignalProvider.deriveSignal(
                window("25:00", "23:00"),
                "ad-20260928-0730",
                at(28, 21, 0)
            )
        )
        assertNull(
            EveningSignalProvider.deriveSignal(
                window("20:00", "23:00", type = "morning-buffer"),
                "ad-20260928-0730",
                at(28, 21, 0)
            )
        )
    }
}
