import ExpoModulesCore
import Foundation
#if canImport(FamilyControls)
import FamilyControls
#endif
#if canImport(ManagedSettings)
import ManagedSettings
#endif
#if canImport(DeviceActivity)
import DeviceActivity
#endif
#if canImport(SwiftUI)
import SwiftUI
#endif

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

#if canImport(SwiftUI) && canImport(FamilyControls)
@available(iOS 16.0, *)
struct FamilyActivityPickerContainer: View {
    @Binding var selection: FamilyActivitySelection
    var onDone: () -> Void
    var onCancel: () -> Void

    var body: some View {
        NavigationView {
            FamilyActivityPicker(selection: $selection)
                .navigationTitle("Select Risk Apps")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") {
                            onCancel()
                        }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") {
                            onDone()
                        }
                    }
                }
        }
    }
}
#endif

public class RhythmDeviceModule: Module {
  private let appGroupIdentifier = "group.com.terinit.rhythmicroutine"
  private let storeName = "RhythmRoutineStore"
  private let sharedStateKey = "shared_rhythm_state"
  private let monitoringOperationalKey = "monitoring_operational"
  private let monitoringLastErrorKey = "monitoring_last_error"

  private func selectionKey(groupId: String) -> String {
    return "selection.\(groupId)"
  }

