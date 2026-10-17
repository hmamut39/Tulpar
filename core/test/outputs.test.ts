// Which language and styling an adapter writes: what it declares, never more.

import { describe, expect, it } from "vitest";
import { outputName, supportsOutput, type AdapterManifest } from "../src/index.ts";

const manifest = (outputs?: AdapterManifest["capabilities"]["outputs"]) => ({ capabilities: { outputs } }) as AdapterManifest;
const react = manifest([
  { language: "typescript", styling: "css" },
  { language: "typescript", styling: "tailwind" },
  { language: "javascript", styling: "css" },
]);

describe("output choices", () => {
  it("accepts what the adapter declares, with unset fields taken from its default", () => {
    expect(supportsOutput(react, undefined)).toBe(true);
    expect(supportsOutput(react, { language: "javascript", styling: "css" })).toBe(true);
    expect(supportsOutput(react, { styling: "tailwind" })).toBe(true);
    expect(supportsOutput(react, { language: "javascript" })).toBe(true);
  });

  it("refuses what it does not declare", () => {
    expect(supportsOutput(react, { language: "javascript", styling: "tailwind" })).toBe(false);
    expect(supportsOutput(react, { styling: "less" })).toBe(false);
    expect(supportsOutput(manifest(), { styling: "css" })).toBe(false);
    expect(supportsOutput(manifest(), {})).toBe(true);
  });

  it("names a choice for people", () => {
    expect(outputName({ language: "typescript", styling: "css-modules" })).toBe("TypeScript · CSS Modules");
    expect(outputName({ styling: "less" })).toBe("LESS");
  });
});
