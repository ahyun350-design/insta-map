import Foundation
import UIKit
import WebKit
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
    private var registeredStyleIDs = Set<String>()
    private static let markerLayerID = "pindmap-markers"
    private static let markerStyleID = "pindmap-marker-style"
    private var mapViewReady = false
    private var pendingMarkers: [(id: String, lat: Double, lng: Double, category: String?)] = []
    private var enginePrepareRequested = false
    var onMarkerClick: ((String) -> Void)?

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
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        guard window != nil, !enginePrepareRequested else { return }
        guard !SDKInitializer.GetAppKey().isEmpty, let controller = mapController else { return }
        enginePrepareRequested = true
        CAPLog.print("[PindmapNativeMap] prepareEngine in didMoveToWindow (view attached to window)")
        _ = controller.prepareEngine()
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
        if let map = kakaoMapView(), (map.eventDelegate as AnyObject?) === self {
            map.eventDelegate = nil
        }
        onMarkerClick = nil
        mapViewReady = false
        enginePrepareRequested = false
        pendingMarkers.removeAll()
        clearNativeMarkers()
        markerLayer = nil
        registeredStyleIDs.removeAll()
        mapController?.pauseEngine()
        mapController?.resetEngine()
        mapController?.delegate = nil
        mapController = nil
        pendingCamera = nil
    }

    func addNativeMarkers(_ inputs: [(id: String, lat: Double, lng: Double, category: String?)]) -> Int {
        if !mapViewReady {
            for input in inputs {
                pendingMarkers.removeAll { $0.id == input.id }
                pendingMarkers.append(input)
            }
            return inputs.count
        }
        return drawMarkers(inputs)
    }

    private func drawMarkers(_ inputs: [(id: String, lat: Double, lng: Double, category: String?)]) -> Int {
        guard let layer = ensureMarkerInfrastructure() else { return 0 }
        var added = 0
        for input in inputs {
            if markerPois[input.id] != nil {
                layer.removePoi(poiID: input.id)
                markerPois.removeValue(forKey: input.id)
            }
            let styleID = ensureStyle(for: input.category)
            let option = PoiOptions(styleID: styleID, poiID: input.id)
            option.rank = 0
            option.clickable = true
            option.transformType = .default
            let point = MapPoint(longitude: input.lng, latitude: input.lat)
            guard let poi = layer.addPoi(option: option, at: point) else {
                CAPLog.print("[PindmapNativeMap] addPoi FAIL id=\(input.id) styleID=\(option.styleID)")
                continue
            }
            poi.show()
            markerPois[input.id] = poi
            added += 1
        }
        if added > 0 {
            DispatchQueue.main.async { [weak self] in
                guard let self = self else { return }
                if let layer = self.markerLayer {
                    layer.visible = true
                    layer.showAllPois()
                }
                for poi in self.markerPois.values {
                    poi.show()
                }
                self.kakaoMapView()?.refresh()
                self.applyRefreshMarkerDisplayOnMain()
                self.restartEngineRenderCycleAfterDraw()
            }
        }
        return added
    }

    private func flushPendingMarkersIfNeeded() {
        guard mapViewReady, !pendingMarkers.isEmpty else { return }
        let batch = pendingMarkers
        pendingMarkers.removeAll()
        _ = drawMarkers(batch)
    }

    func removeNativeMarkers(ids: [String]) {
        pendingMarkers.removeAll { ids.contains($0.id) }
        guard mapViewReady else { return }
        guard let layer = markerLayer ?? ensureMarkerInfrastructure() else { return }
        for id in ids {
            layer.removePoi(poiID: id)
            markerPois.removeValue(forKey: id)
        }
        refreshMarkerDisplay()
    }

    func clearNativeMarkers(prefix: String? = nil) {
        if let prefix = prefix, !prefix.isEmpty {
            pendingMarkers.removeAll { $0.id.hasPrefix(prefix) }
            guard let layer = markerLayer else {
                for id in markerPois.keys where id.hasPrefix(prefix) {
                    markerPois.removeValue(forKey: id)
                }
                return
            }
            for id in markerPois.keys where id.hasPrefix(prefix) {
                layer.removePoi(poiID: id)
                markerPois.removeValue(forKey: id)
            }
            refreshMarkerDisplay()
        } else {
            pendingMarkers.removeAll()
            markerLayer?.clearAllItems()
            markerPois.removeAll()
            refreshMarkerDisplay()
        }
    }

    private func ensureStyle(for category: String?) -> String {
        guard let map = kakaoMapView() else {
            return Self.markerStyleID
        }
        let styleID = NativeMapMarkerStyleHelper.styleID(for: category)
        if registeredStyleIDs.contains(styleID) {
            return styleID
        }
        let manager = map.getLabelManager()
        let iconStyle = NativeMapMarkerStyleHelper.makeFixedZoomPoiIconStyle(
            symbol: NativeMapMarkerStyleHelper.makeMarkerIcon(category: category),
            anchorPoint: NativeMapMarkerStyleHelper.savedPinAnchor
        )
        NativeMapMarkerStyleHelper.registerFixedZoomPoiStyle(on: manager, styleID: styleID, iconStyle: iconStyle)
        registeredStyleIDs.insert(styleID)
        return styleID
    }

    private func kakaoMapView() -> KakaoMap? {
        mapController?.getView("mapview") as? KakaoMap
    }

    /// Kakao docs: re-apply KMViewContainer size in addViewSucceeded when addView ran before layout finished.
    private func syncMapViewContainerSize() {
        setNeedsLayout()
        layoutIfNeeded()
        kmContainer.frame = bounds
        let size = bounds.size
        guard size.width > 0, size.height > 0, let kakaoMap = kakaoMapView() else { return }
        kakaoMap.viewRect = CGRect(origin: .zero, size: size)
        kakaoMap.refresh()
    }

    private func applyRefreshMarkerDisplayOnMain() {
        if let controller = mapController, controller.isEnginePrepared {
            if !controller.isEngineActive {
                controller.activateEngine()
            } else {
                let frame = kmContainer.frame
                if frame.width > 1, frame.height > 0 {
                    kmContainer.frame = CGRect(x: frame.origin.x, y: frame.origin.y, width: frame.width - 1, height: frame.height)
                    kmContainer.frame = frame
                }
            }
        }
        if let layer = markerLayer {
            layer.visible = true
            if !markerPois.isEmpty {
                layer.showAllPois()
            }
        }
        kakaoMapView()?.refresh()
    }

    /// Re-register VSync render loop after new markers (same effect as app bg→fg).
    /// Call only from drawMarkers — not on remove/clear refresh paths.
    /// May cause brief base-map flicker; if unacceptable, try wiring KMController lifecycle via viewWillAppear instead.
    private func restartEngineRenderCycleAfterDraw() {
        mapController?.pauseEngine()
        mapController?.activateEngine()
        kakaoMapView()?.refresh()
    }

    private func refreshMarkerDisplay() {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.applyRefreshMarkerDisplayOnMain()
        }
    }

    private func ensureMarkerInfrastructure() -> LabelLayer? {
        guard let map = kakaoMapView() else { return nil }
        _ = ensureStyle(for: nil)
        if markerLayer == nil {
            let manager = map.getLabelManager()
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

    func attachKakaoEventDelegateIfNeeded() {
        guard let map = kakaoMapView() else { return }
        if map.eventDelegate == nil {
            map.eventDelegate = self
        }
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
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.syncMapViewContainerSize()
            self.mapViewReady = true
            if let map = self.kakaoMapView() {
                NativeMapMarkerStyleHelper.applyFixedScreenMapSettings(on: map)
            }
            self.applyCameraIfReady(animated: false)
            self.attachKakaoEventDelegateIfNeeded()
            self.flushPendingMarkersIfNeeded()
        }
    }

    func containerDidResized(_ size: CGSize) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.kmContainer.frame = self.bounds
            if let kakaoMap = self.kakaoMapView() {
                kakaoMap.viewRect = CGRect(origin: .zero, size: size)
                kakaoMap.refresh()
            }
        }
    }
}

extension KakaoMapHost: KakaoMapEventDelegate {
    func poiDidTapped(kakaoMap: KakaoMap, layerID: String, poiID: String, position: MapPoint) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            guard layerID == Self.markerLayerID, self.markerPois[poiID] != nil else { return }
            self.onMarkerClick?(poiID)
        }
    }
}

// MARK: - Shared marker styling (compact + fullscreen native maps)

private enum NativeMapMarkerStyleHelper {
    // MARK: - Pin tuning (match React Kakao MarkerImage on-screen size + sharpness)
    /// Canvas / PoiIconStyle symbol size in points. React target is 36×44 on screen; bump if SDK renders smaller.
    static let PIN_DISPLAY_SIZE = CGSize(width: 40, height: 48)
    /// UIGraphicsImageRenderer scale. Bitmap px = PIN_DISPLAY_SIZE × PIN_BITMAP_SCALE (≥2.0 for sharp edges).
    static let PIN_BITMAP_SCALE: CGFloat = 2.0

    private static let reactSavedPinSize = CGSize(width: 36, height: 44)
    private static let reactCoursePinSize = CGSize(width: 32, height: 40)
    private static let reactMyLocationPinSize = CGSize(width: 24, height: 24)

    static let defaultStyleID = "pindmap-marker-style"
    /// KakaoMapsSDK zoom range — PerLevelPoiStyle at every level keeps symbol scale 1.0 (Kakao Marker parity).
    static let minMapZoomLevel = 0
    static let maxMapZoomLevel = 21
    /// Saved/search pin canvas — scales with PIN_DISPLAY_SIZE (React 36×44 reference).
    static var pinSize: CGSize { PIN_DISPLAY_SIZE }
    /// Course pin canvas — proportional to React 32×40.
    static var coursePinSize: CGSize {
        CGSize(
            width: PIN_DISPLAY_SIZE.width * reactCoursePinSize.width / reactSavedPinSize.width,
            height: PIN_DISPLAY_SIZE.height * reactCoursePinSize.height / reactSavedPinSize.height
        )
    }
    /// My location canvas — proportional to React 24×24.
    static var myLocationSize: CGSize {
        let side = PIN_DISPLAY_SIZE.width * reactMyLocationPinSize.width / reactSavedPinSize.width
        return CGSize(width: side, height: side)
    }
    /// Saved/search pin anchor — Kakao MarkerImage default (bottom center).
    static let savedPinAnchor = CGPoint(x: 0.5, y: 1.0)
    /// Course pin anchor — bottom center.
    static let coursePinAnchor = CGPoint(x: 0.5, y: 1.0)
    /// My location anchor — Kakao offset(12,12) on 24×24 → center (0.5, 0.5).
    static let myLocationAnchor = CGPoint(x: 0.5, y: 0.5)

    /// KakaoMapsSDK applies its own POI display scaling — tune PIN_DISPLAY_SIZE / PIN_BITMAP_SCALE only (not UIScreen.main.scale).
    private static func imageRenderer(for size: CGSize) -> UIGraphicsImageRenderer {
        let format = UIGraphicsImageRendererFormat()
        format.scale = PIN_BITMAP_SCALE
        format.opaque = false
        return UIGraphicsImageRenderer(size: size, format: format)
    }

    private static func configurePinContext(_ cg: CGContext) {
        cg.setShouldAntialias(true)
        cg.setAllowsAntialiasing(true)
        cg.interpolationQuality = .high
    }

    /// One iconStyle duplicated at zoom levels 0…21 — no per-level scale interpolation (fixed screen px like Kakao Marker).
    static func allZoomLevelPoiStyles(iconStyle: PoiIconStyle) -> [PerLevelPoiStyle] {
        (minMapZoomLevel...maxMapZoomLevel).map { level in
            PerLevelPoiStyle(iconStyle: iconStyle, padding: 0, level: level)
        }
    }

    static func makeFixedZoomPoiIconStyle(symbol: UIImage, anchorPoint: CGPoint) -> PoiIconStyle {
        PoiIconStyle(
            symbol: symbol,
            anchorPoint: anchorPoint,
            transition: PoiTransition(entrance: .none, exit: .none),
            enableEntranceTransition: false,
            enableExitTransition: false,
            badges: nil
        )
    }

    static func registerFixedZoomPoiStyle(on manager: LabelManager, styleID: String, iconStyle: PoiIconStyle) {
        manager.addPoiStyle(PoiStyle(styleID: styleID, styles: allZoomLevelPoiStyles(iconStyle: iconStyle)))
    }

    static func applyFixedScreenMapSettings(on map: KakaoMap) {
        map.poiScale = .regular
    }

    struct CategoryPinStyle {
        let fillColor: UIColor
        let strokeColor: UIColor
        let emoji: String
    }

    static func categoryPinStyle(for category: String?) -> CategoryPinStyle {
        switch category {
        case "맛집":
            return CategoryPinStyle(fillColor: UIColor(hex: 0x513229), strokeColor: .white, emoji: "🍽️")
        case "카페":
            return CategoryPinStyle(fillColor: UIColor(hex: 0xFCE6B7), strokeColor: UIColor(hex: 0x999999), emoji: "☕")
        case "쇼핑":
            return CategoryPinStyle(fillColor: UIColor(hex: 0xD8EBF9), strokeColor: UIColor(hex: 0x999999), emoji: "🛍️")
        case "숙소":
            return CategoryPinStyle(fillColor: UIColor(hex: 0xD7D4B1), strokeColor: UIColor(hex: 0x999999), emoji: "🏠")
        case "놀거리":
            return CategoryPinStyle(fillColor: UIColor(hex: 0xc4b5fd), strokeColor: UIColor(hex: 0x999999), emoji: "🎮")
        case "여행지":
            return CategoryPinStyle(fillColor: UIColor(hex: 0x99e9f2), strokeColor: UIColor(hex: 0x999999), emoji: "🗺️")
        default:
            return CategoryPinStyle(fillColor: .systemRed, strokeColor: UIColor(hex: 0x999999), emoji: "📍")
        }
    }

    static func markerColor(for category: String?) -> UIColor {
        categoryPinStyle(for: category).fillColor
    }

    static func styleID(for category: String?, order: Int? = nil) -> String {
        let key: String
        switch category {
        case "맛집": key = "food"
        case "카페": key = "cafe"
        case "쇼핑": key = "shopping"
        case "숙소": key = "stay"
        case "놀거리": key = "play"
        case "여행지": key = "travel"
        default: key = "default"
        }
        if key == "default" {
            if let order, order > 0 { return "\(defaultStyleID)-order-\(order)" }
            return defaultStyleID
        }
        if let order, order > 0 { return "pindmap-marker-\(key)-order-\(order)" }
        return "pindmap-marker-\(key)"
    }

