// Vue single-file components, compiled for the browser: the script and template become one
// module, each <style> block a stylesheet of its own (scoped, SCSS, Less, or a CSS Module).
// No Vite needed: the compiler's output goes straight to esbuild.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { compileScript, compileStyle, compileTemplate, parse, type SFCDescriptor } from "@vue/compiler-sfc";
import type * as esbuild from "esbuild";
import less from "less";
import * as sass from "sass";

export interface CompiledStyle {
  css: string;
  module: boolean;
  /** Line in the .vue file where the block starts. */
  line: number;
}

export interface CompiledSfc {
  code: string;
  loader: "ts" | "js";
  styles: CompiledStyle[];
  errors: string[];
}

/** The style blocks, compiled to plain CSS (scoping not applied): what the token checks read. */
export async function sfcStyles(path: string, source = readFileSync(path, "utf8")): Promise<CompiledStyle[]> {
  const { descriptor } = parse(source, { filename: path });
  return Promise.all(descriptor.styles.map(async (s) => ({ css: await preprocess(s.content, s.lang, path), module: !!s.module, line: s.loc.start.line })));
}

export async function compileSfc(path: string, source = readFileSync(path, "utf8")): Promise<CompiledSfc> {
  const { descriptor, errors: parseErrors } = parse(source, { filename: path });
  const errors = parseErrors.map((e) => message(e));
  if (errors.length) return { code: "", loader: "js", styles: [], errors };
  const id = createHash("sha256").update(path).digest("hex").slice(0, 8);
  const scoped = descriptor.styles.some((s) => s.scoped);
  const lang = descriptor.scriptSetup?.lang ?? descriptor.script?.lang;
  let code: string;
  try {
    code = script(descriptor, id, scoped, path);
  } catch (err) {
    return { code: "", loader: "js", styles: [], errors: [message(err)] };
  }

  const styles: CompiledStyle[] = [];
  const imports: string[] = [];
  for (const [i, block] of descriptor.styles.entries()) {
    let css: string;
    try {
      css = await preprocess(block.content, block.lang, path);
    } catch (err) {
      return { code: "", loader: "js", styles: [], errors: [`${path}: <style lang="${block.lang}">: ${message(err)}`] };
    }
    // Scoping adds the component's data-v attribute to each selector, as Vue's build does.
    const out = compileStyle({ source: css, filename: path, id: `data-v-${id}`, scoped: !!block.scoped, trim: true });
    if (out.errors.length) return { code: "", loader: "js", styles: [], errors: out.errors.map((e) => message(e)) };
    styles.push({ css: out.code, module: !!block.module, line: block.loc.start.line });
    if (block.module) imports.push(`import style${i} from ${JSON.stringify(`${path}?vue-style=${i}`)};\n_sfc_main.__cssModules = { ...(_sfc_main.__cssModules || {}), ${JSON.stringify(typeof block.module === "string" ? block.module : "$style")}: style${i} };`);
    else imports.push(`import ${JSON.stringify(`${path}?vue-style=${i}`)};`);
  }
  code += `\n${imports.join("\n")}\n${scoped ? `_sfc_main.__scopeId = "data-v-${id}";\n` : ""}export default _sfc_main;\n`;
  return { code, loader: lang === "ts" || lang === "tsx" ? "ts" : "js", styles, errors: [] };
}

/** The component as `const _sfc_main = …`, with its render function attached. */
function script(descriptor: SFCDescriptor, id: string, scoped: boolean, path: string): string {
  const template = descriptor.template;
  if (descriptor.scriptSetup) {
    // <script setup>: the template is compiled into the setup function.
    return compileScript(descriptor, { id, inlineTemplate: true, genDefaultAs: "_sfc_main", fs: { fileExists: () => false, readFile: () => undefined } }).content;
  }
  const main = descriptor.script ? compileScript(descriptor, { id, genDefaultAs: "_sfc_main" }).content : "const _sfc_main = {};";
  if (!template) return main;
  const compiled = compileTemplate({ source: template.content, filename: path, id, scoped, compilerOptions: { scopeId: scoped ? `data-v-${id}` : undefined } });
  if (compiled.errors.length) throw new Error(compiled.errors.map((e) => message(e)).join("\n"));
  return `${main}\n${compiled.code.replace(/export function render/, "function _sfc_render")}\n_sfc_main.render = _sfc_render;`;
}

async function preprocess(source: string, lang: string | undefined, path: string): Promise<string> {
  if (lang === "scss" || lang === "sass") {
    return sass.compileString(source, { syntax: lang === "sass" ? "indented" : "scss", style: "expanded", loadPaths: [dirname(path), join(dirname(path), "node_modules")] }).css;
  }
  if (lang === "less") return (await less.render(source, { filename: path })).css;
  return source;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).split("\n")[0]!;

/** esbuild plugin: .vue files, and the style blocks they import as virtual stylesheets. */
export function vuePlugin(): esbuild.Plugin {
  const styles = new Map<string, CompiledStyle>();
  return {
    name: "vue-sfc",
    setup(build) {
      build.onLoad({ filter: /\.vue$/ }, async (args) => {
        const out = await compileSfc(args.path);
        if (out.errors.length) return { errors: out.errors.map((text) => ({ text, location: { file: args.path } })) };
        for (const [i, s] of out.styles.entries()) styles.set(`${args.path}?vue-style=${i}`, s);
        return { contents: out.code, loader: out.loader, resolveDir: dirname(args.path) };
      });
      build.onResolve({ filter: /\?vue-style=\d+$/ }, (args) => ({ path: args.path, namespace: "vue-style" }));
      build.onLoad({ filter: /.*/, namespace: "vue-style" }, (args) => {
        const s = styles.get(args.path);
        // A CSS Module's class names become local, and the import gives the component its map.
        return { contents: s?.css ?? "", loader: s?.module ? "local-css" : "css" };
      });
    },
  };
}
