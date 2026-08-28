import DeviceActivity
import Foundation
import ManagedSettings
import FamilyControls

public struct SharedGroupPolicy: Codable {
    public let groupId: String
    public let selectionRef: String?
    public let sessionThresholdMinutes: Int
    public let cooldownMinutes: Int
}

public struct SharedRoutinePolicy: Codable {
    public let windowId: String
    public let startTime: String
    public let endTime: String?
    public let activeDays: [Int]
    public let protectedGroupIds: [String]
    public let enabled: Bool
}

public struct SharedRhythmState: Codable {
    public var groups: [SharedGroupPolicy]
    public var routines: [SharedRoutinePolicy]
    public var activeCooldownEndsAt: [String: Double]
    public var activeAccessLeaseEndsAt: [String: Double]
    public var activeRoutineReasons: [String: [String]]
    public var updatedAt: Double

    public init(
        groups: [SharedGroupPolicy] = [],
        routines: [SharedRoutinePolicy] = [],
        activeCooldownEndsAt: [String: Double] = [:],
        activeAccessLeaseEndsAt: [String: Double] = [:],
        activeRoutineReasons: [String: [String]] = [:],
        updatedAt: Double = Date().timeIntervalSince1970 * 1000
    ) {
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

    override func intervalDidStart(for activity: DeviceActivityName) {
        super.intervalDidStart(for: activity)
        let raw = activity.rawValue
        let windowId = raw.starts(with: "routine.") ? String(raw.dropFirst("routine.".count)) : raw

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

    override func intervalDidEnd(for activity: DeviceActivityName) {
        super.intervalDidEnd(for: activity)
        let raw = activity.rawValue
        let windowId = raw.starts(with: "routine.") ? String(raw.dropFirst("routine.".count)) : raw

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

    override func eventDidReachThreshold(for event: DeviceActivityEvent.Name, activity: DeviceActivityName) {
        super.eventDidReachThreshold(for: event, activity: activity)
        let groupId = event.rawValue
        let nowMs = Date().timeIntervalSince1970 * 1000

        var state = loadSharedState()
        let cooldownMinutes = state.groups.first { $0.groupId == groupId }?.cooldownMinutes ?? 60
        state.activeCooldownEndsAt[groupId] = nowMs + Double(cooldownMinutes) * 60_000
        state.updatedAt = nowMs
        saveSharedState(state)

        recomputeAndApplyShields(state: state)
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
