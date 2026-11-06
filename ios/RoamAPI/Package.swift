// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "RoamAPI",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "RoamAPI", targets: ["RoamAPI"]),
    ],
    targets: [
        .target(name: "RoamAPI"),
        .testTarget(
            name: "RoamAPITests",
            dependencies: ["RoamAPI"],
            resources: [.copy("Fixtures")]
        ),
    ]
)
