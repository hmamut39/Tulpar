// Interaction states, rendered the way a person causes them: the real mouse hovers and presses
// (released away from the element, so nothing is clicked or submitted), and the keyboard focuses.
// For each interactive element: how much of it changes, whether its box moves, and which colours
// appear that were not there at rest. Transitions are switched off so each state is captured settled.

import type { Page } from "playwright";
import { compareImages, type StateFact } from "@tulpar/core";

const INTERACTIVE = 'button, input:not([type="hidden"]), select, textarea, a[href], [tabindex]:not([tabindex="-1"]), [role="button"], [role="checkbox"], [role="switch"], [role="radio"], [role="tab"], [role="slider"]';
// Room around the element for a focus ring or shadow drawn outside its box.
const PAD = 6;

export async function measureStates(page: Page, frameId: string): Promise<StateFact[]> {
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; caret-color: transparent !important; }" });
  // Tagged elements holding exactly one control: a button, a field, a checkbox. Containers of several are not one control.
  const targets = await page.evaluate(
    ({ frameId, selector }) => {
      const frame = document.getElementById(frameId)!;
      const out: { figmaId: string; x: number; y: number; width: number; height: number }[] = [];
      for (const el of frame.querySelectorAll<HTMLElement>("[data-figma-id]")) {
        const controls = [...(el.matches(selector) ? [el] : []), ...el.querySelectorAll<HTMLElement>(selector)].filter((c) => (c as HTMLInputElement).disabled !== true);
        if (controls.length !== 1) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) continue;
        out.push({ figmaId: el.dataset.figmaId!, x: r.x, y: r.y, width: r.width, height: r.height });
      }
      return out;
    },
    { frameId, selector: INTERACTIVE },
  );

  const facts: StateFact[] = [];
  for (const t of targets.slice(0, 24)) {
    const clip = { x: Math.max(0, t.x - PAD), y: Math.max(0, t.y - PAD), width: t.width + 2 * PAD, height: t.height + 2 * PAD };
    const at = { x: t.x + t.width / 2, y: t.y + t.height / 2 };
    const rest = await capture(page, t.figmaId, clip);
    for (const state of ["hover", "pressed", "focus"] as const) {
      if (state === "hover") await page.mouse.move(at.x, at.y);
      if (state === "pressed") {
        await page.mouse.move(at.x, at.y);
        await page.mouse.down();
      }
      if (state === "focus") {
        // A key press first, so the browser treats the focus as keyboard focus (:focus-visible).
        await page.keyboard.press("Shift");
        await page.evaluate(
          ({ id, selector }) => {
            const el = document.querySelector<HTMLElement>(`[data-figma-id="${CSS.escape(id)}"]`);
            const control = el && (el.matches(selector) ? el : el.querySelector<HTMLElement>(selector));
            control?.focus({ preventScroll: true });
          },
          { id: t.figmaId, selector: INTERACTIVE },
        );
      }
      const now = await capture(page, t.figmaId, clip);
      // Back to rest: release away from the element (no click), and drop focus.
      await page.mouse.move(0, 0);
      if (state === "pressed") await page.mouse.up();
      if (state === "focus") await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      const cmp = rest.png && now.png ? compareImages(now.png, rest.png) : undefined;
      const changed = cmp?.mismatch ?? 0;
      const shifted = Math.abs(now.box.x - rest.box.x) > 0.5 || Math.abs(now.box.y - rest.box.y) > 0.5 || Math.abs(now.box.width - rest.box.width) > 0.5 || Math.abs(now.box.height - rest.box.height) > 0.5;
      facts.push({ figmaId: t.figmaId, state, changed: Math.round(changed * 1000) / 1000, changedPixels: cmp ? Math.round(changed * cmp.width * cmp.height) : 0, shifted, colors: now.colors.filter((c) => !rest.colors.includes(c)) });
    }
  }
  return facts;
}

/** The element's pixels (with room for a ring), its box, and every colour it and its descendants paint. */
async function capture(page: Page, figmaId: string, clip: { x: number; y: number; width: number; height: number }) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));
  const info = await page.evaluate((id) => {
    const el = document.querySelector<HTMLElement>(`[data-figma-id="${CSS.escape(id)}"]`)!;
    // The layout box, without transforms: a press that only translates or scales the element (shadcn's
    // Button moves down 1px) moves nothing around it, so it is no layout shift. Padding, border or size do.
    let x = 0;
    let y = 0;
    for (let n: HTMLElement | null = el; n; n = n.offsetParent as HTMLElement | null) {
      x += n.offsetLeft;
      y += n.offsetTop;
    }
    const r = { x, y, width: el.offsetWidth, height: el.offsetHeight };
    const colors = new Set<string>();
    const opaque = (c: string) => c && !/^rgba\(.*,\s*0\)$/.test(c) && c !== "transparent";
    for (const node of [el, ...el.querySelectorAll<HTMLElement>("*")]) {
      const s = getComputedStyle(node);
      if (s.visibility === "hidden" || s.display === "none") continue;
      for (const c of [s.backgroundColor, s.color, s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0 ? s.outlineColor : "", s.borderTopStyle !== "none" && parseFloat(s.borderTopWidth) > 0 ? s.borderTopColor : ""]) if (c && opaque(c)) colors.add(c);
      for (const m of s.boxShadow.matchAll(/rgba?\([^)]*\)/g)) if (opaque(m[0])) colors.add(m[0]);
    }
    return { box: { x: r.x, y: r.y, width: r.width, height: r.height }, colors: [...colors] };
  }, figmaId);
  const png = await page.screenshot({ type: "png", clip }).catch(() => undefined);
  return { ...info, png };
}
