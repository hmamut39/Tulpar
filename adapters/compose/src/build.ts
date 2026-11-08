// Build: a small Compose app around the generated component, compiled to WebAssembly by the project's own Gradle
// build, offline, for checking rather than shipping. Compiling runs nothing: the result runs only in the browser.
// Where this machine has no toolchain, a build machine compiles (TULPAR_COMPOSE_BUILDER) and sends the page back.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import type { BuildParams, BuildResult } from "@tulpar/core";
import { FRAME_ID } from "@tulpar/web-kit";
import { gradle, type Run } from "./sdk.ts";
import { asSource, isTestFile, testDriver, testsIn, UI_TEST_SHIM } from "./tests.ts";

export const DISTRIBUTION_TASK = "wasmJsBrowserDevelopmentExecutableDistribution";
const OUTPUT = join("build", "dist", "wasmJs", "developmentExecutable");

export const builderUrl = (): string | undefined => process.env.TULPAR_COMPOSE_BUILDER || undefined;

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
// A test, when the address names one: it draws what it sets as content instead.
const TEST_MODE = `    tulparTestName()?.let { runTulparTest(it); return }
`;

export function harness(component: string, frame: { width: number; height: number }, withTests = false): string {
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
${withTests ? TEST_MODE : ""}    ComposeViewport(document.getElementById("${FRAME_ID}")!!) {
        MaterialTheme {
            Surface(Modifier.size(${frame.width}.dp, ${frame.height}.dp)) {
                Box { ${component}() }
            }
        }
    }
}
`;
}

export interface RemoteSource {
  name: string;
  content: string;
}

export function writeSources(folder: string, sources: RemoteSource[]): void {
  for (const s of sources) {
    // Only Kotlin files, directly in the folder.
    if (!/^[A-Za-z]\w*\.kt$/.test(s.name)) throw new Error(`not a source file name: ${s.name}`);
    writeFileSync(join(folder, s.name), s.content);
  }
}

/** Compiles the source folder on this machine; the page is in `dir`. */
export async function compileHere(root: string, name: string): Promise<{ ok: true; log: string; dir: string } | { ok: false; log: string }> {
  const run = await gradle([DISTRIBUTION_TASK, "--offline", "--console=plain"], root);
  if (run.code !== 0) return { ok: false, log: failure(run) };
  return { ok: true, log: `built ${name}`, dir: join(root, OUTPUT) };
}

/** Every file of a built page, for sending. */
export function readSite(dir: string): { path: string; base64: string }[] {
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
  return walk(dir).map((f) => ({ path: relative(dir, f).replace(/\\/g, "/"), base64: readFileSync(f).toString("base64") }));
}

async function compileRemote(url: string, root: string, name: string, site: string): Promise<{ ok: boolean; log: string }> {
  const src = sourceDir(root);
  const sources = readdirSync(src).map((f) => ({ name: f, content: readFileSync(join(src, f), "utf8") }));
  let answer: { ok: boolean; log: string; files?: { path: string; base64: string }[] };
  try {
    const res = await fetch(`${url}/compile`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, sources }), signal: AbortSignal.timeout(600_000) });
    answer = (await res.json()) as typeof answer;
  } catch (err) {
    return { ok: false, log: `The Kotlin build machine did not answer: ${(err as Error).message}` };
  }
  if (!answer.ok) return { ok: false, log: answer.log };
  for (const f of answer.files ?? []) {
    const path = join(site, f.path);
    // The build machine is ours, and a path out of the folder still has no business being written.
    if (relative(site, path).startsWith("..")) return { ok: false, log: `The build machine sent an unexpected file: ${f.path}` };
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, Buffer.from(f.base64, "base64"));
  }
  return { ok: true, log: answer.log };
}

/** Compiles the source folder and packages the page; shared with the theme's probe. */
export async function compile(root: string, name: string, frame: { width: number; height: number }): Promise<BuildResult> {
  const site = join(root, ".tulpar", "compose", "out", name);
  rmSync(site, { recursive: true, force: true });
  mkdirSync(site, { recursive: true });
  const url = builderUrl();
  if (url) {
    const remote = await compileRemote(url, root, name, site);
    if (!remote.ok) return { ok: false, log: remote.log };
  } else {
    const here = await compileHere(root, name);
    if (!here.ok) return { ok: false, log: here.log };
    cpSync(here.dir, site, { recursive: true });
  }
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

const sourceDir = (root: string) => join(root, ".tulpar", "compose", "src");

/** Empties the folder Gradle compiles beside the project's own sources. */
export function sourceFolder(root: string): string {
  const src = sourceDir(root);
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
  // Test files compile with the browser's implementation of Compose's test API, and the page runs them by name.
  const tests: string[] = [];
  for (const f of readdirSync(from).filter((x) => x.endsWith(".kt"))) {
    if (!isTestFile(f)) cpSync(join(from, f), join(src, f));
    else {
      const source = readFileSync(join(from, f), "utf8");
      writeFileSync(join(src, f), asSource(source));
      tests.push(...testsIn(source));
    }
  }
  if (tests.length) {
    writeFileSync(join(src, "TulparUiTest.kt"), UI_TEST_SHIM);
    writeFileSync(join(src, "TulparTestDriver.kt"), testDriver(tests));
  }
  const name = basename(entry, ".kt");
  writeFileSync(join(src, "TulparHarness.kt"), harness(name, frame, tests.length > 0));
  return compile(root, name, frame);
}
