# Flutter example: Material 3

Tulpar's first Flutter project (see [docs/16-flutter.md](../../docs/16-flutter.md)). `lib/impl/modal_actions.dart`
is a hand-written reference widget for the Figma frame the other examples use; `lib/main.dart` is the
harness that shows a widget at the frame's size with semantics on, so each `Semantics(identifier:)`
becomes a measurable element in the page.

```sh
flutter build web --release --no-web-resources-cdn --dart-define=FRAME_WIDTH=640 --dart-define=FRAME_HEIGHT=64
```

`--no-web-resources-cdn` bundles Flutter's engine: the render's browser has no network.
