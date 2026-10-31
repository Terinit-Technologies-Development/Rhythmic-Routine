package expo.modules.rhythmdevice

import java.util.Calendar
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * B1 pure native tests. These drive the production predicate/creation helpers
 * used by RhythmEnforcementService (no Android framework required).
 */
class MorningEnforcementTest {
    private fun at(year: Int, month: Int, day: Int, hour: Int, minute: Int): Long =
        Calendar.getInstance().apply {
            clear()
            set(year, month - 1, day, hour, minute, 0)
        }.timeInMillis

    private val monday = at(2026, 9, 28, 9, 0)
    private val tuesday = at(2026, 9, 29, 9, 0)
    private val saturday = at(2026, 10, 3, 9, 0)

    private fun window(
        id: String = "morning-1",
        type: String = "morning-buffer",
        start: String = "06:30",
        end: String = "08:30",
        days: Set<Int> = setOf(1, 2, 3, 4, 5),
        enabled: Boolean = true,
        protected: Set<String> = setOf("com.instagram.android"),
    ) = NativeRoutineWindow(id, type, start, end, days, protected, enabled)

    private fun schedule(vararg windows: NativeRoutineWindow) =
        NativeRoutineSchedule(windows.toList(), setOf("com.instagram.android"))

    private fun day(now: Long, schedule: NativeRoutineSchedule) =
        NativeAttentionExchangeLogic.resolveAttentionDayState(now, schedule)

    private fun requirement(): NativeMorningMeditationState =
        MorningEnforcement.requirement("ad-20260928-0830", at(2026, 9, 28, 8, 30))

    private fun evidence(
        sessionKind: String? = "MORNING_REQUIRED",
        sourceDay: String? = "ad-20260928-0830",
        sourceCooldown: String? = null,
        completedSeconds: Int = 1800,
        status: String = "COMPLETED",
    ) = NativeMeditationSessionEvidence(
        sessionId = "morning-ad-20260928-0830",
        protocolVersion = 1,
        status = status,
        requiredQualifiedSeconds = 1800,
        completedQualifiedSeconds = completedSeconds,
        completedAtEpochMs = 1L,
        lastUpdatedAtEpochMs = 2L,
        sessionKind = sessionKind,
        sourceCooldownId = sourceCooldown,
        sourceRhythmicDayId = sourceDay,
    )

    @Test
    fun `every civil day resolves its own attention day even on inactive weekends`() {
        val schedule = schedule(window(), window(type = "evening-wind-down", start = "21:30", end = "22:30"))
        val saturdayDay = day(saturday, schedule)
        val mondayDay = day(monday, schedule)
        assertTrue(saturdayDay.id.startsWith("ad-20261003"))
        assertTrue(mondayDay.id.startsWith("ad-20260928"))
        assertFalse(saturdayDay.id == mondayDay.id)
    }

    @Test
    fun `eligible morning creates exact stable identity and boundary timestamp`() {
        val schedule = schedule(window())
        val attentionDay = day(monday, schedule)
        val migration = MorningEnforcement.migrationFor("fresh", attentionDay.id, monday)
        val created = MorningEnforcement.reconcile(null, attentionDay, schedule, migration, monday, null)
        assertNotNull(created)
        assertEquals("morning-${attentionDay.id}", created!!.sessionId)
        assertEquals(attentionDay.id, created.attentionDayId)
        assertEquals(attentionDay.startedAt, created.createdAt)
        assertEquals("MORNING_REQUIRED", created.sessionKind)
        assertEquals(1800, created.requiredQualifiedSeconds)

        val again = MorningEnforcement.reconcile(created, attentionDay, schedule, migration, monday + 60_000, null)
        assertEquals(created, again)
    }

    @Test
    fun `cross-midnight morning eligibility uses the opening civil day`() {
        val crossMidnight = schedule(
            window(start = "23:00", end = "00:30", days = setOf(1))
        )
        val sundayOpened = day(at(2026, 9, 28, 0, 30), crossMidnight)
        val mondayOpened = day(at(2026, 9, 29, 0, 30), crossMidnight)
        assertFalse(MorningEnforcement.eligibility(crossMidnight, sundayOpened.startedAt).eligible)
        assertTrue(MorningEnforcement.eligibility(crossMidnight, mondayOpened.startedAt).eligible)
    }

