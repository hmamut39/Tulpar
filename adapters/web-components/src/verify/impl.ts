// An implementation file: HTML markup, module scripts that import components, and styles.
// This is the shape code generators emit for Web Components; line numbers are kept for reports.

import { declarations, classify } from "./css.ts";
import type { AnalyzeResult, StyleFact } from "@tulpar/core";

export interface Implementation {
  markup: string;
  scripts: { code: string; line: number }[];
  styles: { css: string; line: number }[];
  /** `style="…"` attributes, with the line they are on. */
  styleAttributes: { css: string; line: number }[];
}

const lineAt = (text: string, index: number) => text.slice(0, index).split("\n").length;

export function parseImplementation(html: string): Implementation {
  const scripts: Implementation["scripts"] = [];
  const styles: Implementation["styles"] = [];
  let markup = html;
  for (const m of html.matchAll(/<script\b[^>]*type=["']module["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    scripts.push({ code: m[1]!, line: lineAt(html, m.index! + m[0].indexOf(m[1]!)) });
    markup = markup.replace(m[0], "");
  }
  for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    styles.push({ css: m[1]!, line: lineAt(html, m.index! + m[0].indexOf(m[1]!)) });
    markup = markup.replace(m[0], "");
  }
  const styleAttributes = [...html.matchAll(/\sstyle\s*=\s*(["'])([\s\S]*?)\1/gi)].map((m) => ({ css: m[2]!, line: lineAt(html, m.index!) }));
  return { markup: markup.trim(), scripts, styles, styleAttributes };
}

/** Static scan: which custom elements the markup uses, and every hard-coded value in its styles. */
export function analyzeImplementation(impl: Implementation, file: string, prefix: string): AnalyzeResult {
  const used = new Set<string>();
  for (const m of impl.markup.matchAll(/<([a-z][a-z0-9]*-[a-z0-9-]*)\b/g)) used.add(m[1]!);
  const literals: StyleFact[] = [];
  const scan = (css: string, line: number) => {
    for (const d of declarations(css, line)) {
      const fact = classify(d.property, d.value, prefix, `${file}:${d.line}`);
      if (fact?.source === "literal") literals.push(fact);
    }
  };
  for (const s of impl.styles) scan(s.css, s.line);
  for (const a of impl.styleAttributes) scan(a.css, a.line);
  return { componentsUsed: [...used], literals };
}
