package expo.modules.rhythmdevice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Blocker remediation: Routine's Accessibility Service detection must identify
 * Routine's exact service through normalized ComponentName comparison —
 * including relative class names and arbitrary whitespace — and must never
 * accept "any accessibility service enabled".
 */
class NativeServiceDetectionTest {

    private val expected = "com.terinit.rhythmicroutine/expo.modules.rhythmdevice.RhythmEnforcementService"

    @Test
    fun `exact flattened component names match`() {
        assertTrue(enabledServiceListContains(expected, expected))
        assertTrue(
            enabledServiceListContains(
                "$expected:com.other.app/com.other.app.SomeService",
                expected,
            ),
        )
    }

    @Test
    fun `relative class names are expanded against their package`() {
        assertTrue(
            enabledServiceListContains(
                "com.terinit.rhythmicroutine/.rhythmdevice.RhythmEnforcementService",
                "com.terinit.rhythmicroutine/com.terinit.rhythmicroutine.rhythmdevice.RhythmEnforcementService",
            ),
        )
    }

    @Test
    fun `other accessibility services are never accepted`() {
        assertFalse(
            enabledServiceListContains(
                "com.other.app/com.other.app.SomeService",
                expected,
            ),
        )
        assertFalse(enabledServiceListContains("", expected))
        assertFalse(enabledServiceListContains("   ", expected))
    }

    @Test
    fun `matching is exact and not a substring coincidence`() {
        assertFalse(
            enabledServiceListContains(
                "com.terinit.rhythmicroutine.fake/expo.modules.rhythmdevice.RhythmEnforcementService",
                expected,
            ),
        )
    }

    @Test
    fun `entry normalization handles junk entries`() {
        assertEquals("pkg/cls", normalizeEnabledServiceEntry(" pkg/cls "))
        assertEquals("pkg/pkg.Sub", normalizeEnabledServiceEntry("pkg/.Sub"))
        assertNull(normalizeEnabledServiceEntry(""))
        assertNull(normalizeEnabledServiceEntry("no-separator"))
        assertNull(normalizeEnabledServiceEntry("/LeadingSlash"))
        assertNull(normalizeEnabledServiceEntry("trailing/"))
    }
}
