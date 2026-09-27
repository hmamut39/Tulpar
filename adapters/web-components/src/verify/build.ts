// Build: bundle the implementation's module scripts with esbuild and write a harness
// page that holds the implementation at the Figma frame's exact size.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import type { BuildParams, BuildResult } from "@tulpar/core";
import { parseImplementation } from "./impl.ts";

export interface RenderConfig {
  /** Stylesheets every page needs (theme, fonts), relative to the project root. */
  stylesheets?: string[];
  /** Font families the render must have loaded, or it warns that text metrics are untrustworthy. */
  fonts?: string[];
  /** CSS class that applies a theme, per theme name, e.g. { "g10": "cds--g10" }. */
  themes?: Record<string, string>;
}

/** Marks the implementation's own stylesheet, so the renderer can tell it from design-system CSS. */
export const IMPL_SOURCE_URL = "tulpar-implementation.css";
export const FRAME_ID = "tulpar-frame";

export async function build(params: BuildParams, render: RenderConfig): Promise<BuildResult> {
  const { root, entry, frame } = params;
  const html = await readFile(join(root, entry), "utf8");
  const impl = parseImplementation(html);
  const outDir = join(root, ".tulpar", "build", basename(entry).replace(/\.[^.]+$/, ""));
  await mkdir(outDir, { recursive: true });

  const logs: string[] = [];
  try {
    const result = await esbuild.build({
      stdin: { contents: impl.scripts.map((s) => s.code).join("\n"), resolveDir: root, sourcefile: entry, loader: "js" },
      bundle: true,
      format: "iife",
      target: "es2022",
      outfile: join(outDir, "bundle.js"),
      logLevel: "silent",
      write: true,
    });
    logs.push(...result.warnings.map((w) => `warning: ${w.text}`));
  } catch (err) {
    const errors = (err as esbuild.BuildFailure).errors ?? [];
    const log = errors.length ? errors.map((e) => `${e.location ? `${e.location.file}:${e.location.line}: ` : ""}${e.text}`).join("\n") : String(err);
    return { ok: false, log };
  }

  const links = (render.stylesheets ?? []).map((s) => `<link rel="stylesheet" href="${pathToFileURL(resolve(root, s)).href}">`).join("\n");
  const css = impl.styles.map((s) => s.css).join("\n");
  const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
${links}
<style>html, body { margin: 0; padding: 0; } #${FRAME_ID} { position: relative; overflow: hidden; width: ${frame.width}px; height: ${frame.height}px; }</style>
<style>${css}
/*# sourceURL=${IMPL_SOURCE_URL} */</style>
</head>
<body>
<div id="${FRAME_ID}">
${impl.markup}
</div>
<script src="bundle.js"></script>
</body>
</html>
`;
  const harness = join(outDir, "index.html");
  await writeFile(harness, page);
  logs.push(`built ${relative(root, harness)}`);
  return { ok: true, log: logs.join("\n"), artifact: harness };
}
