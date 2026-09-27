package expo.modules.rhythmdevice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CompanionTrustTest {
    private val digestA = "aa".repeat(32)
    private val digestB = "bb".repeat(32)

    @Test
    fun `same non-empty signer digests verify`() {
        assertTrue(CompanionTrust.hasSameSigner(setOf(digestA), setOf(digestA)))
        assertTrue(CompanionTrust.hasSameSigner(setOf(digestA, digestB), setOf(digestB, digestA)))
    }

    @Test
    fun `different signer digests do not verify`() {
        assertFalse(CompanionTrust.hasSameSigner(setOf(digestA), setOf(digestB)))
    }

    @Test
    fun `absent signer digests never verify`() {
        assertFalse(CompanionTrust.hasSameSigner(emptySet(), emptySet()))
        assertFalse(CompanionTrust.hasSameSigner(setOf(digestA), emptySet()))
        assertFalse(CompanionTrust.hasSameSigner(emptySet(), setOf(digestA)))
    }

    @Test
    fun `partial signer overlap never verifies`() {
        assertFalse(CompanionTrust.hasSameSigner(setOf(digestA, digestB), setOf(digestA)))
        assertFalse(CompanionTrust.hasSameSigner(setOf(digestA), setOf(digestA, digestB)))
    }

    @Test
    fun `sha256 hex digests match known vectors`() {
        assertEquals(
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            CompanionTrust.sha256Hex(ByteArray(0)),
        )
        assertEquals(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            CompanionTrust.sha256Hex("abc".toByteArray()),
        )
    }
}