    static func makeMarkerIcon(category: String?, order: Int? = nil) -> UIImage {
        let style = categoryPinStyle(for: category)
        let isCoursePin = (order ?? 0) > 0
        let canvasSize = isCoursePin ? coursePinSize : pinSize
        let renderer = imageRenderer(for: canvasSize)
        return renderer.image { ctx in
            let cg = ctx.cgContext
            configurePinContext(cg)
            let bounds = CGRect(origin: .zero, size: canvasSize)

            let droplet = isCoursePin
                ? courseDropletPath(in: bounds)
                : savedDropletPath(in: bounds)

            cg.saveGState()
            style.fillColor.setFill()
            droplet.fill()
            style.strokeColor.setStroke()
            droplet.lineWidth = 1
            droplet.lineJoinStyle = .round
            droplet.lineCapStyle = .round
            droplet.stroke()
            cg.restoreGState()

            let cx = canvasSize.width * (isCoursePin ? 16 / 32 : 18 / 36)
            let cy = canvasSize.height * (isCoursePin ? 16 / 40 : 18 / 44)
            let radius = canvasSize.width * (isCoursePin ? 11 / 32 : 13 / 36)
            cg.setFillColor(UIColor.white.withAlphaComponent(0.9).cgColor)
            cg.fillEllipse(in: CGRect(x: cx - radius, y: cy - radius, width: radius * 2, height: radius * 2))

            if let order, order > 0 {
                let text = "\(order)"
                let fontScale = canvasSize.width / reactCoursePinSize.width
                let font = UIFont.systemFont(ofSize: 13 * fontScale, weight: .bold)
                let attrs: [NSAttributedString.Key: Any] = [
                    .font: font,
                    .foregroundColor: readableCenterTextColor(for: style.fillColor),
                ]
                let textSize = (text as NSString).size(withAttributes: attrs)
                let textOrigin = CGPoint(x: cx - textSize.width / 2, y: cy - textSize.height / 2)
                (text as NSString).draw(at: textOrigin, withAttributes: attrs)
            } else {
                let fontScale = canvasSize.width / reactSavedPinSize.width
                let font = UIFont.systemFont(ofSize: 14 * fontScale)
                let attrs: [NSAttributedString.Key: Any] = [.font: font]
                let textSize = (style.emoji as NSString).size(withAttributes: attrs)
                let textOrigin = CGPoint(x: cx - textSize.width / 2, y: cy - textSize.height / 2 + 0.5 * fontScale)
                (style.emoji as NSString).draw(at: textOrigin, withAttributes: attrs)
            }
        }
    }

    /// React makeMarkerImage viewBox 0 0 36 44
    private static func savedDropletPath(in rect: CGRect) -> UIBezierPath {
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: rect.minX + x / 36 * rect.width, y: rect.minY + y / 44 * rect.height)
        }
        let path = UIBezierPath()
        path.move(to: p(18, 0))
        path.addCurve(to: p(0, 18), controlPoint1: p(8.06, 0), controlPoint2: p(0, 8.06))
        path.addCurve(to: p(18, 44), controlPoint1: p(0, 31.5), controlPoint2: p(18, 44))
        path.addCurve(to: p(36, 18), controlPoint1: p(18, 44), controlPoint2: p(36, 31.5))
        path.addCurve(to: p(18, 0), controlPoint1: p(36, 8.06), controlPoint2: p(27.94, 0))
        path.close()
        return path
    }

    /// React course marker viewBox 0 0 32 40
    private static func courseDropletPath(in rect: CGRect) -> UIBezierPath {
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: rect.minX + x / 32 * rect.width, y: rect.minY + y / 40 * rect.height)
        }
        let path = UIBezierPath()
        path.move(to: p(16, 0))
        path.addCurve(to: p(0, 16), controlPoint1: p(7.16, 0), controlPoint2: p(0, 7.16))
        path.addCurve(to: p(16, 40), controlPoint1: p(0, 28), controlPoint2: p(16, 40))
        path.addCurve(to: p(32, 16), controlPoint1: p(16, 40), controlPoint2: p(32, 28))
        path.addCurve(to: p(16, 0), controlPoint1: p(32, 7.16), controlPoint2: p(24.84, 0))
        path.close()
        return path
    }

    private static func dropletPath(in rect: CGRect) -> UIBezierPath {
        savedDropletPath(in: rect)
    }

    private static func readableCenterTextColor(for fill: UIColor) -> UIColor {
        var r: CGFloat = 0
        var g: CGFloat = 0
        var b: CGFloat = 0
        var a: CGFloat = 0
        fill.getRed(&r, green: &g, blue: &b, alpha: &a)
        let luminance = 0.299 * r + 0.587 * g + 0.114 * b
        return luminance > 0.72 ? UIColor(hex: 0x1a2a7a) : fill
    }

    static let myLocationStyleID = "pindmap-my-location-style"

    static func makeMyLocationIcon() -> UIImage {
        let size = myLocationSize
        let unit = size.width / reactMyLocationPinSize.width
        let renderer = imageRenderer(for: size)
        return renderer.image { ctx in
            let cg = ctx.cgContext
            configurePinContext(cg)
            // React makeMyLocationImage: r=10 #1a2a7a + white stroke 2.5, inner r=4 white (24×24 viewBox)
            let outerRect = CGRect(x: 2 * unit, y: 2 * unit, width: 20 * unit, height: 20 * unit)
            cg.setFillColor(UIColor(hex: 0x1a2a7a).cgColor)
            cg.fillEllipse(in: outerRect)
            cg.setStrokeColor(UIColor.white.cgColor)
            cg.setLineWidth(2.5 * unit)
            cg.setLineJoin(.round)
            cg.strokeEllipse(in: outerRect.insetBy(dx: 1.25 * unit, dy: 1.25 * unit))
            cg.setFillColor(UIColor.white.cgColor)
            cg.fillEllipse(in: CGRect(x: 8 * unit, y: 8 * unit, width: 8 * unit, height: 8 * unit))
        }
    }

    static func makeMyLocationInfoWindow(guiID: String) -> InfoWindow {
        let infoWindow = InfoWindow(guiID)
        let bodyImage = GuiImage("myLocationDot")
        bodyImage.image = makeMyLocationIcon()
        var iconSize = GuiSize()
        iconSize.width = UInt(myLocationSize.width)
        iconSize.height = UInt(myLocationSize.height)
        bodyImage.imageSize = iconSize
        infoWindow.body = bodyImage
        infoWindow.tail = nil
        let half = myLocationSize.width / 2
        infoWindow.bodyOffset = CGPoint(x: -half, y: -half)
        infoWindow.zOrder = 1000
        return infoWindow
    }
}

// MARK: - Place sheet remote image loading

private final class PlaceSheetRemoteImageLoader {
    static let shared = PlaceSheetRemoteImageLoader()
    private let cache = NSCache<NSString, UIImage>()
    private var tasks = NSMapTable<UIImageView, URLSessionDataTask>(keyOptions: .weakMemory, valueOptions: .strongMemory)

    private init() {}

    func load(urlString: String, into imageView: UIImageView) {
        imageView.image = nil
        imageView.backgroundColor = UIColor.secondarySystemFill
        let cacheKey = urlString as NSString
        if let cached = cache.object(forKey: cacheKey) {
            imageView.image = cached
            imageView.backgroundColor = .clear
            return
        }
        cancel(for: imageView)
        guard let url = URL(string: urlString) else { return }
        let task = URLSession.shared.dataTask(with: url) { [weak self, weak imageView] data, _, _ in
            guard let self, let imageView, let data, let image = UIImage(data: data) else { return }
            self.cache.setObject(image, forKey: cacheKey)
            DispatchQueue.main.async {
                guard imageView.superview != nil else { return }
                imageView.image = image
                imageView.backgroundColor = .clear
            }
        }
        tasks.setObject(task, forKey: imageView)
        task.resume()
    }

    func cancel(for imageView: UIImageView) {
        tasks.object(forKey: imageView)?.cancel()
        tasks.removeObject(forKey: imageView)
    }
}

// MARK: - V-7-2 fullscreen native map VC (prototype + production modes)

private final class KakaoMapTestViewController: UIViewController {
    enum Mode {
        case prototype
        case production
    }

    struct MapMarkerInput {
        let id: String
        let lat: Double
        let lng: Double
        let category: String?
        let title: String?
        let address: String?
        let photos: [String]
        let postCount: Int
        let isSaved: Bool
        let photoPostIds: [String]
        let order: Int?
    }

    struct SearchResultInput {
        let id: String
        let name: String
        let address: String
        let lat: Double
        let lng: Double
        let category: String?
    }

    private static let searchResultCellID = "SearchResultCell"
    private static let markerLayerID = "pindmap-fullscreen-markers"
    private static let myLocationGuiID = "my-location"

    /// Plugin-level route debug — exposed for [crs] logs
    var isMapViewReadyForDebug: Bool { mapViewReady }

    private struct MarkerMetadata {
        var title: String?
        var address: String?
        var category: String?
        var lat: Double?
        var lng: Double?
        var photos: [String]
        var postCount: Int
        var isSaved: Bool
        var photoPostIds: [String]
    }

    private let mode: Mode
    private let kmContainer = KMViewContainer()
    private var mapController: KMController?
    private var enginePrepareRequested = false
    private var mapViewReady = false
    private var markerLayer: LabelLayer?
    private var markerPois: [String: Poi] = [:]
    private var markerMetadata: [String: MarkerMetadata] = [:]
    private var registeredStyleIDs = Set<String>()
    private var pendingCamera: (lat: Double, lng: Double, zoom: Int) = (37.5665, 126.9780, 9)
    private var pendingInitialMarkers: [MapMarkerInput] = []
    private let overlayCardWebView = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
    var onMarkerClick: ((String) -> Void)?
    var onSearch: ((String) -> Void)?
    var onDirections: ((String, Double, Double, String) -> Void)?
    var onToggleSave: ((String) -> Void)?
    var onCuration: ((String, String) -> Void)?
    var onOpenExternal: ((String, String) -> Void)?
    var onImageLightbox: ((String) -> Void)?
    var onPlaceDetail: ((String) -> Void)?
    var onResearchArea: ((Double, Double) -> Void)?
    var onDismiss: (() -> Void)?
    private weak var productionCloseButton: UIButton?
    private weak var productionSearchBarContainer: UIView?
    private weak var productionSearchField: UITextField?
    private weak var researchAreaButton: UIButton?
    private weak var placeSheetBackdrop: UIView?
    private weak var placeSheetCard: UIView?
    private var placeSheetBottomConstraint: NSLayoutConstraint?
    private weak var placeSheetCategoryDot: UIView?
    private weak var placeSheetCategoryLabel: UILabel?
    private weak var placeSheetTitleLabel: UILabel?
    private weak var placeSheetAddressLabel: UILabel?
    private weak var placeSheetDirectionsButton: UIButton?
    private weak var placeSheetSaveButton: UIButton?
    private weak var placeSheetDirectionsInfoLabel: UILabel?
    private weak var placeSheetAppleMapsButton: UIButton?
    private weak var placeSheetTransitButton: UIButton?
    private var placeSheetActionsTopToAddress: NSLayoutConstraint?
    private var placeSheetActionsTopToTitle: NSLayoutConstraint?
    private var placeSheetActionsTopToMedia: NSLayoutConstraint?
    private var placeSheetActionsTopToPostCount: NSLayoutConstraint?
    private var placeSheetMarkerId: String?
    private weak var placeSheetPostCountLabel: UILabel?
    private weak var placeSheetPhotosScrollView: UIScrollView?
    private weak var placeSheetPhotosStackView: UIStackView?
    private var placeSheetPhotosHeightConstraint: NSLayoutConstraint?
    private static let photoThumbnailSize: CGFloat = 88
    private static let placeSheetCompactDismissOffset: CGFloat = 300
    private static let placeSheetExpandedDismissOffset: CGFloat = 440
    private weak var searchResultsCard: UIView?
    private weak var searchResultsTitleLabel: UILabel?
    private weak var searchResultsTableView: UITableView?
    private var searchResultsBottomConstraint: NSLayoutConstraint?
    private var searchResults: [SearchResultInput] = []
    private var pendingSearchResults: [SearchResultInput]?
    private static let searchResultsSheetHeight: CGFloat = 260
    private static let routeLayerID = "pindmap-fullscreen-route"
    private static let routeID = "pindmap-route-main"
    private static let carRouteStyleSetID = "pindmap-route-car"
    private static let walkRouteStyleSetID = "pindmap-route-walk"
    private var routeLayer: RouteLayer?
    private var registeredRouteStyleSetIDs = Set<String>()
    private var pendingRoute: (path: [(lat: Double, lng: Double)], mode: String)?
    private var pendingMyLocation: (lat: Double, lng: Double)?
    private var myLocationInfoWindow: InfoWindow?

    struct CourseNavStep {
        let description: String
        let lat: Double
        let lng: Double
    }

    struct CourseNavSegment {
        let index: Int
        let fromName: String
        let toName: String
        let distanceM: Int
        let timeSec: Int
        let path: [(lat: Double, lng: Double)]
        let steps: [CourseNavStep]
    }

    private var courseNavSegments: [CourseNavSegment] = []
    private var courseNavFullPath: [(lat: Double, lng: Double)] = []
    private var courseNavPlaceCount = 0
    private var courseNavTotalDistanceM = 0
    private var courseNavTotalTimeSec = 0
    private var courseNavSelectedSegmentIndex: Int?
    private var courseNavSegmentFocusMode = false
    private weak var courseNavPanel: UIView?
    private weak var courseNavSummaryLabel: UILabel?
    private weak var courseNavSegmentScrollView: UIScrollView?
    private weak var courseNavSegmentStack: UIStackView?
    private weak var courseNavFocusBar: UIStackView?
    private weak var courseNavPrevButton: UIButton?
    private weak var courseNavNextButton: UIButton?
    private weak var courseNavFocusLabel: UILabel?
    private var courseNavFocusBarTopConstraint: NSLayoutConstraint?
    private var courseNavFocusBarHeightConstraint: NSLayoutConstraint?
    private var courseNavFocusBarBottomConstraint: NSLayoutConstraint?
    private var courseNavScrollBottomConstraint: NSLayoutConstraint?

    private struct TestMarker {
        let id: String
        let lat: Double
        let lng: Double
    }

    private let seoulMarkers: [TestMarker] = [
        TestMarker(id: "test-0", lat: 37.5665, lng: 126.9780),
        TestMarker(id: "test-1", lat: 37.5796, lng: 126.9770),
        TestMarker(id: "test-2", lat: 37.5512, lng: 126.9882),
        TestMarker(id: "test-3", lat: 37.5700, lng: 126.9920),
        TestMarker(id: "test-4", lat: 37.5284, lng: 126.9645),
    ]

