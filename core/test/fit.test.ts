// A frame not built with the chosen design system: said up front, with what does not match.

import { describe, expect, it } from "vitest";
import { designFit, fitNote } from "../src/verify/fit.ts";
import type { DesignNode, TokenSet, TokenValue } from "../src/index.ts";

const color = (r: number, g: number, b: number) => ({ space: "srgb" as const, r, g, b, a: 1 });
const text = (size: number) => ({ kind: "text", visible: true, style: { fontSize: size, italic: false }, fills: [] }) as unknown as DesignNode;
const frame = (fills: unknown[], children: DesignNode[]) => ({ kind: "container", visible: true, fills, children }) as unknown as DesignNode;
const instance = (name: string, w = 120, h = 40) => ({ kind: "instance", name, visible: true, box: { x: 0, y: 0, width: w, height: h }, component: { id: name, name }, fills: [], children: [] }) as unknown as DesignNode;
const token = (name: string, value: TokenValue, type = "dimension") => ({ name, path: [name], type, values: { white: value }, provenance: { source: "t", confidence: "high" as const } });
const carbon: TokenSet = { adapter: "t", modes: ["white"], gaps: [], tokens: [token("heading-05-font-size", { kind: "dimension", points: 32 }), token("body-01-font-size", { kind: "dimension", points: 14 }), token("background", { kind: "color", color: color(1, 1, 1) }, "color")] };

describe("design fit", () => {
  it("names a frame with none of the design system's components, and the sizes and colours it lacks", () => {
    const worldPeas = frame([{ kind: "solid", color: color(0.17, 0.37, 0.18), opacity: 1 }], [text(64), text(14), text(20), instance("Button"), instance("Card"), instance("Close", 16, 16)]);
    const fit = designFit(worldPeas, carbon, () => false);
    expect(fit).toEqual({ components: { total: 2, mapped: 0 }, sizes: [64, 20], colors: ["#2b5e2e"] });
    expect(fitNote(fit, "@carbon/react")).toMatch(/^This design is not built with @carbon\/react: none of its 2 components are @carbon\/react's; it uses text sizes @carbon\/react has no token for \(64px, 20px\); a colour no @carbon\/react token comes close to \(#2b5e2e\)\./);
  });

  it("says nothing for a frame made with the design system", () => {
    const form = frame([{ kind: "solid", color: color(1, 1, 1), opacity: 1 }], [text(32), text(14), instance("Button")]);
    expect(fitNote(designFit(form, carbon, () => true), "@carbon/react")).toBeUndefined();
  });
});
