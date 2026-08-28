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

enum ExpiryKind: String {
    case cooldown
    case lease
}

struct ExpiryActivityDescriptor {
    let kind: ExpiryKind
    let groupId: String
    let endsAt: Double
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

    private func parseRoutineActivity(_ name: DeviceActivityName) -> (windowId: String, isoDay: Int)? {
        let parts = name.rawValue.split(separator: "|").map(String.init)
        guard parts.count == 4, parts[0] == "routine", parts[2] == "day", let isoDay = Int(parts[3]) else {
            // Legacy fallback if name is routine.<windowId>
            if name.rawValue.starts(with: "routine.") {
                let winId = String(name.rawValue.dropFirst("routine.".count))
                return (windowId: winId, isoDay: 1)
            }
            return nil
        }
        return (windowId: parts[1], isoDay: isoDay)
    }

    private func parseExpiryActivity(_ name: DeviceActivityName) -> ExpiryActivityDescriptor? {
        let parts = name.rawValue.split(separator: "|").map(String.init)
        guard parts.count == 4, parts[0] == "expiry",
              let kind = ExpiryKind(rawValue: parts[1]),
              let endsAt = Double(parts[3]) else {
            return nil
        }
        return ExpiryActivityDescriptor(kind: kind, groupId: parts[2], endsAt: endsAt)
    }

    private func scheduleExpiryMonitor(kind: String, groupId: String, endsAtMs: Double) {
        let now = Date()
        let end = Date(timeIntervalSince1970: endsAtMs / 1000)
        guard end > now else { return }

        let calendar = Calendar.current
        let startComponents = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: now)
        let endComponents = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: end)

        let name = DeviceActivityName("expiry|\(kind)|\(groupId)|\(Int(endsAtMs))")
        let schedule = DeviceActivitySchedule(intervalStart: startComponents, intervalEnd: endComponents, repeats: false)
        try? DeviceActivityCenter().startMonitoring(name, during: schedule)
    }

    override func intervalDidStart(for activity: DeviceActivityName) {
        super.intervalDidStart(for: activity)

        if let routineInfo = parseRoutineActivity(activity) {
            let windowId = routineInfo.windowId
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

        // 1. Check out-of-process expiry activity
        if let expiry = parseExpiryActivity(activity) {
            var state = loadSharedState()
            let nowMs = Date().timeIntervalSince1970 * 1000

            switch expiry.kind {
            case .cooldown:
                if let current = state.activeCooldownEndsAt[expiry.groupId],
                   abs(current - expiry.endsAt) < 1000 {
                    state.activeCooldownEndsAt.removeValue(forKey: expiry.groupId)
                }
            case .lease:
                if let current = state.activeAccessLeaseEndsAt[expiry.groupId],
                   abs(current - expiry.endsAt) < 1000 {
                    state.activeAccessLeaseEndsAt.removeValue(forKey: expiry.groupId)
                }
            }

            state.updatedAt = nowMs
            saveSharedState(state)
            recomputeAndApplyShields(state: state)
            return
        }

        // 2. Routine interval did end
        if let routineInfo = parseRoutineActivity(activity) {
            let windowId = routineInfo.windowId
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

        scheduleExpiryMonitor(kind: "cooldown", groupId: groupId, endsAtMs: endsAt)
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