    @Test
    fun `unfinished requirement carries across inactive and eligible rollover without mutation`() {
        val mondaySchedule = schedule(window(days = setOf(1)))
        val mondayDay = day(monday, mondaySchedule)
        val migration = MorningEnforcement.migrationFor("fresh", mondayDay.id, monday)
        val mondayRequirement = MorningEnforcement.reconcileRequirements(
            emptyList(), mondayDay, mondaySchedule, migration, monday, emptyMap()
        ).single()

        val tuesdayInactive = day(tuesday, mondaySchedule)
        val carried = MorningEnforcement.reconcileRequirements(
            listOf(mondayRequirement), tuesdayInactive, mondaySchedule, migration, tuesday, emptyMap()
        ).single()
        assertEquals(mondayRequirement, carried)

        val bothSchedule = schedule(window(days = setOf(1, 2)))
        val tuesdayEligible = day(tuesday, bothSchedule)
        val both = MorningEnforcement.reconcileRequirements(
            listOf(carried), tuesdayEligible, bothSchedule, migration, tuesday, emptyMap()
        )
        assertEquals(2, both.size)
        assertEquals(mondayRequirement.sessionId, both.first().sessionId)
        assertTrue(both.any { it.attentionDayId == tuesdayEligible.id })

        val completedFirst = both.first()
        val evidence = NativeMeditationSessionEvidence(
            sessionId = completedFirst.sessionId,
            protocolVersion = 1,
            status = "COMPLETED",
            requiredQualifiedSeconds = 1800,
            completedQualifiedSeconds = 1800,
            completedAtEpochMs = tuesday,
            lastUpdatedAtEpochMs = tuesday,
            sessionKind = "MORNING_REQUIRED",
            sourceCooldownId = null,
            sourceRhythmicDayId = completedFirst.attentionDayId,
        )
        val promoted = MorningEnforcement.reconcileRequirements(
            both, tuesdayEligible, bothSchedule, migration, tuesday + 1000,
            mapOf(evidence.sessionId to evidence),
        )
        assertNotNull(promoted.first { it.attentionDayId == completedFirst.attentionDayId }.satisfiedAt)
    }

    @Test
    fun `incoming js completion marker is never native proof`() {
        val snapshot = RestorativeEnforcement.parse(
            mapOf(
                "morningMeditation" to mapOf(
                    "attentionDayId" to "ad-20260928-0830",
                    "sessionId" to "forged-session",
                    "requiredQualifiedSeconds" to 1800,
                    "satisfied" to true,
                    "satisfiedAt" to 1L,
                    "sessionKind" to "MORNING_REQUIRED",
                    "sourceRhythmicDayId" to "ad-20260928-0830",
                )
            )
        )
        assertTrue(snapshot.morningFocusActive)
        assertNull(snapshot.morningMeditation?.satisfiedAt)
    }

    @Test
    fun `atomic persistence restores prior map after commitToMemory then false`() {
        val previous = mapOf(
            "restorative" to "old",
            "pin" to "old-pin",
        )
        var current = previous.toMutableMap()
        var failNext = true
        val store = object : NativePolicyKeyValueStore {
            override fun get(key: String): String? = current[key]
            override fun commit(values: Map<String, String>, removals: Set<String>): Boolean {
                values.forEach { (key, value) -> current[key] = value }
                removals.forEach { key -> current.remove(key) }
                if (failNext) {
                    failNext = false
                    return false
                }
                return true
            }
        }
        val accepted = NativePolicyPersistence.persist(
            store,
            mapOf("restorative" to "new", "pin" to "new-pin"),
        )
        assertFalse(accepted)
        assertEquals("old", current["restorative"])
        assertEquals("old-pin", current["pin"])
    }

