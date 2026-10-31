// A Compose app's tokens: its theme's colour roles and type scale, read where Compose computes them (a probe
// compiled and run in the sandboxed browser), and its spacing object, read from the source. Code refers to them
// as MaterialTheme.colorScheme.primary, MaterialTheme.typography.titleLarge and Space.md.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Color, DesignToken, TokenSet } from "@tulpar/core";
import { compile, sourceFolder } from "./build.ts";
import { withSite } from "./states.ts";

export interface SpacingConfig {
  /** The file declaring the spacing object, relative to the project root. */
  file: string;
  /** The object holding it, e.g. "Space". */
  object: string;
}

const provenance = (source: string) => ({ source, confidence: "high" as const });

const COLOR_ROLES = ["primary", "onPrimary", "primaryContainer", "onPrimaryContainer", "secondary", "onSecondary", "secondaryContainer", "onSecondaryContainer", "tertiary", "onTertiary", "tertiaryContainer", "onTertiaryContainer", "error", "onError", "errorContainer", "onErrorContainer", "background", "onBackground", "surface", "onSurface", "surfaceVariant", "onSurfaceVariant", "outline", "outlineVariant", "inverseSurface", "inverseOnSurface", "inversePrimary"];
const TEXT_STYLES = ["displayLarge", "displayMedium", "displaySmall", "headlineLarge", "headlineMedium", "headlineSmall", "titleLarge", "titleMedium", "titleSmall", "bodyLarge", "bodyMedium", "bodySmall", "labelLarge", "labelMedium", "labelSmall"];

interface Probed {
  colors: Record<string, number>;
  text: Record<string, { fontSize: number; fontWeight?: number; lineHeight?: number }>;
}

function probeSource(): string {
  const colors = COLOR_ROLES.map((r) => `"\\"${r}\\":" + c.${r}.toArgb()`).join(` + "," + `);
  const text = TEXT_STYLES.map((s) => `"\\"${s}\\":{\\"fontSize\\":" + t.${s}.fontSize.value + ",\\"fontWeight\\":" + (t.${s}.fontWeight?.weight ?: 400) + ",\\"lineHeight\\":" + t.${s}.lineHeight.value + "}"`).join(` + "," + `);
  return `// Written by Tulpar: reads the theme's colour roles and type scale at run time, in the browser.
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.window.ComposeViewport
import kotlinx.browser.document

@OptIn(ExperimentalComposeUiApi::class)
fun main() {
    ComposeViewport(document.getElementById("tulpar-frame")!!) {
        MaterialTheme {
            val c = MaterialTheme.colorScheme
            val t = MaterialTheme.typography
            SideEffect { document.title = "{\\"colors\\":{" + ${colors} + "},\\"text\\":{" + ${text} + "}}" }
        }
    }
}
`;
}

function argbColor(argb: number): Color {
  const v = argb >>> 0;
  return { space: "srgb", r: ((v >> 16) & 255) / 255, g: ((v >> 8) & 255) / 255, b: (v & 255) / 255, a: ((v >>> 24) & 255) / 255 };
}

async function probeTheme(root: string): Promise<Probed> {
  const source = probeSource();
  const key = createHash("sha256").update(source).update(readFileSync(join(root, "build.gradle.kts"))).digest("hex").slice(0, 16);
  const cache = join(root, ".tulpar", "cache", `compose-theme-${key}.json`);
  if (existsSync(cache)) return JSON.parse(readFileSync(cache, "utf8")) as Probed;
  writeFileSync(join(sourceFolder(root), "TulparProbe.kt"), source.replace('"tulpar-frame"', `"${(await import("@tulpar/web-kit")).FRAME_ID}"`));
  const built = await compile(root, "probe", { width: 200, height: 200 });
  if (!built.ok) throw new Error(`the probe did not build: ${built.log.split("\n")[0]}`);
  const json = await withSite(built.artifact as string, { width: 200, height: 200 }, async (page) => {
    await page.waitForFunction(() => document.title.startsWith("{"), null, { timeout: 60_000 });
    return page.title();
  });
  const probed = JSON.parse(json) as Probed;
  mkdirSync(join(root, ".tulpar", "cache"), { recursive: true });
  writeFileSync(cache, JSON.stringify(probed));
  return probed;
}

/** `val md = 12.dp` lines of the spacing object. */
export function spacingValues(source: string): Record<string, number> {
  return Object.fromEntries([...source.matchAll(/\bval\s+(\w+)\s*=\s*(\d+(?:\.\d+)?)\.dp\b/g)].map((m) => [m[1]!, Number(m[2])]));
}

export async function readTokens(root: string, spacing?: SpacingConfig): Promise<TokenSet> {
  const gaps: string[] = [];
  const tokens: DesignToken[] = [];
  try {
    const probed = await probeTheme(root);
    for (const [role, argb] of Object.entries(probed.colors)) {
      tokens.push({ name: `colorScheme.${role}`, path: ["colorScheme", role], type: "color", values: { default: { kind: "color", color: argbColor(argb) } }, codeRef: `MaterialTheme.colorScheme.${role}`, provenance: provenance("compose-theme-probe") });
    }
    for (const [style, s] of Object.entries(probed.text)) {
      tokens.push({
        name: `typography.${style}`,
        path: ["typography", style],
        type: "typography",
        description: [`${s.fontSize}px`, s.fontWeight && `weight ${s.fontWeight}`, s.lineHeight && `line height ${s.lineHeight}`].filter(Boolean).join(", "),
        values: { default: { kind: "dimension", points: s.fontSize } },
        codeRef: `MaterialTheme.typography.${style}`,
        provenance: provenance("compose-theme-probe"),
      });
    }
  } catch (err) {
    gaps.push(`The theme was not read: ${(err as Error).message.split("\n")[0]}`);
  }
  if (spacing) {
    for (const [name, points] of Object.entries(spacingValues(readFileSync(join(root, spacing.file), "utf8")))) {
      tokens.push({ name: `${spacing.object}.${name}`, path: [spacing.object, name], type: "dimension", values: { default: { kind: "dimension", points } }, codeRef: `${spacing.object}.${name}`, provenance: provenance("kotlin-source") });
    }
  } else gaps.push('No "spacing" object configured: spacing values cannot be checked against a scale.');
  return { adapter: "compose", modes: ["default"], tokens, gaps };
}
