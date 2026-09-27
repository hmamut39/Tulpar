import { describe, expect, it } from "vitest";
import { flatName, parseColor, parseDimension, readDtcg, type DtcgDocument } from "../src/index.ts";

const palette: DtcgDocument = {
  label: "palette.json",
  referenceOnly: true,
  json: {
    white: { default: { $type: "color", $value: { colorSpace: "srgb", components: [1, 1, 1], hex: "#ffffff" } } },
    black: { default: { $type: "color", $value: "#000000" } },
    gray: { $type: "color", "100": { $value: "#161616" } },
  },
};

const themes: DtcgDocument = {
  label: "themes.json",
  json: {
    background: {
      $type: "color",
      $description: "Page background.",
      $extensions: { "x.themes": { light: "{white.default}", dark: "{gray.100}", odd: "#ff0000" } },
      hover: { $type: "color", $extensions: { "x.themes": { light: "#e8e8e8", dark: "#292929" } } },
    },
    overlay: { $type: "color", $extensions: { "x.themes": { light: { value: "{black.default}", alpha: 0.5 }, dark: "{missing.token}" } } },
    loop: { a: { $type: "color", $value: "{loop.b}" }, b: { $type: "color", $value: "{loop.a}" } },
  },
};

describe("readDtcg", () => {
  const result = readDtcg([themes, palette], { modesExtension: "x.themes", modes: ["light", "dark"], codeRef: (n) => `var(--x-${n})` });
  const token = (name: string) => result.tokens.find((t) => t.name === name)!;

  it("returns tokens, not reference-only documents", () => {
    expect(result.tokens.map((t) => t.name).sort()).toEqual(["background", "background-hover", "loop-a", "loop-b", "overlay"]);
    expect(result.modes).toEqual(["light", "dark"]);
  });

  it("resolves aliases per mode, across documents", () => {
    expect(token("background").values).toEqual({
      light: { kind: "color", color: { space: "srgb", r: 1, g: 1, b: 1, a: 1 } },
      dark: { kind: "color", color: { space: "srgb", r: 0x16 / 255, g: 0x16 / 255, b: 0x16 / 255, a: 1 } },
    });
    expect(token("background").codeRef).toBe("var(--x-background)");
    expect(token("background").description).toBe("Page background.");
  });

  it("applies an alpha modifier and reports a missing alias instead of guessing", () => {
    expect(token("overlay").values.light).toEqual({ kind: "color", color: { space: "srgb", r: 0, g: 0, b: 0, a: 0.5 } });
    expect(token("overlay").values.dark).toEqual({ kind: "unresolved", text: "{missing.token}", reason: "alias target not found" });
    expect(token("overlay").provenance.confidence).toBe("medium");
  });

  it("stops alias cycles", () => {
    expect(token("loop-a").values.default).toMatchObject({ kind: "unresolved", reason: "alias cycle" });
  });

  it("reports what departs from the spec or the configuration", () => {
    expect(result.gaps).toContain('themes.json: "background" has a value for "odd", which is not a configured mode; ignored.');
    expect(result.gaps).toContain("themes.json: some tokens also contain child tokens, which the spec forbids; both are read.");
  });

  it("uses a custom dimension reader before the spec's", () => {
    const doc: DtcgDocument = { label: "l.json", json: { space: { $type: "dimension", "space-1": { $value: 2 }, "space-2": { $value: { value: 1, unit: "rem" } } } } };
    const r = readDtcg([doc], { dimension: (raw) => (typeof raw === "number" ? { kind: "dimension", points: raw * 8 } : undefined) });
    expect(r.tokens.map((t) => [t.name, t.values.default])).toEqual([
      ["space-1", { kind: "dimension", points: 16 }],
      ["space-2", { kind: "dimension", points: 16 }],
    ]);
  });
});

describe("values", () => {
  it("parses colours", () => {
    expect(parseColor("#fff")).toEqual({ space: "srgb", r: 1, g: 1, b: 1, a: 1 });
    expect(parseColor("#00000080")?.a).toBeCloseTo(128 / 255);
    expect(parseColor({ colorSpace: "srgb", components: [0.5, 0, 1], alpha: 0.2 })).toEqual({ space: "srgb", r: 0.5, g: 0, b: 1, a: 0.2 });
    // Only sRGB is modelled; another space falls back to the hex the spec lets documents carry.
    expect(parseColor({ colorSpace: "display-p3", components: [1, 0, 0], hex: "#ff0000" })).toEqual({ space: "srgb", r: 1, g: 0, b: 0, a: 1 });
    expect(parseColor({ colorSpace: "display-p3", components: [1, 0, 0] })).toBeUndefined();
    expect(parseColor("red")).toBeUndefined();
  });

  it("parses dimensions and refuses what has no fixed length", () => {
    expect(parseDimension({ value: 12, unit: "px" }, 16)).toEqual({ kind: "dimension", points: 12 });
    expect(parseDimension("1.5rem", 16)).toEqual({ kind: "dimension", points: 24 });
    expect(parseDimension("0", 16)).toEqual({ kind: "dimension", points: 0 });
    expect(parseDimension("5vw", 16)).toMatchObject({ kind: "unresolved" });
    expect(parseDimension(4, 16)).toMatchObject({ kind: "unresolved", reason: "bare number without a unit" });
  });

  it("builds flat names without repeating the group", () => {
    expect(flatName(["border", "subtle", "02"])).toBe("border-subtle-02");
    expect(flatName(["spacing", "spacing-01"])).toBe("spacing-01");
    expect(flatName(["button", "danger-hover"])).toBe("button-danger-hover");
  });
});
