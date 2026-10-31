// The site in the sandboxed browser, every other host blocked, and a control's interaction states, caused the way
// a person causes them. Compose paints on a canvas, so the colours a state adds are read from its pixels.

import { compareImages, type StateFact } from "@tulpar/core";
import { serving } from "@tulpar/web-kit";
import { chromium, type Browser, type Page } from "playwright";
import { PNG } from "pngjs";

/** Elements a Modifier.testTag made: Compose's accessibility page gives them the tag as their id. */
export const TAGGED = "#cmp_a11y_root [id]";
const CONTROL = '[role="button"], [role="checkbox"], [role="switch"], [role="radio"], [role="tab"], [role="slider"], [role="textbox"], [contenteditable="true"]';
const PAD = 6;

let browser: Browser | undefined;

export async function closeBrowser(): Promise<void> {
  await browser?.close();
  browser = undefined;
}

export function withSite<T>(dir: string, viewport: { width: number; height: number; scale?: number }, fn: (page: Page, blocked: Set<string>) => Promise<T>): Promise<T> {
  return serving(dir, async (url) => {
    const here = new URL(url).host;
    browser ??= await chromium.launch({ args: ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"] });
    const context = await browser.newContext({ viewport: { width: Math.ceil(viewport.width), height: Math.ceil(viewport.height) }, deviceScaleFactor: viewport.scale ?? 1 });
    const blocked = new Set<string>();
    await context.route("**/*", (route) => {
      const host = new URL(route.request().url()).host;
      if (host === here) return route.continue();
      blocked.add(host);
      return route.abort();
    });
    try {
      const page = await context.newPage();
      await page.goto(url);
      return await fn(page, blocked);
    } finally {
      await context.close();
    }
  });
}

export async function measureComposeStates(page: Page): Promise<StateFact[]> {
  // Through Playwright's selector: Compose keeps this page in a shadow root, which document.querySelector cannot see.
  const targets = await page.$$eval(
    TAGGED,
    (els, control) =>
      els
        .filter((el) => el.matches(control))
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { figmaId: el.id, x: r.x, y: r.y, width: r.width, height: r.height };
        })
        .filter((t) => t.width >= 4 && t.height >= 4),
    CONTROL,
  );
  const facts: StateFact[] = [];
  for (const t of targets.slice(0, 24)) {
    const clip = { x: Math.max(0, t.x - PAD), y: Math.max(0, t.y - PAD), width: t.width + 2 * PAD, height: t.height + 2 * PAD };
    const at = { x: t.x + t.width / 2, y: t.y + t.height / 2 };
    const rest = await shot(page, clip);
    for (const state of ["hover", "pressed", "focus"] as const) {
      if (state !== "focus") await page.mouse.move(at.x, at.y, { steps: 6 });
      if (state === "pressed") await page.mouse.down();
      // Compose moves focus inside its canvas, not the page's: a control is reached when Tab changes its pixels.
      // Tab goes through the controls in order, which is the order they are measured in.
      let reached: Buffer | undefined;
      if (state === "focus") {
        for (let i = 0; i < 8 && !reached; i++) {
          await page.keyboard.press("Tab");
          const seen = await shot(page, clip);
          if (rest && seen && compareImages(seen, rest, 1, 0.02).mismatch > 0.002) reached = seen;
        }
        // Not reachable by keyboard: it has no focus to show, so its focus is not judged.
        if (!reached) continue;
      }
      const now = reached ?? (await shot(page, clip));
      await page.mouse.move(0, 0);
      if (state === "pressed") await page.mouse.up();
      // The same render against itself: sensitive enough for Material's state layers (an 8–12% tint).
      const cmp = rest && now ? compareImages(now, rest, 1, 0.02) : undefined;
      const changed = cmp?.mismatch ?? 0;
      facts.push({ figmaId: t.figmaId, state, changed: Math.round(changed * 1000) / 1000, changedPixels: cmp ? Math.round(changed * cmp.width * cmp.height) : 0, shifted: false, colors: rest && now ? addedColors(rest, now) : [] } as StateFact);
    }
  }
  return facts;
}

async function shot(page: Page, clip: { x: number; y: number; width: number; height: number }): Promise<Buffer | undefined> {
  await page.waitForTimeout(450); // state animations
  return page.screenshot({ type: "png", clip }).catch(() => undefined);
}

/** Colours painted on at least 2% of the pixels in the state and on none at rest, as CSS rgb() strings. */
function addedColors(restPng: Buffer, nowPng: Buffer): string[] {
  const count = (png: Buffer) => {
    const img = PNG.sync.read(png);
    const m = new Map<string, number>();
    for (let i = 0; i < img.data.length; i += 4) {
      const key = `${img.data[i]! & 0xfc},${img.data[i + 1]! & 0xfc},${img.data[i + 2]! & 0xfc}`;
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return { m, total: img.width * img.height };
  };
  const rest = count(restPng);
  const now = count(nowPng);
  return [...now.m].filter(([k, n]) => n / now.total >= 0.02 && !rest.m.has(k)).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k]) => `rgb(${k.split(",").join(", ")})`);
}
