import XCTest

/// Launches the host app, then writes every element with an accessibilityIdentifier (its frame, label, value and kind)
/// and a screenshot of the screen to TULPAR_OUT (default /tmp/tulpar-out).
final class RenderUITests: XCTestCase {
    @MainActor
    func testRender() throws {
        let app = XCUIApplication()
        app.launch()
        _ = app.wait(for: .runningForeground, timeout: 30)
        Thread.sleep(forTimeInterval: 1.0)

        var nodes: [[String: Any]] = []
        func visit(_ s: XCUIElementSnapshot) {
            if !s.identifier.isEmpty {
                nodes.append([
                    "id": s.identifier,
                    "label": s.label,
                    "value": (s.value as? String) ?? "",
                    "placeholder": s.placeholderValue ?? "",
                    "type": s.elementType.rawValue,
                    "x": s.frame.origin.x, "y": s.frame.origin.y, "width": s.frame.size.width, "height": s.frame.size.height,
                ])
            }
            for c in s.children { visit(c) }
        }
        visit(try app.snapshot())

        let out = ProcessInfo.processInfo.environment["TULPAR_OUT"] ?? "/tmp/tulpar-out"
        try FileManager.default.createDirectory(atPath: out, withIntermediateDirectories: true)
        let shot = XCUIScreen.main.screenshot()
        try shot.pngRepresentation.write(to: URL(fileURLWithPath: "\(out)/render.png"))
        let json = try JSONSerialization.data(withJSONObject: ["nodes": nodes, "scale": shot.image.scale], options: [.prettyPrinted])
        try json.write(to: URL(fileURLWithPath: "\(out)/render.json"))
        print("TULPAR wrote \(nodes.count) nodes to \(out)")
    }
}
