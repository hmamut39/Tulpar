// Build: bundle the implementation's module scripts and write the harness page.

import { readFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import type { BuildParams, BuildResult } from "@tulpar/core";
import { bundle, writeHarness, type RenderConfig } from "@tulpar/web-kit";
import { parseImplementation } from "./impl.ts";

export async function build(params: BuildParams, render: RenderConfig): Promise<BuildResult> {
  const { root, entry, frame } = params;
  const impl = parseImplementation(await readFile(join(root, entry), "utf8"));
  const outDir = join(root, ".tulpar", "build", basename(entry).replace(/\.[^.]+$/, ""));
  const code = impl.scripts.map((s) => s.code).join("\n");
  const bundled = await bundle({ code, resolveDir: root, sourcefile: entry, outDir, loader: "js" });
  if (!bundled.ok) return { ok: false, log: bundled.log.join("\n") };
  const css = [...impl.styles.map((s) => s.css), bundled.css].join("\n");
  const harness = await writeHarness({ root, outDir, frame, render, css, markup: impl.markup, script: "bundle.js" });
  return { ok: true, log: [...bundled.log, `built ${relative(root, harness)}`].join("\n"), artifact: harness };
}
