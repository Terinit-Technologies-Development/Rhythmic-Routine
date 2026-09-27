package expo.modules.rhythmdevice

import android.content.Context
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.content.pm.Signature
import android.os.Build
import java.security.MessageDigest
import java.util.Locale

enum class CompanionTrustResult {
    TRUSTED,
    NOT_INSTALLED,
    UNTRUSTED_SIGNATURE,
    UNAVAILABLE,
}

/**
 * Verifies that a companion package presents the same signing certificates as
 * Routine itself. Denied by default: missing packages, absent signers, and any
 * lookup error never verify.
 */
object CompanionTrust {
    fun verify(context: Context, packageName: String): CompanionTrustResult {
        return try {
            val pm = context.packageManager
            if (!isInstalled(pm, packageName)) {
                CompanionTrustResult.NOT_INSTALLED
            } else if (!hasSameSigner(signerDigests(pm, context.packageName), signerDigests(pm, packageName))) {
                CompanionTrustResult.UNTRUSTED_SIGNATURE
            } else {
                CompanionTrustResult.TRUSTED
            }
        } catch (_: Exception) {
            CompanionTrustResult.UNAVAILABLE
        }
    }

    /** Both packages must present the same non-empty set of signer certificate digests. */
    internal fun hasSameSigner(routineSignerDigests: Set<String>, companionSignerDigests: Set<String>): Boolean {
        if (routineSignerDigests.isEmpty() || companionSignerDigests.isEmpty()) return false
        return routineSignerDigests == companionSignerDigests
    }

    internal fun sha256Hex(bytes: ByteArray): String? = try {
        MessageDigest.getInstance("SHA-256").digest(bytes)
            .joinToString("") { String.format(Locale.ROOT, "%02x", it) }
    } catch (_: Exception) {
        null
    }

    private fun isInstalled(pm: PackageManager, packageName: String): Boolean = try {
        packageInfoOf(pm, packageName, 0)
        true
    } catch (_: PackageManager.NameNotFoundException) {
        false
    }

    private fun signerDigests(pm: PackageManager, packageName: String): Set<String> =
        signaturesOf(pm, packageName).mapNotNullTo(mutableSetOf()) { sha256Hex(it.toByteArray()) }

    @Suppress("DEPRECATION")
    private fun signaturesOf(pm: PackageManager, packageName: String): Array<Signature> {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val signingInfo = packageInfoOf(pm, packageName, PackageManager.GET_SIGNING_CERTIFICATES).signingInfo
                ?: return emptyArray()
            return signingInfo.apkContentsSigners ?: emptyArray()
        }
        return packageInfoOf(pm, packageName, PackageManager.GET_SIGNATURES).signatures ?: emptyArray()
    }

    private fun packageInfoOf(pm: PackageManager, packageName: String, flags: Int): PackageInfo =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            pm.getPackageInfo(packageName, PackageManager.PackageInfoFlags.of(flags.toLong()))
        } else {
            @Suppress("DEPRECATION")
            pm.getPackageInfo(packageName, flags)
        }
}
