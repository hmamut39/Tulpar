// Tailwind in strict mode: layout utilities and token-carrying arbitrary values compile; Tailwind's own
// scale draws nothing, and is named so the repair loop can fix it.

import { describe, expect, it } from "vitest";
import { classCandidates, offScaleMessage, tailwindCss } from "../src/index.ts";

describe("Tailwind, strict", () => {
  it("compiles layout utilities, breakpoints and token values", async () => {
    const r = await tailwindCss([`export default () => <div className="flex flex-col md:flex-row items-center w-1/2 gap-[var(--cds-spacing-05,16px)]" />;`]);
    expect(r.offScale).toEqual([]);
    expect(r.css).toMatch(/\.flex \{\s*display: flex;/);
    expect(r.css).toMatch(/@media \(width >= 48rem\)/);
    expect(r.css).toMatch(/gap: var\(--cds-spacing-05,16px\)/);
  });

  it("names classes that need Tailwind's own scale, and leaves them out", async () => {
    const r = await tailwindCss([`<template><div class="p-4 text-red-500 flex">Hello container</div></template>`]);
    expect(r.offScale.sort()).toEqual(["p-4", "text-red-500"]);
    expect(r.css).not.toMatch(/padding/);
    expect(offScaleMessage(r.offScale, "el")).toMatch(/p-4, text-red-500.*p-\[var\(--el-…,16px\)\]/);
  });

  it("allows zero, which is no design value, but not the other steps of Tailwind's spacing scale", async () => {
    const r = await tailwindCss([`<h1 className="m-0 !m-0 gap-0 p-4 -mt-2">Sign in</h1>`]);
    expect(r.offScale.sort()).toEqual(["-mt-2", "p-4"]);
    expect(r.css).toMatch(/\.m-0 \{\s*margin: 0px;/);
    expect(r.css).not.toMatch(/--spacing/);
  });

  it("reads class names from string literals only, not from the text a component shows", () => {
    expect(classCandidates(`<p className="grid">container shadow</p>`)).toEqual(["grid"]);
    expect(classCandidates("cn('flex', `w-full ${x}`)")).toEqual(expect.arrayContaining(["flex", "w-full"]));
  });
});
