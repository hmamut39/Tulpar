// Build: mount the implementation's default export into the frame, bundled with esbuild.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import type { BuildParams, BuildResult } from "@tulpar/core";
import { FRAME_ID, bundle, offScaleMessage, tailwindCss, tailwindThemeCss, writeHarness, type RenderConfig } from "@tulpar/web-kit";

/** Where the page exposes the design-system packages' exports, so components are identified by identity, not by name. */
export const DESIGN_SYSTEM_GLOBAL = "__tulparDesignSystem";

/** A design system kept in the project's own source (shadcn/ui): its component folders and its Tailwind stylesheet. */
export interface SourceDesignSystem {
  sources?: { dir: string }[];
  tailwind?: { css: string };
}

const SOURCE_FILE = /\.(tsx|jsx|ts|js)$/;
const sourceFiles = (dir: string) => readdirSync(dir).filter((f) => SOURCE_FILE.test(f) && !/\.(test|spec)\.|\.d\.ts$/.test(f));

export async function build(params: BuildParams, render: RenderConfig, packages: string[], prefix = "", own: SourceDesignSystem = {}): Promise<BuildResult> {
  const { root, entry, frame } = params;
  const outDir = join(root, ".tulpar", "build", basename(entry).replace(/\.[^.]+$/, ""));
  // Runtime function names are unreliable (bundlers rename them, e.g. ModalFooter → ModalFooter2),
  // so the page gets the real exports to compare against: the packages', and the project's own
  // components' files (imported by path; the code's "@/components/ui/button" is the same module).
  const modules = [
    ...packages.map((dir) => JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8")).name as string),
    ...(own.sources ?? []).flatMap((s) => sourceFiles(join(root, s.dir)).map((f) => `./${s.dir.replace(/\\/g, "/")}/${f}`)),
  ];
  const code = `import { createRoot } from "react-dom/client";
import Implementation from ${JSON.stringify(`./${entry.replace(/\\/g, "/")}`)};
${modules.map((n, i) => `import * as ds${i} from ${JSON.stringify(n)};`).join("\n")}
window.${DESIGN_SYSTEM_GLOBAL} = Object.assign({}, ${modules.map((_, i) => `ds${i}`).join(", ") || "{}"});
${render.setup ? `import Setup from ${JSON.stringify(`./${render.setup.replace(/\\/g, "/")}`)};` : ""}
createRoot(document.getElementById(${JSON.stringify(FRAME_ID)})).render(${render.setup ? "<Setup><Implementation /></Setup>" : "<Implementation />"});
`;
  const bundled = await bundle({ code, resolveDir: root, sourcefile: "tulpar-entry.jsx", outDir, loader: "jsx" });
  if (!bundled.ok) return { ok: false, log: bundled.log.join("\n") };
  let css = bundled.css;
  const packageCss = [...bundled.packageCss];
  // The component's own files, whose Tailwind classes become its own stylesheet, so the token checks read them.
  const ownSources = () => {
    const dir = join(root, dirname(entry));
    return sourceFiles(dir).map((f) => readFileSync(join(dir, f), "utf8"));
  };
  if (own.tailwind) {
    // The project's theme is the design system: its stylesheet as the app compiles it, for its components
    // and the generated code, and the code's own utilities on top.
    const dsSources = (own.sources ?? []).flatMap((s) => sourceFiles(join(root, s.dir)).map((f) => readFileSync(join(root, s.dir, f), "utf8")));
    try {
      const tw = await tailwindThemeCss(join(root, own.tailwind.css), dsSources, ownSources());
      mkdirSync(outDir, { recursive: true });
      const sheet = join(outDir, "design-system.css");
      writeFileSync(sheet, tw.designSystem);
      packageCss.unshift(sheet);
      css = `${css}\n${tw.css}`;
    } catch (err) {
      return { ok: false, log: `Tailwind could not compile ${own.tailwind.css}: ${(err as Error).message}` };
    }
  } else if (params.output?.styling === "tailwind") {
    const tw = await tailwindCss(ownSources());
    if (tw.offScale.length) return { ok: false, log: offScaleMessage(tw.offScale, prefix) };
    css = `${css}\n${tw.css}`;
  }
  const harness = await writeHarness({ root, outDir, frame, render, css, packageCss, markup: "", script: "bundle.js" });
  return { ok: true, log: [...bundled.log, `built ${relative(root, harness)}`].join("\n"), artifact: harness };
}
