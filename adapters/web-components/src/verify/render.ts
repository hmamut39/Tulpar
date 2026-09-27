// Render: load the built harness in headless Chromium, then report what was drawn.
//
// - The network is blocked: only local files load, so a render never depends on a CDN.
// - Style provenance comes from the Chrome DevTools Protocol (CSS.getMatchedStylesForNode),
//   which shows the declaration that set a value — `var(--token)` or a literal.
//   getComputedStyle cannot tell those apart.

import { platform, release } from "node:os";
import { pathToFileURL } from "node:url";
import { chromium, type Browser, type CDPSession } from "playwright";
import type { RenderParams, RenderResult, RenderedElement, StyleFact } from "@tulpar/core";
import { classify } from "./css.ts";
import { FRAME_ID, IMPL_SOURCE_URL, type RenderConfig } from "./build.ts";

let browser: Browser | undefined;

export async function closeBrowser(): Promise<void> {
  await browser?.close();
  browser = undefined;
}

export async function render(params: RenderParams, config: RenderConfig, prefix: string, entry: string): Promise<RenderResult> {
  browser ??= await chromium.launch();
  const context = await browser.newContext({ viewport: { width: Math.ceil(params.width), height: Math.ceil(params.height) }, deviceScaleFactor: params.scale });
  const warnings: string[] = [];
  try {
    const blocked = new Set<string>();
    await context.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith("file:") || url.startsWith("data:")) return route.continue();
      blocked.add(new URL(url).host);
      return route.abort();
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    const cdp = await context.newCDPSession(page);
    const implSheets = new Set<string>();
    cdp.on("CSS.styleSheetAdded", ({ header }) => {
      if (header.sourceURL === IMPL_SOURCE_URL) implSheets.add(header.styleSheetId);
    });
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");

    await page.goto(pathToFileURL(params.artifact).href, { waitUntil: "load" });
    const themeClass = params.theme ? config.themes?.[params.theme] : undefined;
    if (params.theme && !themeClass) warnings.push(`Theme "${params.theme}" has no class configured; rendered with the default theme.`);

    const settle = await page.evaluate(
      async ({ frameId, themeClass }) => {
        const frame = document.getElementById(frameId)!;
        if (themeClass) frame.classList.add(themeClass);
        const tags = [...new Set([...frame.querySelectorAll("*")].map((e) => e.localName).filter((n) => n.includes("-")))];
        const timeout = new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 5000));
        const undefinedTags: string[] = [];
        await Promise.all(tags.map(async (t) => ((await Promise.race([customElements.whenDefined(t), timeout])) === "timeout" ? undefinedTags.push(t) : undefined)));
        // Lit elements expose updateComplete; wait for every pending render.
        await Promise.all([...frame.querySelectorAll("*")].map((e) => (e as unknown as { updateComplete?: Promise<unknown> }).updateComplete));
        await document.fonts.ready;
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return { undefinedTags };
      },
      { frameId: FRAME_ID, themeClass },
    );
    if (settle.undefinedTags.length) warnings.push(`Never registered (not imported?): ${settle.undefinedTags.join(", ")}`);
    if (blocked.size) warnings.push(`Blocked network requests to: ${[...blocked].join(", ")}`);
    for (const e of errors) warnings.push(`Page error: ${e}`);

    const facts = await page.evaluate((frameId) => {
      const frame = document.getElementById(frameId)!.getBoundingClientRect();
      return [...document.querySelectorAll<HTMLElement>("[data-figma-id]")].map((el) => {
        const r = el.getBoundingClientRect();
        return {
          figmaId: el.dataset.figmaId!,
          component: el.localName,
          defined: !el.localName.includes("-") || !!customElements.get(el.localName),
          box: { x: r.x - frame.x, y: r.y - frame.y, width: r.width, height: r.height },
          text: (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim(),
          visible: el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) && r.width > 0 && r.height > 0,
        };
      });
    }, FRAME_ID);

    const styles = await styleFacts(cdp, implSheets, prefix, entry);
    const elements: RenderedElement[] = facts.map((f) => ({ ...f, styles: styles.get(f.figmaId)?.facts ?? [], fonts: styles.get(f.figmaId)?.fonts ?? [] }));
    // Fonts the project requires but that drew none of the tagged text: text metrics are then untrustworthy.
    const used = new Set(elements.flatMap((e) => e.fonts));
    const missing = (config.fonts ?? []).filter((f) => !used.has(f));
    if (missing.length && elements.some((e) => e.text)) warnings.push(`Required fonts drew no text: ${missing.join(", ")} (used: ${[...used].join(", ") || "none"}). Text sizes are untrustworthy.`);
    const png = (await page.locator(`#${FRAME_ID}`).screenshot({ type: "png" })).toString("base64");
    return { status: "ok", png, elements, renderer: { name: "chromium", version: browser.version(), os: `${platform()} ${release()}` }, warnings };
  } catch (err) {
    return { status: "failed", reason: err instanceof Error ? err.message : String(err) };
  } finally {
    await context.close();
  }
}

