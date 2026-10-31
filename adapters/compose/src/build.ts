// Build: a small Compose app around the generated component, compiled to WebAssembly by the project's own Gradle
// build, offline, for checking rather than shipping. Compiling runs nothing: the result runs only in the browser.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { BuildParams, BuildResult } from "@tulpar/core";
import { FRAME_ID } from "@tulpar/web-kit";
import { gradle, type Run } from "./sdk.ts";

export const DISTRIBUTION_TASK = "wasmJsBrowserDevelopmentExecutableDistribution";
const OUTPUT = join("build", "dist", "wasmJs", "developmentExecutable");

/** Kotlin reports "e: file:///…/Card.kt:12:5 Unresolved reference 'x'.": the file's name, line and message. */
export function buildErrors(output: string): string {
  const out: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    const m = /^e: (?:file:\/+)?(.*?\.kts?):(\d+):(\d+) (.*)$/.exec(line.trim());
    if (m) out.push(`${m[1]!.split(/[\\/]/).pop()}:${m[2]}:${m[3]}: ${m[4]}`);
    if (out.length === 12) break;
  }
  return out.join("\n");
}

/** Gradle's one-line reason, when no compiler error was reported. */
const failure = (run: Run) => buildErrors(run.stdout + "\n" + run.stderr) || run.stderr.split(/\r?\n/).filter((l) => l.trim()).slice(0, 6).join(" ").slice(0, 1500) || `gradle failed (exit ${run.code})`;

/** The app around a component: its theme, on the app's surface, at the frame's size. */
export function harness(component: string, frame: { width: number; height: number }): string {
  return `// Written by Tulpar: shows one component at the Figma frame's size.
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.ComposeViewport
import kotlinx.browser.document

@OptIn(ExperimentalComposeUiApi::class)
fun main() {
    ComposeViewport(document.getElementById("${FRAME_ID}")!!) {
        MaterialTheme {
            Surface(Modifier.size(${frame.width}.dp, ${frame.height}.dp)) {
                Box { ${component}() }
            }
        }
    }
}
`;
}

/** Compiles the source folder and packages the page; shared with the theme's probe. */
export async function compile(root: string, name: string, frame: { width: number; height: number }): Promise<BuildResult> {
  const run = await gradle([DISTRIBUTION_TASK, "--offline", "--console=plain"], root);
  if (run.code !== 0) return { ok: false, log: failure(run) };
  const site = join(root, ".tulpar", "compose", "out", name);
  rmSync(site, { recursive: true, force: true });
  mkdirSync(site, { recursive: true });
  cpSync(join(root, OUTPUT), site, { recursive: true });
  writeFileSync(
    join(site, "index.html"),
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Tulpar</title>
<style>html, body { margin: 0; padding: 0; } #${FRAME_ID} { position: relative; overflow: hidden; width: ${frame.width}px; height: ${frame.height}px; }</style>
<script src="app.js"></script>
</head>
<body><div id="${FRAME_ID}"></div></body>
</html>
`,
  );
  return { ok: true, log: `built ${name}`, artifact: site };
}

/** Empties the folder Gradle compiles beside the project's own sources. */
export function sourceFolder(root: string): string {
  const src = join(root, ".tulpar", "compose", "src");
  rmSync(src, { recursive: true, force: true });
  mkdirSync(src, { recursive: true });
  return src;
}

export async function build(params: BuildParams): Promise<BuildResult> {
  const { root, entry, frame } = params;
  const from = dirname(join(root, entry));
  if (!existsSync(join(root, entry))) return { ok: false, log: `${entry} was not written.` };
  const src = sourceFolder(root);
  // Sections of a page refer to each other by name: every generated file compiles together.
  for (const f of readdirSync(from).filter((x) => x.endsWith(".kt"))) cpSync(join(from, f), join(src, f));
  const name = basename(entry, ".kt");
  writeFileSync(join(src, "TulparHarness.kt"), harness(name, frame));
  return compile(root, name, frame);
}
