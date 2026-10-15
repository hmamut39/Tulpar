// Build: mount the implementation's default export into the frame, bundled with esbuild.

import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import type { BuildParams, BuildResult } from "@tulpar/core";
import { FRAME_ID, bundle, offScaleMessage, tailwindCss, writeHarness, type RenderConfig } from "@tulpar/web-kit";

/** Where the page exposes the design-system packages' exports, so components are identified by identity, not by name. */
export const DESIGN_SYSTEM_GLOBAL = "__tulparDesignSystem";

export async function build(params: BuildParams, render: RenderConfig, packages: string[], prefix = ""): Promise<BuildResult> {
  const { root, entry, frame } = params;
  const outDir = join(root, ".tulpar", "build", basename(entry).replace(/\.[^.]+$/, ""));
  // Runtime function names are unreliable (bundlers rename them, e.g. ModalFooter → ModalFooter2),
  // so the page gets the real exports to compare against.
  const names = packages.map((dir) => JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8")).name as string);
  const code = `import { createRoot } from "react-dom/client";
import Implementation from ${JSON.stringify(`./${entry.replace(/\\/g, "/")}`)};
${names.map((n, i) => `import * as ds${i} from ${JSON.stringify(n)};`).join("\n")}
window.${DESIGN_SYSTEM_GLOBAL} = Object.assign({}, ${names.map((_, i) => `ds${i}`).join(", ") || "{}"});
${render.setup ? `import Setup from ${JSON.stringify(`./${render.setup.replace(/\\/g, "/")}`)};` : ""}
createRoot(document.getElementById(${JSON.stringify(FRAME_ID)})).render(${render.setup ? "<Setup><Implementation /></Setup>" : "<Implementation />"});
`;
  const bundled = await bundle({ code, resolveDir: root, sourcefile: "tulpar-entry.jsx", outDir, loader: "jsx" });
  if (!bundled.ok) return { ok: false, log: bundled.log.join("\n") };
  let css = bundled.css;
  if (params.output?.styling === "tailwind") {
    // Tailwind classes in the component's files become its own stylesheet, so the token checks read them.
    const dir = join(root, dirname(entry));
    const sources = readdirSync(dir).filter((f) => /\.(tsx|jsx|ts|js)$/.test(f) && !/\.(test|spec)\./.test(f)).map((f) => readFileSync(join(dir, f), "utf8"));
    const tw = await tailwindCss(sources);
    if (tw.offScale.length) return { ok: false, log: offScaleMessage(tw.offScale, prefix) };
    css = `${css}\n${tw.css}`;
  }
  const harness = await writeHarness({ root, outDir, frame, render, css, packageCss: bundled.packageCss, markup: "", script: "bundle.js" });
  return { ok: true, log: [...bundled.log, `built ${relative(root, harness)}`].join("\n"), artifact: harness };
}
