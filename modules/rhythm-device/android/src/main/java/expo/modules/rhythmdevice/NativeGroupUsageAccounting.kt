package expo.modules.rhythmdevice

data class NativeGroupExhaustionAccounting(
    val usage: NativeGroupAllowanceUsage,
    val accountedThrough: Long,
)

/** Pure accounting-boundary calculations shared by native exhaustion and UsageStats reconciliation. */
object NativeGroupUsageAccounting {
    fun hasCommittedExhaustion(
        groupId: String,
        dateKey: String,
        usage: NativeGroupAllowanceUsage?,
        cooldowns: Map<String, NativeCooldownPolicy>,
        gates: Map<String, NativeReadingGate>,
    ): Boolean =
        (usage?.dateKey == dateKey && usage.exhaustedAt != null) ||
            cooldowns.containsKey(groupId) ||
            gates[groupId]?.attentionDateKey == dateKey

    fun prepareExhaustion(
        groupId: String,
        dateKey: String,
        now: Long,
        localMidnight: Long,
        allowanceMillis: Long,
        previousUsage: NativeGroupAllowanceUsage?,
        activeSegmentStartedAt: Long?,
        existingWatermark: Long?,
    ): NativeGroupExhaustionAccounting {
        val sameDayUsage = previousUsage?.takeIf { it.dateKey == dateKey }
        val accumulatedMillis = if (activeSegmentStartedAt != null && sameDayUsage != null) {
            sameDayUsage.usedMillis + maxOf(0L, now - maxOf(localMidnight, activeSegmentStartedAt))
        } else {
            sameDayUsage?.usedMillis ?: 0L
        }

        return NativeGroupExhaustionAccounting(
            usage = NativeGroupAllowanceUsage(
                groupId = groupId,
                dateKey = dateKey,
                usedMillis = maxOf(accumulatedMillis, allowanceMillis),
                activePackageName = null,
                activeSegmentStartedAt = null,
                exhaustedAt = now,
                cycleRevision = previousUsage?.cycleRevision ?: 0L,
            ),
            accountedThrough = nextAccountingWatermark(existingWatermark, now),
        )
    }

    fun unaccountedIntervalMillis(
        startedAt: Long,
        endedAt: Long,
        watermark: Long?,
        localMidnight: Long,
    ): Long = maxOf(0L, endedAt - maxOf(startedAt, watermark ?: 0L, localMidnight))

    fun nextAccountingWatermark(existing: Long?, committedThrough: Long): Long =
        maxOf(existing ?: 0L, committedThrough)

    fun withWatermarkUpdates(
        existing: Map<String, Long>,
        updates: Map<String, Long>,
    ): Map<String, Long> = existing.toMutableMap().apply {
        updates.forEach { (groupId, committedThrough) ->
            this[groupId] = nextAccountingWatermark(this[groupId], committedThrough)
        }
    }
}
