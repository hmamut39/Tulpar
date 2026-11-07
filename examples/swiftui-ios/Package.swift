// swift-tools-version: 6.0
// A SwiftUI package the way Tulpar checks generated views: the view in Generated, drawn by RenderTests in the iPhone
// simulator, which writes what it drew (each accessibilityIdentifier with its frame and text) and a picture.
import PackageDescription

let package = Package(
    name: "TulparSwiftUI",
    platforms: [.iOS(.v17)],
    targets: [
        .target(name: "Generated", path: "Sources/Generated"),
        .testTarget(name: "RenderTests", dependencies: ["Generated"], path: "Tests/RenderTests"),
    ]
)