    @Test
    fun `pending failed writer serializes a real second writer and readers see accepted state`() {
        val store = object : NativePolicyKeyValueStore {
            val current = linkedMapOf("k" to "accepted")
            val commitEntered = java.util.concurrent.CountDownLatch(1)
            val releaseCommit = java.util.concurrent.CountDownLatch(1)
            override fun get(key: String): String? = current[key]
            override fun commit(values: Map<String, String>, removals: Set<String>): Boolean {
                values.forEach { (key, value) -> current[key] = value }
                removals.forEach { key -> current.remove(key) }
                if (values["k"] == "uncommitted") {
                    commitEntered.countDown()
                    // Bounded so a broken test can never strand a writer.
                    releaseCommit.await(5, java.util.concurrent.TimeUnit.SECONDS)
                    return false
                }
                return true
            }
        }
        assertTrue(NativePolicyPersistence.persist(store, mapOf("k" to "accepted")))

        val writerError = java.util.concurrent.atomic.AtomicReference<Throwable?>()
        val writerA = Thread {
            try {
                NativePolicyPersistence.persist(store, mapOf("k" to "uncommitted"))
            } catch (error: Throwable) {
                writerError.set(error)
            }
        }
        val writerBDone = java.util.concurrent.CountDownLatch(1)
        val writerB = Thread {
            try {
                NativePolicyPersistence.persist(store, mapOf("k" to "later-accepted"))
            } catch (error: Throwable) {
                writerError.set(error)
            } finally {
                writerBDone.countDown()
            }
        }
        val readDone = java.util.concurrent.CountDownLatch(1)
        val readValue = java.util.concurrent.atomic.AtomicReference<String?>()
        val reader = Thread {
            try {
                readValue.set(NativePolicyPersistence.acceptedValueForTests("k"))
            } catch (error: Throwable) {
                writerError.set(error)
            } finally {
                readDone.countDown()
            }
        }

        writerA.start()
        try {
            assertTrue(
                "writer A must reach commitToMemory",
                store.commitEntered.await(2, java.util.concurrent.TimeUnit.SECONDS),
            )
            // B is genuinely concurrent while A is paused before its disk outcome.
            writerB.start()
            reader.start()
            assertFalse(
                "second writer must wait for the pending transaction",
                writerBDone.await(150, java.util.concurrent.TimeUnit.MILLISECONDS),
            )
            assertFalse(
                "reader must not observe commitToMemory before the disk outcome",
                readDone.await(150, java.util.concurrent.TimeUnit.MILLISECONDS),
            )
        } finally {
            store.releaseCommit.countDown()
            writerA.join(5000)
            writerB.join(5000)
            reader.join(5000)
        }

        assertNull(writerError.get())
        assertFalse("writer A must not survive its join", writerA.isAlive)
        assertFalse("writer B must not survive its join", writerB.isAlive)
        assertFalse("reader must not survive its join", reader.isAlive)
        assertTrue(writerBDone.await(1, java.util.concurrent.TimeUnit.SECONDS))
        assertTrue(readDone.await(1, java.util.concurrent.TimeUnit.SECONDS))
        assertTrue(
            "reader may only observe a durable accepted value",
            readValue.get() == "accepted" || readValue.get() == "later-accepted",
        )
        assertEquals("later-accepted", NativePolicyPersistence.acceptedValueForTests("k"))
        assertEquals("later-accepted", store.current["k"])
    }