    private let busanMarkers: [TestMarker] = [
        TestMarker(id: "test-0", lat: 35.1796, lng: 129.0756),
        TestMarker(id: "test-1", lat: 35.1587, lng: 129.1604),
        TestMarker(id: "test-2", lat: 35.1334, lng: 129.0865),
    ]

    init(mode: Mode = .prototype) {
        self.mode = mode
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func configure(lat: Double, lng: Double, zoom: Double, markers: [MapMarkerInput]) {
        pendingCamera = (lat, lng, max(1, min(20, Int(zoom.rounded()))))
        pendingInitialMarkers = markers
        if mapViewReady {
            applyPendingCamera(animated: false)
            updateMarkers(markers, clearPrefix: nil)
            // TEMP crs-debug
            CAPLog.print("[crs] configure mapViewReady=true flushPendingRouteIfNeeded pendingRouteCount=\(pendingRoute?.path.count ?? 0)")
            flushPendingRouteIfNeeded()
        }
    }

    func setCamera(lat: Double, lng: Double, zoom: Double, animated: Bool) {
        pendingCamera = (lat, lng, max(1, min(20, Int(zoom.rounded()))))
        applyPendingCamera(animated: animated)
    }

    func updateMarkers(_ markers: [MapMarkerInput], clearPrefix: String?) {
        if let prefix = clearPrefix, !prefix.isEmpty {
            clearMarkers(withPrefix: prefix)
        } else {
            clearAllMarkers()
        }
        _ = addMarkers(markers)
    }

    func setRoute(path: [(lat: Double, lng: Double)], mode: String, fitCamera: Bool = true) {
        // TEMP crs-debug
        CAPLog.print("[crs] setRoute entry pathCount=\(path.count) mode=\(mode) mapViewReady=\(mapViewReady) kakaoMap=\(kakaoMapView() != nil)")
        pendingRoute = (path, mode)
        guard mapViewReady, kakaoMapView() != nil else {
            // TEMP crs-debug
            CAPLog.print("[crs] setRoute deferred — stored pendingRoute pathCount=\(path.count)")
            return
        }
        // TEMP crs-debug
        CAPLog.print("[crs] setRoute applying immediately pathCount=\(path.count)")
        applyRoute(path: path, mode: mode, fitCamera: fitCamera)
    }

    private func flushPendingRouteIfNeeded() {
        guard let pendingRoute else {
            // TEMP crs-debug
            CAPLog.print("[crs] flushPendingRoute skip — no pendingRoute mapViewReady=\(mapViewReady)")
            return
        }
        guard mapViewReady, kakaoMapView() != nil else {
            // TEMP crs-debug
            CAPLog.print("[crs] flushPendingRoute skip — not ready pathCount=\(pendingRoute.path.count) mapViewReady=\(mapViewReady) kakaoMap=\(kakaoMapView() != nil)")
            return
        }
        // TEMP crs-debug
        CAPLog.print("[crs] flushPendingRoute applying pathCount=\(pendingRoute.path.count) mode=\(pendingRoute.mode)")
        applyRoute(path: pendingRoute.path, mode: pendingRoute.mode, fitCamera: true)
    }

    func clearRoute() {
        pendingRoute = nil
        routeLayer?.clearAllRoutes()
    }

    func setCourseNavigation(
        placeCount: Int,
        totalTimeSec: Int,
        totalDistanceM: Int,
        segments: [CourseNavSegment],
        fullPath: [(lat: Double, lng: Double)]
    ) {
        courseNavSegments = segments
        courseNavFullPath = fullPath
        courseNavPlaceCount = placeCount
        courseNavTotalDistanceM = totalDistanceM
        courseNavTotalTimeSec = totalTimeSec
        courseNavSelectedSegmentIndex = segments.isEmpty ? nil : 0
        courseNavSegmentFocusMode = false
        ensureCourseNavChrome()
        productionSearchBarContainer?.isHidden = true
        hideResearchAreaButton()
        updateCourseNavUI()
        bringCourseNavToFront()
    }

    func clearCourseNavigation() {
        courseNavSegments = []
        courseNavFullPath = []
        courseNavPlaceCount = 0
        courseNavTotalDistanceM = 0
        courseNavTotalTimeSec = 0
        courseNavSelectedSegmentIndex = nil
        courseNavSegmentFocusMode = false
        courseNavPanel?.isHidden = true
        productionSearchBarContainer?.isHidden = false
    }

    static func parseCourseNavigationSegments(from call: CAPPluginCall) -> [CourseNavSegment] {
        guard let raw = call.options["segments"] as? [[String: Any]] else { return [] }
        var out: [CourseNavSegment] = []
        for dict in raw {
            let index = intValue(dict["index"]) ?? out.count
            let fromName = dict["fromName"] as? String ?? ""
            let toName = dict["toName"] as? String ?? ""
            let distanceM = intValue(dict["distanceM"]) ?? 0
            let timeSec = intValue(dict["timeSec"]) ?? 0
            var path: [(lat: Double, lng: Double)] = []
            if let pathRaw = dict["path"] as? [[String: Any]] {
                for point in pathRaw {
                    guard let lat = doubleValue(point["lat"]), let lng = doubleValue(point["lng"]) else { continue }
                    path.append((lat: lat, lng: lng))
                }
            }
            var steps: [CourseNavStep] = []
            if let stepsRaw = dict["steps"] as? [[String: Any]] {
                for stepDict in stepsRaw {
                    guard let lat = doubleValue(stepDict["lat"]), let lng = doubleValue(stepDict["lng"]) else { continue }
                    let description = stepDict["description"] as? String ?? ""
                    steps.append(CourseNavStep(description: description, lat: lat, lng: lng))
                }
            }
            out.append(CourseNavSegment(
                index: index,
                fromName: fromName,
                toName: toName,
                distanceM: distanceM,
                timeSec: timeSec,
                path: path,
                steps: steps
            ))
        }
        return out.sorted { $0.index < $1.index }
    }

    private static func intValue(_ value: Any?) -> Int? {
        if let intVal = value as? Int { return intVal }
        if let num = value as? NSNumber { return num.intValue }
        if let str = value as? String, let intVal = Int(str) { return intVal }
        return nil
    }

    private static func doubleValue(_ value: Any?) -> Double? {
        if let doubleVal = value as? Double { return doubleVal }
        if let num = value as? NSNumber { return num.doubleValue }
        if let str = value as? String, let doubleVal = Double(str) { return doubleVal }
        return nil
    }

    func setMyLocation(lat: Double, lng: Double) {
        pendingMyLocation = (lat, lng)
        guard mapViewReady else { return }
        applyMyLocation(lat: lat, lng: lng)
    }

    func clearMyLocation() {
        pendingMyLocation = nil
        guard let map = kakaoMapView() else {
            myLocationInfoWindow = nil
            return
        }
        let layer = map.getGuiManager().infoWindowLayer
        if let window = myLocationInfoWindow ?? layer.getInfoWindow(guiName: Self.myLocationGuiID) {
            window.hide()
            layer.removeInfoWindow(guiName: Self.myLocationGuiID)
        }
        myLocationInfoWindow = nil
        map.refresh()
    }

    func setSearchResults(_ results: [SearchResultInput]) {
        pendingSearchResults = results
        guard mapViewReady else { return }
        applySearchResults(results)
    }

    func clearSearchResults() {
        pendingSearchResults = nil
        searchResults = []
        hideResearchAreaButton()
        hideSearchResultsSheet(animated: true)
    }

    func showPlaceSheet(for markerId: String) {
        showPlaceBottomSheet(for: markerId)
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground

        kmContainer.frame = view.bounds
        kmContainer.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(kmContainer)

        if mode == .prototype {
            installOverlayTestCard()
            installPrototypeToolbar()
        } else {
            installProductionChrome()
        }

        guard !SDKInitializer.GetAppKey().isEmpty else {
            CAPLog.print("[PindmapNativeMap][Fullscreen] Kakao SDK key missing — skipping map setup")
            return
        }

        let controller = KMController(viewContainer: kmContainer)
        mapController = controller
        controller.delegate = self
    }

    private func installPrototypeToolbar() {
        let closeButton = makeToolbarButton(title: "닫기")
        closeButton.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)

        let cameraButton = makeToolbarButton(title: "카메라이동")
        cameraButton.addTarget(self, action: #selector(cameraMoveTapped), for: .touchUpInside)

        let replaceButton = makeToolbarButton(title: "마커교체")
        replaceButton.addTarget(self, action: #selector(replaceMarkersTapped), for: .touchUpInside)

        let toolbar = UIStackView(arrangedSubviews: [cameraButton, replaceButton, closeButton])
        toolbar.axis = .horizontal
        toolbar.spacing = 8
        toolbar.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(toolbar)
        NSLayoutConstraint.activate([
            toolbar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12),
            toolbar.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16),
        ])
    }

    private func installProductionChrome() {
        let closeButton = UIButton(type: .system)
        closeButton.translatesAutoresizingMaskIntoConstraints = false
        closeButton.setTitle("✕", for: .normal)
        closeButton.titleLabel?.font = .systemFont(ofSize: 18, weight: .semibold)
        closeButton.setTitleColor(.label, for: .normal)
        closeButton.backgroundColor = UIColor.systemBackground.withAlphaComponent(0.92)
        closeButton.layer.cornerRadius = 22
        closeButton.layer.shadowColor = UIColor.black.cgColor
        closeButton.layer.shadowOpacity = 0.15
        closeButton.layer.shadowOffset = CGSize(width: 0, height: 2)
        closeButton.layer.shadowRadius = 4
        closeButton.accessibilityLabel = "닫기"
        closeButton.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)
        view.addSubview(closeButton)
        productionCloseButton = closeButton

        let searchContainer = UIView()
        searchContainer.translatesAutoresizingMaskIntoConstraints = false
        searchContainer.backgroundColor = UIColor.systemBackground.withAlphaComponent(0.95)
        searchContainer.layer.cornerRadius = 22
        searchContainer.layer.shadowColor = UIColor.black.cgColor
        searchContainer.layer.shadowOpacity = 0.15
        searchContainer.layer.shadowOffset = CGSize(width: 0, height: 2)
        searchContainer.layer.shadowRadius = 4
        view.addSubview(searchContainer)
        productionSearchBarContainer = searchContainer

