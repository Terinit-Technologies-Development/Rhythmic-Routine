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
  public func definition() -> ModuleDefinition {
    Name("RhythmDevice")

    AsyncFunction("checkPermissions") { () -> [String: Any] in
      #if canImport(FamilyControls)
      if #available(iOS 16.0, *) {
        let status = AuthorizationCenter.shared.authorizationStatus
        let statusString: String
        switch status {
        case .notDetermined:
          statusString = "unknown"
        case .approved:
          statusString = "approved"
        case .denied:
          statusString = "denied"
        @unknown default:
          statusString = "unknown"
        }

        return [
          "hasUsagePermission": status == .approved,
          "hasRestrictionPermission": status == .approved,
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

    AsyncFunction("getInstalledApps") { () -> [[String: Any]] in
      // iOS FamilyControls does not expose plaintext installed applications
      // Opaque native selection tokens are used when authorized
      return []
    }

    AsyncFunction("queryUsageEvents") { (startTime: Double, endTime: Double) -> [[String: Any]] in
      return []
    }

    AsyncFunction("applyShieldRestrictions") { (packageNames: [String]) -> Bool in
      #if canImport(ManagedSettings)
      if #available(iOS 16.0, *) {
        // ManagedSettingsStore shield activation foundation
        // let store = ManagedSettingsStore()
        // store.shield.applications = ...
        return true
      }
      #endif
      return false
    }

    AsyncFunction("clearShieldRestrictions") { (packageNames: [String]) -> Bool in
      #if canImport(ManagedSettings)
      if #available(iOS 16.0, *) {
        // ManagedSettingsStore shield clear foundation
        // let store = ManagedSettingsStore()
        // store.shield.applications = nil
        return true
      }
      #endif
      return false
    }
  }
}
