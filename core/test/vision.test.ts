import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { compareImages, toDesign, verify, type AdapterManifest, type CodeComponent, type ComponentIndex, type InstanceNode } from "../src/index.ts";

const comp = (name: string): CodeComponent => ({ id: name, name, module: "m", props: [], slots: [{ name: "", provenance: { source: "t", confidence: "high" } }], events: [], provenance: { source: "t", confidence: "high" } });
const known = new Map([["ButtonSet", comp("ButtonSet")], ["Button", comp("Button")]]);
const el = (id: string, parent: string, kind: "container" | "component" | "text", component: string, x: number, text = "", confidence = 0.9) => ({ id, parent, kind, component, props: kind === "component" ? [{ name: "kind", value: "primary" }] : [], text, x, y: 0, width: 200, height: 128, fill: kind === "container" ? "#f4f4f4" : "", confidence });

describe("screenshot reading → design", () => {
  const reading = {
    width: 1280,
    height: 128,
    notes: ["model note"],
    elements: [
      el("e1", "", "component", "ButtonSet", 0),
      el("e2", "e1", "component", "Button", 0, "Cancel"),
      el("e3", "e1", "component", "Button", 640, "Save", 0.4),
      el("e4", "", "component", "FancyCard", 0),
      el("e5", "", "text", "", 0, "Hello"),
    ],
  };
  const { design, mapping, notes } = toDesign(reading, known, 2);

  it("converts image pixels to design points at the given scale", () => {
    expect(design.root.box).toEqual({ x: 0, y: 0, width: 640, height: 64 });
    expect(design.root.kind === "container" && design.root.children.find((c) => c.id === "e5")!.box).toEqual({ x: 0, y: 0, width: 100, height: 64 });
  });

  it("places elements inside a component as its content, to be checked", () => {
    const set = design.root.kind === "container" ? (design.root.children.find((c) => c.id === "e1") as InstanceNode) : undefined;
    expect(set?.kind).toBe("instance");
    expect(set!.content!.map((c) => c.id)).toEqual(["e2", "e3"]);
    expect(mapping.get("screenshot:Button")).toBe("Button");
  });

  it("never maps an invented component, and passes on doubts as notes", () => {
    const card = design.root.kind === "container" ? design.root.children.find((c) => c.id === "e4") : undefined;
    expect(card?.kind).toBe("container");
    expect(notes).toEqual(["model note", "e3 read as Button with low confidence (0.4).", 'e4: "FancyCard" is not a component of this design system; treated as a container.']);
  });
});

const png = (width: number, height: number, paint: (x: number, y: number) => [number, number, number]): Buffer => {
  const img = new PNG({ width, height });
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const [r, g, b] = paint(x, y);
    const i = (y * width + x) * 4;
    img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
  }
  return PNG.sync.write(img);
};

describe("pixel comparison", () => {
  const white = png(100, 40, () => [255, 255, 255]);
  const halfBlue = png(100, 40, (x) => (x < 50 ? [255, 255, 255] : [15, 98, 254]));

  it("finds no difference between identical images", () => {
    expect(compareImages(white, white).mismatch).toBe(0);
  });

  it("measures and locates a difference", () => {
    const r = compareImages(white, halfBlue);
    expect(r.mismatch).toBeCloseTo(0.5, 1);
    expect(r.regions[0]).toMatchObject({ x: 48, y: 0 });
  });

  it("scales a 2× screenshot down to the 1× render", () => {
    const retina = png(200, 80, (x) => (x < 100 ? [255, 255, 255] : [15, 98, 254]));
    expect(compareImages(halfBlue, retina).mismatch).toBeLessThan(0.05);
  });
});

describe("verify with a baseline image", () => {
  const caps: AdapterManifest["capabilities"] = { index: true, tokens: true, links: false, emit: false, build: true, render: { supported: true, hostOS: ["linux"] }, runtimeStyleProvenance: true, staticProvenance: true, forceStates: [], themes: true };
  const index: ComponentIndex = { adapter: "t", gaps: [], components: [] };
  const design = { schemaVersion: "0.1" as const, source: { fileKey: "screenshot", fileVersion: "1", nodeId: "screenshot" }, origin: { x: 0, y: 0 }, root: { id: "r", name: "R", kind: "container" as const, figmaType: "FRAME", box: { x: 0, y: 0, width: 100, height: 40 }, visible: true, opacity: 1, fills: [], effects: [], clips: false, tokens: {}, children: [] } };
  const run = (renderPng: Buffer, baselinePng: Buffer) =>
    verify({
      design,
      mapping: new Map(),
      index,
      capabilities: caps,
      build: { ok: true, log: "" },
      render: { status: "ok", png: renderPng.toString("base64"), elements: [{ figmaId: "r", component: "div", defined: true, box: { x: 0, y: 0, width: 100, height: 40 }, text: "", fonts: [], visible: true, styles: [] }], renderer: { name: "r", version: "1", os: "t" }, warnings: [] },
      baseline: { png: baselinePng.toString("base64"), source: "screenshot" },
    }).checks.find((c) => c.id === "visual")!;

  it("passes a render that looks like the screenshot", () => {
    expect(run(png(100, 40, () => [255, 255, 255]), png(100, 40, () => [255, 255, 255]))).toMatchObject({ status: "pass", summary: "0.0% of pixels differ from the screenshot (limit 8.0%)" });
  });

  it("fails a render that doesn't, and says where", () => {
    const check = run(png(100, 40, () => [255, 255, 255]), png(100, 40, (x) => (x < 50 ? [255, 255, 255] : [15, 98, 254])));
    expect(check.status).toBe("fail");
    expect(check.details[0]).toMatch(/^✗ differs at \(48,0/);
  });
});
