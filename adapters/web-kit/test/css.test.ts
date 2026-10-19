import { describe, expect, it } from "vitest";
import { classify } from "../src/index.ts";

const source = (property: string, value: string) => classify(property, value, "x")?.source;

describe("grid tracks", () => {
  it("accepts how grids are normally written", () => {
    for (const v of ["1fr auto", "repeat(3, 1fr)", "minmax(0, 1fr) minmax(0, 2fr)", "auto 1fr", "min-content 1fr"]) {
      expect(source("grid-template-columns", v), v).toBe("keyword");
    }
    expect(source("grid-template-columns", "repeat(auto-fill, minmax(var(--x-size-card, 12rem), 1fr))")).toBe("token");
  });

  it("calls a measured layout hard-coded, even written as ratios", () => {
    expect(source("grid-template-columns", "minmax(0, 25fr) minmax(0, 310fr) minmax(0, 25fr)")).toBe("literal");
    expect(source("grid-template-rows", "48px auto")).toBe("literal");
    expect(source("grid-template-columns", "1.5fr 1fr")).toBe("literal");
  });
});

describe("arithmetic on tokens", () => {
  it("allows whole multiples of a scale unit, and nothing else", () => {
    expect(source("padding", "calc(var(--mui-spacing, 8px) * 3)")).toBe("token");
    expect(source("gap", "calc(1.5 * var(--x-spacing))")).toBe("token");
    expect(source("padding", "calc(var(--x-spacing-05) * 4)")).toBe("literal");
    expect(source("padding", "calc(var(--mui-spacing) * 3 + 2px)")).toBe("literal");
    expect(source("padding", "calc(var(--mui-spacing) / 3)")).toBe("literal");
  });
});

describe("Tailwind's own variables", () => {
  it("are no tokens: the token is the one they fall back to", () => {
    expect(classify("line-height", "var(--tw-leading, var(--text-sm--line-height))", "")).toMatchObject({ source: "token", token: "text-sm--line-height" });
  });
});
