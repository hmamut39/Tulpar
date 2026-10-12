// Static scan of a Vue single-file component: the components its template uses, and hard-coded
// values in static style="…" attributes and in its <style> blocks (read compiled: SCSS and Less
// variables hide nothing).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "@vue/compiler-sfc";
import type { AnalyzeResult, StyleFact } from "@tulpar/core";
import { classify, declarations } from "@tulpar/web-kit";
import { sfcStyles } from "../sfc.ts";

interface TemplateNode {
  type: number;
  tag?: string;
  tagType?: number;
  props?: { type: number; name: string; value?: { content: string }; loc: { start: { line: number } } }[];
  children?: TemplateNode[];
}

const ELEMENT = 1;
const COMPONENT = 1;
const ATTRIBUTE = 6;

export async function analyzeVue(root: string, entry: string, prefix: string): Promise<AnalyzeResult> {
  const file = join(root, entry);
  const text = readFileSync(file, "utf8");
  const { descriptor } = parse(text, { filename: file });
  const used = new Set<string>();
  const literals: StyleFact[] = [];

  const visit = (node: TemplateNode) => {
    if (node.type === ELEMENT && node.tag) {
      // <el-button> and <ElButton> are the same component.
      if (node.tagType === COMPONENT) used.add(node.tag.includes("-") ? node.tag.replace(/(^|-)([a-z])/g, (_m, _d, c: string) => c.toUpperCase()) : node.tag.split(".").at(-1)!);
      for (const p of node.props ?? []) {
        if (p.type !== ATTRIBUTE || p.name !== "style" || !p.value) continue;
        for (const decl of p.value.content.split(";")) {
          const at = decl.indexOf(":");
          if (at < 0) continue;
          const fact = classify(decl.slice(0, at).trim(), decl.slice(at + 1).trim(), prefix, `${entry}:${p.loc.start.line}`);
          if (fact?.source === "literal") literals.push(fact);
        }
      }
    }
    for (const c of node.children ?? []) visit(c);
  };
  if (descriptor.template?.ast) visit(descriptor.template.ast as unknown as TemplateNode);

  let styles: Awaited<ReturnType<typeof sfcStyles>> = [];
  try {
    styles = await sfcStyles(file, text);
  } catch {
    styles = []; // a style block that does not compile fails the build, which says why
  }
  for (const s of styles) {
    for (const d of declarations(s.css)) {
      // Lines are the .vue file's for plain CSS; compiled SCSS and Less lines are approximate.
      const fact = classify(d.property, d.value, prefix, `${entry}:${s.line + d.line - 1}`);
      if (fact?.source === "literal") literals.push(fact);
    }
  }
  return { componentsUsed: [...used], literals };
}
