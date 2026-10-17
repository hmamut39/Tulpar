// Figma's picture of a frame, for the pixel comparison: fetched once, then from the cache for good.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FigmaClient } from "../src/index.ts";

describe("frame image", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is asked for once, then read from the cache; offline it is never fetched", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      if (url.includes("/v1/images/")) return new Response(JSON.stringify({ images: { "1:2": "https://figma-images.example/f.png" } }), { status: 200 });
      return new Response(Buffer.from([0x89, 0x50, 0x4e, 0x47]), { status: 200 });
    });
    const cacheDir = mkdtempSync(join(tmpdir(), "tulpar-figma-img-"));
    const client = new FigmaClient({ token: "t", cacheDir });
    expect(await client.frameImage("FILE", "1:2")).toBe("iVBORw==");
    expect(await client.frameImage("FILE", "1:2")).toBe("iVBORw==");
    expect(urls).toEqual(["https://api.figma.com/v1/images/FILE?ids=1%3A2&format=png&scale=1", "https://figma-images.example/f.png"]);

    const offline = new FigmaClient({ token: "", cacheDir });
    offline.offline = true;
    expect(await offline.frameImage("FILE", "9:9")).toBeUndefined();
    expect(urls).toHaveLength(2);
  });
});
