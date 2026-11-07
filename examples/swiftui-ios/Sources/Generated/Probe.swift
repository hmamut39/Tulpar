import SwiftUI

/** A small view for trying the render: the generated view replaces it. */
public struct Probe: View {
    @State private var email = ""

    public init() {}

    public var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Sign in")
                .font(.title2)
                .accessibilityIdentifier("title")
            TextField("name@company.com", text: $email)
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("email")
            Button("Continue") {}
                .buttonStyle(.borderedProminent)
                .accessibilityIdentifier("go")
        }
        .padding(16)
        .accessibilityIdentifier("root")
    }
}
