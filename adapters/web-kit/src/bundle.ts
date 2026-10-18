// Bundle an implementation's code with esbuild into one classic script (and one CSS file
// for any stylesheets it imports), so the harness page loads from local files only.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import * as esbuild from "esbuild";
import * as sass from "sass";
import { compileLess } from "./stylesheet.ts";

/** Where Tulpar's own packages are installed (styled-components, Emotion), for projects without them. */
const OWN_MODULES = dirname(dirname(createRequire(import.meta.url).resolve("styled-components/package.json")));

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

export interface BundleInput {
  code: string;
  resolveDir: string;
  sourcefile: string;
  outDir: string;
  loader: "js" | "jsx" | "tsx" | "ts";
  /** A framework's own file types (Vue's .vue), compiled before bundling. */
  plugins?: esbuild.Plugin[];
  /** Compile-time flags a framework's build expects (Vue's __VUE_OPTIONS_API__). */
  define?: Record<string, string>;
  /** Package export conditions to resolve with (Svelte packages publish components under "svelte"). */
  conditions?: string[];
}

export async function bundle(input: BundleInput): Promise<BundleResult> {
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
  // One React: a library resolved from Tulpar's own copies (styled-components, Emotion, when the project
  // has none) must use the project's React, never a second one (two Reacts break hooks).
  const oneReact: esbuild.Plugin = {
    name: "one-react",
    setup(build) {
      build.onResolve({ filter: /^react(-dom)?(\/.*)?$/ }, async (args) => {
        if (args.pluginData?.oneReact) return undefined;
        const resolved = await build.resolve(args.path, { resolveDir: input.resolveDir, kind: args.kind, pluginData: { oneReact: true } });
        return resolved.errors.length ? undefined : { path: resolved.path };
      });
    },
  };
  // The styling libraries a team may write with (styled-components, Emotion): the project's own copy, or
  // Tulpar's when it has none. Only these: any other package the code imports must be the project's.
  const stylingLibraries: esbuild.Plugin = {
    name: "styling-libraries",
    setup(build) {
      build.onResolve({ filter: /^(styled-components|@emotion\/(react|styled|cache|css|is-prop-valid))(\/.*)?$/ }, async (args) => {
        if (args.pluginData?.styling) return undefined;
        const own = await build.resolve(args.path, { resolveDir: args.resolveDir, kind: args.kind, pluginData: { styling: true } });
        if (!own.errors.length) return { path: own.path };
        const ours = await build.resolve(args.path, { resolveDir: OWN_MODULES, kind: args.kind, pluginData: { styling: true } });
        return ours.errors.length ? undefined : { path: ours.path };
      });
    },
  };
  // LESS the implementation imports, the same way (a .module.less stays a CSS Module).
  const lessPlugin: esbuild.Plugin = {
    name: "less",
    setup(build) {
      build.onLoad({ filter: /\.less$/ }, async (args) => {
        try {
          return { contents: compileLess(await readFile(args.path, "utf8"), args.path), loader: /\.module\.less$/.test(args.path) ? "local-css" : "css" };
        } catch (err) {
          return { errors: [{ text: (err as Error).message.split("\n")[0]! }] };
        }
      });
    },
  };
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
      define: { "process.env.NODE_ENV": '"production"', ...input.define },
      ...(input.conditions && { conditions: input.conditions }),
      outfile: join(input.outDir, "bundle.js"),
      logLevel: "silent",
      write: true,
      plugins: [oneReact, stylingLibraries, separatePackageCss, scss, lessPlugin, ...(input.plugins ?? [])],
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
