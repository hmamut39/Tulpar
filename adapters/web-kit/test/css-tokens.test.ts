import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { cssColor, parseCssValue, readCssTokens, readTokens } from "../src/index.ts";

const root = resolve(import.meta.dirname, "fixtures");
const byName = (tokens: { name: string }[]) => Object.fromEntries(tokens.map((t) => [t.name, t])) as Record<string, any>;

describe("tokens declared as CSS custom properties", () => {
  const { tokens, modes, gaps } = readCssTokens(root, { files: ["theme.css"], prefix: "ds", modes: { dark: ".ds-theme-dark" } });
  const t = byName(tokens);

  it("reads each property on a theme selector, per mode, and only the library's own", () => {
    expect(modes).toEqual(["default", "dark"]);
    expect(t["other-library"]).toBeUndefined();
    expect(t["ds-color-primary-600"]).toMatchObject({ type: "color", codeRef: "var(--ds-color-primary-600)", codeRefConfirmed: true });
    expect(t["ds-color-primary-600"].values.dark.color.r).toBeCloseTo(0x81 / 255);
    expect(gaps).toEqual([]);
  });

  it("resolves var() references in the mode being read, and uses fallbacks", () => {
    // The dark block also names :host (as Shoelace does); that must not overwrite the default.
    expect(t["ds-color-surface"].values.default.color.r).toBe(1);
    expect(t["ds-color-primary"].values.default.color.b).toBeCloseTo(0xe5 / 255);
    expect(t["ds-color-primary"].values.dark.color.b).toBeCloseTo(0xf8 / 255);
    expect(t["ds-border"].values.default).toEqual({ kind: "dimension", points: 1 });
  });

  it("parses colours, lengths and numbers, and keeps the rest unresolved", () => {
    expect(t["ds-space-small"].values.default).toEqual({ kind: "dimension", points: 8 });
    expect(t["ds-space-large"].values.default).toEqual({ kind: "dimension", points: 20 }); // the later declaration wins
    expect(t["ds-font-weight-bold"]).toMatchObject({ type: "number" });
    expect(t["ds-shadow"]).toMatchObject({ type: "other", values: { default: { kind: "unresolved" } } });
    expect(t["ds-color-overlay"].values.default.color.a).toBe(0.5);
    expect(cssColor("hsl(0, 100%, 50%)")).toEqual({ space: "srgb", r: 1, g: 0, b: 0, a: 1 });
    expect(cssColor("rgb(0 0 0 / 10%)")?.a).toBeCloseTo(0.1);
    expect(cssColor("not-a-colour")).toBeUndefined();
    expect(parseCssValue("5vw")).toMatchObject({ kind: "unresolved" });
  });

  it("joins DTCG tokens when a project has both, and reports a missing stylesheet", () => {
    const set = readTokens(root, { css: { files: ["theme.css"], prefix: "ds" } }, [], "test");
    expect(set.tokens.length).toBe(tokens.length);
    expect(readCssTokens(root, { files: ["missing.css"] }).gaps).toEqual(["Token stylesheet not found: missing.css"]);
  });
});

describe("wide-gamut colours", () => {
  it("reads Display P3 and oklch as their sRGB equivalents", () => {
    const hex = (c: { r: number; g: number; b: number } | undefined) => c && `#${[c.r, c.g, c.b].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;
    // Radix's sky-9 in sRGB is #7ce2fe; its P3 form must land on (almost) the same colour.
    expect(hex(cssColor("color(display-p3 0.585 0.877 0.983)"))).toMatch(/^#7[bcd]e[12]f[de]$/);
    expect(hex(cssColor("color(display-p3 1 0 0)"))).toBe("#ff0000"); // outside sRGB: clipped
    expect(hex(cssColor("oklch(62.3% 0.214 259.8)"))).toMatch(/^#(2b7ff[e-f]|2c7ff[e-f]|2b80ff)$/); // Tailwind 4 blue-500
    expect(cssColor("color(display-p3 0.5 0.5 0.5 / 50%)")?.a).toBe(0.5);
  });
});
