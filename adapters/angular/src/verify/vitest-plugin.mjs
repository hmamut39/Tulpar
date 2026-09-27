// A Vite plugin for running Angular specs in Vitest browser mode, in JIT: inline
// templateUrl, drop styleUrl(s) (styles don't matter to TestBed assertions), and compile
// TypeScript with Angular's decorator semantics (experimentalDecorators) via esbuild.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { transform } from "esbuild";

export function tulparAngular() {
  return {
    name: "tulpar-angular-jit",
    enforce: "pre",
    async transform(code, id) {
      const file = id.split("?")[0];
      if (!file.endsWith(".ts") || file.includes("node_modules")) return null;
      const dir = dirname(file);
      let source = code.replace(/templateUrl\s*:\s*(["'`])([^"'`]+)\1/, (_m, _q, f) => `template: ${JSON.stringify(readFileSync(resolve(dir, f), "utf8"))}`);
      source = source.replace(/styleUrls?\s*:\s*(\[[^\]]*\]|(["'`])[^"'`]+\2)\s*,?/, "");
      const out = await transform(source, {
        loader: "ts",
        format: "esm",
        target: "es2022",
        sourcefile: file,
        tsconfigRaw: { compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false } },
      });
      return { code: out.code, map: null };
    },
  };
}
