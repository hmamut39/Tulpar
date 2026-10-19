// The design's typefaces for the render: fetched from Fontsource once, cached, inlined as @font-face.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesignNode } from "@tulpar/core";

process.env.TULPAR_FONT_CACHE = mkdtempSync(join(tmpdir(), "tulpar-fonts-test-"));
const { designFontFaces, designFonts } = await import("../src/fonts.ts");

const text = (fontFamily: string, fontWeight: number, italic = false) => ({ kind: "text", visible: true, style: { fontFamily, fontWeight, italic } }) as unknown as DesignNode;
const root = { kind: "container", visible: true, children: [text("Newsreader", 400), text("Newsreader", 700), text("Inter", 500), text("Newsreader", 400)] } as unknown as DesignNode;

const meta = { family: "Newsreader", weights: [400, 600], styles: ["normal", "italic"], defSubset: "latin", variants: { "400": { normal: { latin: { url: { woff2: "https://cdn.jsdelivr.net/fontsource/fonts/newsreader@latest/latin-400-normal.woff2" } } } }, "600": { normal: { latin: { url: { woff2: "https://cdn.jsdelivr.net/fontsource/fonts/newsreader@latest/latin-600-normal.woff2" } } } } } };

afterEach(() => vi.unstubAllGlobals());

describe("the design's fonts", () => {
  it("are the families the render does not already have, with the weights the text uses", () => {
    expect([...designFonts(root)].map(([f, v]) => [f, [...v].sort()])).toEqual([["Newsreader", ["400-normal", "700-normal"]]]);
  });

  it("come from Fontsource as inlined @font-face rules, at the weight the design asks for, once", async () => {
    const fetched: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      fetched.push(url);
      return url.startsWith("https://api.fontsource.org/") ? new Response(JSON.stringify(meta)) : new Response(new Uint8Array([119, 79, 70, 50]));
    });
    const css = await designFontFaces(root);
    expect(css).toContain(`font-family: "Newsreader"; font-style: normal; font-weight: 400;`);
    // 700 is not published: the nearest file (600) is declared at 700, so bold text still uses it.
    expect(css).toContain(`font-weight: 700;`);
    expect(css).toContain("src: url(data:font/woff2;base64,d09GMg==)");
    expect(fetched).toEqual(["https://api.fontsource.org/v1/fonts/newsreader", meta.variants["400"].normal.latin.url.woff2, meta.variants["600"].normal.latin.url.woff2]);
    // Cached: no second fetch.
    fetched.length = 0;
    await designFontFaces(root);
    expect(fetched).toEqual([]);
  });

  it("leaves a family Fontsource does not have to the fallback, without failing", async () => {
    vi.stubGlobal("fetch", async () => new Response("not found", { status: 404 }));
    expect(await designFontFaces({ kind: "container", visible: true, children: [text("Company Sans", 400)] } as unknown as DesignNode)).toBe("");
  });
});
