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
  ]

  private static let appGroupId = "group.com.pindmap.app"
  private static let pendingUrlKey = "pendingShareUrl"
  private static let pendingAtKey = "pendingShareAt"
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
}
