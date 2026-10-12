// Bundle an implementation's code with esbuild into one classic script (and one CSS file
// for any stylesheets it imports), so the harness page loads from local files only.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as esbuild from "esbuild";
import * as sass from "sass";

export interface BundleResult {
  ok: boolean;
  log: string[];
  /** CSS the code imported (e.g. `import "./card.css"`), to be marked as the implementation's own. */
  css: string;
  /**
   * Stylesheets the code imported from packages (e.g. `import "@radix-ui/themes/styles.css"`), as
   * absolute paths. They are the design system's CSS, so the page loads them as such; folded into
   * the implementation's CSS, every value inside them would be blamed on the implementation.
   */
  packageCss: string[];
}

export async function bundle(input: { code: string; resolveDir: string; sourcefile: string; outDir: string; loader: "js" | "jsx" | "tsx" }): Promise<BundleResult> {
  const packageCss: string[] = [];
  const separatePackageCss: esbuild.Plugin = {
    name: "package-css",
    setup(build) {
      build.onResolve({ filter: /\.css$/ }, async (args) => {
        if (args.pluginData?.inner) return undefined;
        const resolved = await build.resolve(args.path, { resolveDir: args.resolveDir, kind: args.kind, importer: args.importer, pluginData: { inner: true } });
        if (resolved.errors.length || !/[\\/]node_modules[\\/]/.test(resolved.path)) return undefined;
        if (!packageCss.includes(resolved.path)) packageCss.push(resolved.path);
        return { path: resolved.path, namespace: "package-css" };
      });
      build.onLoad({ filter: /.*/, namespace: "package-css" }, () => ({ contents: "", loader: "css" }));
    },
  };
  // SCSS the implementation imports, compiled to CSS (a .module.scss stays a CSS Module).
  const scss: esbuild.Plugin = {
    name: "scss",
    setup(build) {
      build.onLoad({ filter: /\.scss$/ }, (args) => {
        try {
          const out = sass.compile(args.path, { style: "expanded", loadPaths: [input.resolveDir, join(input.resolveDir, "node_modules")] });
          return { contents: out.css, loader: /\.module\.scss$/.test(args.path) ? "local-css" : "css", watchFiles: out.loadedUrls.map((u) => u.pathname) };
        } catch (err) {
          return { errors: [{ text: (err as Error).message.split("\n")[0]! }] };
        }
      });
    },
  };
  try {
    const result = await esbuild.build({
      stdin: { contents: input.code, resolveDir: input.resolveDir, sourcefile: input.sourcefile, loader: input.loader },
      bundle: true,
      format: "iife",
      target: "es2022",
      jsx: "automatic",
      define: { "process.env.NODE_ENV": '"production"' },
      outfile: join(input.outDir, "bundle.js"),
      logLevel: "silent",
      write: true,
      plugins: [separatePackageCss, scss],
    });
    const cssFile = join(input.outDir, "bundle.css");
    return { ok: true, log: result.warnings.map((w) => `warning: ${w.text}`), css: existsSync(cssFile) ? await readFile(cssFile, "utf8") : "", packageCss };
  } catch (err) {
    const errors = (err as esbuild.BuildFailure).errors ?? [];
    return {
      ok: false,
      log: errors.length ? errors.map((e) => `${e.location ? `${e.location.file}:${e.location.line}: ` : ""}${e.text}`) : [String(err)],
      css: "",
      packageCss,
    };
  }
}