        let searchField = UITextField()
        searchField.translatesAutoresizingMaskIntoConstraints = false
        searchField.placeholder = "장소 검색"
        searchField.font = .systemFont(ofSize: 16)
        searchField.returnKeyType = .search
        searchField.clearButtonMode = .whileEditing
        searchField.delegate = self
        searchField.addTarget(self, action: #selector(searchFieldEditingChanged), for: .editingChanged)
        searchContainer.addSubview(searchField)
        productionSearchField = searchField

        let searchButton = UIButton(type: .system)
        searchButton.translatesAutoresizingMaskIntoConstraints = false
        if #available(iOS 13.0, *) {
            searchButton.setImage(UIImage(systemName: "magnifyingglass"), for: .normal)
        } else {
            searchButton.setTitle("🔍", for: .normal)
        }
        searchButton.tintColor = .secondaryLabel
        searchButton.addTarget(self, action: #selector(searchButtonTapped), for: .touchUpInside)
        searchContainer.addSubview(searchButton)

        NSLayoutConstraint.activate([
            closeButton.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12),
            closeButton.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 12),
            closeButton.widthAnchor.constraint(equalToConstant: 44),
            closeButton.heightAnchor.constraint(equalToConstant: 44),
            searchContainer.centerYAnchor.constraint(equalTo: closeButton.centerYAnchor),
            searchContainer.leadingAnchor.constraint(equalTo: closeButton.trailingAnchor, constant: 8),
            searchContainer.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16),
            searchContainer.heightAnchor.constraint(equalToConstant: 44),
            searchField.leadingAnchor.constraint(equalTo: searchContainer.leadingAnchor, constant: 16),
            searchField.centerYAnchor.constraint(equalTo: searchContainer.centerYAnchor),
            searchField.trailingAnchor.constraint(equalTo: searchButton.leadingAnchor, constant: -8),
            searchButton.trailingAnchor.constraint(equalTo: searchContainer.trailingAnchor, constant: -12),
            searchButton.centerYAnchor.constraint(equalTo: searchContainer.centerYAnchor),
            searchButton.widthAnchor.constraint(equalToConstant: 32),
            searchButton.heightAnchor.constraint(equalToConstant: 32),
        ])
    }

    private func bringProductionChromeToFront() {
        if let research = researchAreaButton, !research.isHidden {
            view.bringSubviewToFront(research)
        }
        if let search = productionSearchBarContainer {
            view.bringSubviewToFront(search)
        }
        if let button = productionCloseButton {
            view.bringSubviewToFront(button)
        }
    }

    private func ensureResearchAreaButton() {
        guard mode == .production else { return }
        if researchAreaButton != nil { return }

        let button = UIButton(type: .system)
        button.translatesAutoresizingMaskIntoConstraints = false
        button.setTitle("이 지역에서 재검색", for: .normal)
        button.setTitleColor(UIColor(red: 0.10, green: 0.16, blue: 0.48, alpha: 1.0), for: .normal)
        button.titleLabel?.font = .systemFont(ofSize: 14, weight: .semibold)
        button.backgroundColor = .white
        button.layer.cornerRadius = 18
        button.layer.shadowColor = UIColor.black.cgColor
        button.layer.shadowOpacity = 0.12
        button.layer.shadowOffset = CGSize(width: 0, height: 2)
        button.layer.shadowRadius = 6
        button.contentEdgeInsets = UIEdgeInsets(top: 8, left: 14, bottom: 8, right: 14)
        button.isHidden = true
        button.accessibilityLabel = "이 지역에서 재검색"
        if #available(iOS 13.0, *) {
            let config = UIImage.SymbolConfiguration(pointSize: 12, weight: .semibold)
            let image = UIImage(systemName: "arrow.triangle.2.circlepath", withConfiguration: config)
            button.setImage(image, for: .normal)
            button.tintColor = UIColor(red: 0.10, green: 0.16, blue: 0.48, alpha: 1.0)
            button.semanticContentAttribute = .forceLeftToRight
            button.imageEdgeInsets = UIEdgeInsets(top: 0, left: -4, bottom: 0, right: 4)
        }
        button.addTarget(self, action: #selector(researchAreaButtonTapped), for: .touchUpInside)
        view.addSubview(button)
        researchAreaButton = button

        let topAnchor = productionSearchBarContainer?.bottomAnchor ?? view.safeAreaLayoutGuide.topAnchor
        NSLayoutConstraint.activate([
            button.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            button.topAnchor.constraint(equalTo: topAnchor, constant: 10),
        ])
    }

    private func mapCenterCoordinate() -> (lat: Double, lng: Double)? {
        guard let map = kakaoMapView() else { return nil }
        let rect = map.viewRect
        let centerPoint = CGPoint(x: rect.midX, y: rect.midY)
        let mapPoint = map.getPosition(centerPoint)
        let coord = mapPoint.wgsCoord
        return (coord.latitude, coord.longitude)
    }

    private func showResearchAreaButtonIfNeeded() {
        guard mode == .production, !searchResults.isEmpty else { return }
        ensureResearchAreaButton()
        researchAreaButton?.isHidden = false
        bringProductionChromeToFront()
    }

    private func hideResearchAreaButton() {
        researchAreaButton?.isHidden = true
    }

    @objc private func researchAreaButtonTapped() {
        guard let center = mapCenterCoordinate() else { return }
        hideResearchAreaButton()
        onResearchArea?(center.lat, center.lng)
    }

    @objc private func searchButtonTapped() {
        submitFullscreenSearch()
    }

    @objc private func searchFieldEditingChanged() {
        let text = productionSearchField?.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard text.isEmpty else { return }
        clearSearchResults()
        onSearch?("")
    }

    private func submitFullscreenSearch() {
        let query = productionSearchField?.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !query.isEmpty else { return }
        productionSearchField?.resignFirstResponder()
        onSearch?(query)
    }

    private func makeToolbarButton(title: String) -> UIButton {
        let button = UIButton(type: .system)
        button.setTitle(title, for: .normal)
        button.titleLabel?.font = .systemFont(ofSize: 15, weight: .semibold)
        button.backgroundColor = UIColor.systemBackground.withAlphaComponent(0.92)
        button.layer.cornerRadius = 8
        button.contentEdgeInsets = UIEdgeInsets(top: 8, left: 12, bottom: 8, right: 12)
        return button
    }

    private func installOverlayTestCard() {
        overlayCardWebView.translatesAutoresizingMaskIntoConstraints = false
        overlayCardWebView.isOpaque = false
        overlayCardWebView.backgroundColor = .clear
        overlayCardWebView.scrollView.backgroundColor = .clear
        overlayCardWebView.isUserInteractionEnabled = true
        overlayCardWebView.layer.cornerRadius = 16
        overlayCardWebView.clipsToBounds = true
        view.addSubview(overlayCardWebView)
        NSLayoutConstraint.activate([
            overlayCardWebView.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            overlayCardWebView.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            overlayCardWebView.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -16),
            overlayCardWebView.heightAnchor.constraint(equalToConstant: 200),
        ])

        let html = """
        <!DOCTYPE html>
        <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body {
              font-family: -apple-system, BlinkMacSystemFont, sans-serif;
              background: #ffffff;
              padding: 20px;
              height: 100%;
            }
            p {
              font-size: 16px;
              line-height: 1.5;
              color: #222;
              margin-bottom: 16px;
            }
            button {
              width: 100%;
              padding: 12px;
              font-size: 15px;
              font-weight: 600;
              color: #fff;
              background: #1b9aad;
              border: none;
              border-radius: 10px;
            }
          </style>
        </head>
        <body>
          <p>테스트 카드 — 이게 보이면 Native VC 위 WebView OK</p>
          <button onclick="console.log('[Proto overlay card] button tapped')">테스트 버튼</button>
        </body>
        </html>
        """
        overlayCardWebView.loadHTMLString(html, baseURL: nil)
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        bringProductionChromeToFront()
        guard !enginePrepareRequested else { return }
        guard !SDKInitializer.GetAppKey().isEmpty, let controller = mapController else { return }
        enginePrepareRequested = true
        CAPLog.print("[PindmapNativeMap][Fullscreen] prepareEngine in viewDidAppear")
        _ = controller.prepareEngine()
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        if isBeingDismissed || navigationController?.isBeingDismissed == true {
            onDismiss?()
        }
    }

    @objc private func closeTapped() {
        dismiss(animated: true)
    }

    @objc private func cameraMoveTapped() {
        setCamera(lat: 35.1796, lng: 129.0756, zoom: 9, animated: false)
    }

    @objc private func replaceMarkersTapped() {
        let busanInputs = busanMarkers.map {
            MapMarkerInput(id: $0.id, lat: $0.lat, lng: $0.lng, category: nil, title: nil, address: nil, photos: [], postCount: 0, isSaved: false, photoPostIds: [], order: nil)
        }
        updateMarkers(busanInputs, clearPrefix: nil)
    }

    private func kakaoMapView() -> KakaoMap? {
        mapController?.getView("mapview") as? KakaoMap
    }

    private func attachKakaoEventDelegateIfNeeded() {
        guard let map = kakaoMapView() else { return }
        if map.eventDelegate == nil {
            map.eventDelegate = self
        }
    }

    private func ensureStyle(for category: String?, order: Int? = nil) -> String {
        guard let map = kakaoMapView() else {
            return NativeMapMarkerStyleHelper.styleID(for: category, order: order)
        }
        let styleID = NativeMapMarkerStyleHelper.styleID(for: category, order: order)
        if registeredStyleIDs.contains(styleID) {
            return styleID
        }
        let manager = map.getLabelManager()
        let isCoursePin = (order ?? 0) > 0
        let anchor = isCoursePin ? NativeMapMarkerStyleHelper.coursePinAnchor : NativeMapMarkerStyleHelper.savedPinAnchor
        let iconStyle = NativeMapMarkerStyleHelper.makeFixedZoomPoiIconStyle(
            symbol: NativeMapMarkerStyleHelper.makeMarkerIcon(category: category, order: order),
            anchorPoint: anchor
        )
        NativeMapMarkerStyleHelper.registerFixedZoomPoiStyle(on: manager, styleID: styleID, iconStyle: iconStyle)
        registeredStyleIDs.insert(styleID)
        return styleID
    }

    private func ensureMarkerLayer(on map: KakaoMap) -> LabelLayer? {
        if markerLayer == nil {
            let manager = map.getLabelManager()
            _ = ensureStyle(for: nil)
            let opts = LabelLayerOptions(
                layerID: Self.markerLayerID,
                competitionType: .none,
                competitionUnit: .poi,
                orderType: .rank,
                zOrder: 100
            )
            markerLayer = manager.addLabelLayer(option: opts)
        }
        return markerLayer
    }

    private func clearAllMarkers() {
        markerLayer?.clearAllItems()
        markerPois.removeAll()
        markerMetadata.removeAll()
        hidePlaceBottomSheet(animated: false)
        kakaoMapView()?.refresh()
    }

    private func clearMarkers(withPrefix prefix: String) {
        if let layer = markerLayer {
            for id in markerPois.keys where id.hasPrefix(prefix) {
                layer.removePoi(poiID: id)
                markerPois.removeValue(forKey: id)
                markerMetadata.removeValue(forKey: id)
            }
        } else {
            for id in markerPois.keys where id.hasPrefix(prefix) {
                markerPois.removeValue(forKey: id)
                markerMetadata.removeValue(forKey: id)
            }
        }
        hidePlaceBottomSheet(animated: true)
        kakaoMapView()?.refresh()
    }

    @discardableResult
    private func addMarkers(_ markers: [MapMarkerInput]) -> Int {
        guard let map = kakaoMapView(), let layer = ensureMarkerLayer(on: map) else {
            CAPLog.print("[PindmapNativeMap][Fullscreen] addMarkers skipped — map/layer unavailable")
            return 0
        }
        var added = 0
        for marker in markers {
            if markerPois[marker.id] != nil {
                layer.removePoi(poiID: marker.id)
                markerPois.removeValue(forKey: marker.id)
            }
            markerMetadata[marker.id] = MarkerMetadata(
                title: marker.title,
                address: marker.address,
                category: marker.category,
                lat: marker.lat,
                lng: marker.lng,
                photos: marker.photos,
                postCount: marker.postCount,
                isSaved: marker.isSaved,
                photoPostIds: marker.photoPostIds
            )
            let styleID = ensureStyle(for: marker.category, order: marker.order)
            let option = PoiOptions(styleID: styleID, poiID: marker.id)
            option.rank = 0
            option.clickable = true
            option.transformType = .default
            let point = MapPoint(longitude: marker.lng, latitude: marker.lat)
            guard let poi = layer.addPoi(option: option, at: point) else {
                CAPLog.print("[PindmapNativeMap][Fullscreen] addPoi FAIL id=\(marker.id)")
                continue
            }
            poi.show()
            attachMarkerPoiTapHandler(to: poi, poiID: marker.id)
            markerPois[marker.id] = poi
            added += 1
        }
        layer.visible = true
        layer.showAllPois()
        map.refresh()
        CAPLog.print("[PindmapNativeMap][Fullscreen] markers added count=\(added)")
        return added
    }

    private func onMarkerPoiTapped(poiID: String) {
        guard markerPois[poiID] != nil else { return }
        if mode == .production {
            showPlaceBottomSheet(for: poiID)
        }
        onMarkerClick?(poiID)
    }

    private func attachMarkerPoiTapHandler(to poi: Poi, poiID: String) {
        _ = poi.addPoiTappedEventHandler(target: self) { owner in
            { _ in
                owner.onMarkerPoiTapped(poiID: poiID)
            }
        }
    }

    private func syncContainerSize() {
        kmContainer.frame = view.bounds
        guard let map = kakaoMapView() else { return }
        let size = view.bounds.size
        guard size.width > 0, size.height > 0 else { return }
        map.viewRect = CGRect(origin: .zero, size: size)
        map.refresh()
    }

    private func applyPendingCamera(animated: Bool) {
        guard mapViewReady, let map = kakaoMapView() else { return }
        let target = MapPoint(longitude: pendingCamera.lng, latitude: pendingCamera.lat)
        let update = CameraUpdate.make(target: target, zoomLevel: pendingCamera.zoom, mapView: map)
        map.moveCamera(update)
        _ = animated
    }

    private func ensurePlaceBottomSheetChrome() {
        guard placeSheetBackdrop == nil else { return }

        let backdrop = UIView()
        backdrop.translatesAutoresizingMaskIntoConstraints = false
        backdrop.backgroundColor = UIColor.black.withAlphaComponent(0.25)
        backdrop.alpha = 0
        backdrop.isHidden = true
        backdrop.isUserInteractionEnabled = true
        let backdropTap = UITapGestureRecognizer(target: self, action: #selector(placeSheetBackdropTapped))
        backdrop.addGestureRecognizer(backdropTap)
        view.addSubview(backdrop)
        NSLayoutConstraint.activate([
            backdrop.topAnchor.constraint(equalTo: view.topAnchor),
            backdrop.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            backdrop.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            backdrop.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        placeSheetBackdrop = backdrop

        let card = UIView()
        card.translatesAutoresizingMaskIntoConstraints = false
        card.backgroundColor = .systemBackground
        card.layer.cornerRadius = 16
        card.layer.maskedCorners = [.layerMinXMinYCorner, .layerMaxXMinYCorner]
        card.layer.shadowColor = UIColor.black.cgColor
        card.layer.shadowOpacity = 0.12
        card.layer.shadowOffset = CGSize(width: 0, height: -2)
        card.layer.shadowRadius = 8
        view.addSubview(card)
        placeSheetCard = card

        let closeButton = UIButton(type: .system)
        closeButton.translatesAutoresizingMaskIntoConstraints = false
        closeButton.setTitle("✕", for: .normal)
        closeButton.titleLabel?.font = .systemFont(ofSize: 16, weight: .semibold)
        closeButton.setTitleColor(.secondaryLabel, for: .normal)
        closeButton.addTarget(self, action: #selector(placeSheetCloseTapped), for: .touchUpInside)
        card.addSubview(closeButton)

        let categoryDot = UIView()
        categoryDot.translatesAutoresizingMaskIntoConstraints = false
        categoryDot.layer.cornerRadius = 5
        card.addSubview(categoryDot)
        placeSheetCategoryDot = categoryDot

        let categoryLabel = UILabel()
        categoryLabel.translatesAutoresizingMaskIntoConstraints = false
        categoryLabel.font = .systemFont(ofSize: 13, weight: .semibold)
        categoryLabel.textColor = .secondaryLabel
        card.addSubview(categoryLabel)
        placeSheetCategoryLabel = categoryLabel

        let titleLabel = UILabel()
        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        titleLabel.font = .systemFont(ofSize: 18, weight: .bold)
        titleLabel.textColor = .label
        titleLabel.numberOfLines = 2
        card.addSubview(titleLabel)
        placeSheetTitleLabel = titleLabel

        let addressLabel = UILabel()
        addressLabel.translatesAutoresizingMaskIntoConstraints = false
        addressLabel.font = .systemFont(ofSize: 14, weight: .regular)
        addressLabel.textColor = .secondaryLabel
        addressLabel.numberOfLines = 2
        card.addSubview(addressLabel)
        placeSheetAddressLabel = addressLabel

        let postCountLabel = UILabel()
        postCountLabel.translatesAutoresizingMaskIntoConstraints = false
        postCountLabel.font = .systemFont(ofSize: 13, weight: .medium)
        postCountLabel.textColor = .secondaryLabel
        postCountLabel.isHidden = true
        card.addSubview(postCountLabel)
        placeSheetPostCountLabel = postCountLabel

        let photosScrollView = UIScrollView()
        photosScrollView.translatesAutoresizingMaskIntoConstraints = false
        photosScrollView.showsHorizontalScrollIndicator = false
        photosScrollView.isHidden = true
        card.addSubview(photosScrollView)
        placeSheetPhotosScrollView = photosScrollView

        let photosStackView = UIStackView()
        photosStackView.translatesAutoresizingMaskIntoConstraints = false
        photosStackView.axis = .horizontal
        photosStackView.spacing = 8
        photosStackView.alignment = .fill
        photosScrollView.addSubview(photosStackView)
        placeSheetPhotosStackView = photosStackView

        let saveButton = UIButton(type: .system)
        saveButton.translatesAutoresizingMaskIntoConstraints = false
        saveButton.setImage(UIImage(systemName: "heart"), for: .normal)
        saveButton.tintColor = .secondaryLabel
        saveButton.addTarget(self, action: #selector(placeSheetSaveTapped), for: .touchUpInside)
        card.addSubview(saveButton)
        placeSheetSaveButton = saveButton

        let directionsInfoLabel = UILabel()
        directionsInfoLabel.translatesAutoresizingMaskIntoConstraints = false
        directionsInfoLabel.font = .systemFont(ofSize: 13, weight: .medium)
        directionsInfoLabel.textColor = .secondaryLabel
        directionsInfoLabel.isHidden = true
        card.addSubview(directionsInfoLabel)
        placeSheetDirectionsInfoLabel = directionsInfoLabel

        let directionsButton = UIButton(type: .system)
        directionsButton.translatesAutoresizingMaskIntoConstraints = false
        directionsButton.setTitle("길찾기", for: .normal)
        directionsButton.titleLabel?.font = .systemFont(ofSize: 16, weight: .semibold)
        directionsButton.setTitleColor(.white, for: .normal)
        directionsButton.backgroundColor = UIColor(hex: 0x1a2a7a)
        directionsButton.layer.cornerRadius = 10
        directionsButton.addTarget(self, action: #selector(placeSheetDirectionsTapped), for: .touchUpInside)
        card.addSubview(directionsButton)
        placeSheetDirectionsButton = directionsButton

        let appleMapsButton = UIButton(type: .system)
        appleMapsButton.translatesAutoresizingMaskIntoConstraints = false
        appleMapsButton.setTitle("Apple 지도", for: .normal)
        appleMapsButton.titleLabel?.font = .systemFont(ofSize: 14, weight: .semibold)
        appleMapsButton.setTitleColor(UIColor(hex: 0x1a2a7a), for: .normal)
        appleMapsButton.backgroundColor = .systemBackground
        appleMapsButton.layer.cornerRadius = 10
        appleMapsButton.layer.borderWidth = 1
        appleMapsButton.layer.borderColor = UIColor(hex: 0x1a2a7a).cgColor
        appleMapsButton.addTarget(self, action: #selector(placeSheetAppleMapsTapped), for: .touchUpInside)

        let transitButton = UIButton(type: .system)
        transitButton.translatesAutoresizingMaskIntoConstraints = false
        transitButton.setTitle("대중교통", for: .normal)
        transitButton.titleLabel?.font = .systemFont(ofSize: 14, weight: .semibold)
        transitButton.setTitleColor(UIColor(hex: 0x1a2a7a), for: .normal)
        transitButton.backgroundColor = .systemBackground
        transitButton.layer.cornerRadius = 10
        transitButton.layer.borderWidth = 1
        transitButton.layer.borderColor = UIColor(hex: 0x1a2a7a).cgColor
        transitButton.addTarget(self, action: #selector(placeSheetTransitTapped), for: .touchUpInside)

        let externalStack = UIStackView(arrangedSubviews: [appleMapsButton, transitButton])
        externalStack.translatesAutoresizingMaskIntoConstraints = false
        externalStack.axis = .horizontal
        externalStack.spacing = 8
        externalStack.distribution = .fillEqually
        card.addSubview(externalStack)
        placeSheetAppleMapsButton = appleMapsButton
        placeSheetTransitButton = transitButton

        let bottom = card.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: Self.placeSheetCompactDismissOffset)
        placeSheetBottomConstraint = bottom

        let actionsTopToAddress = directionsInfoLabel.topAnchor.constraint(equalTo: addressLabel.bottomAnchor, constant: 12)
        let actionsTopToTitle = directionsInfoLabel.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 12)
        let actionsTopToMedia = directionsInfoLabel.topAnchor.constraint(equalTo: photosScrollView.bottomAnchor, constant: 12)
        let actionsTopToPostCount = directionsInfoLabel.topAnchor.constraint(equalTo: postCountLabel.bottomAnchor, constant: 12)
        actionsTopToTitle.isActive = false
        actionsTopToMedia.isActive = false
        actionsTopToPostCount.isActive = false
        placeSheetActionsTopToAddress = actionsTopToAddress
        placeSheetActionsTopToTitle = actionsTopToTitle
        placeSheetActionsTopToMedia = actionsTopToMedia
        placeSheetActionsTopToPostCount = actionsTopToPostCount

        let photosHeight = photosScrollView.heightAnchor.constraint(equalToConstant: Self.photoThumbnailSize)
        placeSheetPhotosHeightConstraint = photosHeight

        NSLayoutConstraint.activate([
            card.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            card.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            bottom,
            saveButton.topAnchor.constraint(equalTo: card.topAnchor, constant: 12),
            saveButton.trailingAnchor.constraint(equalTo: closeButton.leadingAnchor, constant: -8),
            saveButton.widthAnchor.constraint(equalToConstant: 32),
            saveButton.heightAnchor.constraint(equalToConstant: 32),
            closeButton.topAnchor.constraint(equalTo: card.topAnchor, constant: 12),
            closeButton.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -12),
            closeButton.widthAnchor.constraint(equalToConstant: 32),
            closeButton.heightAnchor.constraint(equalToConstant: 32),
            categoryDot.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 20),
            categoryDot.topAnchor.constraint(equalTo: card.topAnchor, constant: 20),
            categoryDot.widthAnchor.constraint(equalToConstant: 10),
            categoryDot.heightAnchor.constraint(equalToConstant: 10),
            categoryLabel.leadingAnchor.constraint(equalTo: categoryDot.trailingAnchor, constant: 8),
            categoryLabel.centerYAnchor.constraint(equalTo: categoryDot.centerYAnchor),
            categoryLabel.trailingAnchor.constraint(lessThanOrEqualTo: saveButton.leadingAnchor, constant: -8),
            titleLabel.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 20),
            titleLabel.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -20),
            titleLabel.topAnchor.constraint(equalTo: categoryDot.bottomAnchor, constant: 12),
            addressLabel.leadingAnchor.constraint(equalTo: titleLabel.leadingAnchor),
            addressLabel.trailingAnchor.constraint(equalTo: titleLabel.trailingAnchor),
            addressLabel.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 6),
            postCountLabel.leadingAnchor.constraint(equalTo: titleLabel.leadingAnchor),
            postCountLabel.trailingAnchor.constraint(equalTo: titleLabel.trailingAnchor),
            postCountLabel.topAnchor.constraint(equalTo: addressLabel.bottomAnchor, constant: 10),
            photosScrollView.leadingAnchor.constraint(equalTo: titleLabel.leadingAnchor),
            photosScrollView.trailingAnchor.constraint(equalTo: titleLabel.trailingAnchor),
            photosScrollView.topAnchor.constraint(equalTo: postCountLabel.bottomAnchor, constant: 6),
            photosHeight,
            photosStackView.topAnchor.constraint(equalTo: photosScrollView.contentLayoutGuide.topAnchor),
            photosStackView.leadingAnchor.constraint(equalTo: photosScrollView.contentLayoutGuide.leadingAnchor),
            photosStackView.trailingAnchor.constraint(equalTo: photosScrollView.contentLayoutGuide.trailingAnchor),
            photosStackView.bottomAnchor.constraint(equalTo: photosScrollView.contentLayoutGuide.bottomAnchor),
            photosStackView.heightAnchor.constraint(equalTo: photosScrollView.frameLayoutGuide.heightAnchor),
            actionsTopToAddress,
            directionsInfoLabel.leadingAnchor.constraint(equalTo: titleLabel.leadingAnchor),
            directionsInfoLabel.trailingAnchor.constraint(equalTo: titleLabel.trailingAnchor),
            directionsButton.topAnchor.constraint(equalTo: directionsInfoLabel.bottomAnchor, constant: 10),
            directionsButton.leadingAnchor.constraint(equalTo: titleLabel.leadingAnchor),
            directionsButton.trailingAnchor.constraint(equalTo: titleLabel.trailingAnchor),
            directionsButton.heightAnchor.constraint(equalToConstant: 44),
            externalStack.topAnchor.constraint(equalTo: directionsButton.bottomAnchor, constant: 10),
            externalStack.leadingAnchor.constraint(equalTo: titleLabel.leadingAnchor),
            externalStack.trailingAnchor.constraint(equalTo: titleLabel.trailingAnchor),
            externalStack.heightAnchor.constraint(equalToConstant: 40),
            externalStack.bottomAnchor.constraint(equalTo: card.safeAreaLayoutGuide.bottomAnchor, constant: -16),
        ])

        let pan = UIPanGestureRecognizer(target: self, action: #selector(placeSheetPanned(_:)))
        card.addGestureRecognizer(pan)
    }

    private func placeSheetDismissOffset(for markerId: String?) -> CGFloat {
        guard let markerId, let meta = markerMetadata[markerId] else {
            return Self.placeSheetCompactDismissOffset
        }
        let hasMedia = meta.postCount > 0 || !meta.photos.isEmpty
        return hasMedia ? Self.placeSheetExpandedDismissOffset : Self.placeSheetCompactDismissOffset
    }

    private func updatePlaceSheetMedia(for meta: MarkerMetadata?) {
        let postCount = meta?.postCount ?? 0
        let photos = meta?.photos ?? []
        let hasPostCount = postCount > 0
        let hasPhotos = !photos.isEmpty

        placeSheetPostCountLabel?.isHidden = !hasPostCount
        if hasPostCount {
            placeSheetPostCountLabel?.text = "관련 포스트 \(postCount)개"
        } else {
            placeSheetPostCountLabel?.text = nil
        }

        placeSheetPhotosScrollView?.isHidden = !hasPhotos
        placeSheetPhotosHeightConstraint?.constant = hasPhotos ? Self.photoThumbnailSize : 0

        if let stack = placeSheetPhotosStackView {
            for view in stack.arrangedSubviews {
                if let imageView = view as? UIImageView {
                    PlaceSheetRemoteImageLoader.shared.cancel(for: imageView)
                }
                stack.removeArrangedSubview(view)
                view.removeFromSuperview()
            }
            if hasPhotos {
                var index = 0
                for urlString in photos {
                    let imageView = UIImageView()
                    imageView.translatesAutoresizingMaskIntoConstraints = false
                    imageView.contentMode = .scaleAspectFill
                    imageView.clipsToBounds = true
                    imageView.layer.cornerRadius = 10
                    imageView.backgroundColor = UIColor.secondarySystemFill
                    imageView.isUserInteractionEnabled = true
                    imageView.tag = index
                    index += 1
                    let tap = UITapGestureRecognizer(target: self, action: #selector(placeSheetPhotoTapped(_:)))
                    imageView.addGestureRecognizer(tap)
                    NSLayoutConstraint.activate([
                        imageView.widthAnchor.constraint(equalToConstant: Self.photoThumbnailSize),
                        imageView.heightAnchor.constraint(equalToConstant: Self.photoThumbnailSize),
                    ])
                    stack.addArrangedSubview(imageView)
                    PlaceSheetRemoteImageLoader.shared.load(urlString: urlString, into: imageView)
                }
            }
        }

        placeSheetActionsTopToAddress?.isActive = false
        placeSheetActionsTopToTitle?.isActive = false
        placeSheetActionsTopToMedia?.isActive = false
        placeSheetActionsTopToPostCount?.isActive = false

        if hasPhotos {
            placeSheetActionsTopToMedia?.isActive = true
        } else if hasPostCount {
            placeSheetActionsTopToPostCount?.isActive = true
        } else if meta?.address?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false {
            placeSheetActionsTopToAddress?.isActive = true
        } else {
            placeSheetActionsTopToTitle?.isActive = true
        }
    }

    private func updatePlaceSheetSaveButton(isSaved: Bool) {
        let symbol = isSaved ? "heart.fill" : "heart"
        placeSheetSaveButton?.setImage(UIImage(systemName: symbol), for: .normal)
        placeSheetSaveButton?.tintColor = isSaved ? UIColor(hex: 0xe07070) : .secondaryLabel
    }

    private func formatDirectionsInfo(durationSec: Int, distanceM: Int) -> String {
        let minutes = max(1, Int(round(Double(durationSec) / 60.0)))
        let km = Double(distanceM) / 1000.0
        let distanceText: String
        if km >= 10 {
            distanceText = String(format: "%.0f km", km)
        } else if km >= 1 {
            distanceText = String(format: "%.1f km", km)
        } else {
            distanceText = "\(distanceM) m"
        }
        return "약 \(minutes)분 · \(distanceText)"
    }

    func setPlaceSaved(markerId: String, saved: Bool) {
        if var meta = markerMetadata[markerId] {
            meta.isSaved = saved
            markerMetadata[markerId] = meta
        }
        if placeSheetMarkerId == markerId {
            updatePlaceSheetSaveButton(isSaved: saved)
        }
    }

    func setDirectionsInfo(markerId: String, durationSec: Int, distanceM: Int) {
        guard placeSheetMarkerId == markerId else { return }
        let text = formatDirectionsInfo(durationSec: durationSec, distanceM: distanceM)
        placeSheetDirectionsInfoLabel?.text = text
        placeSheetDirectionsInfoLabel?.isHidden = false
    }

    private func showPlaceBottomSheet(for markerId: String) {
        guard mode == .production else { return }
        ensurePlaceBottomSheetChrome()
        guard let backdrop = placeSheetBackdrop, let card = placeSheetCard else { return }

        placeSheetMarkerId = markerId
        let meta = markerMetadata[markerId]
        let category = meta?.category
        let title = meta?.title?.trimmingCharacters(in: .whitespacesAndNewlines)
        let address = meta?.address?.trimmingCharacters(in: .whitespacesAndNewlines)

        placeSheetCategoryDot?.backgroundColor = NativeMapMarkerStyleHelper.markerColor(for: category)
        if let category, !category.isEmpty {
            placeSheetCategoryLabel?.text = category
            placeSheetCategoryLabel?.isHidden = false
            placeSheetCategoryDot?.isHidden = false
        } else {
            placeSheetCategoryLabel?.text = nil
            placeSheetCategoryLabel?.isHidden = true
            placeSheetCategoryDot?.isHidden = true
        }

        if let title, !title.isEmpty {
            placeSheetTitleLabel?.text = title
        } else {
            placeSheetTitleLabel?.text = markerId
        }

        if let address, !address.isEmpty {
            placeSheetAddressLabel?.text = address
            placeSheetAddressLabel?.isHidden = false
        } else {
            placeSheetAddressLabel?.text = nil
            placeSheetAddressLabel?.isHidden = true
        }

        updatePlaceSheetMedia(for: meta)
        updatePlaceSheetSaveButton(isSaved: meta?.isSaved ?? false)
        placeSheetDirectionsInfoLabel?.text = nil
        placeSheetDirectionsInfoLabel?.isHidden = true

        let dismissOffset = placeSheetDismissOffset(for: markerId)
        let alreadyVisible = backdrop.alpha > 0 && !backdrop.isHidden
        if alreadyVisible {
            view.bringSubviewToFront(backdrop)
            view.bringSubviewToFront(card)
            bringProductionChromeToFront()
            if let searchCard = searchResultsCard, !searchCard.isHidden {
                view.insertSubview(searchCard, belowSubview: backdrop)
            }
            return
        }

        backdrop.isHidden = false
        view.bringSubviewToFront(backdrop)
        view.bringSubviewToFront(card)
        bringProductionChromeToFront()

        placeSheetBottomConstraint?.constant = dismissOffset
        view.layoutIfNeeded()
        placeSheetBottomConstraint?.constant = 0

        UIView.animate(withDuration: 0.28, delay: 0, options: [.curveEaseOut]) {
            backdrop.alpha = 1
            self.view.layoutIfNeeded()
        }
    }

    private func hidePlaceBottomSheet(animated: Bool) {
        guard let backdrop = placeSheetBackdrop else { return }
        guard !backdrop.isHidden else { return }

        placeSheetBottomConstraint?.constant = placeSheetDismissOffset(for: placeSheetMarkerId)
        let animations = {
            backdrop.alpha = 0
            self.view.layoutIfNeeded()
        }
        let completion: (Bool) -> Void = { _ in
            backdrop.isHidden = true
        }

        if animated {
            UIView.animate(withDuration: 0.22, delay: 0, options: [.curveEaseIn], animations: animations, completion: completion)
        } else {
            animations()
            completion(true)
        }
    }

    @objc private func placeSheetBackdropTapped() {
        hidePlaceBottomSheet(animated: true)
    }

    @objc private func placeSheetCloseTapped() {
        hidePlaceBottomSheet(animated: true)
    }

    @objc private func placeSheetDirectionsTapped() {
        guard let markerId = placeSheetMarkerId else {
            return
        }
        let meta = markerMetadata[markerId]
        let metaLat = meta?.lat
        let metaLng = meta?.lng

        let lat: Double
        let lng: Double
        if let metaLat, let metaLng {
            lat = metaLat
            lng = metaLng
        } else if let poi = markerPois[markerId] {
            let coord = poi.position.wgsCoord
            lat = coord.latitude
            lng = coord.longitude
        } else {
            return
        }
        onDirections?(markerId, lat, lng, "walk")
    }

    @objc private func placeSheetSaveTapped() {
        guard let markerId = placeSheetMarkerId else { return }
        onToggleSave?(markerId)
    }

    @objc private func placeSheetAppleMapsTapped() {
        guard let markerId = placeSheetMarkerId else { return }
        onOpenExternal?(markerId, "apple")
    }

    @objc private func placeSheetTransitTapped() {
        guard let markerId = placeSheetMarkerId else { return }
        onOpenExternal?(markerId, "transit")
    }

    @objc private func placeSheetPhotoTapped(_ gesture: UITapGestureRecognizer) {
        guard let imageView = gesture.view as? UIImageView,
              let markerId = placeSheetMarkerId,
              let meta = markerMetadata[markerId] else { return }
        let index = imageView.tag
        guard index >= 0, index < meta.photos.count else { return }
        let url = meta.photos[index]
        if index < meta.photoPostIds.count, !meta.photoPostIds[index].isEmpty {
            onCuration?(markerId, meta.photoPostIds[index])
        } else {
            onImageLightbox?(url)
        }
    }

    @objc private func placeSheetPanned(_ gesture: UIPanGestureRecognizer) {
        guard let card = placeSheetCard else { return }
        let translation = gesture.translation(in: view)
        switch gesture.state {
        case .changed:
            if translation.y > 0 {
                placeSheetBottomConstraint?.constant = translation.y
            }
        case .ended, .cancelled:
            let velocity = gesture.velocity(in: view).y
            if translation.y > 80 || velocity > 600 {
                hidePlaceBottomSheet(animated: true)
            } else {
                placeSheetBottomConstraint?.constant = 0
                UIView.animate(withDuration: 0.2) {
                    self.view.layoutIfNeeded()
                }
            }
        default:
            break
        }
    }

    private func ensureSearchResultsSheetChrome() {
        guard mode == .production, searchResultsCard == nil else { return }

        let card = UIView()
        card.translatesAutoresizingMaskIntoConstraints = false
        card.backgroundColor = .systemBackground
        card.layer.cornerRadius = 16
        card.layer.maskedCorners = [.layerMinXMinYCorner, .layerMaxXMinYCorner]
        card.layer.shadowColor = UIColor.black.cgColor
        card.layer.shadowOpacity = 0.12
        card.layer.shadowOffset = CGSize(width: 0, height: -2)
        card.layer.shadowRadius = 8
        card.isHidden = true
        view.addSubview(card)
        searchResultsCard = card

        let titleLabel = UILabel()
        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        titleLabel.font = .systemFont(ofSize: 15, weight: .semibold)
        titleLabel.textColor = .label
        card.addSubview(titleLabel)
        searchResultsTitleLabel = titleLabel

        let closeButton = UIButton(type: .system)
        closeButton.translatesAutoresizingMaskIntoConstraints = false
        closeButton.setTitle("✕", for: .normal)
        closeButton.titleLabel?.font = .systemFont(ofSize: 16, weight: .semibold)
        closeButton.setTitleColor(.secondaryLabel, for: .normal)
        closeButton.addTarget(self, action: #selector(searchResultsCloseTapped), for: .touchUpInside)
        card.addSubview(closeButton)

        let tableView = UITableView(frame: .zero, style: .plain)
        tableView.translatesAutoresizingMaskIntoConstraints = false
        tableView.dataSource = self
        tableView.delegate = self
        tableView.register(UITableViewCell.self, forCellReuseIdentifier: Self.searchResultCellID)
        tableView.separatorInset = UIEdgeInsets(top: 0, left: 16, bottom: 0, right: 16)
        tableView.rowHeight = 64
        card.addSubview(tableView)
        searchResultsTableView = tableView

        let bottom = card.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: Self.searchResultsSheetHeight)
        searchResultsBottomConstraint = bottom

        NSLayoutConstraint.activate([
            card.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            card.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            bottom,
            card.heightAnchor.constraint(equalToConstant: Self.searchResultsSheetHeight),
            titleLabel.topAnchor.constraint(equalTo: card.topAnchor, constant: 14),
            titleLabel.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 20),
            titleLabel.trailingAnchor.constraint(lessThanOrEqualTo: closeButton.leadingAnchor, constant: -8),
            closeButton.centerYAnchor.constraint(equalTo: titleLabel.centerYAnchor),
            closeButton.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -12),
            closeButton.widthAnchor.constraint(equalToConstant: 32),
            closeButton.heightAnchor.constraint(equalToConstant: 32),
            tableView.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 8),
            tableView.leadingAnchor.constraint(equalTo: card.leadingAnchor),
            tableView.trailingAnchor.constraint(equalTo: card.trailingAnchor),
            tableView.bottomAnchor.constraint(equalTo: card.safeAreaLayoutGuide.bottomAnchor),
        ])
    }

    private func applySearchResults(_ results: [SearchResultInput]) {
        guard mode == .production else { return }
        searchResults = results
        hideResearchAreaButton()
        if results.isEmpty {
            hideSearchResultsSheet(animated: true)
            return
        }

        for item in results {
            markerMetadata[item.id] = MarkerMetadata(
                title: item.name,
                address: item.address,
                category: item.category,
                lat: item.lat,
                lng: item.lng,
                photos: [],
                postCount: 0,
                isSaved: false,
                photoPostIds: []
            )
        }

        ensureSearchResultsSheetChrome()
        searchResultsTitleLabel?.text = "검색 결과 \(results.count)건"
        searchResultsTableView?.reloadData()
        showSearchResultsSheet(animated: true)
    }

    private func showSearchResultsSheet(animated: Bool) {
        guard let card = searchResultsCard else { return }
        card.isHidden = false
        view.bringSubviewToFront(card)
        if let backdrop = placeSheetBackdrop, !backdrop.isHidden {
            view.bringSubviewToFront(backdrop)
            if let placeCard = placeSheetCard {
                view.bringSubviewToFront(placeCard)
            }
        }
        bringProductionChromeToFront()

        searchResultsBottomConstraint?.constant = Self.searchResultsSheetHeight
        view.layoutIfNeeded()
        searchResultsBottomConstraint?.constant = 0

        if animated {
            UIView.animate(withDuration: 0.28, delay: 0, options: [.curveEaseOut]) {
                self.view.layoutIfNeeded()
            }
        } else {
            view.layoutIfNeeded()
        }
    }

    private func hideSearchResultsSheet(animated: Bool) {
        guard let card = searchResultsCard, !card.isHidden else { return }
        searchResultsBottomConstraint?.constant = Self.searchResultsSheetHeight
        let animations = { self.view.layoutIfNeeded() }
        let completion: (Bool) -> Void = { _ in
            card.isHidden = true
        }
        if animated {
            UIView.animate(withDuration: 0.22, delay: 0, options: [.curveEaseIn], animations: animations, completion: completion)
        } else {
            animations()
            completion(true)
        }
    }

    private func selectSearchResult(_ item: SearchResultInput) {
        setCamera(lat: item.lat, lng: item.lng, zoom: 16, animated: true)
        showPlaceBottomSheet(for: item.id)
    }

    @objc private func searchResultsCloseTapped() {
        hideSearchResultsSheet(animated: true)
    }

    private func applyInitialContent() {
        applyPendingCamera(animated: false)
        if mode == .prototype {
            let protoMarkers = seoulMarkers.map {
                MapMarkerInput(id: $0.id, lat: $0.lat, lng: $0.lng, category: nil, title: nil, address: nil, photos: [], postCount: 0, isSaved: false, photoPostIds: [], order: nil)
            }
            _ = addMarkers(protoMarkers)
        } else if !pendingInitialMarkers.isEmpty && markerPois.isEmpty {
            // Skip re-applying initial markers if JS already added markers (search restore race)
            updateMarkers(pendingInitialMarkers, clearPrefix: nil)
        }
        if let pendingRoute {
            // TEMP crs-debug
            CAPLog.print("[crs] applyInitialContent applyRoute pathCount=\(pendingRoute.path.count) mode=\(pendingRoute.mode)")
            applyRoute(path: pendingRoute.path, mode: pendingRoute.mode, fitCamera: true)
        } else {
            // TEMP crs-debug
            CAPLog.print("[crs] applyInitialContent no pendingRoute")
        }
        if let pendingSearchResults {
            applySearchResults(pendingSearchResults)
        }
        if let pendingMyLocation {
            applyMyLocation(lat: pendingMyLocation.lat, lng: pendingMyLocation.lng)
        }
    }

    private func makeMyLocationInfoWindow() -> InfoWindow {
        NativeMapMarkerStyleHelper.makeMyLocationInfoWindow(guiID: Self.myLocationGuiID)
    }

    private func applyMyLocation(lat: Double, lng: Double) {
        pendingMyLocation = (lat, lng)
        guard mode == .production else { return }
        guard let map = kakaoMapView() else { return }

        let guiManager = map.getGuiManager()
        let layer = guiManager.infoWindowLayer
        let point = MapPoint(longitude: lng, latitude: lat)

        if let existing = myLocationInfoWindow ?? layer.getInfoWindow(guiName: Self.myLocationGuiID) {
            existing.position = point
            existing.show()
            myLocationInfoWindow = existing
        } else {
            let infoWindow = makeMyLocationInfoWindow()
            infoWindow.position = point
            layer.addInfoWindow(infoWindow)
            infoWindow.show()
            myLocationInfoWindow = infoWindow
        }
        map.refresh()
    }

    private func formatWalkDuration(_ totalSec: Int) -> String {
        let minutes = max(1, Int(round(Double(totalSec) / 60.0)))
        if minutes < 60 { return "\(minutes)분" }
        let hours = minutes / 60
        let rem = minutes % 60
        return rem > 0 ? "\(hours)시간 \(rem)분" : "\(hours)시간"
    }

    private func formatWalkDistance(_ totalM: Int) -> String {
        if totalM >= 1000 {
            let km = Double(totalM) / 1000.0
            return km >= 10 ? String(format: "%.0f km", km) : String(format: "%.1f km", km)
        }
        return "\(totalM) m"
    }

    private func ensureCourseNavChrome() {
        guard mode == .production else { return }
        if courseNavPanel != nil {
            courseNavPanel?.isHidden = false
            return
        }

        let panel = UIView()
        panel.translatesAutoresizingMaskIntoConstraints = false
        panel.backgroundColor = UIColor.systemBackground.withAlphaComponent(0.96)
        panel.layer.cornerRadius = 16
        panel.layer.maskedCorners = [.layerMinXMinYCorner, .layerMaxXMinYCorner]
        panel.layer.shadowColor = UIColor.black.cgColor
        panel.layer.shadowOpacity = 0.12
        panel.layer.shadowOffset = CGSize(width: 0, height: -2)
        panel.layer.shadowRadius = 8
        view.addSubview(panel)
        courseNavPanel = panel

        let summary = UILabel()
        summary.translatesAutoresizingMaskIntoConstraints = false
        summary.font = .systemFont(ofSize: 14, weight: .semibold)
        summary.textColor = UIColor(hex: 0x1a2a7a)
        summary.numberOfLines = 2
        panel.addSubview(summary)
        courseNavSummaryLabel = summary

        let scroll = UIScrollView()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.showsHorizontalScrollIndicator = false
        panel.addSubview(scroll)
        courseNavSegmentScrollView = scroll

        let stack = UIStackView()
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.axis = .horizontal
        stack.spacing = 8
        stack.alignment = .fill
        scroll.addSubview(stack)
        courseNavSegmentStack = stack

        let focusBar = UIStackView()
        focusBar.translatesAutoresizingMaskIntoConstraints = false
        focusBar.axis = .horizontal
        focusBar.spacing = 8
        focusBar.alignment = .center
        focusBar.distribution = .fillEqually
        panel.addSubview(focusBar)
        courseNavFocusBar = focusBar

        let prevButton = UIButton(type: .system)
        prevButton.setTitle("이전", for: .normal)
        prevButton.titleLabel?.font = .systemFont(ofSize: 13, weight: .semibold)
        prevButton.addTarget(self, action: #selector(courseNavPrevTapped), for: .touchUpInside)
        focusBar.addArrangedSubview(prevButton)
        courseNavPrevButton = prevButton

        let focusLabel = UILabel()
        focusLabel.font = .systemFont(ofSize: 13, weight: .medium)
        focusLabel.textAlignment = .center
        focusLabel.textColor = .secondaryLabel
        focusBar.addArrangedSubview(focusLabel)
        courseNavFocusLabel = focusLabel

        let nextButton = UIButton(type: .system)
        nextButton.setTitle("다음", for: .normal)
        nextButton.titleLabel?.font = .systemFont(ofSize: 13, weight: .semibold)
        nextButton.addTarget(self, action: #selector(courseNavNextTapped), for: .touchUpInside)
        focusBar.addArrangedSubview(nextButton)
        courseNavNextButton = nextButton

        let fullButton = UIButton(type: .system)
        fullButton.setTitle("전체 보기", for: .normal)
        fullButton.titleLabel?.font = .systemFont(ofSize: 13, weight: .bold)
        fullButton.setTitleColor(UIColor(hex: 0x1a2a7a), for: .normal)
        fullButton.addTarget(self, action: #selector(courseNavShowFullTapped), for: .touchUpInside)
        focusBar.addArrangedSubview(fullButton)

        let focusTop = focusBar.topAnchor.constraint(equalTo: scroll.bottomAnchor, constant: 8)
        let focusHeight = focusBar.heightAnchor.constraint(equalToConstant: 32)
        let focusBottom = focusBar.bottomAnchor.constraint(equalTo: panel.safeAreaLayoutGuide.bottomAnchor, constant: -12)
        let scrollBottom = scroll.bottomAnchor.constraint(equalTo: panel.safeAreaLayoutGuide.bottomAnchor, constant: -12)
        scrollBottom.isActive = false
        courseNavFocusBarTopConstraint = focusTop
        courseNavFocusBarHeightConstraint = focusHeight
        courseNavFocusBarBottomConstraint = focusBottom
        courseNavScrollBottomConstraint = scrollBottom

        NSLayoutConstraint.activate([
            panel.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            panel.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            panel.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            summary.topAnchor.constraint(equalTo: panel.topAnchor, constant: 12),
            summary.leadingAnchor.constraint(equalTo: panel.leadingAnchor, constant: 16),
            summary.trailingAnchor.constraint(equalTo: panel.trailingAnchor, constant: -16),

            scroll.topAnchor.constraint(equalTo: summary.bottomAnchor, constant: 10),
            scroll.leadingAnchor.constraint(equalTo: panel.leadingAnchor, constant: 12),
            scroll.trailingAnchor.constraint(equalTo: panel.trailingAnchor, constant: -12),
            scroll.heightAnchor.constraint(equalToConstant: 36),

            stack.topAnchor.constraint(equalTo: scroll.topAnchor),
            stack.leadingAnchor.constraint(equalTo: scroll.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: scroll.trailingAnchor),
            stack.bottomAnchor.constraint(equalTo: scroll.bottomAnchor),
            stack.heightAnchor.constraint(equalTo: scroll.heightAnchor),

            focusTop,
            focusBar.leadingAnchor.constraint(equalTo: panel.leadingAnchor, constant: 12),
            focusBar.trailingAnchor.constraint(equalTo: panel.trailingAnchor, constant: -12),
            focusHeight,
            focusBottom,
        ])
    }

    private func bringCourseNavToFront() {
        if let panel = courseNavPanel {
            view.bringSubviewToFront(panel)
        }
        if let button = productionCloseButton {
            view.bringSubviewToFront(button)
        }
    }

    private func updateCourseNavUI() {
        guard let summary = courseNavSummaryLabel else { return }
        summary.text = "전체 도보 \(formatWalkDuration(courseNavTotalTimeSec)) · \(formatWalkDistance(courseNavTotalDistanceM)) · 장소 \(courseNavPlaceCount)곳"

        courseNavSegmentStack?.arrangedSubviews.forEach { chip in
            courseNavSegmentStack?.removeArrangedSubview(chip)
            chip.removeFromSuperview()
        }

        for segment in courseNavSegments {
            let button = UIButton(type: .system)
            button.setTitle("\(segment.index + 1)→\(segment.index + 2) \(segment.toName)", for: .normal)
            button.titleLabel?.font = .systemFont(ofSize: 12, weight: .semibold)
            button.titleLabel?.lineBreakMode = .byTruncatingTail
            button.contentEdgeInsets = UIEdgeInsets(top: 6, left: 10, bottom: 6, right: 10)
            button.layer.cornerRadius = 14
            button.tag = segment.index
            button.addTarget(self, action: #selector(courseNavSegmentChipTapped(_:)), for: .touchUpInside)
            styleCourseNavSegmentChip(button, selected: segment.index == courseNavSelectedSegmentIndex)
            courseNavSegmentStack?.addArrangedSubview(button)
        }

        let segmentCount = courseNavSegments.count
        let selected = courseNavSelectedSegmentIndex ?? 0
        let showFocusBar = courseNavSegmentFocusMode
        courseNavFocusBar?.isHidden = !showFocusBar
        courseNavFocusBarTopConstraint?.constant = showFocusBar ? 8 : 0
        courseNavFocusBarHeightConstraint?.constant = showFocusBar ? 32 : 0
        courseNavFocusBarBottomConstraint?.isActive = showFocusBar
        courseNavScrollBottomConstraint?.isActive = !showFocusBar
        courseNavFocusLabel?.text = "구간 \(selected + 1)/\(max(segmentCount, 1))"
        courseNavPrevButton?.isEnabled = selected > 0
        courseNavNextButton?.isEnabled = selected < segmentCount - 1
    }

    private func styleCourseNavSegmentChip(_ button: UIButton, selected: Bool) {
        if selected {
            button.backgroundColor = UIColor(hex: 0x1a2a7a)
            button.setTitleColor(.white, for: .normal)
        } else {
            button.backgroundColor = UIColor.secondarySystemFill
            button.setTitleColor(.label, for: .normal)
        }
    }

    private func selectCourseNavSegment(_ index: Int, segmentFocus: Bool) {
        guard index >= 0, index < courseNavSegments.count else { return }
        courseNavSelectedSegmentIndex = index
        courseNavSegmentFocusMode = segmentFocus
        updateCourseNavUI()
        if segmentFocus {
            let segment = courseNavSegments[index]
            setRoute(path: segment.path, mode: "walk", fitCamera: true)
        }
    }

    @objc private func courseNavSegmentChipTapped(_ sender: UIButton) {
        let focus = courseNavSegmentFocusMode || (courseNavSelectedSegmentIndex != sender.tag)
        selectCourseNavSegment(sender.tag, segmentFocus: focus)
        if !courseNavSegmentFocusMode {
            courseNavSegmentFocusMode = true
            updateCourseNavUI()
            let segment = courseNavSegments[sender.tag]
            setRoute(path: segment.path, mode: "walk", fitCamera: true)
        }
    }

    @objc private func courseNavPrevTapped() {
        guard let current = courseNavSelectedSegmentIndex, current > 0 else { return }
        selectCourseNavSegment(current - 1, segmentFocus: true)
    }

    @objc private func courseNavNextTapped() {
        guard let current = courseNavSelectedSegmentIndex, current < courseNavSegments.count - 1 else { return }
        selectCourseNavSegment(current + 1, segmentFocus: true)
    }

    @objc private func courseNavShowFullTapped() {
        courseNavSegmentFocusMode = false
        updateCourseNavUI()
        if courseNavFullPath.count >= 2 {
            setRoute(path: courseNavFullPath, mode: "walk", fitCamera: true)
        }
    }

    private func applyRoute(path: [(lat: Double, lng: Double)], mode: String, fitCamera: Bool = true) {
        // TEMP crs-debug
        CAPLog.print("[crs] applyRoute entry pathCount=\(path.count) mode=\(mode) mapViewReady=\(mapViewReady) routeLayerExists=\(routeLayer != nil)")
        guard path.count >= 2 else {
            // TEMP crs-debug
            CAPLog.print("[crs] applyRoute abort — pathCount < 2 (\(path.count))")
            return
        }
        guard let map = kakaoMapView() else {
            // TEMP crs-debug
            CAPLog.print("[crs] applyRoute abort — kakaoMapView=nil")
            return
        }

        let routeMode = mode == "walk" ? "walk" : "car"
        let manager = map.getRouteManager()
        ensureRouteStyleSet(mode: routeMode, manager: manager)
        // TEMP crs-debug
        CAPLog.print("[crs] applyRoute styleSet ok mode=\(routeMode) registeredStyleSets=\(registeredRouteStyleSetIDs.count)")

        guard let layer = ensureRouteLayer(manager: manager) else {
            // TEMP crs-debug
            CAPLog.print("[crs] applyRoute abort — ensureRouteLayer returned nil")
            return
        }
        // TEMP crs-debug
        CAPLog.print("[crs] applyRoute routeLayer ok layerID=\(Self.routeLayerID) visible=\(layer.visible)")

        layer.removeRoute(routeID: Self.routeID)

        let points = path.map { MapPoint(longitude: $0.lng, latitude: $0.lat) }
        let styleSetID = routeMode == "walk" ? Self.walkRouteStyleSetID : Self.carRouteStyleSetID
        var option = RouteOptions(routeID: Self.routeID, styleID: styleSetID, zOrder: 0)
        option.segments = [RouteSegment(points: points, styleIndex: 0)]
        // TEMP crs-debug
        CAPLog.print("[crs] applyRoute addRoute attempt segmentPoints=\(points.count) styleSetID=\(styleSetID)")

        guard let route = layer.addRoute(option: option) else {
            // TEMP crs-debug
            CAPLog.print("[crs] applyRoute addRoute FAIL nil route pathCount=\(path.count)")
            return
        }
        // TEMP crs-debug
        CAPLog.print("[crs] applyRoute addRoute ok routeID=\(Self.routeID)")
        route.show()
        layer.visible = true
        map.refresh()
        // TEMP crs-debug
        CAPLog.print("[crs] applyRoute done — route shown layerVisible=\(layer.visible)")

        if fitCamera {
            fitCameraToRoute(points: points, map: map)
        }
    }

    private func ensureRouteLayer(manager: RouteManager) -> RouteLayer? {
        if routeLayer == nil {
            routeLayer = manager.addRouteLayer(layerID: Self.routeLayerID, zOrder: 50)
        }
        routeLayer?.visible = true
        return routeLayer
    }

    private func ensureRouteStyleSet(mode: String, manager: RouteManager) {
        let styleSetID = mode == "walk" ? Self.walkRouteStyleSetID : Self.carRouteStyleSetID
        guard !registeredRouteStyleSetIDs.contains(styleSetID) else { return }

        let color = mode == "walk" ? UIColor(hex: 0x16a34a) : UIColor(hex: 0x1a2a7a)
        let perLevelStyle = PerLevelRouteStyle(
            width: 6,
            color: color,
            strokeWidth: 0,
            strokeColor: .clear,
            level: 0,
            patternIndex: -1
        )
        let routeStyle = RouteStyle(styles: [perLevelStyle])
        let styleSet = RouteStyleSet(styleID: styleSetID, styles: [routeStyle])
        manager.addRouteStyleSet(styleSet)
        registeredRouteStyleSetIDs.insert(styleSetID)
    }

    private func fitCameraToRoute(points: [MapPoint], map: KakaoMap) {
        guard points.count >= 2 else { return }
        let area = AreaRect(points: points)
        let update = CameraUpdate.make(area: area)
        map.animateCamera(
            cameraUpdate: update,
            options: CameraAnimationOptions(autoElevation: true, consecutive: false, durationInMillis: 500)
        )
    }
}

extension KakaoMapTestViewController: MapControllerDelegate {
    func authenticationSucceeded() {
        mapController?.activateEngine()
    }

    func authenticationFailed(_ errorCode: Int, desc: String) {
        CAPLog.print("[PindmapNativeMap][Fullscreen] Kakao auth failed \(errorCode): \(desc)")
    }

    func addViews() {
        let info = MapviewInfo(
            viewName: "mapview",
            viewInfoName: "map",
            defaultPosition: MapPoint(longitude: pendingCamera.lng, latitude: pendingCamera.lat),
            defaultLevel: pendingCamera.zoom
        )
        mapController?.addView(info, viewSize: view.bounds.size)
    }

    func addViewSucceeded(_ viewName: String, viewInfoName: String) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.mapViewReady = true
            // TEMP crs-debug
            CAPLog.print("[crs] addViewSucceeded mapViewReady=true pendingRouteCount=\(self.pendingRoute?.path.count ?? 0)")
            self.syncContainerSize()
            if let map = self.kakaoMapView() {
                NativeMapMarkerStyleHelper.applyFixedScreenMapSettings(on: map)
            }
            self.attachKakaoEventDelegateIfNeeded()
            self.applyInitialContent()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
                // TEMP crs-debug
                CAPLog.print("[crs] addViewSucceeded delayed flushPendingRouteIfNeeded")
                self?.flushPendingRouteIfNeeded()
            }
        }
    }

    func containerDidResized(_ size: CGSize) {
        DispatchQueue.main.async { [weak self] in
            self?.syncContainerSize()
        }
    }
}

