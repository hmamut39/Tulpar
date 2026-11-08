// A Vite plugin for running Angular specs in Vitest browser mode, in JIT: inline
// templateUrl, drop styleUrl(s) (styles don't matter to TestBed assertions), and compile
// TypeScript with Angular's decorator semantics (experimentalDecorators) via esbuild.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { transform } from "esbuild";

/**
 * Signal inputs, models and outputs (input(), input.required(), model(), output()) are found by Angular's compiler,
 * which JIT through esbuild never runs: without it, setInput() never reaches them. Each gets the decorator Angular's
 * own JIT transform would give it.
 */
export function signalMembers(source) {
  let changed = false;
  const out = source.replace(/^(\s*)((?:(?:public|protected|private|readonly)\s+)*)(\w+)(\s*=\s*)(input|model|output)(\.required)?(\s*[<(])/gm, (m, indent, mods, name, eq, kind, required, rest) => {
    changed = true;
    const alias = /alias\s*:\s*(["'])([^"']+)\1/.exec(source.slice(source.indexOf(m), source.indexOf(m) + 400))?.[2] ?? name;
    const input = `@__TulparInput({ isSignal: true, alias: ${JSON.stringify(alias)}, required: ${!!required}, transform: undefined })`;
    const decorators = kind === "input" ? input : kind === "model" ? `${input} @__TulparOutput(${JSON.stringify(`${alias}Change`)})` : `@__TulparOutput(${JSON.stringify(alias)})`;
    return `${indent}${decorators} ${mods}${name}${eq}${kind}${required ?? ""}${rest}`;
  });
  return changed ? `import { Input as __TulparInput, Output as __TulparOutput } from "@angular/core";\n${out}` : source;
}

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
      source = signalMembers(source);
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
