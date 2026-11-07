import SwiftUI
import UIKit
import XCTest
@testable import Generated

/// Draws the view at the frame's size in a window, then writes every element the accessibility tree has (its
/// identifier, frame, label and kind) and a PNG of the window to TULPAR_OUT (default /tmp/tulpar-out).
@MainActor
final class RenderTests: XCTestCase {
    func testRender() throws {
        let size = CGSize(width: 360, height: 300)
        let host = UIHostingController(rootView: Probe().frame(width: size.width, height: size.height, alignment: .topLeading))
        let window = UIWindow(frame: CGRect(origin: .zero, size: size))
        window.rootViewController = host
        window.makeKeyAndVisible()
        host.view.frame = window.bounds
        host.view.layoutIfNeeded()
        RunLoop.main.run(until: Date().addingTimeInterval(1.5))

        var nodes: [[String: Any]] = []
        func visit(_ element: Any, depth: Int) {
            guard depth < 40, let o = element as? NSObject else { return }
            let id = (o as? UIAccessibilityIdentification)?.accessibilityIdentifier ?? ""
            let frame = o.accessibilityFrame
            if !id.isEmpty || o.isAccessibilityElement {
                nodes.append([
                    "id": id,
                    "label": o.accessibilityLabel ?? "",
                    "value": o.accessibilityValue ?? "",
                    "traits": o.accessibilityTraits.rawValue,
                    "type": String(describing: type(of: o)),
                    "x": frame.origin.x, "y": frame.origin.y, "width": frame.size.width, "height": frame.size.height,
                ])
            }
            if let children = o.accessibilityElements {
                for c in children { visit(c, depth: depth + 1) }
            } else {
                let count = o.accessibilityElementCount()
                if count > 0 && count != NSNotFound {
                    for i in 0..<count { if let c = o.accessibilityElement(at: i) { visit(c, depth: depth + 1) } }
                }
            }
            if let v = o as? UIView { for s in v.subviews { visit(s, depth: depth + 1) } }
        }
        visit(host.view as Any, depth: 0)

        let out = ProcessInfo.processInfo.environment["TULPAR_OUT"] ?? "/tmp/tulpar-out"
        try FileManager.default.createDirectory(atPath: out, withIntermediateDirectories: true)
        let png = UIGraphicsImageRenderer(bounds: window.bounds).pngData { _ in
            _ = window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
        }
        try png.write(to: URL(fileURLWithPath: "\(out)/render.png"))
        let json = try JSONSerialization.data(withJSONObject: ["nodes": nodes, "scale": window.screen.scale], options: [.prettyPrinted])
        try json.write(to: URL(fileURLWithPath: "\(out)/render.json"))
        print("TULPAR wrote \(nodes.count) nodes to \(out)")
    }
}
