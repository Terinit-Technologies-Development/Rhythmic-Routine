package com.terinit.rhythmicroutine.sw005probe

import android.net.Uri
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.fail
import org.junit.Test

/**
 * SW-2026-005 A4 TEST-ONLY mismatched-signer negative probe.
 *
 * Run this class ONLY with a test APK signed by a disposable key that differs
 * from the shared provider key. The provider package must be installed and the
 * URI must be the same one used by a passing positive baseline; absence of the
 * provider or a malformed URI is a failure, never a "denial" pass.
 */
class MismatchedSignerProbeTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val arguments get() = InstrumentationRegistry.getArguments()

    private fun requiredArgument(name: String): String =
        arguments.getString(name)?.takeIf { it.isNotBlank() }
            ?: throw AssertionError("Missing instrumentation argument: $name")

    private fun requiredColumns(): List<String> =
        arguments.getString("requiredColumns")
            ?.split(',')
            ?.map { it.trim() }
            ?.filter { it.isNotEmpty() }
            ?: emptyList()

    @Test
    fun mismatchedSignerIsDeniedBySignaturePermission() {
        val providerUri = Uri.parse(requiredArgument("providerUri"))
        val providerPackage = requiredArgument("providerPackage")
        val columns = requiredColumns()

        if (providerUri.scheme != "content" || providerUri.authority.isNullOrBlank()) {
            fail("Negative probe URI is not a valid content:// provider URI")
        }
        // Prove the provider target exists before treating an exception as a
        // signature denial. A missing package must fail the test.
        context.packageManager.getPackageInfo(providerPackage, 0)

        // Preserve the positive query shape when a projection is supplied so
        // denial is attributable to signer verification, not a shape change.
        val projection = columns.takeIf { it.isNotEmpty() }?.toTypedArray()
        try {
            val cursor = context.contentResolver.query(providerUri, projection, null, null, null)
            cursor?.close()
            fail("Mismatched-signer caller was NOT denied by the provider")
        } catch (expected: SecurityException) {
            // Expected production caller-verification rejection.
        }
    }
}
