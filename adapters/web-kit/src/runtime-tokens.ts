// Design tokens a library defines at runtime: PrimeNG (--p-*), MUI (--mui-*) and Chakra
// (--chakra-*) inject their CSS custom properties when their provider starts, so no file holds
// them. A probe page (an empty component, with the project's setup applied) is rendered, and
// every custom property declared on :root, html, :host or the frame's root class is read back
// with its computed value: what components actually see.

import { pathToFileURL } from "node:url";
import { chromium, type Browser } from "playwright";
import type { DesignToken, TokenValue } from "@tulpar/core";
import { parseCssValue } from "./css-tokens.ts";
import { FRAME_ID, type RenderConfig } from "./harness.ts";
import type { FrameworkHooks } from "./render.ts";

export interface RuntimeTokenConfig {
  /** Only properties with this prefix (without "--"), e.g. "p" for --p-primary-color. */
  prefix?: string;
  /** Mode name → class that switches to it (set on <html> and the frame), e.g. { "dark": "p-dark" }. */
  modes?: Record<string, string>;
}

let browser: Browser | undefined;

export async function closeProbeBrowser(): Promise<void> {
  await browser?.close();
  browser = undefined;
}

export async function probeTokens(artifact: string, render: RenderConfig, framework: Pick<FrameworkHooks, "settle">, config: RuntimeTokenConfig): Promise<{ tokens: DesignToken[]; modes: string[]; gaps: string[] }> {
  browser ??= await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 200, height: 200 } });
  const gaps: string[] = [];
  try {
    await context.route("**/*", (route) => (/^(file|data):/.test(route.request().url()) ? route.continue() : route.abort()));
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(pathToFileURL(artifact).href, { waitUntil: "load" });
    if (render.rootClass) await page.evaluate(({ id, c }) => document.getElementById(id)?.classList.add(c), { id: FRAME_ID, c: render.rootClass });
    // The probe renders nothing on purpose, so the framework's "rendered nothing" warning is not a gap.
    await framework.settle(page, FRAME_ID);
    for (const e of errors) gaps.push(`Probe page error: ${e}`);

    const prefix = config.prefix ? `--${config.prefix}-` : "--";
    const read = () =>
      page.evaluate(({ id, prefix, rootClass }) => {
        const scopes = new Set([":root", "html", ":host", ...(rootClass ? [`.${rootClass}`] : [])]);
        const names = new Set<string>();
        const visit = (rules: CSSRuleList) => {
          for (const rule of Array.from(rules)) {
            if (rule instanceof CSSStyleRule) {
              // ":where(:root, :host)" (Chakra) and ":is(...)" wrap the same scopes.
              const selectors = rule.selectorText.replace(/:(where|is)\(([^()]*)\)/g, "$2").split(",");
              if (!selectors.some((s) => scopes.has(s.trim()))) continue;
              for (let i = 0; i < rule.style.length; i++) {
                const n = rule.style.item(i);
                if (n.startsWith(prefix)) names.add(n);
              }
            } else if ("cssRules" in rule) {
              try {
                visit((rule as CSSGroupingRule).cssRules);
              } catch {
                /* cross-origin or unreadable */
              }
            }
          }
        };
        for (const sheet of [...Array.from(document.styleSheets), ...document.adoptedStyleSheets]) {
          try {
            visit(sheet.cssRules);
          } catch {
            /* unreadable sheet */
          }
        }
        // Computed on the frame: it sees :root and the root class alike, with var() already substituted.
        const style = getComputedStyle(document.getElementById(id) ?? document.documentElement);
        return [...names].map((n) => [n, style.getPropertyValue(n).trim()] as const).filter(([, v]) => v !== "");
      }, { id: FRAME_ID, prefix, rootClass: render.rootClass ?? "" });

    const byMode = new Map<string, Map<string, string>>([["default", new Map(await read())]]);
    for (const [mode, cls] of Object.entries(config.modes ?? {})) {
      await page.evaluate(({ id, cls }) => {
        document.documentElement.classList.add(cls);
        document.getElementById(id)?.classList.add(cls);
      }, { id: FRAME_ID, cls });
      byMode.set(mode, new Map(await read()));
      await page.evaluate(({ id, cls }) => {
        document.documentElement.classList.remove(cls);
        document.getElementById(id)?.classList.remove(cls);
      }, { id: FRAME_ID, cls });
    }

    const defaults = byMode.get("default")!;
    if (!defaults.size) gaps.push(`The probe page defines no ${prefix}* custom properties: the setup may not start the design system's theme.`);
    const tokens: DesignToken[] = [...defaults.keys()].sort().map((property) => {
      const values: Record<string, TokenValue> = {};
      for (const [mode, props] of byMode) {
        const v = props.get(property);
        if (v !== undefined && (mode === "default" || v !== defaults.get(property))) values[mode] = parseCssValue(v);
      }
      const kinds = new Set(Object.values(values).map((v) => v.kind));
      const name = property.slice(2);
      return {
        name,
        path: name.split("-"),
        type: kinds.has("color") ? "color" : kinds.has("dimension") ? "dimension" : kinds.has("number") ? "number" : "other",
        values,
        codeRef: `var(${property})`,
        codeRefConfirmed: true,
        provenance: { source: "runtime-probe", confidence: "high", note: "read from the page after the design system's setup ran" },
      };
    });
    return { tokens, modes: [...byMode.keys()], gaps };
  } finally {
    await context.close();
  }
}
