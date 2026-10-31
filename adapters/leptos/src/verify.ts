// Render and static scan. Leptos draws real HTML, so the render is Tulpar's usual one, of a site served
// on localhost. A Leptos component leaves no trace on its DOM, so the source says which component each Figma
// id is written on.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AnalyzeResult, RenderParams, RenderResult, StyleFact } from "@tulpar/core";
import { classify, declarations, render as renderPage, serving, type FrameworkHooks, type RenderConfig } from "@tulpar/web-kit";

export function leptosHooks(written: Record<string, string> = {}): FrameworkHooks {
  return {
    async settle(page, frameId) {
      const drawn = await page
        .waitForFunction((id) => (document.getElementById(id)?.childElementCount ?? 0) > 0, frameId, { timeout: 60_000 })
        .then(() => true)
        .catch(() => false);
      await page.evaluate(async (id) => {
        const frame = document.getElementById(id)!;
        for (let quiet = 0, i = 0; quiet < 5 && i < 120; i++) {
          const before = frame.innerHTML.length;
          await new Promise((r) => requestAnimationFrame(() => r(null)));
          quiet = frame.innerHTML.length === before ? quiet + 1 : 0;
        }
      }, frameId);
      return drawn ? [] : ["The Leptos component rendered nothing into the frame."];
    },
    identify(page) {
      return page.evaluate((written) => {
        const out: Record<string, { component: string; defined: boolean }> = {};
        for (const el of document.querySelectorAll<HTMLElement>("[data-figma-id]")) out[el.dataset.figmaId!] = { component: written[el.dataset.figmaId!] ?? el.localName, defined: true };
        return out;
      }, written);
    },
  };
}

/** Which component each data-figma-id is written on: <Button attr:data-figma-id="e1">, <div data-figma-id="e2">. */
export function componentsWrittenOn(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of source.matchAll(/<([A-Za-z][\w:]*)\b((?:[^>"']|"[^"]*"|'[^']*')*?)\/?>/g)) {
    const id = /\b(?:attr:)?data-figma-id\s*=\s*"([^"]+)"/.exec(m[2]!)?.[1];
    if (id) out[id] = m[1]!;
  }
  return out;
}

export async function render(params: RenderParams, config: RenderConfig, prefix: string): Promise<RenderResult> {
  const entry = params.entry ?? "";
  const source = entry && existsSync(join(params.root, entry)) ? readFileSync(join(params.root, entry), "utf8") : "";
  return serving(params.artifact, (url) => renderPage({ ...params, artifact: url }, config, prefix, leptosHooks(componentsWrittenOn(source))));
}

/** Hard-coded values in the component's stylesheet and style="…" attributes, and the components it uses. */
export function analyze(root: string, entry: string, prefix: string): AnalyzeResult {
  const source = readFileSync(join(root, entry), "utf8");
  const literals: StyleFact[] = [];
  for (const m of source.matchAll(/\bstyle\s*=\s*"([^"]*)"/g)) {
    for (const d of declarations(m[1]!)) {
      const fact = classify(d.property, d.value, prefix, `${entry}: style attribute`);
      if (fact?.source === "literal") literals.push(fact);
    }
  }
  const dir = dirname(join(root, entry));
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".css"))) {
    for (const rule of readFileSync(join(dir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      for (const d of declarations(rule[2]!)) {
        const fact = classify(d.property, d.value, prefix, `${f}, rule "${rule[1]!.trim()}"`);
        if (fact?.source === "literal") literals.push(fact);
      }
    }
  }
  return { componentsUsed: [...new Set([...source.matchAll(/<([A-Z]\w*)\b/g)].map((m) => m[1]!))], literals };
}