interface CssProperty {
  name: string;
  value: string;
  implicit?: boolean;
  disabled?: boolean;
  parsedOk?: boolean;
  range?: { startLine: number };
}

/**
 * Font families the renderer actually used to draw an element's text. Chrome reports
 * fonts per text node, so this gathers every text node below the element, including
 * inside shadow roots.
 */
async function fontsDrawing(cdp: CDPSession, nodeId: number): Promise<string[]> {
  const { node } = await cdp.send("DOM.describeNode", { nodeId, depth: -1, pierce: true });
  const backendNodeIds: number[] = [];
  const walk = (n: typeof node) => {
    if (n.nodeType === 3 && n.nodeValue.trim()) backendNodeIds.push(n.backendNodeId);
    for (const c of [...(n.children ?? []), ...(n.shadowRoots ?? [])]) walk(c);
  };
  walk(node);
  if (!backendNodeIds.length) return [];
  const { nodeIds } = await cdp.send("DOM.pushNodesByBackendIdsToFrontend", { backendNodeIds });
  const families = new Set<string>();
  for (const id of nodeIds) {
    const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId: id }).catch(() => ({ fonts: [] }));
    for (const f of fonts) if (f.glyphCount > 0) families.add(f.familyName);
  }
  return [...families];
}

/** For each tagged element: the declarations the implementation's own code applies to it. */
async function styleFacts(cdp: CDPSession, implSheets: Set<string>, prefix: string, entry: string): Promise<Map<string, { facts: StyleFact[]; fonts: string[] }>> {
  const out = new Map<string, { facts: StyleFact[]; fonts: string[] }>();
  const { root } = await cdp.send("DOM.getDocument", { depth: -1 });
  const { nodeIds } = await cdp.send("DOM.querySelectorAll", { nodeId: root.nodeId, selector: "[data-figma-id]" });
  for (const nodeId of nodeIds) {
    const { attributes } = await cdp.send("DOM.getAttributes", { nodeId });
    const figmaId = attributes[attributes.indexOf("data-figma-id") + 1]!;
    const matched = await cdp.send("CSS.getMatchedStylesForNode", { nodeId });
    const facts: StyleFact[] = [];
    const add = (props: CssProperty[], at: (p: CssProperty) => string) => {
      for (const p of props) {
        if (p.implicit || p.disabled || p.parsedOk === false || !p.value) continue;
        const fact = classify(p.name, p.value, prefix, at(p));
        if (fact) facts.push(fact);
      }
    };
    // Rules come in ascending cascade order; only the implementation's own stylesheet counts.
    for (const m of matched.matchedCSSRules ?? []) {
      if (!m.rule.styleSheetId || !implSheets.has(m.rule.styleSheetId)) continue;
      add(m.rule.style.cssProperties as CssProperty[], () => `${entry} <style>, rule "${m.rule.selectorList.text}"`);
    }
    if (matched.inlineStyle) add(matched.inlineStyle.cssProperties as CssProperty[], () => `${entry} style attribute on data-figma-id="${figmaId}"`);
    out.set(figmaId, { facts, fonts: await fontsDrawing(cdp, nodeId) });
  }
  return out;
}
