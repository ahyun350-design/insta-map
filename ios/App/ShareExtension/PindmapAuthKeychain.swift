import Foundation
import Security

/// Must stay in sync with plugins/pindmap-auth-session/.../PindmapAuthKeychain.swift
enum PindmapAuthKeychain {
  static let service = "com.pindmap.app.supabase"
  static let accessGroup = "6PPUBSW44S.com.pindmap.app"
  static let appGroupId = "group.com.pindmap.app"

  private static let accountAccess = "access_token"
  private static let accountRefresh = "refresh_token"
  private static let accountExpires = "expires_at"

  static func load() -> (access: String, refresh: String, expiresAt: Double?)? {
    guard
      let access = read(account: accountAccess), !access.isEmpty,
      let refresh = read(account: accountRefresh), !refresh.isEmpty
    else { return nil }
    let expStr = read(account: accountExpires)
    let exp = expStr.flatMap { Double($0) }
    return (access, refresh, exp)
  }

  static func save(accessToken: String, refreshToken: String, expiresAt: Double?) throws {
    try upsert(account: accountAccess, value: accessToken)
    try upsert(account: accountRefresh, value: refreshToken)
    if let expiresAt {
      try upsert(account: accountExpires, value: String(expiresAt))
    } else {
      delete(account: accountExpires)
    }
  }

  private static func upsert(account: String, value: String) throws {
    delete(account: account)
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecAttrAccessGroup as String: accessGroup,
      kSecValueData as String: Data(value.utf8),
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    ]
    let status = SecItemAdd(query as CFDictionary, nil)
    guard status == errSecSuccess else {
      throw NSError(domain: "PindmapAuthKeychain", code: Int(status))
    }
  }

  private static func read(account: String) -> String? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecAttrAccessGroup as String: accessGroup,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    guard status == errSecSuccess, let data = item as? Data else { return nil }
    return String(data: data, encoding: .utf8)
  }

  private static func delete(account: String) {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecAttrAccessGroup as String: accessGroup,
    ]
    SecItemDelete(query as CFDictionary)
  }
}
