// Why an element is out of place. The layout check measures where each element landed; a repair needs to
// know what put it there. An element's place along its parent's auto layout is set by what comes before it:
// the parent's padding (the first child) or the space after the previous sibling (the gap). Comparing that
// space in the design and in the render names the cause, and the spacing token of the design's value.
// An element that moved only because the one before it (or its container) is off is told to fix that first.

import type { TokenSet } from "../code-model.ts";
import type { Box, DesignNode } from "../model.ts";
import { tokenKind } from "./token-kind.ts";
import type { RenderedElement } from "./types.ts";

const round = (n: number) => Math.round(n * 10) / 10;

/** The visible child list each node sits in, with its parent. */
function parents(root: DesignNode): Map<string, DesignNode> {
  const out = new Map<string, DesignNode>();
  const visit = (n: DesignNode) => {
    if (!("children" in n)) return;
    for (const c of n.children) {
      out.set(c.id, n);
      visit(c);
    }
  };
  visit(root);
  return out;
}

/** The spacing tokens worth exactly `px`, as code writes them. */
export function spacingTokens(px: number, tokens: TokenSet | undefined): string[] {
  if (!tokens || px <= 0) return [];
  return tokens.tokens
    .filter((t) => tokenKind(t.name, t.type) === "spacing")
    .filter((t) => {
      const v = t.values.default ?? Object.values(t.values)[0];
      return v?.kind === "dimension" && Math.abs(v.points - px) < 0.5;
    })
    .map((t) => `var(--${/var\(\s*--([\w-]+)/.exec(t.codeRef ?? "")?.[1] ?? t.name})`)
    .slice(0, 2);
}

const tokenNote = (px: number, tokens: TokenSet | undefined) => {
  const names = spacingTokens(px, tokens);
  return names.length ? ` (${names.join(" or ")})` : "";
};

/**
 * The likely cause of an element's misplacement along its parent's axis, or undefined when the element's
 * own size is what is off (the type hint covers that) or the design gives no auto layout to reason from.
 */
export function layoutCause(node: DesignNode, root: DesignNode, rendered: Map<string, RenderedElement>, tokens: TokenSet | undefined, tolerance: number): string | undefined {
  const parent = parents(root).get(node.id);
  const el = rendered.get(node.id);
  if (!parent || !el || !node.box || !parent.box || !("children" in parent)) return undefined;
  const stack = "stack" in parent ? parent.stack : undefined;
  // Without auto layout (layers placed by hand), the axis is the one the element is off along.
  const v = stack ? stack.axis === "vertical" : Math.abs(el.box.y - node.box.y) > tolerance;
  const start = (b: Box) => (v ? b.y : b.x);
  const end = (b: Box) => (v ? b.y + b.height : b.x + b.width);
  const off = (want: Box, got: Box) => Math.abs(start(got) - start(want)) > tolerance || Math.abs(end(got) - end(want)) > tolerance;
  if (Math.abs(start(el.box) - start(node.box)) <= tolerance) return undefined;
  const parentEl = rendered.get(parent.id);
  const shift = start(el.box) - start(node.box);
  // The container itself moved by about as much: the cause is above this element.
  if (parentEl && parent !== root && Math.abs(start(parentEl.box) - start(parent.box) - shift) <= tolerance) {
    return `it moved with its container "${parent.name}", which is off by the same: fix the container first`;
  }
  const siblings = parent.children.filter((c) => c.visible && c.box && c.id !== node.id);
  const across = (b: Box) => (v ? [b.x, b.x + b.width] : [b.y, b.y + b.height]) as [number, number];
  const [a0, a1] = across(node.box);
  // The element just before it: in auto layout the previous child; otherwise the nearest layer that ends
  // before it starts and lies beside it on the other axis (the line above, the column to the left).
  const prev = stack
    ? parent.children.filter((c) => c.visible && c.box)[parent.children.filter((c) => c.visible && c.box).findIndex((c) => c.id === node.id) - 1]
    : siblings
        .filter((c) => end(c.box!) <= start(node.box!) + 0.5)
        .filter((c) => {
          const [b0, b1] = across(c.box!);
          return b0 < a1 && b1 > a0;
        })
        .sort((x, y) => end(y.box!) - end(x.box!))[0];
  const prevEl = prev && rendered.get(prev.id);
  if (prev && prevEl) {
    const designGap = start(node.box) - end(prev.box!);
    const renderGap = start(el.box) - end(prevEl.box);
    if (Math.abs(renderGap - designGap) > tolerance) {
      const grew = Math.abs(end(prevEl.box) - end(prev.box!)) > 0.5 ? `; "${prev.name}" also ends ${round(end(prevEl.box) - end(prev.box!))}px ${end(prevEl.box) > end(prev.box!) ? "later" : "earlier"} than in the design (its ${v ? "height or line height" : "width"})` : "";
      return `the space between "${prev.name}" and it is ${round(renderGap)}px, the design's is ${round(designGap)}px${stack && designGap === stack.gap ? ` ("${parent.name}"'s gap)` : ""}: set that space to ${round(designGap)}px${tokenNote(designGap, tokens)}${grew}`;
    }
    if (off(prev.box!, prevEl.box)) return `it follows "${prev.name}", which is out of place or of the wrong ${v ? "height" : "width"}: fix that first`;
    return undefined;
  }
  if (!prev && parentEl) {
    const designPad = start(node.box) - start(parent.box);
    const renderPad = start(el.box) - start(parentEl.box);
    if (Math.abs(renderPad - designPad) > tolerance) {
      return `it sits ${round(renderPad)}px from the ${v ? "top" : "left"} of "${parent.name}", the design's ${round(designPad)}px${stack && designPad === (v ? stack.padding.top : stack.padding.left) ? " (its padding)" : ""}: set that to ${round(designPad)}px${tokenNote(designPad, tokens)}`;
    }
  }
  return undefined;
}
