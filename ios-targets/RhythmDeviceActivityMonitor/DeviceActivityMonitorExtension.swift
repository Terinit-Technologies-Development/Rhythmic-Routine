import DeviceActivity
import Foundation
import ManagedSettings

// DeviceActivityMonitorExtension for background rhythm routine boundary transitions.
// This extension executes out-of-process when DeviceActivity schedules expire or interval thresholds are reached.
class DeviceActivityMonitorExtension: DeviceActivityMonitor {
    let store = ManagedSettingsStore(named: .init("RhythmRoutineStore"))

    override func intervalDidStart(for activity: DeviceActivityName) {
        super.intervalDidStart(for: activity)
        // Invoked when a routine boundary window begins
    }

    override func intervalDidEnd(for activity: DeviceActivityName) {
        super.intervalDidEnd(for: activity)
        // Invoked when a routine boundary window ends
    }

    override func eventDidReachThreshold(for event: DeviceActivityEvent.Name, activity: DeviceActivityName) {
        super.eventDidReachThreshold(for: event, activity: activity)
        // Invoked when Risk Group cumulative session reaches threshold limit
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
}
