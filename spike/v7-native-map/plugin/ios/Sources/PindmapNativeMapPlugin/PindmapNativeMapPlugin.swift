import Foundation
import UIKit
import Capacitor
import MapKit
import KakaoMapsSDK

// MARK: - MapKit host (V-7-0 prototype — no Kakao key required)

private final class MapKitMapHost: UIView {
    let mapView = MKMapView()

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear
        isOpaque = false
        isUserInteractionEnabled = true
        mapView.mapType = .standard
        mapView.isOpaque = true
        mapView.isUserInteractionEnabled = true
        mapView.frame = bounds
        mapView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        addSubview(mapView)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        mapView.frame = bounds
    }

    func setCamera(lat: Double, lng: Double, zoom: Double, animated: Bool) {
        let center = CLLocationCoordinate2D(latitude: lat, longitude: lng)
        // Rough span from Kakao-like level (spike only)
        let delta = max(0.002, 0.45 / pow(1.45, zoom))
        let region = MKCoordinateRegion(center: center, span: MKCoordinateSpan(latitudeDelta: delta, longitudeDelta: delta))
        mapView.setRegion(region, animated: animated)
    }
}

// MARK: - Kakao Maps host (KMViewContainer + KMController)

private final class KakaoMapHost: UIView {
    private let kmContainer = KMViewContainer()
    private var mapController: KMController?
    private var pendingCamera: (lat: Double, lng: Double, zoom: Double)?
    private var markerLayer: LabelLayer?
    private var markerPois: [String: Poi] = [:]
    private var markerStyleRegistered = false
    private static let markerLayerID = "pindmap-markers"
    private static let markerStyleID = "pindmap-marker-style"

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear
        isOpaque = false
        isUserInteractionEnabled = true

        kmContainer.frame = bounds
        kmContainer.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        kmContainer.isUserInteractionEnabled = true
        addSubview(kmContainer)

        guard !SDKInitializer.GetAppKey().isEmpty else {
            CAPLog.print("[PindmapNativeMap] Kakao InitSDK skipped — KakaoMapKeys.plist not in app bundle (Target Membership App)")
            return
        }

        let controller = KMController(viewContainer: kmContainer)
        mapController = controller
        controller.delegate = self
        _ = controller.prepareEngine()
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        kmContainer.frame = bounds
    }

    func setCamera(lat: Double, lng: Double, zoom: Double, animated: Bool) {
        pendingCamera = (lat, lng, zoom)
        applyCameraIfReady(animated: animated)
    }

    func teardown() {
        clearNativeMarkers()
        markerLayer = nil
        markerStyleRegistered = false
        mapController?.pauseEngine()
        mapController?.resetEngine()
        mapController?.delegate = nil
        mapController = nil
        pendingCamera = nil
    }

    func addNativeMarkers(_ inputs: [(id: String, lat: Double, lng: Double)]) -> Int {
        guard let layer = ensureMarkerInfrastructure() else { return 0 }
        var added = 0
        for input in inputs {
            if markerPois[input.id] != nil {
                layer.removePoi(poiID: input.id)
                markerPois.removeValue(forKey: input.id)
            }
            let option = PoiOptions(styleID: Self.markerStyleID, poiID: input.id)
            option.rank = 0
            let point = MapPoint(longitude: input.lng, latitude: input.lat)
            guard let poi = layer.addPoi(option: option, at: point) else { continue }
            poi.show()
            markerPois[input.id] = poi
            added += 1
        }
        return added
    }

    func removeNativeMarkers(ids: [String]) {
        guard let layer = markerLayer ?? ensureMarkerInfrastructure() else { return }
        for id in ids {
            layer.removePoi(poiID: id)
            markerPois.removeValue(forKey: id)
        }
    }

    func clearNativeMarkers() {
        markerLayer?.clearAllItems()
        markerPois.removeAll()
    }

    private static func makeDefaultMarkerIcon() -> UIImage {
        let size = CGSize(width: 28, height: 28)
        let renderer = UIGraphicsImageRenderer(size: size)
        return renderer.image { ctx in
            UIColor.systemRed.setFill()
            ctx.cgContext.fillEllipse(in: CGRect(origin: .zero, size: size))
            UIColor.white.setStroke()
            ctx.cgContext.setLineWidth(2)
            ctx.cgContext.strokeEllipse(in: CGRect(x: 1, y: 1, width: size.width - 2, height: size.height - 2))
        }
    }

    private func kakaoMapView() -> KakaoMap? {
        mapController?.getView("mapview") as? KakaoMap
    }

    private func ensureMarkerInfrastructure() -> LabelLayer? {
        guard let map = kakaoMapView() else { return nil }
        let manager = map.getLabelManager()
        if !markerStyleRegistered {
            let iconStyle = PoiIconStyle(symbol: Self.makeDefaultMarkerIcon(), anchorPoint: CGPoint(x: 0.5, y: 1.0))
            let perLevel = PerLevelPoiStyle(iconStyle: iconStyle, level: 0)
            manager.addPoiStyle(PoiStyle(styleID: Self.markerStyleID, styles: [perLevel]))
            markerStyleRegistered = true
        }
        if markerLayer == nil {
            if let existing = manager.getLabelLayer(layerID: Self.markerLayerID) {
                markerLayer = existing
            } else {
                let opts = LabelLayerOptions(
                    layerID: Self.markerLayerID,
                    competitionType: .none,
                    competitionUnit: .poi,
                    orderType: .rank,
                    zOrder: 100
                )
                markerLayer = manager.addLabelLayer(option: opts)
            }
        }
        return markerLayer
    }

    private func kakaoZoomLevel() -> Int {
        guard let zoom = pendingCamera?.zoom else { return 9 }
        return max(1, min(20, Int(zoom.rounded())))
    }

    private func kakaoPosition() -> MapPoint {
        if let pending = pendingCamera {
            return MapPoint(longitude: pending.lng, latitude: pending.lat)
        }
        return MapPoint(longitude: 126.978, latitude: 37.5665)
    }

    private func applyCameraIfReady(animated: Bool) {
        guard let pending = pendingCamera,
              let controller = mapController,
              let kakaoMap = controller.getView("mapview") as? KakaoMap else { return }
        let target = MapPoint(longitude: pending.lng, latitude: pending.lat)
        let level = max(1, min(20, Int(pending.zoom.rounded())))
        let update = CameraUpdate.make(target: target, zoomLevel: level, mapView: kakaoMap)
        kakaoMap.moveCamera(update)
        _ = animated
    }
}

