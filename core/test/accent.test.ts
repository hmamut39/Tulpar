// The design's accent colour, the design system's nearest palettes, and the prop that applies it.

import { describe, expect, it } from "vitest";
import { accentHint, accentProp, carriesAccent, familyOf, findAccent, roleFor, type DesignNode, type TokenSet } from "../src/index.ts";

const rgb = (h: string) => ({ space: "srgb" as const, r: parseInt(h.slice(1, 3), 16) / 255, g: parseInt(h.slice(3, 5), 16) / 255, b: parseInt(h.slice(5, 7), 16) / 255, a: 1 });
const base = { visible: true, opacity: 1, effects: [], clips: false, tokens: {} };
const solid = (h: string) => [{ kind: "solid" as const, color: rgb(h), opacity: 1 }];
const button = (id: string, fill: string, w = 310, h = 40): DesignNode => ({ ...base, id, name: "Button", kind: "instance", box: { x: 0, y: 0, width: w, height: h }, fills: solid(fill), component: { id: "b" }, props: [], children: [] }) as DesignNode;
const frame = (children: DesignNode[]): DesignNode => ({ ...base, id: "r", name: "r", kind: "container", figmaType: "FRAME", box: { x: 0, y: 0, width: 360, height: 360 }, fills: solid("#ffffff"), children }) as DesignNode;
const token = (name: string, hex: string) => ({ name, path: name.split("-"), type: "color", values: { default: { kind: "color" as const, color: rgb(hex) } }, codeRef: `var(--${name})`, provenance: { source: "t", confidence: "high" as const } });

describe("accent colour", () => {
  it("is the most saturated colour covering the most area inside components, not the page background", () => {
    const design = frame([button("big", "#0284c7"), button("small", "#e11d48", 40, 20), button("grey", "#e4e4e7")]);
    const accent = findAccent(design)!;
    expect(Math.round(accent.b * 255)).toBe(0xc7);
  });

  it("names the design system's nearest palettes, skipping greys and roles", () => {
    const set: TokenSet = { adapter: "t", modes: [], gaps: [], tokens: [token("blue-9", "#0090ff"), token("cyan-9", "#00a2c7"), token("red-9", "#e5484d"), token("gray-9", "#8b8d98"), token("accent-9", "#0284c7")] };
    const hint = accentHint(frame([button("b", "#0284c7")]), set, "default")!;
    expect(hint.color).toBe("#0284c7");
    expect(hint.options.map((o) => o.family)).toEqual(["blue", "cyan", "red"]);
    expect(familyOf("chakra-colors-blue-500")).toBe("blue");
    expect(familyOf("mui-palette-info-main")).toBe("info");
    expect(familyOf("p-gray-500")).toBeUndefined();
  });

  it("is given to the component painted in it, through its own colour prop: a palette, else a role", () => {
    const hint = { color: "#0284c7", options: [{ family: "cyan", token: "cyan-9", hex: "#00a2c7", distance: 5 }] };
    expect(accentProp([{ name: "color", type: { kind: "enum", values: ["indigo", "cyan", "sky"] } }], hint)).toEqual({ prop: "color", value: "cyan" });
    expect(accentProp([{ name: "severity", type: { kind: "enum", values: ["primary", "info", "danger"] } }], hint)).toEqual({ prop: "severity", value: "info" });
    expect(accentProp([{ name: "size", type: { kind: "enum", values: ["sm", "md"] } }], hint)).toBeUndefined();
    expect(carriesAccent(button("b", "#0285c8"), "#0284c7")).toBe(true);
    expect(carriesAccent(button("b", "#e11d48"), "#0284c7")).toBe(false);
    expect([roleFor("#0284c7"), roleFor("#16a34a"), roleFor("#dc2626"), roleFor("#f59e0b"), roleFor("#7c3aed")]).toEqual(["info", "success", "danger", "warn", "help"]);
  });
});
