// What a Java view writes, read from its source: styles set from Java (getStyle().set("padding", "16px"),
// setWidth("320px")) and the components it creates. Colours, type and spacing in the theme are CSS variables, so
// a value written as var(--aura-…) or var(--vaadin-…) is a token and a bare value is hard-coded.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AnalyzeResult, StyleFact } from "@tulpar/core";
import { classify } from "@tulpar/web-kit";

/** Java with comments blanked, strings kept: a style's value is a string. */
const withoutComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));

const SIZE_SETTERS: Record<string, string> = { setWidth: "width", setHeight: "height", setMinWidth: "min-width", setMaxWidth: "max-width", setMinHeight: "min-height", setMaxHeight: "max-height" };

export function scan(source: string, at: string, prefix: string): { literals: StyleFact[]; components: string[] } {
  const code = withoutComments(source);
  const line = (i: number) => `${at}:${code.slice(0, i).split("\n").length}`;
  const facts: StyleFact[] = [];
  const add = (property: string, value: string, i: number) => {
    const fact = classify(property, value, prefix, line(i));
    if (fact) facts.push(fact);
  };
  // getStyle().set("a", "1").set("b", "2"): every .set("property", "value") in a chain.
  for (const m of code.matchAll(/\.set\(\s*"([a-z-]+)"\s*,\s*"([^"]*)"\s*\)/g)) add(m[1]!, m[2]!, m.index);
  // On a component (b.setWidth) or on the view itself (setWidth).
  for (const m of code.matchAll(/(?<![\w$])(set(?:Min|Max)?(?:Width|Height))\(\s*"([^"]*)"\s*\)/g)) add(SIZE_SETTERS[m[1]!]!, m[2]!, m.index);
  const components = [...new Set([...code.matchAll(/\bnew\s+([A-Z]\w*)\s*[(<]/g)].map((m) => m[1]!))];
  return { literals: facts, components };
}

export function analyze(root: string, entry: string, prefix: string): AnalyzeResult {
  const literals: StyleFact[] = [];
  const components = new Set<string>();
  const dir = dirname(join(root, entry));
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".java"))) {
    const found = scan(readFileSync(join(dir, f), "utf8"), f, prefix);
    literals.push(...found.literals);
    for (const c of found.components) components.add(c);
  }
  return { componentsUsed: [...components], literals };
}
