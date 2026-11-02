package com.terinit.rhythmicroutine.sw005probe

import android.net.Uri
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * SW-2026-005 A4 TEST-ONLY positive IPC probe.
 * Signed with the shared QA key. Queries only the supplied existing provider
 * URI; no writes, grants, seeding or settings changes.
 */
class SharedSignerProbeTest {
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
    fun signatureProtectedProviderIsReadableUnderSharedSigner() {
        val providerUri = Uri.parse(requiredArgument("providerUri"))
        val providerPackage = requiredArgument("providerPackage")
        val columns = requiredColumns()

        assertTrue("providerUri must use content://", providerUri.scheme == "content")
        assertNotNull("providerUri must declare an authority", providerUri.authority)
        // If the target package/provider is absent this throws NameNotFoundException
        // and the positive probe fails rather than reporting a false pass.
        context.packageManager.getPackageInfo(providerPackage, 0)

        // Use the configured projection when supplied. A2 exposes identity
        // columns only on explicit projection; a null projection intentionally
        // tests the provider's default shape instead. Zero rows remain a valid
        // neutral response; this probe checks signature access and schema only.
        val projection = columns.takeIf { it.isNotEmpty() }?.toTypedArray()
        val cursor = context.contentResolver.query(providerUri, projection, null, null, null)
            ?: throw AssertionError("Shared-signer query returned no cursor for ${providerUri.authority}")
        cursor.use {
            assertTrue("Provider returned an empty projection", it.columnCount > 0)
            for (column in columns) {
                assertTrue(
                    "Required provider column '$column' is missing; received ${it.columnNames.joinToString(",")}",
                    it.getColumnIndex(column) >= 0
                )
            }
        }
    }
}
