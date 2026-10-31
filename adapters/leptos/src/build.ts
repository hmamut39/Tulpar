// Build: a small Leptos app around the generated component, compiled to WebAssembly and packaged for the
// browser. It uses the project's dependencies at the versions its Cargo.lock pins. The compile keeps its
// output between runs, so only the component is rebuilt.

import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, relative } from "node:path";
import type { BuildParams, BuildResult } from "@tulpar/core";
import { FRAME_ID, IMPL_SOURCE_URL } from "@tulpar/web-kit";
import { forbidden, tool } from "./sdk.ts";

export interface HarnessConfig {
  /** Crates every generated component gets (use …::*), e.g. thaw. */
  uses?: string[];
  /** The component an app has around its pages, e.g. ConfigProvider. */
  provider?: string;
  /** The typeface files to serve, from Fontsource, e.g. { family: "Segoe UI", package: "@fontsource/open-sans", file: "open-sans" }. */
  font?: { family: string; package: string; file: string };
}

const require = createRequire(import.meta.url);

/** The [dependencies] section of the project's Cargo.toml. */
export function dependencies(cargoToml: string): string {
  return /\[dependencies\]\n([\s\S]*?)(?=\n\[|$)/.exec(cargoToml.replace(/\r\n/g, "\n"))?.[1]?.trim() ?? "";
}

/**
 * The compiler's errors, with the file and line and what rustc says about them. rustc prints "error[E…]: what",
 * then "--> file:line:col"; errors that only repeat the count are left out.
 */
export function buildErrors(output: string): string {
  const lines = output.split(/\r?\n/);
  const out: string[] = [];
  for (let i = 0; i < lines.length && out.length < 12; i++) {
    const m = /^error(\[E\d+\])?: (.*)$/.exec(lines[i]!);
    if (!m || /^(could not compile|aborting due to)/.test(m[2]!)) continue;
    const at = /^\s*--> (.*?):(\d+):(\d+)/.exec(lines[i + 1] ?? "");
    const help = lines.slice(i + 2, i + 16).find((l) => /^\s*(= )?help: /.test(l))?.trim().replace(/^= /, "");
    out.push(`${at ? `${at[1]!.split(/[\\/]/).pop()}:${at[2]}:${at[3]}: ` : ""}${m[1] ?? ""}${m[1] ? " " : ""}${m[2]}${help ? ` (${help})` : ""}`);
  }
  return out.join("\n");
}

/** The Rust function a file defines: sign_in_card.rs defines SignInCard. */
export function componentName(source: string, file: string): string {
  return /#\[component\]\s*pub\s+fn\s+([A-Z]\w*)/.exec(source)?.[1] ?? basename(file, ".rs").replace(/(^|_)(\w)/g, (_m, _s, c: string) => c.toUpperCase());
}

export async function build(params: BuildParams, config: HarnessConfig): Promise<BuildResult> {
  const { root, entry, frame } = params;
  const from = dirname(join(root, entry));
  const rustSources = readdirSync(from).filter((f) => f.endsWith(".rs"));
  for (const f of rustSources) {
    const why = forbidden(readFileSync(join(from, f), "utf8"));
    if (why) return { ok: false, log: `${f}: not allowed in a component: ${why}.` };
  }
  const dir = join(root, ".tulpar", "leptos");
  const src = join(dir, "src");
  rmSync(src, { recursive: true, force: true });
  mkdirSync(join(src, "generated"), { recursive: true });
  for (const f of rustSources) cpSync(join(from, f), join(src, "generated", f));
  const modules = rustSources.map((f) => basename(f, ".rs"));
  writeFileSync(join(src, "generated", "mod.rs"), modules.map((m) => `pub mod ${m};\n#[allow(unused_imports)]\npub use ${m}::*;`).join("\n") + "\n");
  const name = componentName(readFileSync(join(root, entry), "utf8"), entry);
  // Sections of a page refer to each other by name: every file sees all the generated components.
  writeFileSync(
    join(src, "main.rs"),
    `mod generated;
use generated::*;
use leptos::prelude::*;
${(config.uses ?? []).map((u) => `use ${u}::*;`).join("\n")}

fn main() {
    let frame = document().get_element_by_id("${FRAME_ID}").unwrap();
    leptos::mount::mount_to(frame.unchecked_into(), || {
        view! { ${config.provider ? `<${config.provider}><${name} /></${config.provider}>` : `<${name} />`} }
    })
    .forget();
}

use leptos::wasm_bindgen::JsCast;
`,
  );
  const toml = readFileSync(join(root, "Cargo.toml"), "utf8");
  // Only what the browser needs: no debug information, which would make the file 200 MB.
  writeFileSync(
    join(dir, "Cargo.toml"),
    `[package]
name = "harness"
version = "0.1.0"
edition = "2021"

[dependencies]
${dependencies(toml)}

[profile.dev]
debug = false
opt-level = 1

[workspace]
`,
  );
  if (existsSync(join(root, "Cargo.lock"))) copyFileSync(join(root, "Cargo.lock"), join(dir, "Cargo.lock"));

  const compiled = await tool("cargo", ["build", "--target", "wasm32-unknown-unknown", "--offline"], dir);
  if (compiled.code !== 0) return { ok: false, log: buildErrors(compiled.stderr) || compiled.stderr.slice(-1500) || `cargo build failed (exit ${compiled.code})` };

  const site = join(dir, "out", basename(entry, ".rs"));
  rmSync(site, { recursive: true, force: true });
  mkdirSync(site, { recursive: true });
  const bound = await tool("wasm-bindgen", [join("target", "wasm32-unknown-unknown", "debug", "harness.wasm"), "--out-dir", relative(dir, site), "--out-name", "app", "--target", "web", "--no-typescript"], dir);
  if (bound.code !== 0) return { ok: false, log: `wasm-bindgen failed: ${bound.stderr.slice(-800)}` };

  // The design system's typeface: the sandbox has no network to fetch it.
  const fonts: string[] = [];
  if (config.font) {
    for (const weight of [400, 500, 600, 700]) {
      try {
        const file = require.resolve(`${config.font.package}/files/${config.font.file}-latin-${weight}-normal.woff2`);
        copyFileSync(file, join(site, basename(file)));
        fonts.push(`@font-face { font-family: ${JSON.stringify(config.font.family)}; font-weight: ${weight}; src: url(${basename(file)}) format("woff2"); }`);
      } catch {
        // that weight is not installed
      }
    }
  }
  const sheets = readdirSync(from).filter((f) => f.endsWith(".css")).map((f) => readFileSync(join(from, f), "utf8")).join("\n");
  writeFileSync(
    join(site, "index.html"),
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>${fonts.join("\n")}
html, body { margin: 0; padding: 0; } #${FRAME_ID} { position: relative; overflow: hidden; width: ${frame.width}px; height: ${frame.height}px; }</style>
<style>${sheets}
/*# sourceURL=${IMPL_SOURCE_URL} */</style>
</head>
<body>
<div id="${FRAME_ID}"></div>
<script type="module">import init from "./app.js"; init();</script>
</body>
</html>
`,
  );
  return { ok: true, log: `built ${relative(root, site)}`, artifact: site };
}