extension KakaoMapHost: MapControllerDelegate {
    func authenticationSucceeded() {
        mapController?.activateEngine()
    }

    func authenticationFailed(_ errorCode: Int, desc: String) {
        CAPLog.print("[PindmapNativeMap] Kakao auth failed \(errorCode): \(desc)")
    }

    func addViews() {
        let info = MapviewInfo(
            viewName: "mapview",
            viewInfoName: "map",
            defaultPosition: kakaoPosition(),
            defaultLevel: kakaoZoomLevel()
        )
        mapController?.addView(info, viewSize: bounds.size)
    }

    func addViewSucceeded(_ viewName: String, viewInfoName: String) {
        applyCameraIfReady(animated: false)
    }
}

// MARK: - Touch routing (google-maps PassThroughView pattern, non-invasive variant)

/// Full-screen overlay above WKWebView. Map-frame touches → native map; elsewhere → nil (WebView).
private final class MapTouchRouterView: UIView {
    weak var mapHost: UIView?

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear
        isOpaque = false
        isUserInteractionEnabled = true
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
        guard let mapHost = mapHost, let container = superview else { return false }
        let pointInContainer = convert(point, to: container)
        return mapHost.frame.contains(pointInContainer)
    }

    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        guard let mapHost = mapHost, let container = superview else { return nil }
        let pointInContainer = convert(point, to: container)
        guard mapHost.frame.contains(pointInContainer) else { return nil }
        let pointInMap = mapHost.convert(pointInContainer, from: container)
        return mapHost.hitTest(pointInMap, with: event)
    }
}

