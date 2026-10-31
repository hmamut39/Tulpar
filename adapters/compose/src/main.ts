#!/usr/bin/env node
// Tulpar adapter for Jetpack Compose (Kotlin), through Compose Multiplatform. Speaks the adapter protocol on stdio;
// uses the JDK and Gradle as tools. The same Kotlin runs on Android; here it is checked as WebAssembly in the browser.

import { PROTOCOL_VERSION, serve, type ProjectParams } from "@tulpar/core";
import { build } from "./build.ts";
import { indexComponents } from "./components.ts";
import { toolchainFound } from "./sdk.ts";
import { closeBrowser } from "./states.ts";
import { readTokens, type SpacingConfig } from "./tokens.ts";
import { analyze, render } from "./verify.ts";

interface Config {
  library?: { module: string; name: string; version: string };
  spacing?: SpacingConfig;
  rules?: string[];
}

const config = (p: ProjectParams) => p.config as Config;
const MATERIAL3 = { module: "androidx.compose.material3", name: "Compose Material 3", version: "1.9.0" };
const library = (p: ProjectParams) => config(p).library ?? MATERIAL3;
const found = toolchainFound();

serve({
  initialize: () => ({
    id: "compose",
    protocolVersion: PROTOCOL_VERSION,
    detects: ["build.gradle.kts:org.jetbrains.compose"],
    capabilities: {
      index: found,
      tokens: found,
      links: false,
      emit: false,
      build: found,
      render: found ? { supported: true, hostOS: ["linux", "windows", "macos"] } : { supported: false, hostOS: [], reason: "the JDK and Gradle are not installed (set TULPAR_JAVA_HOME and TULPAR_GRADLE_HOME)" },
      // Compose paints a canvas: styles come from reading the code, not from the render.
      runtimeStyleProvenance: false,
      staticProvenance: true,
      tests: false,
      forceStates: found ? ["hover", "pressed", "focus"] : [],
      themes: false,
    },
  }),

  index: (params) => indexComponents(params.root, library(params)),

  tokens: (params) => readTokens(params.root, config(params).spacing),

  build: (params) => build(params),

  render: (params) => render(params),

  analyze: (params) => analyze(params.root, params.entry, config(params).spacing?.object),

  conventions: (params) => {
    const spacing = config(params).spacing;
    return {
      language: "Kotlin",
      framework: `Jetpack Compose with ${library(params).name}`,
      files: [{ path: "{name}.kt", role: "component", description: "The component: @Composable fun {name}() with no required parameters and no package line; it renders the whole design." }],
      entry: "{name}.kt",
      rules: [
        "Use Material 3's composables (Button, OutlinedButton, TextField, OutlinedTextField, Checkbox, Card, Text…) for every mapped instance, with the parameters the mapping gives. Never rebuild one from Box and clickable. Every composable's required parameters must be given: a Button needs onClick = {}.",
        'Instead of data-figma-id, put Modifier.testTag("<figma id>") on the root and on every composable that renders a Figma instance or text layer, using the ids in the outline: that is how the verifier finds each one. The tag goes in the composable\'s own modifier parameter. Do not tag a Text inside a Button: a button merges its text, so the tag goes on the Button.',
        "Colours come only from the theme: MaterialTheme.colorScheme.<role> (primary, onPrimary, surface, onSurface, outline…). Never Color(0x…) or Color.Red.",
        "Text styles come only from the theme: MaterialTheme.typography.<style> (titleLarge, bodyMedium, labelLarge…), with color = MaterialTheme.colorScheme.<role> when the colour differs. Never fontSize, fontWeight, lineHeight or a FontFamily.",
        spacing ? `Spacing and sizes come from the app's scale: ${spacing.object}.<step> (no import needed), in Modifier.padding, Arrangement.spacedBy and Spacer. Never a bare .dp other than 0.dp.` : "Spacing: prefer the layout's own arrangement over bare numbers.",
        "State is remembered: var email by remember { mutableStateOf(\"\") }, passed as value = email, onValueChange = { email = it }. A label inside a field's border is label = { Text(\"…\") }; a placeholder is placeholder = { Text(\"…\") }; a label drawn above it is its own Text. A one-line field has singleLine = true, or the Tab key stays inside it and keyboard users cannot leave.",
        "Do not give the root a fixed size from the frame: Modifier.fillMaxWidth() and the content's own height.",
        "Import each name you use: androidx.compose.material3.*, androidx.compose.foundation.layout.*, androidx.compose.runtime.*, androidx.compose.ui.Modifier, androidx.compose.ui.platform.testTag, androidx.compose.ui.Alignment. Only these and androidx.compose.ui.unit.dp; no other libraries, no package line, no main function. An @ExperimentalMaterial3Api composable needs @OptIn(ExperimentalMaterial3Api::class) on the function.",
        ...(config(params).rules ?? []),
      ],
      importExample: "import androidx.compose.material3.Button",
    };
  },

  links: () => ({ adapter: "compose", links: [], gaps: ["Compose has no Code Connect files to read yet."] }),

  shutdown: async () => {
    await closeBrowser();
    return null;
  },
});
