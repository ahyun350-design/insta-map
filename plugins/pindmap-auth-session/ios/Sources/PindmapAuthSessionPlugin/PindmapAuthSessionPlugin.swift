import Foundation
import Capacitor

/**
 Write-only session mirror: Shared Keychain (tokens) + App Group (userId only).
 Does not read Capacitor Preferences / does not touch JS auth watchdog.
 */
@objc(PindmapAuthSessionPlugin)
public class PindmapAuthSessionPlugin: CAPPlugin, CAPBridgedPlugin {
  public let identifier = "PindmapAuthSessionPlugin"
  public let jsName = "PindmapAuthSession"
  public let pluginMethods: [CAPPluginMethod] = [
    CAPPluginMethod(name: "mirrorSession", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "clearSession", returnType: CAPPluginReturnPromise),
  ]

  @objc func mirrorSession(_ call: CAPPluginCall) {
    guard
      let access = call.getString("accessToken"), !access.isEmpty,
      let refresh = call.getString("refreshToken"), !refresh.isEmpty,
      let userId = call.getString("userId"), !userId.isEmpty
    else {
      call.reject("accessToken, refreshToken, userId required")
      return
    }
    let expiresAt: Double?
    if let n = call.getDouble("expiresAt") {
      expiresAt = n
    } else if let i = call.getInt("expiresAt") {
      expiresAt = Double(i)
    } else {
      expiresAt = nil
    }

    do {
      try PindmapAuthKeychain.save(
        accessToken: access,
        refreshToken: refresh,
        expiresAt: expiresAt
      )
      PindmapAuthKeychain.setAppGroupUserId(userId)
      call.resolve()
    } catch {
      call.reject(error.localizedDescription)
    }
  }

  @objc func clearSession(_ call: CAPPluginCall) {
    PindmapAuthKeychain.clear()
    PindmapAuthKeychain.setAppGroupUserId(nil)
    call.resolve()
  }
}
