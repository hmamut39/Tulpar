// What makes rendering Web Components different: custom elements register asynchronously,
// Lit renders asynchronously, and an element's component is its tag name.

import type { FrameworkHooks } from "@tulpar/web-kit";

export const webComponentHooks: FrameworkHooks = {
  async settle(page, frameId) {
    const undefinedTags = await page.evaluate(async (id) => {
      const frame = document.getElementById(id)!;
      const tags = [...new Set([...frame.querySelectorAll("*")].map((e) => e.localName).filter((n) => n.includes("-")))];
      const timeout = new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 5000));
      const missing: string[] = [];
      await Promise.all(tags.map(async (t) => ((await Promise.race([customElements.whenDefined(t), timeout])) === "timeout" ? missing.push(t) : undefined)));
      // Lit elements expose updateComplete; wait for every pending render.
      await Promise.all([...frame.querySelectorAll("*")].map((e) => (e as unknown as { updateComplete?: Promise<unknown> }).updateComplete));
      return missing;
    }, frameId);
    return undefinedTags.length ? [`Never registered (not imported?): ${undefinedTags.join(", ")}`] : [];
  },

  identify(page) {
    return page.evaluate(() =>
      Object.fromEntries(
        [...document.querySelectorAll<HTMLElement>("[data-figma-id]")].map((el) => [
          el.dataset.figmaId!,
          { component: el.localName, defined: !el.localName.includes("-") || !!customElements.get(el.localName) },
        ]),
      ),
    );
  },
};
