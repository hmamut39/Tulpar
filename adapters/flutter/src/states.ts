// Interaction states of a Flutter widget, caused the way a person causes them: the real mouse hovers
// and presses (released away, so nothing is tapped), and the keyboard focuses (Tab first, so Flutter
// shows its keyboard focus highlight). Flutter paints on a canvas, so the colours a state adds are
// read from its pixels, not from CSS.

import type { Page } from "playwright";
import { PNG } from "pngjs";
import { compareImages, type StateFact } from "@tulpar/core";

const PAD = 6;
const INTERACTIVE = '[role="button"], [role="checkbox"], [role="switch"], [role="radio"], [role="tab"], [role="slider"], input, textarea, [flt-tappable]';

export async function measureFlutterStates(page: Page): Promise<StateFact[]> {
  const targets = await page.evaluate((selector) => {
    const out: { figmaId: string; x: number; y: number; width: number; height: number }[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("[flt-semantics-identifier]")) {
      // One control directly in this node (not under another tagged node): a button, a field, a
      // checkbox. A node holding several is a container.
      const own = [...(el.matches(selector) ? [el] : []), ...el.querySelectorAll<HTMLElement>(selector)].filter((c) => c === el || c.parentElement?.closest("[flt-semantics-identifier]") === el);
      if (own.length !== 1) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      out.push({ figmaId: el.getAttribute("flt-semantics-identifier")!, x: r.x, y: r.y, width: r.width, height: r.height });
    }
    return out;
  }, INTERACTIVE);

  // Flutter takes a page's first mouse events to register the mouse itself, not as hovering:
  // move once before measuring, or the first control's hover is missed.
  await page.mouse.move(1, 1);
  await page.mouse.move(3, 3, { steps: 3 });
  const facts: StateFact[] = [];
  for (const t of targets.slice(0, 24)) {
    const clip = { x: Math.max(0, t.x - PAD), y: Math.max(0, t.y - PAD), width: t.width + 2 * PAD, height: t.height + 2 * PAD };
    const at = { x: t.x + t.width / 2, y: t.y + t.height / 2 };
    const rest = await shot(page, clip);
    for (const state of ["hover", "pressed", "focus"] as const) {
      // In steps, as a hand moves: one jump does not always register as hovering in Flutter.
      if (state !== "focus") await page.mouse.move(at.x, at.y, { steps: 6 });
      if (state === "pressed") await page.mouse.down();
      // Focus as keyboard users reach it (calling .focus() on the page's element does not move Flutter's
      // own focus). A key press first: any key switches Flutter to keyboard mode, where focus is drawn.
      // The press before may have focused the control already, and a Tab would then move away from it;
      // otherwise Tab forward, then back, until it is reached.
      if (state === "focus") {
        const there = () => page.evaluate((id) => !!document.activeElement?.closest(`[flt-semantics-identifier="${CSS.escape(id)}"]`), t.figmaId);
        await page.keyboard.press("Shift");
        for (const key of ["Tab", "Shift+Tab"]) {
          for (let i = 0; i < 30 && !(await there()); i++) await page.keyboard.press(key);
          if (await there()) break;
        }
      }
      const now = await shot(page, clip);
      await page.mouse.move(0, 0);
      if (state === "pressed") await page.mouse.up();

      await settle(page);
      // The same render against itself: sensitive enough for Material's state layers (an 8–12% tint).
      const cmp = rest && now ? compareImages(now, rest, 1, 0.02) : undefined;
      const changed = cmp?.mismatch ?? 0;
      facts.push({ figmaId: t.figmaId, state, changed: Math.round(changed * 1000) / 1000, changedPixels: cmp ? Math.round(changed * cmp.width * cmp.height) : 0, shifted: false, colors: rest && now ? addedColors(rest, now) : [] });
    }
  }
  return facts;
}

/** Waits out Flutter's state animations (ink splashes, hover overlays) before a capture. */
async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(450);
}

async function shot(page: Page, clip: { x: number; y: number; width: number; height: number }): Promise<Buffer | undefined> {
  await settle(page);
  return page.screenshot({ type: "png", clip }).catch(() => undefined);
}

/** Colours painted on at least 2% of the pixels in the state and on none at rest, as CSS rgb() strings. */
function addedColors(restPng: Buffer, nowPng: Buffer): string[] {
  const count = (png: Buffer) => {
    const img = PNG.sync.read(png);
    const m = new Map<string, number>();
    for (let i = 0; i < img.data.length; i += 4) {
      // Quantised a little, so anti-aliasing does not make every edge pixel a colour of its own.
      const key = `${img.data[i]! & 0xfc},${img.data[i + 1]! & 0xfc},${img.data[i + 2]! & 0xfc}`;
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return { m, total: img.width * img.height };
  };
  const rest = count(restPng);
  const now = count(nowPng);
  return [...now.m].filter(([k, n]) => n / now.total >= 0.02 && !rest.m.has(k)).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k]) => `rgb(${k.split(",").join(", ")})`);
}
