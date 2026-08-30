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
  private let persistentMonitoringOperationalKey = "persistent_monitoring_operational"
  private let expiryMonitoringOperationalKey = "expiry_monitoring_operational"
  private let monitoringLastErrorKey = "monitoring_last_error"
  private let monitoringConfigSignatureKey = "monitoring_config_signature"

  private let maximumActivityCount = 20
  private let reservedExpirySlots = 1
  private let reservedSafetySlots = 1
  private var maximumPersistentActivities: Int {
    maximumActivityCount - reservedExpirySlots - reservedSafetySlots // 18
  }

  private func selectionKey(groupId: String) -> String {
    return "selection.\(groupId)"
  }

  private func selectionRevisionKey(groupId: String) -> String {
    return "selection_revision.\(groupId)"
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

  private func isRhythmRoutineActivity(_ name: DeviceActivityName) -> Bool {
    return name.rawValue.hasPrefix("routine|")
  }

  private func isRhythmRiskActivity(_ name: DeviceActivityName) -> Bool {
    return name.rawValue == "risk.daily"
  }

  private func isRhythmExpiryActivity(_ name: DeviceActivityName) -> Bool {
    return name.rawValue.hasPrefix("expiry|")
  }

  private func updateOverallMonitoringHealth(defaults: UserDefaults?) {
    guard let defaults = defaults else { return }
    let persistentOp = defaults.bool(forKey: self.persistentMonitoringOperationalKey)
    let expiryOp = defaults.bool(forKey: self.expiryMonitoringOperationalKey)

    let nowMs = Date().timeIntervalSince1970 * 1000
    var hasActiveExpiry = false
    if let data = defaults.data(forKey: self.sharedStateKey),
       let state = try? JSONDecoder().decode(SharedRhythmState.self, from: data) {
      hasActiveExpiry = self.nextExpiry(state: state, nowMs: nowMs) != nil
    }

    let overall = persistentOp && (!hasActiveExpiry || expiryOp)
    defaults.set(overall, forKey: self.monitoringOperationalKey)
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
        let persistentOperational = defaults?.bool(forKey: self.persistentMonitoringOperationalKey) ?? false
        let expiryOperational = defaults?.bool(forKey: self.expiryMonitoringOperationalKey) ?? false
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
          "persistentMonitoringOperational": persistentOperational,
          "expiryMonitoringOperational": expiryOperational,
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
        "persistentMonitoringOperational": false,
        "expiryMonitoringOperational": false,
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

                // Increment selection revision monotonically so monitoring configuration signature detects selection updates
                let revKey = self.selectionRevisionKey(groupId: groupId)
                let nextRevision = (defaults?.integer(forKey: revKey) ?? 0) + 1
                defaults?.set(nextRevision, forKey: revKey)

                let tokenCount = currentSelection.applicationTokens.count + currentSelection.categoryTokens.count + currentSelection.webDomainTokens.count
                promise.resolve([
                  "localSelectionId": key,
                  "tokenCount": tokenCount,
                  "revision": nextRevision,
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

    AsyncFunction("clearGroupSelection") { (groupId: String) -> [String: Any] in
      guard let defaults = UserDefaults(suiteName: self.appGroupIdentifier) else {
        return ["success": false, "revision": 0]
      }
      defaults.removeObject(forKey: self.selectionKey(groupId: groupId))
      let revKey = self.selectionRevisionKey(groupId: groupId)
      let nextRevision = defaults.integer(forKey: revKey) + 1
      defaults.set(nextRevision, forKey: revKey)

      self.recomputeAndApplyShieldsInternal()
      return ["success": true, "revision": nextRevision]
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
        do {
          try self.ensureNearestExpiryMonitor(state: state)
        } catch {
          // Failure recorded in expiry_monitoring_operational
        }
        self.updateOverallMonitoringHealth(defaults: defaults)
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

    AsyncFunction("synchronizeMonitoringConfiguration") { (stateJson: String, configurationSignature: String) -> [String: Any] in
      #if canImport(DeviceActivity) && canImport(FamilyControls)
      if #available(iOS 16.0, *) {
        guard let defaults = UserDefaults(suiteName: self.appGroupIdentifier) else {
          return [
            "success": false,
            "persistentActivityCount": 0,
            "totalActivityCount": 0,
            "errorCode": "app_group_unavailable",
            "errorMessage": "App Group UserDefaults unavailable"
          ]
        }

        let center = DeviceActivityCenter()
        let persistedSignature = defaults.string(forKey: self.monitoringConfigSignatureKey)

        // Idempotency: If configuration signature is unchanged and monitoring is operational, no-op!
        if persistedSignature == configurationSignature && defaults.bool(forKey: self.monitoringOperationalKey) {
          let persistentCount = center.activities.filter { self.isRhythmRoutineActivity($0) || self.isRhythmRiskActivity($0) }.count
          return [
            "success": true,
            "persistentActivityCount": persistentCount,
            "totalActivityCount": center.activities.count
          ]
        }

        guard let data = stateJson.data(using: .utf8),
              let state = try? JSONDecoder().decode(SharedRhythmState.self, from: data) else {
          return [
            "success": false,
            "persistentActivityCount": 0,
            "totalActivityCount": 0,
            "errorCode": "invalid_payload",
            "errorMessage": "Failed to decode stateJson"
          ]
        }

        let plan = self.buildMonitoringPlan(state: state, defaults: defaults)
        let persistentCount = plan.routines.count + (plan.riskEvents.isEmpty ? 0 : 1)

        // Preflight budget check: max 18 persistent activities
        if persistentCount > self.maximumPersistentActivities {
          defaults.set(false, forKey: self.persistentMonitoringOperationalKey)
          defaults.set(false, forKey: self.monitoringOperationalKey)
          let errorMsg = "Requested \(persistentCount) persistent activities, maximum is \(self.maximumPersistentActivities)"
          defaults.set("activity_budget_exceeded: \(errorMsg)", forKey: self.monitoringLastErrorKey)
          return [
            "success": false,
            "persistentActivityCount": persistentCount,
            "totalActivityCount": center.activities.count,
            "errorCode": "activity_budget_exceeded",
            "errorMessage": errorMsg
          ]
        }

        // Persistent topology is being replaced; old healthy state must not survive if an error occurs
        defaults.set(false, forKey: self.persistentMonitoringOperationalKey)

        // Phase 1: Persistent registration error boundary
        do {
          // Stop ONLY persistent routine and risk activities; preserve expiry activities!
          let persistentToReplace = center.activities.filter {
            self.isRhythmRoutineActivity($0) || self.isRhythmRiskActivity($0)
          }
          if !persistentToReplace.isEmpty {
            center.stopMonitoring(persistentToReplace)
          }

          // Register routine activities
          for planned in plan.routines {
            try center.startMonitoring(planned.name, during: planned.schedule)
          }

          // Register single risk.daily activity if any group has non-empty tokens
          if !plan.riskEvents.isEmpty {
            let dailySchedule = DeviceActivitySchedule(
              intervalStart: DateComponents(hour: 0, minute: 0),
              intervalEnd: DateComponents(hour: 23, minute: 59),
              repeats: true
            )
            try center.startMonitoring(DeviceActivityName("risk.daily"), during: dailySchedule, events: plan.riskEvents)
          }

          defaults.set(true, forKey: self.persistentMonitoringOperationalKey)
        } catch {
          defaults.set(false, forKey: self.persistentMonitoringOperationalKey)
          self.recordMonitoringFailure(error, context: "persistent-monitoring")
          self.updateOverallMonitoringHealth(defaults: defaults)
          return [
            "success": false,
            "persistentActivityCount": persistentCount,
            "totalActivityCount": center.activities.count,
            "errorCode": "persistent_registration_failed",
            "errorMessage": error.localizedDescription
          ]
        }

        // Phase 2: Expiry monitor error boundary
        do {
          try self.ensureNearestExpiryMonitor(state: state)
        } catch {
          // ensureNearestExpiryMonitor already sets expiryMonitoringOperationalKey = false
          // and records the error details via recordMonitoringFailure
          self.updateOverallMonitoringHealth(defaults: defaults)
          return [
            "success": false,
            "persistentActivityCount": persistentCount,
            "totalActivityCount": center.activities.count,
            "errorCode": "expiry_registration_failed",
            "errorMessage": error.localizedDescription
          ]
        }

        // Both phases succeeded!
        self.updateOverallMonitoringHealth(defaults: defaults)
        defaults.removeObject(forKey: self.monitoringLastErrorKey)
        defaults.set(configurationSignature, forKey: self.monitoringConfigSignatureKey)

        return [
          "success": true,
          "persistentActivityCount": persistentCount,
          "totalActivityCount": center.activities.count
        ]
      }
      #endif

      return [
        "success": false,
        "persistentActivityCount": 0,
        "totalActivityCount": 0,
        "errorCode": "unsupported",
        "errorMessage": "DeviceActivity requires iOS 16.0+"
      ]
    }

    AsyncFunction("getMonitoringDiagnostics") { () -> [String: Any] in
      #if canImport(DeviceActivity)
      if #available(iOS 16.0, *) {
        let center = DeviceActivityCenter()
        let defaults = UserDefaults(suiteName: self.appGroupIdentifier)
        let persistentOp = defaults?.bool(forKey: self.persistentMonitoringOperationalKey) ?? false
        let expiryOp = defaults?.bool(forKey: self.expiryMonitoringOperationalKey) ?? false
        let monitoringOp = defaults?.bool(forKey: self.monitoringOperationalKey) ?? false

        return [
          "activityCount": center.activities.count,
          "activityNames": center.activities.map { $0.rawValue },
          "monitoringOperational": monitoringOp,
          "persistentMonitoringOperational": persistentOp,
          "expiryMonitoringOperational": expiryOp,
          "configSignature": defaults?.string(forKey: self.monitoringConfigSignatureKey) ?? "",
          "lastError": defaults?.string(forKey: self.monitoringLastErrorKey) ?? ""
        ]
      }
      #endif

      return [
        "activityCount": 0,
        "activityNames": [],
        "monitoringOperational": false,
        "persistentMonitoringOperational": false,
        "expiryMonitoringOperational": false,
        "configSignature": "",
        "lastError": ""
      ]
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

  struct PlannedRoutineActivity {
    let name: DeviceActivityName
    let schedule: DeviceActivitySchedule
  }

  private func buildMonitoringPlan(state: SharedRhythmState, defaults: UserDefaults) -> (routines: [PlannedRoutineActivity], riskEvents: [DeviceActivityEvent.Name: DeviceActivityEvent]) {
    var plannedRoutines: [PlannedRoutineActivity] = []

    // 1. Routine compression: skip empty protected groups (e.g. Open Day)
    for routine in state.routines where routine.enabled && !routine.protectedGroupIds.isEmpty {
      let startParts = routine.startTime.split(separator: ":").compactMap { Int($0) }
      let endParts = (routine.endTime ?? "08:00").split(separator: ":").compactMap { Int($0) }
      guard startParts.count == 2, endParts.count == 2 else { continue }

      let isEveryDay = Set(routine.activeDays) == Set(1...7)

      if isEveryDay {
        // Compress 7-day routine into 1 repeating daily monitor
        let schedule = DeviceActivitySchedule(
          intervalStart: DateComponents(hour: startParts[0], minute: startParts[1]),
          intervalEnd: DateComponents(hour: endParts[0], minute: endParts[1]),
          repeats: true
        )
        let name = DeviceActivityName("routine|\(routine.windowId)|daily")
        plannedRoutines.append(PlannedRoutineActivity(name: name, schedule: schedule))
      } else {
        // Partial-week routines: 1 monitor per weekday
        for isoDay in routine.activeDays {
          guard let schedule = makeRoutineSchedule(routine: routine, isoDay: isoDay) else { continue }
          let name = routineActivityName(windowId: routine.windowId, isoDay: isoDay)
          plannedRoutines.append(PlannedRoutineActivity(name: name, schedule: schedule))
        }
      }
    }

    // 2. Build consolidated risk events for single risk.daily activity
    var riskEvents: [DeviceActivityEvent.Name: DeviceActivityEvent] = [:]
    #if canImport(FamilyControls)
    if #available(iOS 16.0, *) {
      for group in state.groups {
        let key = self.selectionKey(groupId: group.groupId)
        guard let data = defaults.data(forKey: key),
              let selection = try? JSONDecoder().decode(FamilyActivitySelection.self, from: data) else {
          continue
        }
        let tokenCount = selection.applicationTokens.count + selection.categoryTokens.count + selection.webDomainTokens.count
        guard tokenCount > 0 else { continue }

        riskEvents[DeviceActivityEvent.Name(group.groupId)] = DeviceActivityEvent(
          applications: selection.applicationTokens,
          categories: selection.categoryTokens,
          webDomains: selection.webDomainTokens,
          threshold: DateComponents(minute: group.sessionThresholdMinutes),
          includesPastActivity: false
        )
      }
    }
    #endif

    return (plannedRoutines, riskEvents)
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

  private func ensureNearestExpiryMonitor(state: SharedRhythmState) throws {
    #if canImport(DeviceActivity)
    if #available(iOS 16.0, *) {
      let center = DeviceActivityCenter()
      let now = Date()
      let nowMs = now.timeIntervalSince1970 * 1000
      guard let defaults = UserDefaults(suiteName: self.appGroupIdentifier) else { return }

      let expiryActivities = center.activities.filter { isRhythmExpiryActivity($0) }

      guard let semanticEndsAt = nextExpiry(state: state, nowMs: nowMs) else {
        if !expiryActivities.isEmpty {
          center.stopMonitoring(expiryActivities)
        }
        defaults.set(true, forKey: self.expiryMonitoringOperationalKey)
        return
      }

      let expectedName = DeviceActivityName("expiry|next|\(Int(semanticEndsAt))")
      if expiryActivities.contains(expectedName) {
        // Nearest wake-up monitor already registered; no churn
        defaults.set(true, forKey: self.expiryMonitoringOperationalKey)
        return
      }

      let schedule = makeExpiryWakeSchedule(semanticEndsAtMs: semanticEndsAt, now: now)
      if !expiryActivities.isEmpty {
        center.stopMonitoring(expiryActivities)
      }
      do {
        try center.startMonitoring(expectedName, during: schedule)
        defaults.set(true, forKey: self.expiryMonitoringOperationalKey)
      } catch {
        defaults.set(false, forKey: self.expiryMonitoringOperationalKey)
        recordMonitoringFailure(error, context: "ensureNearestExpiryMonitor")
        throw error
      }
    }
    #endif
  }

  private func recordMonitoringFailure(_ error: Error, context: String) {
    guard let defaults = UserDefaults(suiteName: self.appGroupIdentifier) else { return }
    defaults.set(false, forKey: self.monitoringOperationalKey)
    defaults.set("\(context): \(error.localizedDescription)", forKey: self.monitoringLastErrorKey)
  }

  private func cleanupAfterAuthorizationLoss() {
    #if canImport(DeviceActivity)
    if #available(iOS 16.0, *) {
      DeviceActivityCenter().stopMonitoring() // Full stop ONLY on explicit authorization revocation
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
      defaults.set(false, forKey: self.persistentMonitoringOperationalKey)
      defaults.set(false, forKey: self.expiryMonitoringOperationalKey)
      defaults.removeObject(forKey: self.monitoringLastErrorKey)
      defaults.removeObject(forKey: self.monitoringConfigSignatureKey)
    }
  }
}
