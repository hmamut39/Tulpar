// Tailwind in strict mode: layout utilities and token-carrying arbitrary values compile; Tailwind's own
// scale draws nothing, and is named so the repair loop can fix it.

import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { classCandidates, offScaleMessage, resolveCssImport, tailwindCss, tailwindThemeCss } from "../src/index.ts";

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

  it("tells a repair the token form of each rejected class: a weight is not written like a size", () => {
    const msg = offScaleMessage(["font-normal", "md:text-sm", "bg-blue-500"], "");
    expect(msg).toContain("a font weight: font-[var(--…font-weight…,400)]");
    expect(msg).toContain("a font size: text-[length:var(--…font-size…,14px)]");
    expect(msg).toContain("a colour: bg-[var(--…color…,#…)]");
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

describe("Tailwind with a project's theme (shadcn/ui)", () => {
  const shadcn = join(__dirname, "../../../examples/shadcn");
  it.skipIf(!existsSync(join(shadcn, "node_modules", "shadcn")))("resolves stylesheet imports as a bundler does, and keeps the code's utilities apart", async () => {
    const src = join(shadcn, "src");
    expect(resolveCssImport("tw-animate-css", src)).toMatch(/tw-animate-css[\\/]dist[\\/]tw-animate\.css$/);
    expect(resolveCssImport("shadcn/tailwind.css", src)).toMatch(/shadcn[\\/]dist[\\/]tailwind\.css$/);
    expect(resolveCssImport("@fontsource-variable/geist", src)).toMatch(/geist[\\/]index\.css$/);
    const r = await tailwindThemeCss(join(src, "index.css"), [`<button className="bg-primary text-primary-foreground" />`], [`<div className="flex gap-4 bg-card text-sm bg-[#ff0000]" />`]);
    expect(r.designSystem).toMatch(/--primary:/);
    expect(r.designSystem).toMatch(/\.bg-primary \{/);
    expect(r.css).toMatch(/^@layer utilities \{/);
    expect(r.css).toMatch(/\.gap-4 \{\s*gap: calc\(var\(--spacing\) \* 4\);/);
    expect(r.css).toMatch(/background-color: #ff0000;/);
    expect(r.css).not.toMatch(/bg-primary/);
  });

  it.skipIf(!existsSync(join(shadcn, "node_modules", "shadcn")))("uses a theme step written as a formula by its name, defined on every element", async () => {
    const r = await tailwindThemeCss(join(shadcn, "src", "index.css"), [], [`<div className="rounded-xl rounded-lg" />`]);
    expect(r.css).toMatch(/border-radius: var\(--radius-xl\);/);
    expect(r.designSystem).toMatch(/\*, ::before, ::after \{[^}]*--radius-xl: calc\(var\(--radius\) \* 1\.4\);/);
  });
});
