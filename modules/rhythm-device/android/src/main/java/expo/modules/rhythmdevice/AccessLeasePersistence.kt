package expo.modules.rhythmdevice

/**
 * Production lease mutation seam. Persistence acknowledgement is checked before
 * any expiry scheduler side effect; unrelated group leases are preserved.
 */
object AccessLeasePersistence {
    fun start(
        existingLeases: List<NativeAccessLease>,
        newLease: NativeAccessLease,
        persist: (List<NativeAccessLease>) -> Boolean,
        scheduleExpiry: (NativeAccessLease) -> Unit,
    ): Boolean {
        val updated = existingLeases.filter { it.groupId != newLease.groupId } + newLease
        val saved = persist(updated)
        if (saved) scheduleExpiry(newLease)
        return saved
    }

    fun end(
        existingLeases: List<NativeAccessLease>,
        groupId: String,
        persist: (List<NativeAccessLease>) -> Boolean,
        cancelExpiry: (String) -> Unit,
    ): Boolean {
        if (existingLeases.none { it.groupId == groupId }) return true
        val saved = persist(existingLeases.filter { it.groupId != groupId })
        if (saved) cancelExpiry(groupId)
        return saved
    }
}
