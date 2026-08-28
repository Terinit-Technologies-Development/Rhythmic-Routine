import DeviceActivity
import Foundation
import ManagedSettings
import FamilyControls

public enum NativeShieldReason: String, Codable, Hashable {
    case routine
    case cooldown
    case overrideSuppression
}

public struct SharedRhythmState: Codable {
    public var activeCooldowns: [String: Double] // groupId -> endsAt (ms)
    public var activeRoutineReasons: [String: [String]] // groupId -> [windowId]
    public var activeAccessLeases: [String: Double] // groupId -> endsAt (ms)
    public var lastUpdatedAt: Double

    public init(
        activeCooldowns: [String: Double] = [:],
        activeRoutineReasons: [String: [String]] = [:],
        activeAccessLeases: [String: Double] = [:],
        lastUpdatedAt: Double = Date().timeIntervalSince1970 * 1000
    ) {
        self.activeCooldowns = activeCooldowns
        self.activeRoutineReasons = activeRoutineReasons
        self.activeAccessLeases = activeAccessLeases
        self.lastUpdatedAt = lastUpdatedAt
    }
}

// DeviceActivityMonitorExtension for background rhythm routine and session threshold transitions.
// Executes out-of-process when DeviceActivity schedules expire or interval thresholds are reached.
class DeviceActivityMonitorExtension: DeviceActivityMonitor {
    let store = ManagedSettingsStore(named: .init("RhythmRoutineStore"))
    let appGroupIdentifier = "group.com.terinit.rhythmicroutine"
    let sharedStateKey = "shared_rhythm_state"

    override func intervalDidStart(for activity: DeviceActivityName) {
        super.intervalDidStart(for: activity)
        let windowId = activity.rawValue
        addRoutineReason(windowId: windowId)
        recomputeAndApplyShields()
    }

    override func intervalDidEnd(for activity: DeviceActivityName) {
        super.intervalDidEnd(for: activity)
        let windowId = activity.rawValue
        removeRoutineReason(windowId: windowId)
        recomputeAndApplyShields()
    }

    override func eventDidReachThreshold(for event: DeviceActivityEvent.Name, activity: DeviceActivityName) {
        super.eventDidReachThreshold(for: event, activity: activity)
        let groupId = event.rawValue
        let nowMs = Date().timeIntervalSince1970 * 1000
        let defaultCooldownMs: Double = 60 * 60 * 1000 // 60 minutes default

        var state = loadSharedState()
        state.activeCooldowns[groupId] = nowMs + defaultCooldownMs
        state.lastUpdatedAt = nowMs
        saveSharedState(state)

        recomputeAndApplyShields()
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

    private func recomputeAndApplyShields() {
        let state = loadSharedState()
        let nowMs = Date().timeIntervalSince1970 * 1000
        var shouldShieldAny = false

        // Check if any group has active cooldown (not expired and not suppressed by active lease)
        for (groupId, endsAt) in state.activeCooldowns {
            if endsAt > nowMs {
                let leaseEndsAt = state.activeAccessLeases[groupId] ?? 0
                if leaseEndsAt <= nowMs {
                    shouldShieldAny = true
                    break
                }
            }
        }

        // Check if any group has active routine reasons (and not suppressed by lease)
        if !shouldShieldAny {
            for (groupId, windows) in state.activeRoutineReasons {
                if !windows.isEmpty {
                    let leaseEndsAt = state.activeAccessLeases[groupId] ?? 0
                    if leaseEndsAt <= nowMs {
                        shouldShieldAny = true
                        break
                    }
                }
            }
        }

        // Apply or clear shields based on effective union
        let defaults = UserDefaults(suiteName: appGroupIdentifier)
        if shouldShieldAny {
            if let savedData = defaults?.data(forKey: "selection.all"),
               let selection = try? JSONDecoder().decode(FamilyActivitySelection.self, from: savedData) {
                store.shield.applications = selection.applicationTokens
                store.shield.applicationCategories = .specific(selection.categoryTokens)
            }
        } else {
            store.shield.applications = nil
            store.shield.applicationCategories = nil
        }
    }

    private func addRoutineReason(windowId: String) {
        var state = loadSharedState()
        var current = state.activeRoutineReasons["all"] ?? []
        if !current.contains(windowId) {
            current.append(windowId)
            state.activeRoutineReasons["all"] = current
            saveSharedState(state)
        }
    }

    private func removeRoutineReason(windowId: String) {
        var state = loadSharedState()
        var current = state.activeRoutineReasons["all"] ?? []
        current.removeAll { $0 == windowId }
        state.activeRoutineReasons["all"] = current
        saveSharedState(state)
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
