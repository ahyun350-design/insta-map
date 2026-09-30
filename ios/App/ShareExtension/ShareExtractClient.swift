import Foundation

/// Direct POST /api/extract/start from Share Extension (Keychain JWT).
enum ShareExtractClient {
  private static var apiBase: String {
    (Bundle.main.object(forInfoDictionaryKey: "PindmapAPIBaseURL") as? String)?
      .trimmingCharacters(in: .whitespacesAndNewlines)
      ?? "https://pindmap.com"
  }

  private static var supabaseURL: String {
    (Bundle.main.object(forInfoDictionaryKey: "PindmapSupabaseURL") as? String)?
      .trimmingCharacters(in: .whitespacesAndNewlines)
      ?? ""
  }

  private static var anonKey: String {
    (Bundle.main.object(forInfoDictionaryKey: "PindmapSupabaseAnonKey") as? String)?
      .trimmingCharacters(in: .whitespacesAndNewlines)
      ?? ""
  }

  enum Outcome {
    case started
    case fallbackToAppGroup
  }

  static func startExtract(instagramURL: String) async -> Outcome {
    guard let tokens = PindmapAuthKeychain.load() else {
      return .fallbackToAppGroup
    }

    var access = tokens.access
    let refresh = tokens.refresh

    // Refresh if expired (60s skew) or missing expires
    if let exp = tokens.expiresAt, exp < Date().timeIntervalSince1970 + 60 {
      if let renewed = await refreshAccessToken(refreshToken: refresh) {
        access = renewed.access
        try? PindmapAuthKeychain.save(
          accessToken: renewed.access,
          refreshToken: renewed.refresh,
          expiresAt: renewed.expiresAt
        )
      }
    }

    let first = await postStart(instagramURL: instagramURL, accessToken: access)
    switch first {
    case .ok:
      return .started
    case .unauthorized:
      guard let renewed = await refreshAccessToken(refreshToken: refresh) else {
        return .fallbackToAppGroup
      }
      try? PindmapAuthKeychain.save(
        accessToken: renewed.access,
        refreshToken: renewed.refresh,
        expiresAt: renewed.expiresAt
      )
      let second = await postStart(instagramURL: instagramURL, accessToken: renewed.access)
      return second == .ok ? .started : .fallbackToAppGroup
    case .failed:
      return .fallbackToAppGroup
    }
  }

  private enum PostResult {
    case ok
    case unauthorized
    case failed
  }

  private static func postStart(instagramURL: String, accessToken: String) async -> PostResult {
    guard let url = URL(string: apiBase + "/api/extract/start") else { return .failed }
    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
    req.timeoutInterval = 20
    do {
      req.httpBody = try JSONSerialization.data(withJSONObject: ["instagramUrl": instagramURL])
      let (_, resp) = try await URLSession.shared.data(for: req)
      guard let http = resp as? HTTPURLResponse else { return .failed }
      if http.statusCode == 401 { return .unauthorized }
      if (200...299).contains(http.statusCode) { return .ok }
      return .failed
    } catch {
      return .failed
    }
  }

  private static func refreshAccessToken(refreshToken: String) async -> (
    access: String, refresh: String, expiresAt: Double?
  )? {
    guard !supabaseURL.isEmpty, !anonKey.isEmpty else { return nil }
    guard let url = URL(string: supabaseURL + "/auth/v1/token?grant_type=refresh_token") else {
      return nil
    }
    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.setValue(anonKey, forHTTPHeaderField: "apikey")
    req.setValue("Bearer \(anonKey)", forHTTPHeaderField: "Authorization")
    req.timeoutInterval = 15
    do {
      req.httpBody = try JSONSerialization.data(withJSONObject: ["refresh_token": refreshToken])
      let (data, resp) = try await URLSession.shared.data(for: req)
      guard let http = resp as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
        return nil
      }
      guard
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
        let access = json["access_token"] as? String, !access.isEmpty,
        let refresh = json["refresh_token"] as? String, !refresh.isEmpty
      else { return nil }
      let expiresAt: Double?
      if let exp = json["expires_at"] as? Double {
        expiresAt = exp
      } else if let exp = json["expires_at"] as? Int {
        expiresAt = Double(exp)
      } else if let expiresIn = json["expires_in"] as? Int {
        expiresAt = Date().timeIntervalSince1970 + Double(expiresIn)
      } else {
        expiresAt = nil
      }
      return (access, refresh, expiresAt)
    } catch {
      return nil
    }
  }
}
