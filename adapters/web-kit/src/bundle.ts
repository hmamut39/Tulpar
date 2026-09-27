// Bundle an implementation's code with esbuild into one classic script (and one CSS file
// for any stylesheets it imports), so the harness page loads from local files only.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as esbuild from "esbuild";

export interface BundleResult {
  ok: boolean;
  log: string[];
  /** CSS the code imported (e.g. `import "./card.css"`), to be marked as the implementation's own. */
  css: string;
}

export async function bundle(input: { code: string; resolveDir: string; sourcefile: string; outDir: string; loader: "js" | "jsx" | "tsx" }): Promise<BundleResult> {
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
    });
    const cssFile = join(input.outDir, "bundle.css");
    return { ok: true, log: result.warnings.map((w) => `warning: ${w.text}`), css: existsSync(cssFile) ? await readFile(cssFile, "utf8") : "" };
  } catch (err) {
    const errors = (err as esbuild.BuildFailure).errors ?? [];
    return {
      ok: false,
      log: errors.length ? errors.map((e) => `${e.location ? `${e.location.file}:${e.location.line}: ` : ""}${e.text}`) : [String(err)],
      css: "",
    };
  }
}
