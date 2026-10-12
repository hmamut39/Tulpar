// Build an Angular component for rendering: esbuild in JIT mode (no Angular CLI needed).
// - templateUrl is inlined; a .less stylesheet is compiled with `less`, a .scss one with Sass, .css as is;
// - the compiled styles go into the harness as the implementation's own stylesheet (so the
//   token checks see them), with :host rewritten to the component's element;
// - the component is bootstrapped standalone, with the design-system package's exports
//   exposed to the page so components are identified by identity, not by name.

import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import * as esbuild from "esbuild";
import less from "less";
import { readStylesheet } from "@tulpar/web-kit";
import type { BuildParams, BuildResult } from "@tulpar/core";
import { FRAME_ID, writeHarness, type RenderConfig } from "@tulpar/web-kit";

export const DESIGN_SYSTEM_GLOBAL = "__tulparDesignSystem";
export const READY_FLAG = "__tulparReady";

export async function build(params: BuildParams, render: RenderConfig, packages: string[], modules: string[] = []): Promise<BuildResult> {
  const { root, entry, frame } = params;
  const outDir = join(root, ".tulpar", "build", basename(entry).replace(/\.[^.]+$/, ""));
  // Every module the index found components in: the package roots, and secondary entry points
  // (PrimeNG publishes each component as its own, primeng/button, and nothing at the root).
  const roots = packages.map((dir) => JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8")).name as string);
  // Only the entry points the implementation imports: importing all of them would pull in every optional
  // peer (primeng/chart needs chart.js), and only components the code uses need identifying.
  const implSource = readFileSync(join(root, entry), "utf8");
  const used = modules.filter((m) => implSource.includes(`"${m}"`) || implSource.includes(`'${m}'`));
  const names = [...new Set([...roots, ...used])];
  const stylesheets: { file: string; css: string }[] = [];
  const logs: string[] = [];

  const code = `import "zone.js";
import "@angular/compiler";
import { provideZoneChangeDetection, reflectComponentType, ApplicationRef } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";
${names.map((n, i) => `import * as ds${i} from ${JSON.stringify(n)};`).join("\n")}
import * as implementation from ${JSON.stringify(`./${entry.replace(/\\/g, "/")}`)};
${render.setup ? `import { providers as setupImport } from ${JSON.stringify(`./${render.setup.replace(/\\/g, "/")}`)};\nconst setupProviders = setupImport ?? [];` : "const setupProviders = [];"}
window.${DESIGN_SYSTEM_GLOBAL} = Object.assign({}, ${names.map((_, i) => `ds${i}`).join(", ") || "{}"});
const component = Object.values(implementation).find((v) => typeof v === "function" && reflectComponentType(v));
if (!component) throw new Error("The implementation exports no Angular component.");
const selector = reflectComponentType(component).selector.split(",")[0].trim();
document.getElementById(${JSON.stringify(FRAME_ID)}).appendChild(document.createElement(selector));
bootstrapApplication(component, { providers: [provideZoneChangeDetection(), ...setupProviders] })
  .then((app) => app.injector.get(ApplicationRef).whenStable())
  .then(() => (window.${READY_FLAG} = true), (e) => { window.${READY_FLAG} = String((e && e.stack) || e); });
`;

  const angularResources: esbuild.Plugin = {
    name: "tulpar-angular-resources",
    setup(b) {
      b.onLoad({ filter: /\.component\.ts$/ }, async (args) => {
        let source = await readFile(args.path, "utf8");
        const dir = dirname(args.path);
        source = source.replace(/templateUrl\s*:\s*(["'`])([^"'`]+)\1/, (_m, _q, file) => `template: ${JSON.stringify(readFileSync(resolve(dir, file), "utf8"))}`);
        const styleFiles: string[] = [];
        source = source.replace(/styleUrls?\s*:\s*(\[[^\]]*\]|(["'`])[^"'`]+\2)\s*,?/, (m) => {
          for (const f of m.matchAll(/["'`]([^"'`]+)["'`]/g)) styleFiles.push(f[1]!);
          return "";
        });
        const selector = /selector\s*:\s*["'`]([^"'`]+)["'`]/.exec(source)?.[1]?.split(",")[0]?.trim() ?? "";
        for (const f of styleFiles) {
          const path = resolve(dir, f);
          const text = readFileSync(path, "utf8");
          const css = f.endsWith(".less") ? (await less.render(text, { filename: path })).css : f.endsWith(".scss") ? readStylesheet(path) : text;
          // The styles leave Angular's emulated encapsulation; :host becomes the component's element.
          stylesheets.push({ file: relative(root, path).replace(/\\/g, "/"), css: selector ? css.replace(/:host(\(([^)]*)\))?/g, (_x, _g, inner) => `${selector}${inner ?? ""}`) : css });
        }
        return { contents: source, loader: "ts" };
      });
    },
  };

  try {
    const result = await esbuild.build({
      stdin: { contents: code, resolveDir: root, sourcefile: "tulpar-angular-entry.ts", loader: "ts" },
      bundle: true,
      format: "iife",
      // The one environment value a setup may read: a PrimeUI licence key (PrimeNG 20+ is licensed per team).
      // Nothing else from the server's environment reaches the page.
      define: { "process.env.PRIMEUI_LICENSE": JSON.stringify(process.env.PRIMEUI_LICENSE ?? "") },
      target: "es2022",
      outfile: join(outDir, "bundle.js"),
      logLevel: "silent",
      write: true,
      plugins: [angularResources],
      ...(existsSync(join(root, "tsconfig.json")) && { tsconfig: join(root, "tsconfig.json") }),
    });
    logs.push(...result.warnings.map((w) => `warning: ${w.text}`));
  } catch (err) {
    const errors = (err as esbuild.BuildFailure).errors ?? [];
    return { ok: false, log: errors.length ? errors.map((e) => `${e.location ? `${e.location.file}:${e.location.line}: ` : ""}${e.text}`).join("\n") : String(err) };
  }

  const css = stylesheets.map((s) => `/* ${s.file} */\n${s.css}`).join("\n");
  const harness = await writeHarness({ root, outDir, frame, render, css, markup: "", script: "bundle.js" });
  return { ok: true, log: [...logs, `built ${relative(root, harness)}`].join("\n"), artifact: harness };
}
