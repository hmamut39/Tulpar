// Static scan of an Angular component: design-system selectors used in its template, and
// hard-coded values in style="…" attributes and in its (compiled) stylesheets.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import less from "less";
import type { AnalyzeResult, CodeComponent, StyleFact } from "@tulpar/core";
import { classify, declarations } from "@tulpar/web-kit";

export async function analyzeAngular(root: string, entry: string, prefix: string, components: CodeComponent[]): Promise<AnalyzeResult> {
  const file = join(root, entry);
  const source = readFileSync(file, "utf8");
  const dir = dirname(file);
  const literals: StyleFact[] = [];
  const used = new Set<string>();

  const templateFile = /templateUrl\s*:\s*["'`]([^"'`]+)["'`]/.exec(source)?.[1];
  const inline = /template\s*:\s*`([\s\S]*?)`/.exec(source)?.[1];
  const template = templateFile && existsSync(resolve(dir, templateFile)) ? readFileSync(resolve(dir, templateFile), "utf8") : inline ?? "";
  const templateName = templateFile ? relative(root, resolve(dir, templateFile)).replace(/\\/g, "/") : entry;

  // Which design-system components the template uses: element selectors and attribute directives.
  for (const c of components) {
    if (!c.markup) continue;
    const el = /^<([a-z][a-z0-9-]*)>$/.exec(c.markup)?.[1];
    const attr = /directive ([A-Za-z-]+)/.exec(c.markup)?.[1] ?? /^<[a-z][a-z0-9-]* ([A-Za-z-]+)>$/.exec(c.markup)?.[1];
    if ((el && new RegExp(`<${el}[\\s>/]`).test(template)) || (attr && new RegExp(`[\\s\\[]${attr}[\\s\\]=>]`).test(template))) used.add(c.name);
  }

  const lineOf = (text: string, index: number) => text.slice(0, index).split("\n").length;
  for (const m of template.matchAll(/\sstyle\s*=\s*"([^"]*)"/g)) {
    for (const d of declarations(m[1]!, lineOf(template, m.index!))) {
      const fact = classify(d.property, d.value, prefix, `${templateName}:${d.line}`);
      if (fact?.source === "literal") literals.push(fact);
    }
  }
  // [style.margin-left]="'8px'" and [style.marginLeft.px]="8"
  for (const m of template.matchAll(/\[style\.([a-zA-Z-]+)(\.px|\.rem)?\]\s*=\s*"'?([^"']*)'?"/g)) {
    const prop = m[1]!.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);
    const value = m[2] ? `${m[3]}${m[2].slice(1)}` : m[3]!;
    const fact = classify(prop, value, prefix, `${templateName}:${lineOf(template, m.index!)}`);
    if (fact?.source === "literal") literals.push(fact);
  }

  for (const f of [...source.matchAll(/["'`]([^"'`]+\.(?:less|css))["'`]/g)].map((m) => m[1]!)) {
    const path = resolve(dir, f);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    const rel = relative(root, path).replace(/\\/g, "/");
    // LESS variables can hide literals (@gap: 16px); scan what the stylesheet compiles to.
    let css = text;
    if (path.endsWith(".less")) {
      try {
        css = (await less.render(text, { filename: path })).css;
      } catch {
        continue; // the build reports the syntax error
      }
    }
    for (const d of declarations(css)) {
      const fact = classify(d.property, d.value, prefix, path.endsWith(".less") ? `${rel} (compiled)` : `${rel}:${d.line}`);
      if (fact?.source === "literal") literals.push(fact);
    }
  }
  return { componentsUsed: [...used], literals };
}
