import DeviceActivity
import Foundation
import ManagedSettings
import FamilyControls

public struct SharedGroupPolicy: Codable {
    public let groupId: String
    public let selectionRef: String?
    public let sessionThresholdMinutes: Int
    public let cooldownMinutes: Int

    public init(groupId: String, selectionRef: String?, sessionThresholdMinutes: Int, cooldownMinutes: Int) {
        self.groupId = groupId
        self.selectionRef = selectionRef
        self.sessionThresholdMinutes = sessionThresholdMinutes
        self.cooldownMinutes = cooldownMinutes
    }
}

public struct SharedRoutinePolicy: Codable {
    public let windowId: String
    public let startTime: String
    public let endTime: String?
    public let activeDays: [Int]
    public let protectedGroupIds: [String]
    public let enabled: Bool

    public init(windowId: String, startTime: String, endTime: String?, activeDays: [Int], protectedGroupIds: [String], enabled: Bool) {
        self.windowId = windowId
        self.startTime = startTime
        self.endTime = endTime
        self.activeDays = activeDays
        self.protectedGroupIds = protectedGroupIds
        self.enabled = enabled
    }
}

public struct SharedRhythmState: Codable {
    public var schemaVersion: Int
    public var groups: [SharedGroupPolicy]
    public var routines: [SharedRoutinePolicy]
    public var activeCooldownEndsAt: [String: Double]
    public var activeAccessLeaseEndsAt: [String: Double]
    public var activeRoutineReasons: [String: [String]]
    public var updatedAt: Double

    public init(
        schemaVersion: Int = 1,
        groups: [SharedGroupPolicy] = [],
        routines: [SharedRoutinePolicy] = [],
        activeCooldownEndsAt: [String: Double] = [:],
        activeAccessLeaseEndsAt: [String: Double] = [:],
        activeRoutineReasons: [String: [String]] = [:],
        updatedAt: Double = Date().timeIntervalSince1970 * 1000
    ) {
        self.schemaVersion = schemaVersion
        self.groups = groups
        self.routines = routines
        self.activeCooldownEndsAt = activeCooldownEndsAt
        self.activeAccessLeaseEndsAt = activeAccessLeaseEndsAt
        self.activeRoutineReasons = activeRoutineReasons
        self.updatedAt = updatedAt
    }
}

// DeviceActivityMonitorExtension for background rhythm routine and session threshold transitions.
// Executes out-of-process when DeviceActivity schedules expire or interval thresholds are reached.
class DeviceActivityMonitorExtension: DeviceActivityMonitor {
    let store = ManagedSettingsStore(named: .init("RhythmRoutineStore"))
    let appGroupIdentifier = "group.com.terinit.rhythmicroutine"
    let sharedStateKey = "shared_rhythm_state"

    private func selectionKey(groupId: String) -> String {
        return "selection.\(groupId)"
    }

    private func parseRoutineActivity(_ name: DeviceActivityName) -> String? {
        let parts = name.rawValue.split(separator: "|").map(String.init)
        if parts.count >= 3 && parts[0] == "routine" {
            return parts[1]
        }
        if name.rawValue.starts(with: "routine.") {
            return String(name.rawValue.dropFirst("routine.".count))
        }
        return nil
    }

    private func isRhythmExpiryActivity(_ name: DeviceActivityName) -> Bool {
        return name.rawValue.hasPrefix("expiry|")
    }

    private func nextExpiry(state: SharedRhythmState, nowMs: Double) -> Double? {
        let cooldowns = state.activeCooldownEndsAt.values.filter { $0 > nowMs }
        let leases = state.activeAccessLeaseEndsAt.values.filter { $0 > nowMs }
        return (Array(cooldowns) + Array(leases)).min()
    }