  private func hasAnyNonEmptySelection() -> Bool {
    #if canImport(FamilyControls)
    if #available(iOS 16.0, *) {
      guard let defaults = UserDefaults(suiteName: self.appGroupIdentifier) else { return false }
      for key in defaults.dictionaryRepresentation().keys.filter({ $0.hasPrefix("selection.") }) {
        guard let data = defaults.data(forKey: key),
              let selection = try? JSONDecoder().decode(FamilyActivitySelection.self, from: data) else {
          continue
        }
        let count = selection.applicationTokens.count + selection.categoryTokens.count + selection.webDomainTokens.count
        if count > 0 {
          return true
        }
      }
    }
    #endif
    return false
  }

  public func definition() -> ModuleDefinition {
    Name("RhythmDevice")

    AsyncFunction("checkPermissions") { () -> [String: Any] in
      #if canImport(FamilyControls)
      if #available(iOS 16.0, *) {
        let status = AuthorizationCenter.shared.authorizationStatus
        let statusString: String
        let isApproved: Bool

        switch status {
        case .notDetermined:
          statusString = "unknown"
          isApproved = false
        case .approved:
          statusString = "approved"
          isApproved = true
        case .denied:
          statusString = "denied"
          isApproved = false
        @unknown default:
          statusString = "unknown"
          isApproved = false
        }

        let defaults = UserDefaults(suiteName: self.appGroupIdentifier)
        let hasSelection = self.hasAnyNonEmptySelection()
        let monitoringOperational = defaults?.bool(forKey: self.monitoringOperationalKey) ?? false
        let lastError = defaults?.string(forKey: self.monitoringLastErrorKey)
        let shieldingOperational = isApproved && hasSelection && monitoringOperational

        return [
          "hasUsagePermission": isApproved,
          "hasRestrictionPermission": shieldingOperational,
          "familyControlsStatus": statusString,
          "hasSelection": hasSelection,
          "shieldingOperational": shieldingOperational,
          "monitoringOperational": monitoringOperational,
          "lastMonitoringError": lastError ?? ""
        ]
      }
      #endif

      return [
        "hasUsagePermission": false,
        "hasRestrictionPermission": false,
        "familyControlsStatus": "unsupported",
        "hasSelection": false,
        "shieldingOperational": false,
        "monitoringOperational": false,
        "lastMonitoringError": ""
      ]
    }

    AsyncFunction("requestUsagePermission") { () -> Void in
      #if canImport(FamilyControls)
      if #available(iOS 16.0, *) {
        do {
          try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
        } catch {
          // Denied or unavailable
        }
      }
      #endif
    }

    AsyncFunction("requestRestrictionPermission") { () -> Void in
      #if canImport(FamilyControls)
      if #available(iOS 16.0, *) {
        do {
          try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
        } catch {
          // Handled
        }
      }
      #endif
    }

    AsyncFunction("requestFamilyControls") { () -> String in
      #if canImport(FamilyControls)
      if #available(iOS 16.0, *) {
        do {
          try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
          return "approved"
        } catch {
          return "denied"
        }
      }
      #endif
      return "unsupported"
    }

    AsyncFunction("showFamilyActivityPicker") { (groupId: String, promise: Promise) in
      #if canImport(FamilyControls) && canImport(SwiftUI)
      if #available(iOS 16.0, *) {
        DispatchQueue.main.async {
          guard let rootVc = self.appContext.utilities?.currentViewController() else {
            promise.reject("ERR_NO_ROOT_VC", "Cannot present FamilyActivityPicker: Root view controller unavailable")
            return
          }

          let defaults = UserDefaults(suiteName: self.appGroupIdentifier)
          var initialSelection = FamilyActivitySelection()
          let key = self.selectionKey(groupId: groupId)

          if let data = defaults?.data(forKey: key),
             let saved = try? JSONDecoder().decode(FamilyActivitySelection.self, from: data) {
            initialSelection = saved
          }

          var currentSelection = initialSelection
          var hostingController: UIHostingController<FamilyActivityPickerContainer>? = nil

          let containerView = FamilyActivityPickerContainer(
            selection: Binding(
              get: { currentSelection },
              set: { currentSelection = $0 }
            ),
            onDone: {
              hostingController?.dismiss(animated: true) {
                if let data = try? JSONEncoder().encode(currentSelection) {
                  defaults?.set(data, forKey: key)
                }
                let tokenCount = currentSelection.applicationTokens.count + currentSelection.categoryTokens.count + currentSelection.webDomainTokens.count
                promise.resolve([
                  "localSelectionId": key,
                  "tokenCount": tokenCount,
                  "kind": "mixed"
                ])
              }
            },
            onCancel: {
              hostingController?.dismiss(animated: true) {
                promise.reject("ERR_CANCELLED", "User cancelled application selection")
              }
            }
          )

          hostingController = UIHostingController(rootView: containerView)
          if let hc = hostingController {
            rootVc.present(hc, animated: true)
          }
        }
        return
      }
      #endif
      promise.reject("ERR_UNSUPPORTED", "FamilyActivityPicker requires iOS 16.0+")
    }

    AsyncFunction("hasGroupSelection") { (groupId: String) -> Bool in
      guard let defaults = UserDefaults(suiteName: self.appGroupIdentifier) else { return false }
      return defaults.data(forKey: self.selectionKey(groupId: groupId)) != nil
    }

    AsyncFunction("clearGroupSelection") { (groupId: String) -> Bool in
      guard let defaults = UserDefaults(suiteName: self.appGroupIdentifier) else { return false }
      defaults.removeObject(forKey: self.selectionKey(groupId: groupId))
      self.recomputeAndApplyShieldsInternal()
      return true
    }

    AsyncFunction("revokeAuthorization") { () -> Void in
      self.cleanupAfterAuthorizationLoss()
    }

    AsyncFunction("getInstalledApps") { () -> [[String: Any]] in
      // iOS FamilyControls deliberately conceals plaintext bundle identifiers
      return []
    }

    AsyncFunction("queryUsageEvents") { (startTime: Double, endTime: Double) -> [[String: Any]] in
      return []
    }

    AsyncFunction("applyShieldRestrictions") { (packageNames: [String]) -> Bool in
      return self.recomputeAndApplyShieldsInternal()
    }

    AsyncFunction("clearShieldRestrictions") { (packageNames: [String]) -> Bool in
      return self.recomputeAndApplyShieldsInternal()
    }

    AsyncFunction("setSharedRhythmState") { (stateJson: String) -> Bool in
      guard let data = stateJson.data(using: .utf8),
            let defaults = UserDefaults(suiteName: self.appGroupIdentifier) else {
        return false
      }
      defaults.set(data, forKey: self.sharedStateKey)

      if let state = try? JSONDecoder().decode(SharedRhythmState.self, from: data) {
        self.synchronizeMonitoringInternal(state: state)
      }

      return self.recomputeAndApplyShieldsInternal()
    }

    AsyncFunction("getSharedRhythmState") { () -> String? in
      guard let defaults = UserDefaults(suiteName: self.appGroupIdentifier),
            let data = defaults.data(forKey: self.sharedStateKey) else {
        return nil
      }
      return String(data: data, encoding: .utf8)
    }
  }

  // MARK: - Internal Shield Recomputation & DeviceActivity Monitoring

  private func recomputeAndApplyShieldsInternal() -> Bool {
    #if canImport(ManagedSettings) && canImport(FamilyControls)
    if #available(iOS 16.0, *) {
      let defaults = UserDefaults(suiteName: self.appGroupIdentifier)
      guard let data = defaults?.data(forKey: self.sharedStateKey),
            let state = try? JSONDecoder().decode(SharedRhythmState.self, from: data) else {
        return false
      }

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

      var appTokens = Set<ApplicationToken>()
      var categoryTokens = Set<ActivityCategoryToken>()

      for groupId in protectedGroups {
        let key = self.selectionKey(groupId: groupId)
        if let selData = defaults?.data(forKey: key),
           let selection = try? JSONDecoder().decode(FamilyActivitySelection.self, from: selData) {
          appTokens.formUnion(selection.applicationTokens)
          categoryTokens.formUnion(selection.categoryTokens)
        }
      }

      let store = ManagedSettingsStore(named: .init(self.storeName))
      store.shield.applications = appTokens.isEmpty ? nil : appTokens
      store.shield.applicationCategories = categoryTokens.isEmpty ? nil : .specific(categoryTokens)
      return true
    }
    #endif
    return false
  }

  private func appleWeekday(fromISO iso: Int) -> Int {
    return iso == 7 ? 1 : iso + 1
  }

  private func routineActivityName(windowId: String, isoDay: Int) -> DeviceActivityName {
    DeviceActivityName("routine|\(windowId)|day|\(isoDay)")
  }

  private func makeRoutineSchedule(routine: SharedRoutinePolicy, isoDay: Int) -> DeviceActivitySchedule? {
    let startParts = routine.startTime.split(separator: ":").compactMap { Int($0) }
    let endParts = (routine.endTime ?? "08:00").split(separator: ":").compactMap { Int($0) }
    guard startParts.count == 2, endParts.count == 2 else { return nil }

    let startMins = startParts[0] * 60 + startParts[1]
    let endMins = endParts[0] * 60 + endParts[1]
    let crossesMidnight = endMins <= startMins
    let nextIsoDay = isoDay == 7 ? 1 : isoDay + 1

    let startWeekday = appleWeekday(fromISO: isoDay)
    let endWeekday = appleWeekday(fromISO: crossesMidnight ? nextIsoDay : isoDay)

    return DeviceActivitySchedule(
      intervalStart: DateComponents(weekday: startWeekday, hour: startParts[0], minute: startParts[1]),
      intervalEnd: DateComponents(weekday: endWeekday, hour: endParts[0], minute: endParts[1]),
      repeats: true
    )
  }

  private func scheduleExpiryMonitor(kind: String, groupId: String, endsAtMs: Double) {
    #if canImport(DeviceActivity)
    if #available(iOS 16.0, *) {
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
    #endif
  }

  private func synchronizeMonitoringInternal(state: SharedRhythmState) {
    #if canImport(DeviceActivity) && canImport(FamilyControls)
    if #available(iOS 16.0, *) {
      let center = DeviceActivityCenter()
      center.stopMonitoring()

      let defaults = UserDefaults(suiteName: self.appGroupIdentifier)
      do {
        // 1. Register routine schedules respecting activeDays
        for routine in state.routines where routine.enabled {
          for isoDay in routine.activeDays {
            guard let schedule = makeRoutineSchedule(routine: routine, isoDay: isoDay) else { continue }
            let activityName = routineActivityName(windowId: routine.windowId, isoDay: isoDay)
            try center.startMonitoring(activityName, during: schedule)
          }
        }

        // 2. Register group threshold events
        for group in state.groups {
          let key = self.selectionKey(groupId: group.groupId)
          if let selData = defaults?.data(forKey: key),
             let selection = try? JSONDecoder().decode(FamilyActivitySelection.self, from: selData) {
            let thresholdEvent = DeviceActivityEvent(
              applications: selection.applicationTokens,
              categories: selection.categoryTokens,
              webDomains: selection.webDomainTokens,
              threshold: DateComponents(minute: group.sessionThresholdMinutes),
              includesPastActivity: false
            )

            let dailySchedule = DeviceActivitySchedule(
              intervalStart: DateComponents(hour: 0, minute: 0),
              intervalEnd: DateComponents(hour: 23, minute: 59),
              repeats: true
            )

            let activityName = DeviceActivityName("risk.\(group.groupId).daily")
            let eventName = DeviceActivityEvent.Name(group.groupId)
            try center.startMonitoring(activityName, during: dailySchedule, events: [eventName: thresholdEvent])
          }
        }

        // 3. Register active cooldown and lease expiry monitors
        let nowMs = Date().timeIntervalSince1970 * 1000
        for (groupId, endsAt) in state.activeCooldownEndsAt where endsAt > nowMs {
          scheduleExpiryMonitor(kind: "cooldown", groupId: groupId, endsAtMs: endsAt)
        }
        for (groupId, endsAt) in state.activeAccessLeaseEndsAt where endsAt > nowMs {
          scheduleExpiryMonitor(kind: "lease", groupId: groupId, endsAtMs: endsAt)
        }

        defaults?.set(true, forKey: self.monitoringOperationalKey)
        defaults?.removeObject(forKey: self.monitoringLastErrorKey)
      } catch {
        defaults?.set(false, forKey: self.monitoringOperationalKey)
        defaults?.set(error.localizedDescription, forKey: self.monitoringLastErrorKey)
      }
    }
    #endif
  }

  private func cleanupAfterAuthorizationLoss() {
    #if canImport(DeviceActivity)
    if #available(iOS 16.0, *) {
      DeviceActivityCenter().stopMonitoring()
    }
    #endif

    #if canImport(ManagedSettings)
    if #available(iOS 16.0, *) {
      let store = ManagedSettingsStore(named: .init(self.storeName))
      store.shield.applications = nil
      store.shield.applicationCategories = nil
    }
    #endif

    if let defaults = UserDefaults(suiteName: self.appGroupIdentifier) {
      defaults.removeObject(forKey: self.sharedStateKey)
      defaults.set(false, forKey: self.monitoringOperationalKey)
      defaults.removeObject(forKey: self.monitoringLastErrorKey)
    }
  }
}