    @Test
    fun `coupled read snapshot never mixes keys across a successful commit`() {
        val store = object : NativePolicyKeyValueStore {
            val current = linkedMapOf("a" to "old-a", "b" to "old-b")
            val commitEntered = java.util.concurrent.CountDownLatch(1)
            val releaseCommit = java.util.concurrent.CountDownLatch(1)
            override fun get(key: String): String? = current[key]
            override fun commit(values: Map<String, String>, removals: Set<String>): Boolean {
                values.forEach { (key, value) -> current[key] = value }
                removals.forEach { key -> current.remove(key) }
                if (values["a"] == "uncommitted-a") {
                    commitEntered.countDown()
                    releaseCommit.await(5, java.util.concurrent.TimeUnit.SECONDS)
                    return false
                }
                return true
            }
        }
        assertTrue(
            NativePolicyPersistence.persist(
                store,
                mapOf("a" to "old-a", "b" to "old-b"),
            )
        )
        val error = java.util.concurrent.atomic.AtomicReference<Throwable?>()
        val writerA = Thread {
            try {
                NativePolicyPersistence.persist(
                    store,
                    mapOf("a" to "uncommitted-a", "b" to "uncommitted-b"),
                )
            } catch (failure: Throwable) {
                error.set(failure)
            }
        }
        val writerBDone = java.util.concurrent.CountDownLatch(1)
        val writerB = Thread {
            try {
                NativePolicyPersistence.persist(
                    store,
                    mapOf("a" to "later-a", "b" to "later-b"),
                )
            } catch (failure: Throwable) {
                error.set(failure)
            } finally {
                writerBDone.countDown()
            }
        }
        val readDone = java.util.concurrent.CountDownLatch(1)
        val pair = java.util.concurrent.atomic.AtomicReference<Pair<String?, String?>?>()
        val reader = Thread {
            try {
                pair.set(
                    NativePolicyPersistence.withReadSnapshot {
                        NativePolicyPersistence.acceptedValueForTests("a") to
                            NativePolicyPersistence.acceptedValueForTests("b")
                    }
                )
            } catch (failure: Throwable) {
                error.set(failure)
            } finally {
                readDone.countDown()
            }
        }

        writerA.start()
        try {
            assertTrue(
                "writer A must reach commitToMemory",
                store.commitEntered.await(2, java.util.concurrent.TimeUnit.SECONDS),
            )
            writerB.start()
            reader.start()
            assertFalse(
                "coupled reader must wait for the pending transaction",
                readDone.await(150, java.util.concurrent.TimeUnit.MILLISECONDS),
            )
        } finally {
            store.releaseCommit.countDown()
            writerA.join(5000)
            writerB.join(5000)
            reader.join(5000)
        }

        assertNull(error.get())
        assertFalse(writerA.isAlive)
        assertFalse(writerB.isAlive)
        assertFalse(reader.isAlive)
        assertTrue(writerBDone.await(1, java.util.concurrent.TimeUnit.SECONDS))
        assertTrue(readDone.await(1, java.util.concurrent.TimeUnit.SECONDS))
        val observed = pair.get()
        assertTrue(
            "coupled snapshot must be a complete durable pair",
            observed == ("old-a" to "old-b") || observed == ("later-a" to "later-b"),
        )
        assertEquals("later-a", NativePolicyPersistence.acceptedValueForTests("a"))
        assertEquals("later-b", NativePolicyPersistence.acceptedValueForTests("b"))
    }

    @Test
    fun `coupled allocation and restorative gate are not published on first failure and retry succeeds`() {
        val current = linkedMapOf<String, String>()
        var failNext = true
        val store = object : NativePolicyKeyValueStore {
            override fun get(key: String): String? = current[key]
            override fun commit(values: Map<String, String>, removals: Set<String>): Boolean {
                values.forEach { (key, value) -> current[key] = value }
                removals.forEach { key -> current.remove(key) }
                if (failNext) {
                    failNext = false
                    return false
                }
                return true
            }
        }
        val bundle = mapOf(
            "cooldown-policy" to "ordinal-4",
            "restorative-gate" to "gate-ad-20260924-0730-social-o4",
        )
        assertFalse(NativePolicyPersistence.persist(store, bundle))
        assertNull(current["cooldown-policy"])
        assertNull(current["restorative-gate"])

        assertTrue(NativePolicyPersistence.persist(store, bundle))
        assertEquals("ordinal-4", current["cooldown-policy"])
        assertEquals("gate-ad-20260924-0730-social-o4", current["restorative-gate"])
    }

