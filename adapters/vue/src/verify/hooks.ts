// What makes rendering Vue different: updates flush asynchronously, and the component behind a
// DOM element is the instance recorded on it (`__vueParentComponent`, kept by the devtools flag).
//
// A tagged element carries `data-figma-id` because the attribute fell through from the component
// the implementation wrote it on. Walking up the instances that received the same `data-figma-id`
// finds every component in that chain; the outermost one the index knows is the component the
// implementation used. A chain with no known component is markup the code wrote itself.

import type { FrameworkHooks } from "@tulpar/web-kit";
import { DESIGN_SYSTEM_GLOBAL } from "./build.ts";

export function vueHooks(known: Set<string>): FrameworkHooks {
  return {
    async settle(page, frameId) {
      const ok = await page.evaluate(async (id) => {
        const frame = document.getElementById(id)!;
        // Vue flushes updates on a microtask and async components later; wait until the tree stops changing.
        for (let quiet = 0, i = 0; quiet < 3 && i < 100; i++) {
          const before = frame.innerHTML.length;
          await new Promise((r) => requestAnimationFrame(() => r(null)));
          quiet = frame.innerHTML.length === before && frame.childElementCount > 0 ? quiet + 1 : 0;
        }
        return frame.childElementCount > 0;
      }, frameId);
      return ok ? [] : ["The Vue app rendered nothing into the frame."];
    },

    identify(page) {
      return page.evaluate(
        ({ knownNames, global }) => {
          const knownSet = new Set(knownNames);
          type Instance = { type: unknown; parent: Instance | null; vnode: { props: Record<string, unknown> | null } };
          // Design-system components by identity: the exported object itself.
          const byValue = new Map<unknown, string>();
          for (const [name, value] of Object.entries((window as unknown as Record<string, Record<string, unknown>>)[global] ?? {})) {
            if (knownSet.has(name) && value && !byValue.has(value)) byValue.set(value, name);
          }
          const nameOf = (type: unknown): string | undefined => {
            const exported = byValue.get(type);
            if (exported) return exported;
            const t = type as { name?: string; __name?: string } | null;
            return t?.name ?? t?.__name;
          };
          const out: Record<string, { component: string; defined: boolean }> = {};
          for (const el of document.querySelectorAll<HTMLElement>("[data-figma-id]")) {
            const id = el.dataset.figmaId!;
            const chain: string[] = [];
            // Up through the components that received the id; a few in between may not pass it on by
            // name (a wrapper rendering a slot), so the walk steps over up to 3 of them.
            let misses = 0;
            for (let inst = (el as unknown as { __vueParentComponent?: Instance }).__vueParentComponent ?? null; inst && misses <= 3; inst = inst.parent) {
              if (inst.vnode.props?.["data-figma-id"] !== id) {
                misses++;
                continue;
              }
              misses = 0;
              const name = nameOf(inst.type);
              if (name) chain.push(name);
            }
            const outermostKnown = [...chain].reverse().find((n) => knownSet.has(n));
            // A component that binds its attributes to an inner element (Element Plus's input puts them on
            // the native <input>) would be measured by that inner box. The design's box is the whole
            // component, so the id moves to the component's root element before anything is measured.
            if (outermostKnown) {
              for (let inst = (el as unknown as { __vueParentComponent?: Instance }).__vueParentComponent ?? null; inst; inst = inst.parent) {
                if (nameOf(inst.type) !== outermostKnown) continue;
                const rootEl = (inst as unknown as { vnode: { el: unknown } }).vnode.el;
                if (rootEl instanceof HTMLElement && rootEl !== el && rootEl.contains(el) && !rootEl.hasAttribute("data-figma-id")) {
                  rootEl.setAttribute("data-figma-id", id);
                  el.removeAttribute("data-figma-id");
                }
                break;
              }
            }
            // Several elements can carry one id (an inner input copying attributes): a known component wins.
            if (out[id] && knownSet.has(out[id].component) && !outermostKnown) continue;
            // An unresolved component stays in the DOM as an unknown custom tag (<el-buton>).
            const unresolved = !chain.length && el.localName.includes("-") && !customElements.get(el.localName);
            out[id] = { component: outermostKnown ?? chain.at(-1) ?? el.localName, defined: !unresolved };
          }
          return out;
        },
        { knownNames: [...known], global: DESIGN_SYSTEM_GLOBAL },
      );
    },
  };
}
