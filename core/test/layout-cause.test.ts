// Why an element is out of place: the space before it, its container, or the element before it.

import { describe, expect, it } from "vitest";
import type { TokenSet } from "../src/code-model.ts";
import type { Box, DesignNode } from "../src/model.ts";
import type { RenderedElement } from "../src/verify/types.ts";
import { layoutCause, spacingTokens } from "../src/verify/layout-cause.ts";

const box = (x: number, y: number, width: number, height: number): Box => ({ x, y, width, height });
const text = (id: string, b: Box) => ({ id, name: id, kind: "text", visible: true, box: b, style: {}, fills: [] }) as unknown as DesignNode;
const frame = (id: string, b: Box, children: DesignNode[], stack?: { axis: "vertical" | "horizontal"; gap: number; padding: number }) =>
  ({
    id,
    name: id,
    kind: "container",
    visible: true,
    box: b,
    fills: [],
    children,
    ...(stack && { stack: { axis: stack.axis, gap: stack.gap, padding: { top: stack.padding, right: stack.padding, bottom: stack.padding, left: stack.padding }, mainAlign: "start", crossAlign: "start", wrap: false, reverseZ: false } }),
  }) as unknown as DesignNode;
const kids = (n: DesignNode) => (n as unknown as { children: DesignNode[] }).children;
const rendered = (boxes: Record<string, Box>) => new Map(Object.entries(boxes).map(([id, b]) => [id, { figmaId: id, component: "div", defined: true, box: b, visible: true } as unknown as RenderedElement]));
const tokens = { tokens: [{ name: "spacing-4", type: "dimension", codeRef: "var(--chakra-spacing-4)", values: { default: { kind: "dimension", points: 16 } } }, { name: "colors-red", type: "color", values: { default: { kind: "color" } } }] } as unknown as TokenSet;

describe("why an element is out of place", () => {
  // The Tomato card: three lines of text placed by hand under a photo, no auto layout.
  const card = frame("card", box(0, 0, 395, 444), [text("photo", box(0, 0, 395, 296)), text("title", box(24, 320, 162, 26)), text("price", box(24, 350, 92, 26)), text("origin", box(24, 392, 259, 24))]);

  it("names the space before it and its token, in a frame without auto layout", () => {
    const r = rendered({ card: box(0, 0, 395, 444), photo: box(0, 0, 395, 296), title: box(24, 320, 160, 30), price: box(24, 350, 92, 30), origin: box(24, 380, 260, 24) });
    expect(layoutCause(kids(card)[3]!, card, r, tokens, 3)).toBe(
      'the space between "price" and it is 0px, the design\'s is 16px: set that space to 16px (var(--chakra-spacing-4)); "price" also ends 4px later than in the design (its height or line height)',
    );
  });

  it("names the parent's gap in auto layout", () => {
    const list = frame("list", box(0, 0, 200, 100), [text("a", box(0, 0, 200, 20)), text("b", box(0, 36, 200, 20))], { axis: "vertical", gap: 16, padding: 0 });
    const r = rendered({ list: box(0, 0, 200, 100), a: box(0, 0, 200, 20), b: box(0, 28, 200, 20) });
    expect(layoutCause(kids(list)[1]!, list, r, tokens, 3)).toContain(`the design's is 16px ("list"'s gap): set that space to 16px (var(--chakra-spacing-4))`);
  });

  it("names the padding for a first child", () => {
    const inner = frame("inner", box(0, 0, 200, 100), [text("a", box(16, 16, 100, 20))], { axis: "vertical", gap: 0, padding: 16 });
    const outer = frame("outer", box(0, 0, 200, 100), [inner]);
    const r = rendered({ outer: box(0, 0, 200, 100), inner: box(0, 0, 200, 100), a: box(16, 4, 100, 20) });
    expect(layoutCause(kids(inner)[0]!, outer, r, tokens, 3)).toBe('it sits 4px from the top of "inner", the design\'s 16px (its padding): set that to 16px (var(--chakra-spacing-4))');
  });

  it("sends the repair to the container when the container moved", () => {
    const inner = frame("inner", box(0, 40, 200, 60), [text("a", box(0, 40, 100, 20))], { axis: "vertical", gap: 0, padding: 0 });
    const outer = frame("outer", box(0, 0, 200, 100), [inner]);
    const r = rendered({ outer: box(0, 0, 200, 100), inner: box(0, 20, 200, 60), a: box(0, 20, 100, 20) });
    expect(layoutCause(kids(inner)[0]!, outer, r, tokens, 3)).toBe('it moved with its container "inner", which is off by the same: fix the container first');
  });

  it("sends the repair to the element before it when the space is right", () => {
    const list = frame("list", box(0, 0, 200, 100), [text("a", box(0, 0, 200, 20)), text("b", box(0, 36, 200, 20))], { axis: "vertical", gap: 16, padding: 0 });
    const r = rendered({ list: box(0, 0, 200, 100), a: box(0, 0, 200, 30), b: box(0, 46, 200, 20) });
    expect(layoutCause(kids(list)[1]!, list, r, tokens, 3)).toBe('it follows "a", which is out of place or of the wrong height: fix that first');
  });

  it("says nothing when the element is in place", () => {
    const r = rendered({ card: box(0, 0, 395, 444), price: box(24, 350, 92, 26), origin: box(24, 393, 259, 24) });
    expect(layoutCause(kids(card)[3]!, card, r, tokens, 3)).toBeUndefined();
  });

  it("finds spacing tokens of a value, never another kind", () => {
    expect(spacingTokens(16, tokens)).toEqual(["var(--chakra-spacing-4)"]);
    expect(spacingTokens(12, tokens)).toEqual([]);
  });
});
