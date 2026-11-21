// The accessibility audit of a rendered component: axe-core's WCAG 2 A and AA rules, run in the sandboxed page on
// the component's frame only. Each violation comes back with the design element it belongs to (the nearest
// data-figma-id), and whether it sits inside a design system's own internals (a shadow root), which the
// generated code does not write.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Page } from "playwright";
import type { A11yViolation } from "@tulpar/core";

let source: string | undefined;
const axeSource = () => (source ??= readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8"));

export async function auditA11y(page: Page, frameId: string): Promise<A11yViolation[]> {
  await page.evaluate(axeSource());
  return page.evaluate(async (frame) => {
    type Node = { target: (string | string[])[]; html: string };
    type Result = { id: string; impact?: string; help: string; helpUrl: string; nodes: Node[] };
    const axe = (globalThis as unknown as { axe: { run: (ctx: string, o: unknown) => Promise<{ violations: Result[] }> } }).axe;
    const { violations } = await axe.run(`#${frame}`, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] }, resultTypes: ["violations"] });
    return violations.map((v) => ({
      rule: v.id,
      ...(v.impact && { impact: v.impact }),
      help: v.help,
      helpUrl: v.helpUrl,
      nodes: v.nodes.slice(0, 5).map((n) => {
        // A target through a shadow root is an array of selectors: the design system's own markup.
        const inLibrary = n.target.some((t) => Array.isArray(t));
        const host = typeof n.target[0] === "string" ? document.querySelector(n.target[0]) : document.querySelector((n.target[0] as string[])[0]!);
        const figmaId = host?.closest("[data-figma-id]")?.getAttribute("data-figma-id") ?? undefined;
        return { target: n.target.flat().join(" >>> "), html: n.html.slice(0, 160), inLibrary, ...(figmaId && { figmaId }) };
      }),
    }));
  }, frameId);
}