    @Test
    fun `reader observation need is decided before the persistence lock`() {
        val today = "2026-09-28"
        assertFalse(
            RhythmEnforcementService.needsReaderObservationForReconcile(
                gates = emptyMap(),
                cooldowns = emptyList(),
                today = today,
                now = monday,
            )
        )
        val gate = NativeReadingGate("social", today, 3, monday - 1000, monday - 500, 1, 1)
        assertTrue(
            RhythmEnforcementService.needsReaderObservationForReconcile(
                gates = mapOf("social" to gate),
                cooldowns = emptyList(),
                today = today,
                now = monday,
            )
        )
        assertTrue(
            RhythmEnforcementService.needsReaderObservationForReconcile(
                gates = emptyMap(),
                cooldowns = listOf(
                    NativeCooldownPolicy(
                        "social",
                        setOf("com.instagram.android"),
                        monday - 1,
                        monday - 1000,
                        attentionDateKey = today,
                        dailyCooldownOrdinal = 3,
                    )
                ),
                today = today,
                now = monday,
            )
        )
    }

    @Test
    fun `inactive disabled empty and malformed mornings create no obligation`() {
        val cases = listOf(
            schedule(window(days = setOf(1))),
            schedule(window(days = emptySet())),
            schedule(window(enabled = false)),
            schedule(window(end = "not-a-clock")),
            schedule(window(end = "")),
            schedule(window(type = "evening-wind-down")),
        )
        for (schedule in cases) {
            val attentionDay = day(tuesday, schedule)
            val migration = MorningEnforcement.migrationFor("fresh", attentionDay.id, tuesday)
            val created = MorningEnforcement.reconcile(null, attentionDay, schedule, migration, tuesday, null)
            assertNull(created)
            assertFalse(
                MorningEnforcement.eligibility(schedule, attentionDay.startedAt).eligible
            )
        }
    }

    @Test
    fun `upgraded install enforces only after migration day and never compares incompatible ids lexically`() {
        val migration = MorningEnforcement.migrationFor("upgraded", "ad-2026-09-28", monday)
        assertFalse(MorningEnforcement.isEnforceable(migration, "ad-20260928-0830"))
        assertTrue(MorningEnforcement.isEnforceable(migration, "ad-20260929-0830"))

        val fresh = MorningEnforcement.migrationFor("fresh", "ad-20260928-0830", monday)
        assertTrue(MorningEnforcement.isEnforceable(fresh, "ad-20260928-0830"))
        assertFalse(MorningEnforcement.isEnforceable(fresh, "ad-20260927-0830"))
    }

    @Test
    fun `exact MORNING_REQUIRED completion requires kind source day and 1800 monotonic seconds`() {
        val requirement = requirement()
        assertTrue(MorningEnforcement.isVerifiedCompletion(requirement, evidence()))
        assertFalse(MorningEnforcement.isVerifiedCompletion(requirement, evidence(completedSeconds = 1799)))
        assertFalse(MorningEnforcement.isVerifiedCompletion(requirement, evidence(status = "PAUSED")))
        assertFalse(MorningEnforcement.isVerifiedCompletion(requirement, evidence(status = "CANCELLED")))
        assertFalse(MorningEnforcement.isVerifiedCompletion(requirement, evidence(status = "EXPIRED")))
        assertFalse(MorningEnforcement.isVerifiedCompletion(requirement, evidence(sessionKind = "COOLDOWN_RESTORATIVE")))
        assertFalse(MorningEnforcement.isVerifiedCompletion(requirement, evidence(sessionKind = null)))
        assertFalse(MorningEnforcement.isVerifiedCompletion(requirement, evidence(sourceDay = "ad-20260101-0830")))
        assertFalse(MorningEnforcement.isVerifiedCompletion(requirement, evidence(sourceCooldown = "cd-1")))
    }