extension KakaoMapTestViewController: KakaoMapEventDelegate {
    func cameraDidStopped(kakaoMap: KakaoMap, by: MoveBy) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            guard self.mode == .production else { return }
            guard !self.searchResults.isEmpty else { return }
            guard by != .notUserAction else { return }
            self.showResearchAreaButtonIfNeeded()
        }
    }
}

extension KakaoMapTestViewController: UITableViewDataSource, UITableViewDelegate {
    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        searchResults.count
    }

    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let item = searchResults[indexPath.row]
        let cell = tableView.dequeueReusableCell(withIdentifier: Self.searchResultCellID, for: indexPath)
        cell.textLabel?.text = item.name
        cell.textLabel?.font = .systemFont(ofSize: 16, weight: .semibold)
        cell.textLabel?.numberOfLines = 1
        cell.detailTextLabel?.text = item.address
        cell.detailTextLabel?.textColor = .secondaryLabel
        cell.detailTextLabel?.numberOfLines = 2
        if let category = item.category, !category.isEmpty {
            let renderer = UIGraphicsImageRenderer(size: CGSize(width: 10, height: 10))
            cell.imageView?.image = renderer.image { ctx in
                NativeMapMarkerStyleHelper.markerColor(for: category).setFill()
                ctx.cgContext.fillEllipse(in: CGRect(x: 0, y: 0, width: 10, height: 10))
            }
        } else {
            cell.imageView?.image = nil
        }
        cell.selectionStyle = .default
        return cell
    }

    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        selectSearchResult(searchResults[indexPath.row])
    }
}