@objc(PindmapNativeMapPlugin)
public class PindmapNativeMapPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PindmapNativeMapPlugin"
    public let jsName = "PindmapNativeMap"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "createMap", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "destroyMap", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setCamera", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getDebugInfo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "addMarkers", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeMarkers", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearMarkers", returnType: CAPPluginReturnPromise),
    ]

    private var mapHost: UIView?
    private var touchRouter: MapTouchRouterView?
    private weak var mappedWebView: WKWebView?
    private var providerName = "none"

    override public func load() {
        super.load()
        guard SDKInitializer.GetAppKey().isEmpty else { return }
        guard let path = Bundle.main.path(forResource: "KakaoMapKeys", ofType: "plist"),
              let dict = NSDictionary(contentsOfFile: path),
              let key = dict["KAKAO_NATIVE_APP_KEY"] as? String,
              !key.isEmpty else {
            CAPLog.print("[PindmapNativeMap] KakaoMapKeys.plist missing from bundle — add to App target Resources")
            return
        }
        SDKInitializer.InitSDK(appKey: key)
        CAPLog.print("[PindmapNativeMap] Kakao InitSDK OK")
    }

    /// Native map sits in the WebView superview (Capacitor 8: `viewController.view` is the WKWebView).
    private func mapContainerView(for webView: WKWebView) -> UIView? {
        webView.superview
    }

    /// Map is below WKWebView — WebView + HTML must be transparent over the map slot (google-maps pattern).
    private func enableWebViewTransparency(_ webView: WKWebView) {
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.isOpaque = false
        webView.scrollView.backgroundColor = .clear
        if #available(iOS 15.0, *) {
            webView.underPageBackgroundColor = .clear
        }
    }

    private func restoreWebViewAppearance(_ webView: WKWebView) {
        webView.isOpaque = true
        webView.backgroundColor = nil
        webView.scrollView.isOpaque = true
        webView.scrollView.backgroundColor = nil
        if #available(iOS 15.0, *) {
            webView.underPageBackgroundColor = nil
        }
    }

    private func punchMapSlotTransparency(elementId: String, in webView: WKWebView) {
        let js = """
        (() => {
          document.documentElement.style.background = 'transparent';
          document.body.style.background = 'transparent';
          const el = document.getElementById('\(elementId)');
          if (el) {
            el.style.background = 'transparent';
            el.style.pointerEvents = 'none';
          }
        })()
        """
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    /// WKWebView returns DOMRect as NSDictionary with NSNumber values — not [String: Double].
    private func parseDOMRect(_ result: Any?) -> CGRect? {
        guard let dict = result as? [String: Any] else { return nil }
        func number(_ key: String) -> CGFloat? {
            if let n = dict[key] as? NSNumber { return CGFloat(truncating: n) }
            if let d = dict[key] as? Double { return CGFloat(d) }
            if let i = dict[key] as? Int { return CGFloat(i) }
            return nil
        }
        guard let x = number("x"), let y = number("y"),
              let w = number("width"), let h = number("height"),
              w > 0, h > 0 else { return nil }
        return CGRect(x: x, y: y, width: w, height: h)
    }

    private func measureElementRect(
        elementId: String,
        in webView: WKWebView,
        attempt: Int = 0,
        maxAttempts: Int = 10,
        completion: @escaping (CGRect?) -> Void
    ) {
        let js = """
        (() => {
          const el = document.getElementById('\(elementId)');
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        })()
        """
        webView.evaluateJavaScript(js) { [weak self] result, error in
            DispatchQueue.main.async {
                if let rect = self?.parseDOMRect(result) {
                    completion(rect)
                    return
                }
                if error != nil || attempt + 1 >= maxAttempts {
                    completion(nil)
                    return
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                    self?.measureElementRect(
                        elementId: elementId,
                        in: webView,
                        attempt: attempt + 1,
                        maxAttempts: maxAttempts,
                        completion: completion
                    )
                }
            }
        }
    }

    @objc func createMap(_ call: CAPPluginCall) {
        guard let bridge = bridge,
              let webView = bridge.webView,
              let elementId = call.getString("elementId") else {
            call.reject("elementId required (or WebView not in view hierarchy)")
            return
        }

        let lat = call.getDouble("lat") ?? 37.5665
        let lng = call.getDouble("lng") ?? 126.978
        let zoom = call.getDouble("zoom") ?? 9.0
        let provider = call.getString("provider") ?? "mapkit"

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            guard let containerView = self.mapContainerView(for: webView) else {
                call.reject("elementId required (or WebView not in view hierarchy)")
                return
            }

            self.destroyMapHost()

            self.measureElementRect(elementId: elementId, in: webView) { rect in
                DispatchQueue.main.async {
                    guard var rect = rect else {
                        call.reject("element not found or zero size: \(elementId)")
                        return
                    }

                    // WebView viewport coords → superview (google-maps / Capacitor 8 pattern)
                    rect = webView.convert(rect, to: containerView)

                    let host: UIView
                    switch provider {
                    case "kakao":
                        self.providerName = "kakao"
                        let kakao = KakaoMapHost(frame: rect)
                        host = kakao
                        kakao.setCamera(lat: lat, lng: lng, zoom: zoom, animated: false)
                    default:
                        self.providerName = "mapkit"
                        host = MapKitMapHost(frame: rect)
                    }

                    host.clipsToBounds = true
                    host.layer.cornerRadius = 8
                    self.enableWebViewTransparency(webView)
                    self.mappedWebView = webView
                    self.punchMapSlotTransparency(elementId: elementId, in: webView)
                    containerView.insertSubview(host, aboveSubview: webView)
                    self.mapHost = host
                    self.installTouchRouter(on: containerView, above: webView, mapHost: host)
                    if let mk = host as? MapKitMapHost {
                        mk.setCamera(lat: lat, lng: lng, zoom: zoom, animated: false)
                    }

                    call.resolve(["mapId": self.providerName])
                }
            }
        }
    }

    @objc func destroyMap(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.destroyMapHost()
            call.resolve()
        }
    }

    @objc func setCamera(_ call: CAPPluginCall) {
        let lat = call.getDouble("lat") ?? 37.5665
        let lng = call.getDouble("lng") ?? 126.978
        let zoom = call.getDouble("zoom") ?? 9.0
        let animated = call.getBool("animated") ?? true

        DispatchQueue.main.async { [weak self] in
            guard let host = self?.mapHost else {
                call.reject("no map")
                return
            }
            if let mk = host as? MapKitMapHost {
                mk.setCamera(lat: lat, lng: lng, zoom: zoom, animated: animated)
            }
            if let kakao = host as? KakaoMapHost {
                kakao.setCamera(lat: lat, lng: lng, zoom: zoom, animated: animated)
            }
            call.resolve()
        }
    }

    @objc func getDebugInfo(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            let frame = self?.mapHost?.frame.debugDescription ?? "none"
            call.resolve(["provider": self?.providerName ?? "none", "frame": frame])
        }
    }

    @objc func addMarkers(_ call: CAPPluginCall) {
        let inputs = Self.parseMarkerInputs(from: call)
        DispatchQueue.main.async { [weak self] in
            guard let kakao = self?.mapHost as? KakaoMapHost else {
                call.resolve(["added": 0])
                return
            }
            let added = kakao.addNativeMarkers(inputs)
            CAPLog.print("[PindmapNativeMap] addMarkers count=\(added)")
            call.resolve(["added": added])
        }
    }

    @objc func removeMarkers(_ call: CAPPluginCall) {
        let ids = Self.parseMarkerIds(from: call)
        DispatchQueue.main.async { [weak self] in
            guard let kakao = self?.mapHost as? KakaoMapHost else {
                call.resolve()
                return
            }
            kakao.removeNativeMarkers(ids: ids)
            call.resolve()
        }
    }

    @objc func clearMarkers(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let kakao = self?.mapHost as? KakaoMapHost else {
                call.resolve()
                return
            }
            kakao.clearNativeMarkers()
            call.resolve()
        }
    }

    private static func parseMarkerInputs(from call: CAPPluginCall) -> [(id: String, lat: Double, lng: Double)] {
        guard let raw = call.options["markers"] as? [[String: Any]] else { return [] }
        var out: [(id: String, lat: Double, lng: Double)] = []
        for dict in raw {
            guard let id = dict["id"] as? String else { continue }
            guard let lat = doubleValue(dict["lat"]), let lng = doubleValue(dict["lng"]) else { continue }
            out.append((id: id, lat: lat, lng: lng))
        }
        return out
    }

    private static func parseMarkerIds(from call: CAPPluginCall) -> [String] {
        if let ids = call.getArray("ids", String.self) {
            return ids
        }
        return call.options["ids"] as? [String] ?? []
    }

    private static func doubleValue(_ value: Any?) -> Double? {
        if let n = value as? NSNumber { return n.doubleValue }
        if let d = value as? Double { return d }
        return nil
    }

    private func installTouchRouter(on containerView: UIView, above webView: WKWebView, mapHost: UIView) {
        touchRouter?.removeFromSuperview()
        let router = MapTouchRouterView(frame: containerView.bounds)
        router.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        router.mapHost = mapHost
        containerView.insertSubview(router, aboveSubview: webView)
        touchRouter = router
        containerView.bringSubviewToFront(router)
    }

    private func destroyMapHost() {
        if let webView = mappedWebView ?? bridge?.webView {
            restoreWebViewAppearance(webView)
        }
        mappedWebView = nil
        touchRouter?.removeFromSuperview()
        touchRouter = nil
        if let kakao = mapHost as? KakaoMapHost {
            kakao.teardown()
        }
        mapHost?.removeFromSuperview()
        mapHost = nil
        providerName = "none"
    }
}
