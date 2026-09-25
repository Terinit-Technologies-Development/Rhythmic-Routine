package expo.modules.rhythmdevice

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeResetIntegrityTest {
  @Test
  fun successfulPersistenceClearCompletesResetAndResetsRuntime() {
    var runtimeReset = false

    val completed = finishNativePolicyReset(cleared = true) {
      runtimeReset = true
    }

    assertTrue(completed)
    assertTrue(runtimeReset)
  }

  @Test
  fun failedPersistenceClearDoesNotCompleteResetOrResetRuntime() {
    var runtimeReset = false

    val completed = finishNativePolicyReset(cleared = false) {
      runtimeReset = true
    }

    assertFalse(completed)
    assertFalse(runtimeReset)
  }
}
