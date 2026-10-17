// Svelte components compiled for the browser, by the project's own Svelte compiler when it has one
// (compiled code must match the svelte runtime it imports), else Tulpar's. Dev mode: each element
// then records where it was written (__svelte_meta), which is how the render tells which component
// drew it. Component CSS comes out separately, as the implementation's own stylesheet.

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type * as esbuild from "esbuild";

type SvelteCompiler = {
  compile(source: string, options: Record<string, unknown>): { js: { code: string }; css: { code: string } | null; warnings: { message: string }[] };
  parse(source: string, options?: Record<string, unknown>): unknown;
  VERSION: string;
};

const compilers = new Map<string, Promise<SvelteCompiler>>();

/** The Svelte compiler of the project at `root`, or Tulpar's own. */
export function compilerFor(root: string): Promise<SvelteCompiler> {
  let found = compilers.get(root);
  if (!found) {
    let path: string;
    try {
      path = createRequire(join(root, "package.json")).resolve("svelte/compiler");
    } catch {
      path = createRequire(import.meta.url).resolve("svelte/compiler");
    }
    // Loaded as CommonJS, the compiler's functions sit under `default`.
    found = import(pathToFileURL(path).href).then((m: SvelteCompiler & { default?: SvelteCompiler }) => (typeof m.compile === "function" ? m : m.default!));
    compilers.set(root, found);
  }
  return found;
}

/** esbuild plugin: .svelte files compiled; each component's CSS a virtual stylesheet it imports. */
export function sveltePlugin(root: string): esbuild.Plugin {
  const styles = new Map<string, string>();
  return {
    name: "svelte",
    setup(build) {
      build.onLoad({ filter: /\.svelte$/ }, async (args) => {
        const svelte = await compilerFor(root);
        const source = await import("node:fs/promises").then((fs) => fs.readFile(args.path, "utf8"));
        try {
          const out = svelte.compile(source, { filename: args.path, generate: "client", css: "external", dev: true });
          let code = out.js.code;
          if (out.css?.code) {
            styles.set(`${args.path}?svelte-style`, out.css.code);
            code += `\nimport ${JSON.stringify(`${args.path}?svelte-style`)};\n`;
          }
          return { contents: code, loader: "js", resolveDir: dirname(args.path) };
        } catch (err) {
          const e = err as { message?: string; start?: { line: number } };
          return { errors: [{ text: (e.message ?? String(err)).split("\n")[0]!, location: { file: args.path, ...(e.start && { line: e.start.line }) } }] };
        }
      });
      build.onResolve({ filter: /\?svelte-style$/ }, (args) => ({ path: args.path, namespace: "svelte-style" }));
      build.onLoad({ filter: /.*/, namespace: "svelte-style" }, (args) => ({ contents: styles.get(args.path) ?? "", loader: "css" }));
    },
  };
}
