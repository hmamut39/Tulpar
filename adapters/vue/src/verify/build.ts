// Build: mount the implementation's default export into the frame, bundled with esbuild.
// A setup file (render.setup) prepares the app as the team's does: its default export is a
// Vue plugin (app.use) or a function given the app (installing Vuetify, a theme, a locale).

import { readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import type { BuildParams, BuildResult } from "@tulpar/core";
import { FRAME_ID, bundle, writeHarness, type RenderConfig } from "@tulpar/web-kit";
import { vuePlugin } from "../sfc.ts";

/** Where the page exposes the design-system packages' exports, so components are identified by identity, not by name. */
export const DESIGN_SYSTEM_GLOBAL = "__tulparDesignSystem";

export async function build(params: BuildParams, render: RenderConfig, packages: string[]): Promise<BuildResult> {
  const { root, entry, frame } = params;
  const outDir = join(root, ".tulpar", "build", basename(entry).replace(/\.[^.]+$/, ""));
  const names = packages.map((dir) => JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8")).name as string);
  const code = `import { createApp } from "vue";
import Implementation from ${JSON.stringify(`./${entry.replace(/\\/g, "/")}`)};
${names.map((n, i) => `import * as ds${i} from ${JSON.stringify(n)};`).join("\n")}
window.${DESIGN_SYSTEM_GLOBAL} = Object.assign({}, ${names.map((_, i) => `ds${i}`).join(", ") || "{}"});
${render.setup ? `import Setup from ${JSON.stringify(`./${render.setup.replace(/\\/g, "/")}`)};` : ""}
const app = createApp(Implementation);
${render.setup ? `if (typeof Setup === "function") Setup(app); else if (Setup) app.use(Setup);` : ""}
app.mount(document.getElementById(${JSON.stringify(FRAME_ID)}));
`;
  const bundled = await bundle({
    code,
    resolveDir: root,
    sourcefile: "tulpar-entry.ts",
    outDir,
    loader: "ts",
    plugins: [vuePlugin()],
    // Vue's build flags. Devtools support keeps each element's owning component on the element,
    // which is how the render tells which design-system component drew it.
    define: { __VUE_OPTIONS_API__: "true", __VUE_PROD_DEVTOOLS__: "true", __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false" },
  });
  if (!bundled.ok) return { ok: false, log: bundled.log.join("\n") };
  const harness = await writeHarness({ root, outDir, frame, render, css: bundled.css, packageCss: bundled.packageCss, markup: "", script: "bundle.js" });
  return { ok: true, log: [...bundled.log, `built ${relative(root, harness)}`].join("\n"), artifact: harness };
}
