// What makes rendering Svelte different: there is no component instance on an element, but in dev
// mode every element records where it was written (__svelte_meta): its own file and line, and a
// chain of parents, among them the component calls that led to it ({ type: "component", file, line,
// componentTag }). The component a tagged element belongs to is the component call the
// implementation itself wrote (a parent whose file is outside node_modules), named as it wrote it.
//
// A component that puts its attributes on an inner element (Carbon's TextInput on its <input>) is
// measured by its root: the topmost element belonging to the same component call.

import type { FrameworkHooks } from "@tulpar/web-kit";

/** `written`: figma id → the component the source wrote it on, for elements Svelte leaves unmarked. */
export function svelteHooks(written: Record<string, string> = {}): FrameworkHooks {
  return {
    async settle(page, frameId) {
      const ok = await page.evaluate(async (id) => {
        const frame = document.getElementById(id)!;
        for (let quiet = 0, i = 0; quiet < 3 && i < 100; i++) {
          const before = frame.innerHTML.length;
          await new Promise((r) => requestAnimationFrame(() => r(null)));
          quiet = frame.innerHTML.length === before && frame.childElementCount > 0 ? quiet + 1 : 0;
        }
        return frame.childElementCount > 0;
      }, frameId);
      return ok ? [] : ["The Svelte component rendered nothing into the frame."];
    },

    identify(page) {
      return page.evaluate((written) => {
        type Meta = { type?: string; file?: string; line?: number; componentTag?: string; loc?: { file: string; line: number }; parent?: Meta };
        const metaOf = (el: Element) => (el as unknown as { __svelte_meta?: Meta }).__svelte_meta;
        const fromPackage = (file?: string) => !!file && /[\\/]node_modules[\\/]/.test(file);
        // The component call the implementation wrote that this element came from, if any.
        const writtenCall = (el: Element): Meta | undefined => {
          for (let m = metaOf(el)?.parent; m; m = m.parent) if (m.type === "component" && !fromPackage(m.file)) return m;
          return undefined;
        };
        const same = (a?: Meta, b?: Meta) => !!a && !!b && a.file === b.file && a.line === b.line && a.componentTag === b.componentTag;
        const out: Record<string, { component: string; defined: boolean }> = {};
        for (const el of [...document.querySelectorAll<HTMLElement>("[data-figma-id]")]) {
          const id = el.dataset.figmaId!;
          const call = writtenCall(el);
          if (!call) {
            // An element Svelte created dynamically has no record at all; the source says what it was written as.
            const fallback = !metaOf(el) ? written[id] : undefined;
            if (!out[id] || fallback) out[id] = { component: fallback ?? el.localName, defined: true };
            continue;
          }
          // Up to the component's root element: the topmost ancestor from the same call.
          let rootEl: HTMLElement = el;
          for (let p = el.parentElement; p && same(writtenCall(p), call); p = p.parentElement) rootEl = p;
          if (rootEl !== el && !rootEl.hasAttribute("data-figma-id")) {
            rootEl.setAttribute("data-figma-id", id);
            el.removeAttribute("data-figma-id");
          }
          out[id] = { component: call.componentTag ?? el.localName, defined: true };
        }
        return out;
      }, written);
    },
  };
}
