// Render and static scan. Blazor draws real HTML, so the render is Tulpar's usual one; the published app
// is served on localhost, since WebAssembly cannot load from a file. The browser reaches nothing else.
// A Blazor component leaves no trace on its DOM, so the source says which component each Figma id is on.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { AnalyzeResult, RenderParams, RenderResult, StyleFact } from "@tulpar/core";
import { classify, declarations, render as renderPage, serving, type FrameworkHooks, type RenderConfig } from "@tulpar/web-kit";

/** Waits for the app to start and draw; `written` says which component each Figma id was written on. */
export function blazorHooks(written: Record<string, string> = {}, roots: string[] = []): FrameworkHooks {
  return {
    async settle(page, frameId) {
      // WebAssembly takes a few seconds to start. A crash shows in the console, and leaves the frame empty.
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
      return drawn ? [] : ["The Blazor component rendered nothing into the frame."];
    },
    identify(page) {
      return page.evaluate(({ written, roots }) => {
        const out: Record<string, { component: string; defined: boolean }> = {};
        for (const el of [...document.querySelectorAll<HTMLElement>("[data-figma-id]")]) {
          const id = el.dataset.figmaId!;
          // A control that puts its attributes on its inner <input> (MudTextField) is measured by its root,
          // which holds its label too. Only when that root is not tagged itself.
          const root = roots.length ? el.closest<HTMLElement>(roots.join(",")) : null;
          if (root && root !== el && !root.hasAttribute("data-figma-id")) {
            root.setAttribute("data-figma-id", id);
            el.removeAttribute("data-figma-id");
          }
          out[id] = { component: written[id] ?? el.localName, defined: true };
        }
        return out;
      }, { written, roots });
    },
  };
}

/** Which component each data-figma-id is written on, from the source: <MudButton data-figma-id="e1">. */
export function componentsWrittenOn(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of source.matchAll(/<([A-Za-z][\w.]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/g)) {
    const id = /\bdata-figma-id\s*=\s*"([^"]+)"/.exec(m[2]!)?.[1];
    if (id) out[id] = m[1]!;
  }
  return out;
}

export async function render(params: RenderParams, config: RenderConfig, prefix: string, roots: string[] = []): Promise<RenderResult> {
  const entry = params.entry ?? "";
  const source = entry && existsSync(join(params.root, entry)) ? readFileSync(join(params.root, entry), "utf8") : "";
  return serving(params.artifact, (url) => renderPage({ ...params, artifact: url }, config, prefix, blazorHooks(componentsWrittenOn(source), roots)));
}

/** Hard-coded values in the component's scoped stylesheet and its style="…" attributes, and the components it uses. */
export function analyze(root: string, entry: string, prefix: string): AnalyzeResult {
  const source = readFileSync(join(root, entry), "utf8");
  const literals: StyleFact[] = [];
  for (const m of source.matchAll(/\bStyle\s*=\s*"([^"@]*)"|\bstyle\s*=\s*"([^"@]*)"/g)) {
    for (const d of declarations(m[1] ?? m[2] ?? "")) {
      const fact = classify(d.property, d.value, prefix, `${entry}: style attribute`);
      if (fact?.source === "literal") literals.push(fact);
    }
  }
  const sheet = join(root, `${entry}.css`);
  if (existsSync(sheet)) {
    for (const rule of readFileSync(sheet, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      for (const d of declarations(rule[2]!)) {
        const fact = classify(d.property, d.value, prefix, `${entry}.css, rule "${rule[1]!.trim()}"`);
        if (fact?.source === "literal") literals.push(fact);
      }
    }
  }
  const componentsUsed = [...new Set([...source.matchAll(/<([A-Z][\w]*)\b/g)].map((m) => m[1]!))];
  return { componentsUsed, literals };
}