extension KakaoMapTestViewController: UITextFieldDelegate {
    func textFieldShouldReturn(_ textField: UITextField) -> Bool {
        if textField === productionSearchField {
            submitFullscreenSearch()
            return false
        }
        return true
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
        CAPPluginMethod(name: "presentNativeMapTest", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "presentFullscreenMap", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "dismissFullscreenMap", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateFullscreenMarkers", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setFullscreenCamera", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setFullscreenRoute", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearFullscreenRoute", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setFullscreenCourseNavigation", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearFullscreenCourseNavigation", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setFullscreenMyLocation", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearFullscreenMyLocation", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setFullscreenSearchResults", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearFullscreenSearchResults", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setFullscreenPlaceSaved", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setFullscreenDirectionsInfo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showFullscreenPlaceSheet", returnType: CAPPluginReturnPromise),
    ]

    private var mapHost: UIView?
    private var touchRouter: MapTouchRouterView?
    private weak var mappedWebView: WKWebView?
    private var fullscreenMapVC: KakaoMapTestViewController?
    private var pluginPendingFullscreenRoute: (path: [(lat: Double, lng: Double)], mode: String)?
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
                        kakao.onMarkerClick = { [weak self] id in
                            CAPLog.print("[PindmapNativeMap] markerClick id=\(id)")
                            self?.notifyListeners("markerClick", data: ["id": id])
                        }
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
        let parsed = Self.parseMarkerInputs(from: call)
        let inputs = parsed.map { (id: $0.id, lat: $0.lat, lng: $0.lng, category: $0.category) }
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
        let prefix = call.getString("prefix")
        DispatchQueue.main.async { [weak self] in
            guard let kakao = self?.mapHost as? KakaoMapHost else {
                call.resolve()
                return
            }
            kakao.clearNativeMarkers(prefix: prefix)
            call.resolve()
        }
    }

    @objc func presentNativeMapTest(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, let bridge = self.bridge else {
                call.reject("bridge unavailable")
                return
            }
            guard !SDKInitializer.GetAppKey().isEmpty else {
                call.reject("Kakao SDK key missing")
                return
            }
            let testVC = KakaoMapTestViewController(mode: .prototype)
            testVC.modalPresentationStyle = .fullScreen
            self.wireFullscreenMapCallbacks(testVC, trackAsProduction: false)
            guard let presenter = self.topViewController(from: bridge) else {
                call.reject("no view controller to present from")
                return
            }
            presenter.present(testVC, animated: true) {
                call.resolve()
            }
        }
    }

    @objc func presentFullscreenMap(_ call: CAPPluginCall) {
        let lat = call.getDouble("lat") ?? 37.5665
        let lng = call.getDouble("lng") ?? 126.978
        let zoom = call.getDouble("zoom") ?? 9.0
        let markers = Self.toMapMarkerInputs(Self.parseMarkerInputs(from: call))

        DispatchQueue.main.async { [weak self] in
            guard let self = self, let bridge = self.bridge else {
                call.reject("bridge unavailable")
                return
            }
            guard !SDKInitializer.GetAppKey().isEmpty else {
                call.reject("Kakao SDK key missing")
                return
            }
            if self.fullscreenMapVC != nil {
                call.resolve()
                return
            }
            let vc = KakaoMapTestViewController(mode: .production)
            vc.modalPresentationStyle = .fullScreen
            vc.configure(lat: lat, lng: lng, zoom: zoom, markers: markers)
            if let pendingRoute = self.pluginPendingFullscreenRoute {
                // TEMP crs-debug
                CAPLog.print("[crs] presentFullscreenMap apply pluginPendingRoute pathCount=\(pendingRoute.path.count) mode=\(pendingRoute.mode)")
                vc.setRoute(path: pendingRoute.path, mode: pendingRoute.mode)
            } else {
                // TEMP crs-debug
                CAPLog.print("[crs] presentFullscreenMap no pluginPendingRoute at present time")
            }
            self.wireFullscreenMapCallbacks(vc, trackAsProduction: true)
            guard let presenter = self.topViewController(from: bridge) else {
                call.reject("no view controller to present from")
                return
            }
            self.fullscreenMapVC = vc
            presenter.present(vc, animated: true) {
                call.resolve()
            }
        }
    }

    @objc func dismissFullscreenMap(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let vc = self?.fullscreenMapVC else {
                call.resolve()
                return
            }
            vc.dismiss(animated: true) {
                self?.fullscreenMapVC = nil
                self?.pluginPendingFullscreenRoute = nil
                call.resolve()
            }
        }
    }

    @objc func updateFullscreenMarkers(_ call: CAPPluginCall) {
        let clearPrefix = call.getString("clearPrefix")
        let markers = Self.toMapMarkerInputs(Self.parseMarkerInputs(from: call))
        DispatchQueue.main.async { [weak self] in
            guard let vc = self?.fullscreenMapVC else {
                call.resolve()
                return
            }
            vc.updateMarkers(markers, clearPrefix: clearPrefix)
            call.resolve()
        }
    }

    @objc func setFullscreenCamera(_ call: CAPPluginCall) {
        let lat = call.getDouble("lat") ?? 37.5665
        let lng = call.getDouble("lng") ?? 126.978
        let zoom = call.getDouble("zoom") ?? 9.0
        let animated = call.getBool("animated") ?? true
        DispatchQueue.main.async { [weak self] in
            guard let vc = self?.fullscreenMapVC else {
                call.resolve()
                return
            }
            vc.setCamera(lat: lat, lng: lng, zoom: zoom, animated: animated)
            call.resolve()
        }
    }

    @objc func setFullscreenRoute(_ call: CAPPluginCall) {
        let path = Self.parseRoutePath(from: call)
        let mode = call.getString("mode") ?? "car"
        let fitCamera = call.getBool("fitCamera") ?? true
        pluginPendingFullscreenRoute = (path, mode)
        let vcExists = fullscreenMapVC != nil
        let mapViewReady = fullscreenMapVC?.isMapViewReadyForDebug ?? false
        // TEMP crs-debug
        CAPLog.print("[crs] setFullscreenRoute plugin entry pathCount=\(path.count) mode=\(mode) vcExists=\(vcExists) mapViewReady=\(mapViewReady) pluginPendingStored=true")
        DispatchQueue.main.async { [weak self] in
            guard let self = self else {
                call.resolve()
                return
            }
            if let vc = self.fullscreenMapVC {
                // TEMP crs-debug
                CAPLog.print("[crs] setFullscreenRoute forwarding to vc pathCount=\(path.count) mapViewReady=\(vc.isMapViewReadyForDebug)")
                vc.setRoute(path: path, mode: mode, fitCamera: fitCamera)
            } else {
                // TEMP crs-debug
                CAPLog.print("[crs] setFullscreenRoute vc nil — only pluginPendingFullscreenRoute stored pathCount=\(path.count)")
            }
            call.resolve()
        }
    }

    @objc func clearFullscreenRoute(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            // TEMP crs-debug
            CAPLog.print("[crs] clearFullscreenRoute pluginPending cleared")
            self?.pluginPendingFullscreenRoute = nil
            self?.fullscreenMapVC?.clearRoute()
            call.resolve()
        }
    }

    @objc func setFullscreenCourseNavigation(_ call: CAPPluginCall) {
        let placeCount = call.getInt("placeCount") ?? 0
        let totalTimeSec = call.getInt("totalTimeSec") ?? 0
        let totalDistanceM = call.getInt("totalDistanceM") ?? 0
        let segments = KakaoMapTestViewController.parseCourseNavigationSegments(from: call)
        let fullPath = Self.parseRoutePath(fromKey: "fullPath", call: call)
        DispatchQueue.main.async { [weak self] in
            self?.fullscreenMapVC?.setCourseNavigation(
                placeCount: placeCount,
                totalTimeSec: totalTimeSec,
                totalDistanceM: totalDistanceM,
                segments: segments,
                fullPath: fullPath
            )
            call.resolve()
        }
    }

    @objc func clearFullscreenCourseNavigation(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.fullscreenMapVC?.clearCourseNavigation()
            call.resolve()
        }
    }

    @objc func setFullscreenMyLocation(_ call: CAPPluginCall) {
        guard let lat = call.getDouble("lat"), let lng = call.getDouble("lng") else {
            call.resolve()
            return
        }
        DispatchQueue.main.async { [weak self] in
            self?.fullscreenMapVC?.setMyLocation(lat: lat, lng: lng)
            call.resolve()
        }
    }

    @objc func clearFullscreenMyLocation(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.fullscreenMapVC?.clearMyLocation()
            call.resolve()
        }
    }

    @objc func setFullscreenSearchResults(_ call: CAPPluginCall) {
        let results = Self.parseSearchResults(from: call)
        DispatchQueue.main.async { [weak self] in
            guard let vc = self?.fullscreenMapVC else {
                call.resolve()
                return
            }
            vc.setSearchResults(results)
            call.resolve()
        }
    }

    @objc func clearFullscreenSearchResults(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.fullscreenMapVC?.clearSearchResults()
            call.resolve()
        }
    }

    private func wireFullscreenMapCallbacks(_ vc: KakaoMapTestViewController, trackAsProduction: Bool) {
        vc.onMarkerClick = { [weak self] id in
            CAPLog.print("[PindmapNativeMap] markerClick id=\(id)")
            self?.notifyListeners("markerClick", data: ["id": id])
        }
        vc.onSearch = { [weak self] query in
            CAPLog.print("[PindmapNativeMap] fullscreenSearch query=\(query)")
            self?.notifyListeners("fullscreenSearch", data: ["query": query])
        }
        vc.onDirections = { [weak self] id, lat, lng, mode in
            self?.notifyListeners("fullscreenDirections", data: ["id": id, "lat": lat, "lng": lng, "mode": mode])
        }
        vc.onToggleSave = { [weak self] id in
            self?.notifyListeners("fullscreenToggleSave", data: ["id": id])
        }
        vc.onCuration = { [weak self] id, postId in
            self?.notifyListeners("fullscreenCuration", data: ["id": id, "postId": postId])
        }
        vc.onOpenExternal = { [weak self] id, type in
            self?.notifyListeners("fullscreenOpenExternal", data: ["id": id, "type": type])
        }
        vc.onImageLightbox = { [weak self] url in
            self?.notifyListeners("fullscreenImageLightbox", data: ["url": url])
        }
        vc.onResearchArea = { [weak self] lat, lng in
            self?.notifyListeners("fullscreenResearchArea", data: ["lat": lat, "lng": lng])
        }
        vc.onPlaceDetail = { [weak self] id in
            self?.notifyListeners("fullscreenPlaceDetail", data: ["id": id])
        }
        if trackAsProduction {
            vc.onDismiss = { [weak self] in
                self?.fullscreenMapVC = nil
                self?.pluginPendingFullscreenRoute = nil
                self?.notifyListeners("fullscreenMapDismissed", data: [:])
            }
        }
    }

    private func topViewController(from bridge: CAPBridgeProtocol) -> UIViewController? {
        var top = bridge.viewController
        while let presented = top?.presentedViewController {
            top = presented
        }
        return top
    }

    @objc func setFullscreenPlaceSaved(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            call.reject("id required")
            return
        }
        let saved = call.getBool("saved") ?? false
        DispatchQueue.main.async { [weak self] in
            self?.fullscreenMapVC?.setPlaceSaved(markerId: id, saved: saved)
            call.resolve()
        }
    }

    @objc func setFullscreenDirectionsInfo(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            call.reject("id required")
            return
        }
        guard let duration = Self.intValue(call.options["duration"]),
              let distance = Self.intValue(call.options["distance"]) else {
            call.reject("duration and distance required")
            return
        }
        DispatchQueue.main.async { [weak self] in
            self?.fullscreenMapVC?.setDirectionsInfo(markerId: id, durationSec: duration, distanceM: distance)
            call.resolve()
        }
    }

    @objc func showFullscreenPlaceSheet(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            call.reject("id required")
            return
        }
        DispatchQueue.main.async { [weak self] in
            self?.fullscreenMapVC?.showPlaceSheet(for: id)
            call.resolve()
        }
    }

    private static func toMapMarkerInputs(
        _ tuples: [(id: String, lat: Double, lng: Double, category: String?, title: String?, address: String?, photos: [String], postCount: Int, isSaved: Bool, photoPostIds: [String], order: Int?)]
    ) -> [KakaoMapTestViewController.MapMarkerInput] {
        tuples.map {
            KakaoMapTestViewController.MapMarkerInput(
                id: $0.id,
                lat: $0.lat,
                lng: $0.lng,
                category: $0.category,
                title: $0.title,
                address: $0.address,
                photos: $0.photos,
                postCount: $0.postCount,
                isSaved: $0.isSaved,
                photoPostIds: $0.photoPostIds,
                order: $0.order
            )
        }
    }

    private static func parseRoutePath(from call: CAPPluginCall) -> [(lat: Double, lng: Double)] {
        parseRoutePath(fromKey: "path", call: call)
    }

    private static func parseRoutePath(fromKey key: String, call: CAPPluginCall) -> [(lat: Double, lng: Double)] {
        guard let raw = call.options[key] as? [[String: Any]] else { return [] }
        var out: [(lat: Double, lng: Double)] = []
        for dict in raw {
            guard let lat = doubleValue(dict["lat"]), let lng = doubleValue(dict["lng"]) else { continue }
            out.append((lat: lat, lng: lng))
        }
        return out
    }

    private static func parseSearchResults(from call: CAPPluginCall) -> [KakaoMapTestViewController.SearchResultInput] {
        guard let raw = call.options["results"] as? [[String: Any]] else { return [] }
        var out: [KakaoMapTestViewController.SearchResultInput] = []
        for dict in raw {
            guard let id = dict["id"] as? String else { continue }
            guard let lat = doubleValue(dict["lat"]), let lng = doubleValue(dict["lng"]) else { continue }
            let name = dict["name"] as? String ?? ""
            let address = dict["address"] as? String ?? ""
            let category = dict["category"] as? String
            out.append(KakaoMapTestViewController.SearchResultInput(
                id: id,
                name: name,
                address: address,
                lat: lat,
                lng: lng,
                category: category
            ))
        }
        return out
    }

    private static func parseMarkerInputs(from call: CAPPluginCall) -> [(id: String, lat: Double, lng: Double, category: String?, title: String?, address: String?, photos: [String], postCount: Int, isSaved: Bool, photoPostIds: [String], order: Int?)] {
        guard let raw = call.options["markers"] as? [[String: Any]] else { return [] }
        var out: [(id: String, lat: Double, lng: Double, category: String?, title: String?, address: String?, photos: [String], postCount: Int, isSaved: Bool, photoPostIds: [String], order: Int?)] = []
        for dict in raw {
            guard let id = dict["id"] as? String else { continue }
            guard let lat = doubleValue(dict["lat"]), let lng = doubleValue(dict["lng"]) else { continue }
            let category = dict["category"] as? String
            let title = dict["title"] as? String
            let address = dict["address"] as? String
            let photos = (dict["photos"] as? [String])?.filter { !$0.isEmpty } ?? []
            let postCount = intValue(dict["postCount"]) ?? 0
            let isSaved = dict["isSaved"] as? Bool ?? false
            let photoPostIds = (dict["photoPostIds"] as? [String]) ?? []
            let order = intValue(dict["order"])
            out.append((id: id, lat: lat, lng: lng, category: category, title: title, address: address, photos: photos, postCount: postCount, isSaved: isSaved, photoPostIds: photoPostIds, order: order))
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
        if let s = value as? String { return Double(s) }
        if let n = value as? NSNumber { return n.doubleValue }
        if let d = value as? Double { return d }
        return nil
    }

    private static func intValue(_ value: Any?) -> Int? {
        if let s = value as? String { return Int(s) }
        if let n = value as? NSNumber { return n.intValue }
        if let i = value as? Int { return i }
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

private extension UIColor {
    convenience init(hex: UInt32) {
        let r = CGFloat((hex >> 16) & 0xFF) / 255.0
        let g = CGFloat((hex >> 8) & 0xFF) / 255.0
        let b = CGFloat(hex & 0xFF) / 255.0
        self.init(red: r, green: g, blue: b, alpha: 1.0)
    }
}
