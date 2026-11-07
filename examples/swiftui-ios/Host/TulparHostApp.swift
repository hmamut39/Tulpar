import SwiftUI

/// Shows the generated view at the frame's size, at the top left of the screen, with nothing drawn over it.
@main
struct TulparHostApp: App {
    var body: some Scene {
        WindowGroup {
            ZStack(alignment: .topLeading) {
                Color(uiColor: .systemBackground)
                Probe()
                    .frame(width: TulparFrame.width, height: TulparFrame.height, alignment: .topLeading)
                    .clipped()
            }
            .ignoresSafeArea()
            .statusBarHidden(true)
        }
    }
}