    private func makeExpiryWakeSchedule(semanticEndsAtMs: Double, now: Date) -> DeviceActivitySchedule {
        let semanticEnd = Date(timeIntervalSince1970: semanticEndsAtMs / 1000)
        let minimumWakeEnd = now.addingTimeInterval(15 * 60 + 2) // At least 15m + 2s for DeviceActivity constraints
        let wakeEnd = max(semanticEnd, minimumWakeEnd)

        let calendar = Calendar.current
        let startComponents = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: now)
        let endComponents = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: wakeEnd)

        return DeviceActivitySchedule(intervalStart: startComponents, intervalEnd: endComponents, repeats: false)
    }

    private func ensureNearestExpiryMonitor(state: SharedRhythmState) {
        let center = DeviceActivityCenter()
        let now = Date()
        let nowMs = now.timeIntervalSince1970 * 1000
        let defaults = UserDefaults(suiteName: appGroupIdentifier)

        let expiryActivities = center.activities.filter { isRhythmExpiryActivity($0) }

        guard let semanticEndsAt = nextExpiry(state: state, nowMs: nowMs) else {
            if !expiryActivities.isEmpty {
                center.stopMonitoring(expiryActivities)
            }
            defaults?.set(true, forKey: "expiry_monitoring_operational")
            return
        }

        let expectedName = DeviceActivityName("expiry|next|\(Int(semanticEndsAt))")
        if expiryActivities.contains(expectedName) {
            // Existing nearest wake-up schedule is already accurate; no churn
            defaults?.set(true, forKey: "expiry_monitoring_operational")
            return
        }

        let schedule = makeExpiryWakeSchedule(semanticEndsAtMs: semanticEndsAt, now: now)
        if !expiryActivities.isEmpty {
            center.stopMonitoring(expiryActivities)
        }
        do {
            try center.startMonitoring(expectedName, during: schedule)
            defaults?.set(true, forKey: "expiry_monitoring_operational")
        } catch {
            defaults?.set(false, forKey: "expiry_monitoring_operational")
            defaults?.set(false, forKey: "monitoring_operational")
            defaults?.set("Extension ensureNearestExpiryMonitor: \(error.localizedDescription)", forKey: "monitoring_last_error")
        }
    }

    override func intervalDidStart(for activity: DeviceActivityName) {
        super.intervalDidStart(for: activity)

        if let windowId = parseRoutineActivity(activity) {
            var state = loadSharedState()
            if let routine = state.routines.first(where: { $0.windowId == windowId }) {
                for groupId in routine.protectedGroupIds {
                    var current = state.activeRoutineReasons[groupId] ?? []
                    if !current.contains(windowId) {
                        current.append(windowId)
                        state.activeRoutineReasons[groupId] = current
                    }
                }
                state.updatedAt = Date().timeIntervalSince1970 * 1000
                saveSharedState(state)
                recomputeAndApplyShields(state: state)
            }
        }
    }

    override func intervalDidEnd(for activity: DeviceActivityName) {
        super.intervalDidEnd(for: activity)

        // 1. Single nearest-expiry activity callback
        if isRhythmExpiryActivity(activity) {
            var state = loadSharedState()
            let nowMs = Date().timeIntervalSince1970 * 1000

            // Prune ALL expired entries
            state.activeCooldownEndsAt = state.activeCooldownEndsAt.filter { $0.value > nowMs }
            state.activeAccessLeaseEndsAt = state.activeAccessLeaseEndsAt.filter { $0.value > nowMs }
            state.updatedAt = nowMs
            saveSharedState(state)

            recomputeAndApplyShields(state: state)
            ensureNearestExpiryMonitor(state: state)
            return
        }

        // 2. Routine interval did end
        if let windowId = parseRoutineActivity(activity) {
            var state = loadSharedState()
            if let routine = state.routines.first(where: { $0.windowId == windowId }) {
                for groupId in routine.protectedGroupIds {
                    var current = state.activeRoutineReasons[groupId] ?? []
                    current.removeAll { $0 == windowId }
                    state.activeRoutineReasons[groupId] = current
                }
                state.updatedAt = Date().timeIntervalSince1970 * 1000
                saveSharedState(state)
                recomputeAndApplyShields(state: state)
            }
        }
    }

    override func eventDidReachThreshold(for event: DeviceActivityEvent.Name, activity: DeviceActivityName) {
        super.eventDidReachThreshold(for: event, activity: activity)
        let groupId = event.rawValue
        let nowMs = Date().timeIntervalSince1970 * 1000

        var state = loadSharedState()
        let cooldownMinutes = state.groups.first { $0.groupId == groupId }?.cooldownMinutes ?? 60
        let endsAt = nowMs + Double(cooldownMinutes) * 60_000
        state.activeCooldownEndsAt[groupId] = endsAt
        state.updatedAt = nowMs
        saveSharedState(state)

        recomputeAndApplyShields(state: state)
        ensureNearestExpiryMonitor(state: state)
    }

    override func intervalWillStartWarning(for activity: DeviceActivityName) {
        super.intervalWillStartWarning(for: activity)
    }

    override func intervalWillEndWarning(for activity: DeviceActivityName) {
        super.intervalWillEndWarning(for: activity)
    }

    override func eventWillReachThresholdWarning(for event: DeviceActivityEvent.Name, activity: DeviceActivityName) {
        super.eventWillReachThresholdWarning(for: event, activity: activity)
    }

    // MARK: - Native Shield Reason Union

    private func recomputeAndApplyShields(state: SharedRhythmState) {
        let nowMs = Date().timeIntervalSince1970 * 1000
        var protectedGroups = Set<String>()

        // 1. Routine reasons
        for (groupId, windows) in state.activeRoutineReasons {
            if !windows.isEmpty {
                protectedGroups.insert(groupId)
            }
        }

        // 2. Cooldowns
        for (groupId, endsAt) in state.activeCooldownEndsAt {
            if endsAt > nowMs {
                protectedGroups.insert(groupId)
            }
        }

        // 3. Subtract active access leases
        for (groupId, endsAt) in state.activeAccessLeaseEndsAt {
            if endsAt > nowMs {
                protectedGroups.remove(groupId)
            }
        }

        let defaults = UserDefaults(suiteName: appGroupIdentifier)
        var appTokens = Set<ApplicationToken>()
        var categoryTokens = Set<ActivityCategoryToken>()

        for groupId in protectedGroups {
            let key = selectionKey(groupId: groupId)
            if let selData = defaults?.data(forKey: key),
               let selection = try? JSONDecoder().decode(FamilyActivitySelection.self, from: selData) {
                appTokens.formUnion(selection.applicationTokens)
                categoryTokens.formUnion(selection.categoryTokens)
            }
        }

        store.shield.applications = appTokens.isEmpty ? nil : appTokens
        store.shield.applicationCategories = categoryTokens.isEmpty ? nil : .specific(categoryTokens)
    }

    private func loadSharedState() -> SharedRhythmState {
        guard let defaults = UserDefaults(suiteName: appGroupIdentifier),
              let data = defaults.data(forKey: sharedStateKey),
              let state = try? JSONDecoder().decode(SharedRhythmState.self, from: data) else {
            return SharedRhythmState()
        }
        return state
    }

    private func saveSharedState(_ state: SharedRhythmState) {
        guard let defaults = UserDefaults(suiteName: appGroupIdentifier),
              let data = try? JSONEncoder().encode(state) else { return }
        defaults.set(data, forKey: sharedStateKey)
    }
}