    @Test
    fun `reconcile marks satisfaction once and never downgrades it`() {
        val schedule = schedule(window())
        val attentionDay = day(monday, schedule)
        val migration = MorningEnforcement.migrationFor("fresh", attentionDay.id, monday)
        val created = MorningEnforcement.reconcile(null, attentionDay, schedule, migration, monday, null)!!
        val satisfied = MorningEnforcement.reconcile(created, attentionDay, schedule, migration, monday + 1000, evidence())!!
        assertTrue(satisfied.satisfied)
        assertEquals(1L, satisfied.satisfiedAt ?: -1L)

        val stale = MorningEnforcement.reconcile(
            satisfied,
            attentionDay,
            schedule,
            migration,
            monday + 2000,
            evidence(status = "ACTIVE", completedSeconds = 0),
        )!!
        assertTrue(stale.satisfied)
        assertEquals(1L, stale.satisfiedAt ?: -1L)
    }

    @Test
    fun `a failed persistence keeps the previous accepted state`() {
        val previous = requirement()
        val next = previous.copy(satisfied = true, satisfiedAt = 9L)
        assertEquals(previous, MorningEnforcement.acceptedPersistence(false, previous, next))
        assertEquals(next, MorningEnforcement.acceptedPersistence(true, previous, next))
    }

    @Test
    fun `single predicate keeps Essential reachable and leases cannot suppress morning hold`() {
        assertTrue(
            NativeAttentionExchangeLogic.isEffectivelyRestricted(
                baseOrRoutineRestricted = false,
                cooldownActive = false,
                gatePresent = false,
                accessLeaseActive = true,
                morningHold = true,
                essentialPackage = false,
            )
        )
        assertTrue(
            NativeAttentionExchangeLogic.isEffectivelyRestricted(
                baseOrRoutineRestricted = false,
                cooldownActive = false,
                gatePresent = false,
                accessLeaseActive = true,
                morningHold = true,
            )
        )
        assertFalse(
            NativeAttentionExchangeLogic.isEffectivelyRestricted(
                baseOrRoutineRestricted = true,
                cooldownActive = true,
                gatePresent = true,
                accessLeaseActive = true,
                morningHold = true,
                essentialPackage = true,
            )
        )
        assertTrue(
            NativeAttentionExchangeLogic.isEffectivelyRestricted(
                baseOrRoutineRestricted = false,
                cooldownActive = true,
                gatePresent = false,
                accessLeaseActive = false,
                restorativeHold = true,
            )
        )
    }

    @Test
    fun `strict routine matcher supports inactive weekend and cross-midnight windows`() {
        val weekendInactive = schedule(window(days = setOf(1, 2, 3, 4, 5)))
        assertFalse(
            MorningEnforcement.isProtectedByRoutine(weekendInactive, "com.instagram.android", saturday)
        )

        val crossMidnight = schedule(
            window(start = "22:00", end = "06:30", days = setOf(1, 2, 3, 4, 5))
        )
        val tuesdayEarly = at(2026, 9, 29, 5, 0)
        assertTrue(
            MorningEnforcement.isProtectedByRoutine(crossMidnight, "com.instagram.android", tuesdayEarly)
        )
    }

    @Test
    fun `attention insight current selector is real and neutral without creating a gate`() {
        val snapshot = RestorativeEnforcement.parse(
            mapOf(
                "attentionDay" to mapOf("id" to "ad-20260928-0830", "nextBoundaryAt" to 1L),
                "activeRestorativeGates" to emptyList<Any>(),
            )
        )
        val values = AttentionInsightProvider.deriveValues(snapshot, "ad-20260928-0830", 0)
        assertEquals("1", values[AttentionInsightProvider.COLUMN_PROTOCOL_VERSION].toString())
        assertEquals("ad-20260928-0830", values[AttentionInsightProvider.COLUMN_ATTENTION_DAY_ID])
        assertEquals(0, values[AttentionInsightProvider.COLUMN_COOLDOWNS_TRIGGERED])
        assertEquals(0, values[AttentionInsightProvider.COLUMN_RESTORATIVE_GATES_CREATED])
        assertEquals("current", AttentionInsightProvider.CURRENT_SELECTOR)
        assertTrue(snapshot.restorativeGates.isEmpty())
    }
}
