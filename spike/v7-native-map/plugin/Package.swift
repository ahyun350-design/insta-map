// swift-tools-version: 5.9
// V-7-0 spike — link from CapApp-SPM on spike/v7-native-map branch only.
import PackageDescription

let package = Package(
    name: "PindmapNativeMap",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "PindmapNativeMap", targets: ["PindmapNativeMapPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.3.1"),
        .package(url: "https://github.com/kakao-mapsSDK/KakaoMapsSDK-SPM.git", from: "2.12.0")
    ],
    targets: [
        .target(
            name: "PindmapNativeMapPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "KakaoMapsSDK-SPM", package: "KakaoMapsSDK-SPM")
            ],
            path: "ios/Sources/PindmapNativeMapPlugin",
            resources: [],
            linkerSettings: [
                .linkedFramework("MapKit")
            ]
        )
    ]
)
