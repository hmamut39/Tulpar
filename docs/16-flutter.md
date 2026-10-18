# G11: Flutter (Dart) — plan (2026-10-18)

Flutter is the first framework whose components are not written in TypeScript or JavaScript. It joins
the others under the same rules: the design system's own widgets and tokens, the generated code built,
rendered and checked against the design, and generated code that runs only in the sandboxed browser.

```
checkout_card.dart        the widget (a StatelessWidget, or StatefulWidget when it holds state)
checkout_card_test.dart   widget tests (flutter_test)
```

## How each part works

| Part | How |
|---|---|
| **Adapter** | `adapters/flutter`, a TypeScript program like the others, speaking the same protocol. It calls the Flutter SDK (`flutter`, `dart`) as tools; it never loads generated Dart into Node. |
| **Index** | The design system's widgets and their constructor parameters (named, required, types, defaults), read from the package's Dart source with a small Dart program on the analyzer (`package:analyzer`), not with regular expressions. First design system: **Material 3** (`package:flutter/material.dart`), the one every Flutter app has. |
| **Tokens** | Material 3's colour roles (`ColorScheme.primary`, `onSurface`…), type scale (`TextTheme.titleLarge`…) and the app's spacing constants, written in code as `Theme.of(context).colorScheme.primary`. A hard-coded `Color(0xFF…)`, `TextStyle(fontSize: 14)` or `EdgeInsets.all(13)` is a finding, as in CSS. |
| **Build** | `flutter build web` on a small harness app that shows the generated widget at the frame's size. Compiling does not run the code. |
| **Render and measure** | The harness turns semantics on (`SemanticsBinding.instance.ensureSemantics()`), and the generated code puts `Semantics(identifier: '<figma id>')` where web components put `data-figma-id`. Flutter's web engine writes each semantics node into the page as a positioned element carrying that identifier, so layout, text and placement are measured as for the other frameworks, in headless Chromium with the network blocked. Which widget drew each node comes from a debug-mode hook in the harness. |
| **Pixels** | A screenshot of the canvas, compared with Figma's picture of the frame as today. |
| **Static scan** | The Dart analyzer over the generated file: colours, text styles and paddings written as literals instead of theme tokens, and widgets re-created from `Container`s instead of the design system's. |
| **Tests** | `flutter test --platform chrome`: the widget tests run inside Chromium, never on the host, which keeps Tulpar's rule for generated code. |
| **Conventions** | Dart's file naming (`snake_case.dart`), `const` constructors, a `Key`-free public API with no required parameters, `dart format` applied to the output (as Prettier is for the web frameworks). |

## Hosting

The Flutter SDK is large (about 1.5 GB unpacked, with the web engine). It goes in its own image layer,
installed from Google's signed release archive with its SHA-256 checked, and only the web target is
precached. The smoke test in CI builds and tests one widget inside the image, as it does for the
five web frameworks.

## Order

1. SDK and an example project (Material 3); build and render a hand-written widget; measure it through semantics identifiers.
2. Index Material's widgets with the analyzer; tokens from the theme.
3. Conventions and generation; the static scan; `dart format`.
4. Widget tests in Chrome.
5. The image, CI smoke test, the web page (Flutter selectable, "Dart" as its language), the eval case.
