// What makes rendering Angular different: bootstrapping and change detection finish
// asynchronously, and a design-system element may be a component (its host element) or
// a directive on a native element (<button cdsButton>). Angular's development-mode `ng`
// API lists both; each is matched to the design-system exports by identity.

import type { FrameworkHooks } from "@tulpar/web-kit";
import { DESIGN_SYSTEM_GLOBAL, READY_FLAG } from "./build.ts";

export function angularHooks(known: Set<string>): FrameworkHooks {
  return {
    async settle(page) {
      const state = await page
        .waitForFunction((flag) => (window as unknown as Record<string, unknown>)[flag], READY_FLAG, { timeout: 20000 })
        .then((h) => h.jsonValue())
        .catch(() => "timeout");
      if (state === true) return [];
      return [state === "timeout" ? "Angular never became stable within 20 s." : `Angular failed to start: ${String(state).slice(0, 500)}`];
    },

    identify(page) {
      return page.evaluate(
        ({ knownNames, global }) => {
          const w = window as unknown as Record<string, unknown>;
          const ng = w.ng as { getComponent(el: Element): object | null; getDirectives(el: Element): object[] } | undefined;
          const byValue = new Map<unknown, string>();
          for (const [name, value] of Object.entries((w[global] as Record<string, unknown>) ?? {})) if (knownNames.includes(name) && !byValue.has(value)) byValue.set(value, name);
          const out: Record<string, { component: string; defined: boolean }> = {};
          for (const el of document.querySelectorAll<HTMLElement>("[data-figma-id]")) {
            const instances = ng ? [ng.getComponent(el), ...ng.getDirectives(el)].filter((x): x is object => !!x) : [];
            const named = instances.map((i) => byValue.get(i.constructor)).find((n): n is string => !!n);
            // A custom element Angular didn't turn into a component is unknown markup, not a design-system component.
            const unknownCustom = el.localName.includes("-") && !ng?.getComponent(el);
            out[el.dataset.figmaId!] = { component: named ?? el.localName, defined: !unknownCustom || !!named };
          }
          return out;
        },
        { knownNames: [...known], global: DESIGN_SYSTEM_GLOBAL },
      );
    },
  };
}
