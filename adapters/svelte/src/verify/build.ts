// Build: mount the implementation's default export into the frame (Svelte 5's mount), bundled with
// esbuild, with each .svelte file compiled by the project's Svelte compiler.
//
// Components are identified by the source file each element records (__svelte_meta), so the design
// system's exports need not be on the page: only the components the code imports are compiled.

import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import type { BuildParams, BuildResult } from "@tulpar/core";
import { FRAME_ID, bundle, offScaleMessage, tailwindCss, writeHarness, type RenderConfig } from "@tulpar/web-kit";
import { sveltePlugin } from "../compile.ts";

export async function build(params: BuildParams, render: RenderConfig, prefix = ""): Promise<BuildResult> {
  const { root, entry, frame } = params;
  const outDir = join(root, ".tulpar", "build", basename(entry).replace(/\.[^.]+$/, ""));
  const code = `import { mount } from "svelte";
import Implementation from ${JSON.stringify(`./${entry.replace(/\\/g, "/")}`)};
mount(Implementation, { target: document.getElementById(${JSON.stringify(FRAME_ID)}) });
`;
  const bundled = await bundle({
    code,
    resolveDir: root,
    sourcefile: "tulpar-entry.js",
    outDir,
    loader: "js",
    plugins: [sveltePlugin(root)],
    // Svelte packages publish their source components under the "svelte" condition.
    conditions: ["svelte", "browser"],
  });
  if (!bundled.ok) return { ok: false, log: bundled.log.join("\n") };
  let css = bundled.css;
  if (params.output?.styling === "tailwind") {
    const dir = join(root, dirname(entry));
    const sources = readdirSync(dir).filter((f) => /\.(svelte|ts|js)$/.test(f) && !/\.(test|spec)\./.test(f)).map((f) => readFileSync(join(dir, f), "utf8"));
    const tw = await tailwindCss(sources);
    if (tw.offScale.length) return { ok: false, log: offScaleMessage(tw.offScale, prefix) };
    css = `${css}\n${tw.css}`;
  }
  const harness = await writeHarness({ root, outDir, frame, render, css, packageCss: bundled.packageCss, markup: "", script: "bundle.js" });
  return { ok: true, log: [...bundled.log, `built ${relative(root, harness)}`].join("\n"), artifact: harness };
}
