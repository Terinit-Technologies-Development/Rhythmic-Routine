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

public class RhythmDeviceModule: Module {
  private let appGroupIdentifier = "group.com.terinit.rhythmicroutine"
  private let storeName = "RhythmRoutineStore"

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

        return [
          "hasUsagePermission": isApproved,
          "hasRestrictionPermission": isApproved,
          "familyControlsStatus": statusString
        ]
      }
      #endif

      return [
        "hasUsagePermission": false,
        "hasRestrictionPermission": false,
        "familyControlsStatus": "unsupported"
      ]
    }

    AsyncFunction("requestUsagePermission") { () -> Void in
      #if canImport(FamilyControls)
      if #available(iOS 16.0, *) {
        do {
          try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
        } catch {
          // Authorization denied or unavailable
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

    AsyncFunction("revokeAuthorization") { () -> Void in
      #if canImport(ManagedSettings)
      if #available(iOS 16.0, *) {
        let store = ManagedSettingsStore(named: .init(self.storeName))
        store.shield.applications = nil
        store.shield.applicationCategories = nil
      }
      #endif
      if let defaults = UserDefaults(suiteName: self.appGroupIdentifier) {
        defaults.removeObject(forKey: "selection.all")
        defaults.removeObject(forKey: "shared_rhythm_state")
      }
    }

    AsyncFunction("getInstalledApps") { () -> [[String: Any]] in
      // iOS FamilyControls deliberately conceals plaintext bundle identifiers
      return []
    }

    AsyncFunction("queryUsageEvents") { (startTime: Double, endTime: Double) -> [[String: Any]] in
      return []
    }

    AsyncFunction("applyShieldRestrictions") { (packageNames: [String]) -> Bool in
      #if canImport(ManagedSettings) && canImport(FamilyControls)
      if #available(iOS 16.0, *) {
        let defaults = UserDefaults(suiteName: self.appGroupIdentifier)
        if let savedData = defaults?.data(forKey: "selection.all"),
           let selection = try? JSONDecoder().decode(FamilyActivitySelection.self, from: savedData) {
          let store = ManagedSettingsStore(named: .init(self.storeName))
          store.shield.applications = selection.applicationTokens
          store.shield.applicationCategories = .specific(selection.categoryTokens)
          return true
        }
        return false
      }
      #endif
      return false
    }

    AsyncFunction("clearShieldRestrictions") { (packageNames: [String]) -> Bool in
      #if canImport(ManagedSettings)
      if #available(iOS 16.0, *) {
        let store = ManagedSettingsStore(named: .init(self.storeName))
        store.shield.applications = nil
        store.shield.applicationCategories = nil
        return true
      }
      #endif
      return false
    }

    AsyncFunction("setSharedRhythmState") { (stateJson: String) -> Bool in
      guard let data = stateJson.data(using: .utf8),
            let defaults = UserDefaults(suiteName: self.appGroupIdentifier) else {
        return false
      }
      defaults.set(data, forKey: "shared_rhythm_state")
      return true
    }
  }
}
