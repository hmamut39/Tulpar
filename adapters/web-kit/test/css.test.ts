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
