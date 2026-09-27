// Build: mount the implementation's default export into the frame, bundled with esbuild.

import { readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import type { BuildParams, BuildResult } from "@tulpar/core";
import { FRAME_ID, bundle, writeHarness, type RenderConfig } from "@tulpar/web-kit";

/** Where the page exposes the design-system packages' exports, so components are identified by identity, not by name. */
export const DESIGN_SYSTEM_GLOBAL = "__tulparDesignSystem";

export async function build(params: BuildParams, render: RenderConfig, packages: string[]): Promise<BuildResult> {
  const { root, entry, frame } = params;
  const outDir = join(root, ".tulpar", "build", basename(entry).replace(/\.[^.]+$/, ""));
  // Runtime function names are unreliable (bundlers rename them, e.g. ModalFooter → ModalFooter2),
  // so the page gets the real exports to compare against.
  const names = packages.map((dir) => JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8")).name as string);
  const code = `import { createRoot } from "react-dom/client";
import Implementation from ${JSON.stringify(`./${entry.replace(/\\/g, "/")}`)};
${names.map((n, i) => `import * as ds${i} from ${JSON.stringify(n)};`).join("\n")}
window.${DESIGN_SYSTEM_GLOBAL} = Object.assign({}, ${names.map((_, i) => `ds${i}`).join(", ") || "{}"});
createRoot(document.getElementById(${JSON.stringify(FRAME_ID)})).render(<Implementation />);
`;
  const bundled = await bundle({ code, resolveDir: root, sourcefile: "tulpar-entry.jsx", outDir, loader: "jsx" });
  if (!bundled.ok) return { ok: false, log: bundled.log.join("\n") };
  const harness = await writeHarness({ root, outDir, frame, render, css: bundled.css, markup: "", script: "bundle.js" });
  return { ok: true, log: [...bundled.log, `built ${relative(root, harness)}`].join("\n"), artifact: harness };
}
