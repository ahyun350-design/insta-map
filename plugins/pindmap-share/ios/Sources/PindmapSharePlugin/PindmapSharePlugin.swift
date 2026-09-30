import Foundation
import Capacitor

/**
 App Group bridge for Share Extension → main app.
 Keys match ShareViewController: pendingShareUrl / pendingShareAt.
 */
@objc(PindmapSharePlugin)
public class PindmapSharePlugin: CAPPlugin, CAPBridgedPlugin {
  public let identifier = "PindmapSharePlugin"
  public let jsName = "PindmapShare"
  public let pluginMethods: [CAPPluginMethod] = [
    CAPPluginMethod(name: "consumePendingShare", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "getLastExtensionStarted", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "clearLastExtensionStarted", returnType: CAPPluginReturnPromise),
  ]

  private static let appGroupId = "group.com.pindmap.app"
  private static let pendingUrlKey = "pendingShareUrl"
  private static let pendingAtKey = "pendingShareAt"
  private static let lastExtensionUrlKey = "lastExtensionStartedUrl"
  private static let lastExtensionAtKey = "lastExtensionStartedAt"
  private static let ttlSeconds: TimeInterval = 10 * 60

  /// Atomic read-then-delete. Distinguishes empty vs expired for diagnostics.
  @objc func consumePendingShare(_ call: CAPPluginCall) {
    guard let defaults = UserDefaults(suiteName: Self.appGroupId) else {
      call.resolve(["url": NSNull(), "status": "empty"])
      return
    }

    let url = defaults.string(forKey: Self.pendingUrlKey)
    let at = defaults.double(forKey: Self.pendingAtKey)

    defaults.removeObject(forKey: Self.pendingUrlKey)
    defaults.removeObject(forKey: Self.pendingAtKey)
    defaults.synchronize()

    guard let url, !url.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      call.resolve(["url": NSNull(), "status": "empty"])
      return
    }

    if at > 0 {
      let age = Date().timeIntervalSince1970 - at
      if age > Self.ttlSeconds {
        call.resolve(["url": NSNull(), "status": "expired"])
        return
      }
    }

    call.resolve(["url": url, "status": "ok"])
  }

  /// Read-only: URL Extension already started via /api/extract/start.
  @objc func getLastExtensionStarted(_ call: CAPPluginCall) {
    guard let defaults = UserDefaults(suiteName: Self.appGroupId) else {
      call.resolve(["url": NSNull(), "at": NSNull()])
      return
    }
    let url = defaults.string(forKey: Self.lastExtensionUrlKey)
    let at = defaults.double(forKey: Self.lastExtensionAtKey)
    if let url, !url.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, at > 0 {
      call.resolve(["url": url, "at": at])
    } else {
      call.resolve(["url": NSNull(), "at": NSNull()])
    }
  }

  @objc func clearLastExtensionStarted(_ call: CAPPluginCall) {
    guard let defaults = UserDefaults(suiteName: Self.appGroupId) else {
      call.resolve()
      return
    }
    defaults.removeObject(forKey: Self.lastExtensionUrlKey)
    defaults.removeObject(forKey: Self.lastExtensionAtKey)
    defaults.synchronize()
    call.resolve()
  }
}
