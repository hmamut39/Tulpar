// A Flutter app's tokens: its theme's colour roles and type scale, read where Flutter computes them
// (a probe app run in the sandboxed browser), and its spacing constants, read with the analyzer.
// Code refers to them as Theme.of(context).colorScheme.primary, Theme.of(context).textTheme.titleLarge
// and Space.md.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Color, DesignToken, TokenSet } from "@tulpar/core";
import { dartTool, fingerprint, sdk } from "./sdk.ts";
import { WEB_BUILD } from "./verify.ts";
import { withBuild } from "./web.ts";

export interface ThemeConfig {
  /** A Dart import that brings the app's theme into scope, e.g. "package:my_app/theme.dart". */
  import?: string;
  /** The ThemeData expression, e.g. "appTheme" or "ThemeData(useMaterial3: true)" (the default). */
  expression?: string;
  /** The file the theme is written in, relative to the root: a change to it reads the theme again. */
  file?: string;
}

export interface SpacingConfig {
  /** The file declaring the spacing constants, relative to the project root, e.g. "lib/spacing.dart". */
  file: string;
  /** The class holding them, e.g. "Space". */
  class: string;
  /** How code imports it, e.g. "package:my_app/spacing.dart". */
  import: string;
}

const provenance = (source: string) => ({ source, confidence: "high" as const });

export async function readTokens(root: string, theme: ThemeConfig = {}, spacing?: SpacingConfig): Promise<TokenSet> {
  const gaps: string[] = [];
  const tokens: DesignToken[] = [];
  try {
    const probed = await probeTheme(root, theme);
    for (const [role, argb] of Object.entries(probed.colors)) {
      tokens.push({ name: `colorScheme.${role}`, path: ["colorScheme", role], type: "color", values: { default: { kind: "color", color: argbColor(argb) } }, codeRef: `Theme.of(context).colorScheme.${role}`, provenance: provenance("flutter-theme-probe") });
    }
    for (const [style, s] of Object.entries(probed.text)) {
      if (s.fontSize == null) continue;
      tokens.push({
        name: `textTheme.${style}`,
        path: ["textTheme", style],
        type: "typography",
        description: [`${s.fontSize}px`, s.fontWeight && `weight ${s.fontWeight}`, s.height && `line height ${s.height}`, s.letterSpacing && `letter spacing ${s.letterSpacing}`].filter(Boolean).join(", "),
        values: { default: { kind: "dimension", points: s.fontSize } },
        codeRef: `Theme.of(context).textTheme.${style}`,
        provenance: provenance("flutter-theme-probe"),
      });
    }
  } catch (err) {
    gaps.push(`The theme was not read: ${(err as Error).message.split("\n")[0]}`);
  }
  if (spacing) {
    try {
      const values = await dartTool<Record<string, number>>("constants", [root, join(root, spacing.file), spacing.class], root, `${spacing.class}\n${fingerprint(root, spacing.file, "pubspec.lock")}`);
      for (const [name, points] of Object.entries(values)) {
        tokens.push({ name: `${spacing.class}.${name}`, path: [spacing.class, name], type: "dimension", values: { default: { kind: "dimension", points } }, codeRef: `${spacing.class}.${name}`, codeRefConfirmed: true, provenance: provenance("dart-analyzer") });
      }
    } catch (err) {
      gaps.push(`The spacing constants were not read: ${(err as Error).message.split("\n")[0]}`);
    }
  } else gaps.push('No "spacing" class configured: spacing values cannot be checked against a scale.');
  return { adapter: "flutter", modes: ["default"], tokens, gaps };
}

interface Probed {
  colors: Record<string, number>;
  text: Record<string, { fontSize?: number; fontWeight?: number; height?: number; letterSpacing?: number; fontFamily?: string }>;
}

