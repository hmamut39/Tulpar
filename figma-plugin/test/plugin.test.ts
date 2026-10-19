// The Figma plugin's main code, run against a stand-in for Figma's API: what it names the component,
// how it exports the frame, and which links it opens.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const dir = resolve(import.meta.dirname, "..");
const code = readFileSync(resolve(dir, "code.js"), "utf8");

function plugin(selection: unknown[]) {
  const posted: Record<string, unknown>[] = [];
  const opened: string[] = [];
  const exports: unknown[] = [];
  const storage = new Map<string, unknown>();
  const figma = {
    showUI: () => undefined,
    on: () => undefined,
    currentPage: { selection },
    clientStorage: { getAsync: async (k: string) => storage.get(k), setAsync: async (k: string, v: unknown) => void storage.set(k, v) },
    openExternal: (url: string) => opened.push(url),
    notify: () => undefined,
    ui: { postMessage: (m: Record<string, unknown>) => posted.push(m), onmessage: undefined as unknown as (m: unknown) => Promise<void> },
  };
  runInNewContext(code, { figma, __html__: "" });
  return { posted, opened, exports, storage, send: (m: unknown) => figma.ui.onmessage(m) };
}
const REST = { document: { id: "1:2", type: "FRAME", absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 300 } }, components: {} };
const frame = (name: string, width: number, height: number, exported: unknown[] = [], json = true) => ({
  name,
  width,
  height,
  exportAsync: async (o: { format: string }) => {
    if (o.format === "JSON_REST_V1") {
      if (!json) throw new Error("not supported");
      return REST;
    }
    exported.push(o);
    return new Uint8Array([137, 80, 78, 71]);
  },
});

describe("Figma plugin", () => {
  it("names the component from the layer, PascalCase", async () => {
    const names = [];
    for (const layer of ["Sign in / card", "checkout-summary", "2 column hero", "✨"]) {
      const p = plugin([frame(layer, 400, 300)]);
      await p.send({ type: "ready" });
      names.push(p.posted.find((m) => m.type === "selection")!.name);
    }
    expect(names).toEqual(["SignInCard", "CheckoutSummary", "Frame2ColumnHero", "Component"]);
  });

  it("sends the frame's own structure with its picture at 1×", async () => {
    const p = plugin([frame("Card", 400, 300)]);
    await p.send({ type: "export" });
    expect(p.posted.at(-1)).toMatchObject({ type: "image", scale: 1, name: "Card", node: REST });
  });

  it("without the structure, asks for one frame and sends its picture at 2×, or 1× when that would be too large", async () => {
    const none = plugin([]);
    await none.send({ type: "export" });
    expect(none.posted.at(-1)).toMatchObject({ type: "export-failed", error: expect.stringMatching(/Select a frame/) });
    const settings: unknown[] = [];
    const small = plugin([frame("Card", 400, 300, settings, false)]);
    await small.send({ type: "export" });
    expect(small.posted.at(-1)).toMatchObject({ type: "image", scale: 2, name: "Card" });
    const big = plugin([frame("Page", 1440, 3200, settings, false)]);
    await big.send({ type: "export" });
    expect(big.posted.at(-1)).toMatchObject({ type: "image", scale: 1 });
    expect(settings).toEqual([{ format: "PNG", constraint: { type: "SCALE", value: 2 } }, { format: "PNG", constraint: { type: "SCALE", value: 1 } }]);
  });

  it("keeps the key, and opens only Tulpar's own pages", async () => {
    const p = plugin([]);
    await p.send({ type: "save-key", key: "tlp_abc" });
    await p.send({ type: "ready" });
    expect(p.posted.find((m) => m.type === "settings")).toMatchObject({ key: "tlp_abc", server: "https://tulparsi.com" });
    await p.send({ type: "open", url: "https://tulparsi.com/connect?app=figma" });
    await p.send({ type: "open", url: "https://evil.example/phish" });
    expect(p.opened).toEqual(["https://tulparsi.com/connect?app=figma"]);
  });

  it("is allowed to reach tulparsi.com only", () => {
    const manifest = JSON.parse(readFileSync(resolve(dir, "manifest.json"), "utf8"));
    expect(manifest.networkAccess.allowedDomains).toEqual(["https://tulparsi.com"]);
    expect(manifest).toMatchObject({ main: "code.js", ui: "ui.html" });
  });
});
