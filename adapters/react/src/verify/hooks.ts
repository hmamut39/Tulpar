// What makes rendering React different: rendering finishes asynchronously, and the
// component behind a DOM element is found through React's fiber tree.
//
// A tagged DOM element carries `data-figma-id` because the component passed it down.
// Walking up the fibers that received the same `data-figma-id` finds every component
// in that chain; the outermost one that the index knows is the component the
// implementation used. A chain with no known component is a primitive the code invented.

import type { FrameworkHooks } from "@tulpar/web-kit";
import { DESIGN_SYSTEM_GLOBAL } from "./build.ts";

export function reactHooks(known: Set<string>): FrameworkHooks {
  return {
    async settle(page, frameId) {
      const ok = await page.evaluate(async (id) => {
        const frame = document.getElementById(id)!;
        // React commits asynchronously; wait until the tree stops changing.
        for (let quiet = 0, i = 0; quiet < 3 && i < 100; i++) {
          const before = frame.innerHTML.length;
          await new Promise((r) => requestAnimationFrame(() => r(null)));
          quiet = frame.innerHTML.length === before && frame.childElementCount > 0 ? quiet + 1 : 0;
        }
        return frame.childElementCount > 0;
      }, frameId);
      return ok ? [] : ["The React root rendered nothing into the frame."];
    },

    identify(page) {
      return page.evaluate(
        ({ knownNames, global }) => {
        const knownSet = new Set(knownNames);
        type Fiber = { type: unknown; return: Fiber | null; memoizedProps?: Record<string, unknown> };
        // Design-system components by identity: the export object itself, not its (possibly renamed) function name.
        const exportsByValue = new Map<unknown, string>();
        for (const [name, value] of Object.entries((window as unknown as Record<string, Record<string, unknown>>)[global] ?? {})) {
          if (knownSet.has(name) && value && !exportsByValue.has(value)) exportsByValue.set(value, name);
        }
        const nameOf = (type: unknown): string | undefined => {
          if (!type || typeof type === "string") return undefined;
          const exported = exportsByValue.get(type);
          if (exported) return exported;
          const t = type as { displayName?: string; name?: string; render?: { displayName?: string; name?: string }; type?: unknown };
          return t.displayName ?? t.render?.displayName ?? t.render?.name ?? (t.type ? nameOf(t.type) : undefined) ?? t.name;
        };
        const out: Record<string, { component: string; defined: boolean }> = {};
        for (const el of document.querySelectorAll<HTMLElement>("[data-figma-id]")) {
          const id = el.dataset.figmaId!;
          const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
          let fiber = key ? ((el as unknown as Record<string, Fiber>)[key] ?? null) : null;
          const chain: string[] = [];
          for (; fiber; fiber = fiber.return) {
            if (fiber.memoizedProps?.["data-figma-id"] !== id) {
              if (typeof fiber.type === "string") continue; // DOM wrappers between components
              break;
            }
            const name = nameOf(fiber.type);
            if (name) chain.push(name);
          }
          const outermostKnown = [...chain].reverse().find((n) => knownSet.has(n));
          out[id] = { component: outermostKnown ?? chain.at(-1) ?? el.localName, defined: true };
        }
        return out;
        },
        { knownNames: [...known], global: DESIGN_SYSTEM_GLOBAL },
      );
    },
  };
}
