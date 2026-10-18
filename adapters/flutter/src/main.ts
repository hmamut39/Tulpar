#!/usr/bin/env node
// Tulpar adapter for Flutter (Dart). Speaks the adapter protocol on stdio; uses the Flutter SDK as a tool.

import { PROTOCOL_VERSION, serve, type ProjectParams } from "@tulpar/core";
import { indexWidgets } from "./components.ts";
import { flutterBin } from "./sdk.ts";
import { readTokens, type SpacingConfig, type ThemeConfig } from "./tokens.ts";
import { formatDart } from "./format.ts";
import { runWidgetTests } from "./tests.ts";
import { analyze, build, render } from "./verify.ts";
import { closeBrowser } from "./web.ts";

interface Config {
  /** The design system's library, e.g. "package:flutter/material.dart" (the default). */
  library?: string;
  theme?: ThemeConfig;
  spacing?: SpacingConfig;
}

const config = (p: ProjectParams) => p.config as Config;
const library = (p: ProjectParams) => config(p).library ?? "package:flutter/material.dart";
const sdkFound = !!flutterBin();

serve({
  initialize: () => ({
    id: "flutter",
    protocolVersion: PROTOCOL_VERSION,
    detects: ["pubspec.yaml:flutter"],
    capabilities: {
      index: sdkFound,
      tokens: sdkFound,
      links: false,
      emit: false,
      build: sdkFound,
      render: sdkFound ? { supported: true, hostOS: ["linux", "windows", "macos"] } : { supported: false, hostOS: [], reason: "the Flutter SDK is not installed (set TULPAR_FLUTTER_SDK)" },
      // Flutter paints a canvas: styles come from the analyzer reading the code, not from the render.
      runtimeStyleProvenance: false,
      staticProvenance: true,
      // flutter test --platform chrome does not connect back to its runner on Windows.
      tests: sdkFound && process.platform !== "win32",
      forceStates: [],
      themes: false,
      format: sdkFound,
    },
  }),

  index: (params) => indexWidgets(params.root, library(params)),

  tokens: (params) => readTokens(params.root, config(params).theme, config(params).spacing),

  build: (params) => build(params, config(params).theme),

  render: (params) => render(params, config(params).spacing?.class),

  analyze: (params) => analyze(params.root, params.entry, config(params).spacing?.class),

  test: (params) => runWidgetTests(params.root, params.entry),

  format: async (params) => ({ files: await formatDart(params.root, params.files) }),

  conventions: (params) => {
    const lib = library(params);
    const spacing = config(params).spacing;
    return {
      language: "Dart",
      framework: `Flutter with ${lib === "package:flutter/material.dart" ? "Material 3" : lib}`,
      files: [
        { path: "{snake}.dart", role: "component", description: "The widget: a StatelessWidget (a StatefulWidget only for local UI state) named {name}, with const constructor `const {name}({super.key})` and no required parameters; it renders the whole design." },
        { path: "{snake}_test.dart", role: "test", description: "Widget tests (flutter_test): it builds inside MaterialApp, shows the design's text, and uses the design-system widgets." },
      ],
      entry: "{snake}.dart",
      rules: [
        `Use the design system's widgets from ${lib} for every mapped instance (FilledButton, OutlinedButton, TextField, Checkbox, Card…), with the parameters the mapping gives. Never rebuild one from Container, DecoratedBox or GestureDetector.`,
        "Wrap the root and every widget that renders a Figma instance or text layer in Semantics(identifier: '<figma id>', child: …), using the ids in the outline: that is how the verifier finds each one. It changes nothing users see or hear.",
        "Colours come only from the theme: Theme.of(context).colorScheme.<role> (primary, onPrimary, surface, onSurface, outline…). Never Color(0x…), Colors.<name> or Color.fromARGB.",
        "Text styles come only from the theme: Theme.of(context).textTheme.<style> (titleLarge, bodyMedium, labelLarge…), with .copyWith(color: <a colorScheme role>) when the colour differs. Never a numeric fontSize, fontWeight, height or letterSpacing.",
        spacing
          ? `Spacing and sizes come from the app's scale: ${spacing.class}.<step> (import '${spacing.import}'), in EdgeInsets, SizedBox gaps and BorderRadius. Never a bare number other than 0.`
          : "Spacing: prefer the layout widgets' own spacing (Row/Column spacing, ListTile) over bare numbers.",
        "A text field's placeholder is decoration: InputDecoration(hintText: '…'); a label drawn above it is its own Text (or InputDecoration(labelText:) when the design floats it inside the border); a value shown in it goes in a TextEditingController(text: '…').",
        "Do not give the widget a fixed width or height from the frame: fill the space the parent gives (Expanded, Flexible, mainAxisSize).",
        "Import package:flutter/material.dart and the project's own files by package: URI; no other packages.",
        "Write const constructors and const widgets wherever possible, as dart analyze would ask.",
        "In {snake}_test.dart import package:flutter/material.dart, package:flutter_test/flutter_test.dart and the widget by a relative import ('{snake}.dart'); pump it inside MaterialApp(home: Scaffold(body: {name}())) and query with find.byType, find.text and find.bySemanticsIdentifier. The tests run in a browser: no dart:io.",
      ],
      importExample: "import 'package:flutter/material.dart';",
    };
  },

  links: () => ({ adapter: "flutter", links: [], gaps: ["Flutter has no Code Connect files to read yet."] }),

  shutdown: async () => {
    await closeBrowser();
    return null;
  },
});
