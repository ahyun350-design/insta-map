//
//  ShareViewController.swift
//  ShareExtension
//
//  Instagram URL → App Group (+ best-effort pindmap:// open). No network.
//

import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
  private static let appGroupId = "group.com.pindmap.app"
  private static let pendingUrlKey = "pendingShareUrl"
  private static let pendingAtKey = "pendingShareAt"

  private let statusLabel = UILabel()

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = UIColor.systemBackground
    configureStatusLabel()
    statusLabel.text = "처리 중…"
    Task { await processShare() }
  }

  private func configureStatusLabel() {
    statusLabel.translatesAutoresizingMaskIntoConstraints = false
    statusLabel.textAlignment = .center
    statusLabel.numberOfLines = 0
    statusLabel.font = .systemFont(ofSize: 16, weight: .medium)
    statusLabel.textColor = .label
    view.addSubview(statusLabel)
    NSLayoutConstraint.activate([
      statusLabel.leadingAnchor.constraint(equalTo: view.layoutMarginsGuide.leadingAnchor),
      statusLabel.trailingAnchor.constraint(equalTo: view.layoutMarginsGuide.trailingAnchor),
      statusLabel.centerYAnchor.constraint(equalTo: view.centerYAnchor),
    ])
  }

  private func processShare() async {
    let extracted = await extractSharedURL()
    guard let urlString = extracted, isAllowedInstagramURL(urlString) else {
      await showMessageAndFinish("인스타그램 링크만 저장할 수 있어요")
      return
    }

    savePendingShare(urlString: urlString)

    // Best-effort only. Apple scopes extensionContext.open primarily to Today;
    // Share Extensions often get success=false for custom schemes. App Group remains.
    await openMainAppIfPossible(instagramURL: urlString)

    await showMessageAndFinish("PindMap에 저장했어요. 앱에서 추출됩니다")
  }

  private func savePendingShare(urlString: String) {
    guard let defaults = UserDefaults(suiteName: Self.appGroupId) else { return }
    defaults.set(urlString, forKey: Self.pendingUrlKey)
    defaults.set(Date().timeIntervalSince1970, forKey: Self.pendingAtKey)
    defaults.synchronize()
  }

  private func openMainAppIfPossible(instagramURL: String) async {
    var components = URLComponents()
    components.scheme = "pindmap"
    components.host = "extract"
    components.queryItems = [URLQueryItem(name: "url", value: instagramURL)]
    guard let openURL = components.url else { return }

    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      extensionContext?.open(openURL) { _ in
        continuation.resume()
      } ?? continuation.resume()
    }
  }

  private func showMessageAndFinish(_ message: String) async {
    await MainActor.run { statusLabel.text = message }
    try? await Task.sleep(nanoseconds: 1_200_000_000)
    extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
  }

  // MARK: - Extract URL from extension items

  private func extractSharedURL() async -> String? {
    let items = extensionContext?.inputItems.compactMap { $0 as? NSExtensionItem } ?? []
    for item in items {
      guard let attachments = item.attachments else { continue }
      for provider in attachments {
        if let url = await loadURL(from: provider) {
          return url
        }
        if let text = await loadPlainText(from: provider),
           let url = firstURL(in: text) {
          return url
        }
      }
    }
    return nil
  }

  private func loadURL(from provider: NSItemProvider) async -> String? {
    let typeIds = [UTType.url.identifier, "public.url"]
    for typeId in typeIds {
      guard provider.hasItemConformingToTypeIdentifier(typeId) else { continue }
      let value: Any? = await withCheckedContinuation { continuation in
        provider.loadItem(forTypeIdentifier: typeId, options: nil) { item, _ in
          continuation.resume(returning: item)
        }
      }
      if let url = value as? URL {
        return url.absoluteString
      }
      if let data = value as? Data, let s = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty {
        return s
      }
      if let s = value as? String {
        let trimmed = s.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty { return trimmed }
      }
    }
    return nil
  }

  private func loadPlainText(from provider: NSItemProvider) async -> String? {
    let typeId = UTType.plainText.identifier
    guard provider.hasItemConformingToTypeIdentifier(typeId) else { return nil }
    let value: Any? = await withCheckedContinuation { continuation in
      provider.loadItem(forTypeIdentifier: typeId, options: nil) { item, _ in
        continuation.resume(returning: item)
      }
    }
    if let s = value as? String { return s }
    if let data = value as? Data { return String(data: data, encoding: .utf8) }
    return nil
  }

  private func firstURL(in text: String) -> String? {
    guard let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else {
      return nil
    }
    let range = NSRange(text.startIndex..<text.endIndex, in: text)
    let match = detector.firstMatch(in: text, options: [], range: range)
    guard let match, let url = match.url else { return nil }
    return url.absoluteString
  }

  private func isAllowedInstagramURL(_ raw: String) -> Bool {
    guard let url = URL(string: raw), let host = url.host?.lowercased() else { return false }
    if host == "instagr.am" || host == "www.instagr.am" {
      return true
    }
    let allowedHosts: Set<String> = [
      "instagram.com",
      "www.instagram.com",
      "m.instagram.com",
    ]
    guard allowedHosts.contains(host) else { return false }
    let path = url.path.lowercased()
    return path.contains("/reel/") || path.contains("/p/") || path.hasPrefix("/reel") || path.hasPrefix("/p/")
  }
}
