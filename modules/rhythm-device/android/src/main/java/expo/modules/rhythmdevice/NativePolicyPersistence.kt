package expo.modules.rhythmdevice

import android.content.Context

/**
 * SharedPreferences.commit() updates the in-memory map before disk persistence
 * and can still return false. A bare Boolean therefore cannot preserve the last
 * accepted enforcement state. This abstraction captures the prior values,
 * commits once, and restores them in one subsequent commit when the write
 * fails, so subsequent enforcement reads never observe a partially published
 * projection.
 */
interface NativePolicyKeyValueStore {
    fun get(key: String): String?
    fun commit(values: Map<String, String>, removals: Set<String>): Boolean
}

object NativePolicyPersistence {
    private val lock = java.util.concurrent.locks.ReentrantLock()
    private val accepted = HashMap<String, String?>()
    private val loaded = HashSet<String>()
    private val acceptedSets = HashMap<String, Set<String>?>()
    private val loadedSets = HashSet<String>()

    fun getStringSet(context: Context, key: String): Set<String>? = lock.withLock {
        if (key !in loadedSets) {
            acceptedSets[key] = context.getSharedPreferences(
                RhythmNativePolicyKeys.PREFS,
                Context.MODE_PRIVATE,
            ).getStringSet(key, null)
            loadedSets.add(key)
        }
        acceptedSets[key]
    }

    fun persistStringSetPrefs(context: Context, key: String, values: Set<String>?): Boolean = lock.withLock {
        val prefs = context.getSharedPreferences(
            RhythmNativePolicyKeys.PREFS,
            Context.MODE_PRIVATE,
        )
        if (key !in loadedSets) {
            acceptedSets[key] = prefs.getStringSet(key, null)
            loadedSets.add(key)
        }
        val previousAccepted = acceptedSets[key]
        val previousStored = prefs.getStringSet(key, null)
        val editor = prefs.edit()
        if (values == null) editor.remove(key) else editor.putStringSet(key, values)
        val accepted = editor.commit()
        if (accepted) {
            acceptedSets[key] = values
            return@withLock true
        }
        val restore = prefs.edit()
        if (previousStored == null) restore.remove(key) else restore.putStringSet(key, previousStored)
        restore.commit()
        acceptedSets[key] = previousAccepted
        false
    }

    fun get(context: Context, key: String): String? = lock.withLock {
        ensureLoaded(context, key)
        accepted[key]
    }

    /** One accepted snapshot for logically coupled policy/gate/morning reads. */
    fun <T> withReadSnapshot(block: () -> T): T = lock.withLock(block)

    fun persist(
        store: NativePolicyKeyValueStore,
        values: Map<String, String>,
        removals: Set<String> = emptySet(),
    ): Boolean = lock.withLock {
        persistLocked(store, values, removals)
    }

    private fun persistLocked(
        store: NativePolicyKeyValueStore,
        values: Map<String, String>,
        removals: Set<String>,
    ): Boolean {
        val touched = values.keys + removals
        val previous = touched.associateWith { store.get(it) }
        val acceptedBefore = touched.associateWith { accepted[it] }
        val acceptedWasLoaded = touched.associateWith { it in loaded }
        val wasAccepted = store.commit(values, removals)
        if (wasAccepted) {
            for (key in touched) {
                accepted[key] = if (key in removals) null else values[key]
                loaded.add(key)
            }
            return true
        }

        // commitToMemory has already published this bundle. Restore the last
        // accepted projection, not merely the physical prefs copy.
        val restoreValues = LinkedHashMap<String, String>()
        val restoreRemovals = LinkedHashSet<String>()
        for (key in touched) {
            val prior = previous[key]
            if (prior == null) restoreRemovals.add(key) else restoreValues[key] = prior
        }
        store.commit(restoreValues, restoreRemovals)
        for (key in touched) {
            if (acceptedWasLoaded[key] == true) accepted[key] = acceptedBefore[key]
            else {
                accepted.remove(key)
                loaded.remove(key)
            }
        }
        return false
    }

    fun persistPrefs(
        context: Context,
        values: Map<String, String>,
        removals: Set<String> = emptySet(),
    ): Boolean = lock.withLock {
        val prefs = context.getSharedPreferences(
            RhythmNativePolicyKeys.PREFS,
            Context.MODE_PRIVATE,
        )
        // Initialize accepted lazily for every touched key before publishing.
        for (key in values.keys + removals) ensureLoaded(context, key)
        persist(
            object : NativePolicyKeyValueStore {
                override fun get(key: String): String? = prefs.getString(key, null)
                override fun commit(values: Map<String, String>, removals: Set<String>): Boolean {
                    val editor = prefs.edit()
                    values.forEach { (key, value) -> editor.putString(key, value) }
                    removals.forEach { key -> editor.remove(key) }
                    return editor.commit()
                }
            },
            values,
            removals,
        )
    }

    internal fun acceptedValueForTests(key: String): String? = lock.withLock { accepted[key] }

    fun reset() {
        lock.withLock {
            accepted.clear()
            loaded.clear()
            acceptedSets.clear()
            loadedSets.clear()
        }
    }

    private fun ensureLoaded(context: Context, key: String) {
        if (key in loaded) return
        val prefs = context.getSharedPreferences(
            RhythmNativePolicyKeys.PREFS,
            Context.MODE_PRIVATE,
        )
        accepted[key] = prefs.getString(key, null)
        loaded.add(key)
    }

    private inline fun <T> java.util.concurrent.locks.ReentrantLock.withLock(block: () -> T): T {
        lock()
        return try {
            block()
        } finally {
            unlock()
        }
    }
}