/** Builds the probe app with the project's theme, runs it in the sandboxed browser and reads what it reports. Cached per theme and lockfile. */
async function probeTheme(root: string, theme: ThemeConfig): Promise<Probed> {
  const source = probeSource(theme);
  const key = createHash("sha256").update(source).update(fingerprint(root, "pubspec.lock", "pubspec.yaml", ...(theme.file ? [theme.file] : []))).digest("hex").slice(0, 16);
  const cache = join(root, ".tulpar", "cache", `flutter-theme-${key}.json`);
  if (existsSync(cache)) return JSON.parse(readFileSync(cache, "utf8")) as Probed;
  const dir = join(root, ".tulpar", "flutter");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "probe.dart"), source);
  const out = join(dir, "probe-build");
  const built = await sdk("flutter", ["build", "web", ...WEB_BUILD, "-t", ".tulpar/flutter/probe.dart", "-o", ".tulpar/flutter/probe-build"], root);
  if (built.code !== 0) throw new Error(`the probe did not build: ${(built.stdout + built.stderr).split("\n").filter((l) => /error/i.test(l)).slice(0, 3).join(" ")}`);
  const json = await withBuild(out, { width: 200, height: 200 }, async (page) => {
    await page.waitForFunction(() => (window as unknown as { tulparTokens?: string }).tulparTokens, null, { timeout: 30_000 });
    return page.evaluate(() => (window as unknown as { tulparTokens: string }).tulparTokens);
  });
  const probed = JSON.parse(json) as Probed;
  mkdirSync(join(root, ".tulpar", "cache"), { recursive: true });
  writeFileSync(cache, JSON.stringify(probed));
  return probed;
}

function argbColor(argb: number): Color {
  const v = argb >>> 0;
  return { space: "srgb", r: ((v >> 16) & 255) / 255, g: ((v >> 8) & 255) / 255, b: (v & 255) / 255, a: ((v >>> 24) & 255) / 255 };
}

const COLOR_ROLES = ["primary", "onPrimary", "primaryContainer", "onPrimaryContainer", "secondary", "onSecondary", "secondaryContainer", "onSecondaryContainer", "tertiary", "onTertiary", "tertiaryContainer", "onTertiaryContainer", "error", "onError", "errorContainer", "onErrorContainer", "surface", "onSurface", "onSurfaceVariant", "surfaceContainerLowest", "surfaceContainerLow", "surfaceContainer", "surfaceContainerHigh", "surfaceContainerHighest", "outline", "outlineVariant", "inverseSurface", "onInverseSurface", "inversePrimary", "shadow", "scrim"];
const TEXT_STYLES = ["displayLarge", "displayMedium", "displaySmall", "headlineLarge", "headlineMedium", "headlineSmall", "titleLarge", "titleMedium", "titleSmall", "bodyLarge", "bodyMedium", "bodySmall", "labelLarge", "labelMedium", "labelSmall"];

function probeSource(theme: ThemeConfig): string {
  return `// Written by Tulpar: reads the theme's colour roles and type scale at run time, in the browser.
import 'dart:convert';
import 'dart:js_interop';
import 'dart:js_interop_unsafe';

import 'package:flutter/material.dart';
${theme.import ? `import '${theme.import}';\n` : ""}
void main() => runApp(MaterialApp(theme: ${theme.expression ?? "ThemeData(useMaterial3: true)"}, home: const _Probe()));

class _Probe extends StatelessWidget {
  const _Probe();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final c = theme.colorScheme;
    final t = theme.textTheme;
    final colors = <String, Color>{${COLOR_ROLES.map((r) => `'${r}': c.${r}`).join(", ")}};
    final styles = <String, TextStyle?>{${TEXT_STYLES.map((s) => `'${s}': t.${s}`).join(", ")}};
    globalContext['tulparTokens'] = jsonEncode({
      'colors': {for (final e in colors.entries) e.key: e.value.toARGB32()},
      'text': {
        for (final e in styles.entries)
          if (e.value != null)
            e.key: {'fontSize': e.value!.fontSize, 'fontWeight': e.value!.fontWeight?.value, 'height': e.value!.height, 'letterSpacing': e.value!.letterSpacing, 'fontFamily': e.value!.fontFamily},
      },
    }).toJS;
    return const SizedBox.shrink();
  }
}
`;
}
