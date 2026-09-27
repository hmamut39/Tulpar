import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FigmaClient,
  extractLibrary,
  normalizeTree,
  parseVariantName,
  propName,
  roundTrip,
  type DesignNode,
  type DesignTree,
  type Figma,
} from "../src/index.ts";
import { card } from "./fixtures/card.ts";

const entry = card.nodes["1:1"]!;
const ctx = { fileKey: "FILE", fileVersion: card.version, ...entry };
const build = (): DesignTree => normalizeTree(entry.document, ctx);
const child = (n: DesignNode, i: number): DesignNode => (n.kind === "text" ? n : n.children[i]!);

describe("normalizeTree", () => {
  const tree = build();
  const root = tree.root;

  it("makes boxes relative to the root and keeps the origin", () => {
    expect(tree.origin).toEqual({ x: 100.5, y: -40.25 });
    expect(root.box).toEqual({ x: 0, y: 0, width: 320, height: 200 });
    expect(child(root, 0).box).toEqual({ x: 16, y: 16, width: 288, height: 28 });
    expect(root.renderBox).toEqual({ x: -4, y: 0, width: 328, height: 208 });
  });

  it("describes auto layout as a stack, in design terms", () => {
    expect(root.kind === "container" && root.stack).toEqual({
      axis: "vertical",
      gap: 16,
      padding: { top: 16, right: 16, bottom: 16, left: 16 },
      mainAlign: "start",
      crossAlign: "start",
      wrap: false,
      reverseZ: false,
    });
    expect(child(root, 0).inStack).toEqual({ horizontal: "fill", vertical: "hug", absolute: false });
  });

  it("keeps token references for paints, numbers and styles", () => {
    expect(root.fills).toEqual([
      { kind: "solid", color: { space: "srgb", r: 1, g: 1, b: 1, a: 1 }, opacity: 1, token: { source: "variable", id: "VariableID:layer-01" } },
    ]);
    expect(root.tokens["stack.gap"]).toEqual({ source: "variable", id: "VariableID:spacing-05" });
    expect(child(root, 0).tokens["style.text"]).toEqual({ source: "style", id: "S:1", name: "Heading/02" });
  });

  it("drops invisible paints but keeps hidden nodes, marked", () => {
    expect(root.fills).toHaveLength(1);
    const hidden = child(root, 3);
    expect(hidden.visible).toBe(false);
    expect(hidden.box).toBeNull();
  });

  it("groups text style overrides into runs", () => {
    const title = child(root, 0);
    expect(title.kind === "text" && title.runs).toEqual([{ start: 6, end: 13, style: { fontWeight: 600 } }]);
  });

  it("resolves instances to their component and set, with clean prop names", () => {
    const tag = child(root, 1);
    expect(tag.kind).toBe("instance");
    if (tag.kind !== "instance") return;
    expect(tag.component).toEqual({
      id: "10:1",
      key: "tagkey",
      name: "Type=Blue, Size=Small",
      set: { id: "10:0", key: "tagsetkey", name: "Tag" },
    });
    expect(tag.props).toEqual([
      { name: "Type", type: "variant", value: "Blue" },
      { name: "Label", type: "text", value: "New" },
    ]);
    expect(child(tag, 0).id).toBe("I1:3;5:1");
  });

  it("contains no platform vocabulary", () => {
    const json = JSON.stringify(tree);
    for (const word of ["css", "className", "div", "ReactNode", "px"]) expect(json).not.toMatch(new RegExp(`"${word}`, "i"));
  });
});

describe("roundTrip", () => {
  it("rebuilds every Figma box exactly", () => {
    const r = roundTrip(build(), entry.document);
    expect(r.mismatches).toEqual([]);
    expect(r.nodes).toBe(6);
    expect(r.boxesChecked).toBe(5);
    expect(r.boxesAbsent).toBe(1);
    expect(r.maxBoxError).toBe(0);
  });

  // A check that cannot fail proves nothing. Each mutation must be caught.
  const mutations: [string, (t: DesignTree) => void][] = [
    ["a box shifted by 0.01", (t) => (child(t.root, 0).box!.x += 0.01)],
    ["a resized box", (t) => (child(t.root, 2).box!.height = 40)],
    ["a moved origin", (t) => (t.origin.y += 1)],
    ["a lost render box", (t) => (t.root.renderBox = null)],
    ["a dropped child", (t) => t.root.kind === "container" && t.root.children.pop()],
    ["changed text", (t) => { const n = child(t.root, 0); if (n.kind === "text") n.characters = "Order summery"; }],
    ["a swapped component", (t) => { const n = child(t.root, 2); if (n.kind === "instance") n.component.id = "10:1"; }],
    ["a changed id", (t) => (child(child(t.root, 1), 0).id = "I1:3;5:2")],
    ["text turned into a container", (t) => { if (t.root.kind === "container") t.root.children[0] = { ...child(t.root, 0), kind: "container", figmaType: "FRAME", children: [] } as DesignNode; }],
    ["a box invented for a node without bounds", (t) => (child(t.root, 3).box = { x: 0, y: 0, width: 1, height: 1 })],
  ];
  for (const [label, mutate] of mutations) {
    it(`catches ${label}`, () => {
      const tree = build();
      mutate(tree);
      expect(roundTrip(tree, entry.document).mismatches).not.toEqual([]);
    });
  }
});

describe("library", () => {
  it("parses variant names and strips property ids", () => {
    expect(parseVariantName("Size=Large, State=Hover")).toEqual({ Size: "Large", State: "Hover" });
    expect(propName("Label text#1234:0", "TEXT")).toBe("Label text");
    expect(propName("Show #tag", "BOOLEAN")).toBe("Show #tag");
    expect(propName("Tone#1", "VARIANT")).toBe("Tone#1");
  });

  it("extracts component sets with props and variants", () => {
    const page: Figma.FigmaNode = {
      id: "0:1",
      name: "Tag ",
      type: "CANVAS",
      children: [
        {
          id: "10:0",
          name: "Tag",
          type: "COMPONENT_SET",
          componentPropertyDefinitions: {
            Type: { type: "VARIANT", defaultValue: "Blue", variantOptions: ["Blue", "Red"] },
            "Label#12:0": { type: "TEXT", defaultValue: "Tag" },
          },
          children: [
            { id: "10:1", name: "Type=Blue", type: "COMPONENT", absoluteBoundingBox: { x: 0, y: 0, width: 48, height: 24 } },
            { id: "10:2", name: "Type=Red", type: "COMPONENT", absoluteBoundingBox: { x: 60, y: 0, width: 48, height: 24 } },
          ],
        },
        { id: "11:0", name: "_Tag base", type: "COMPONENT", absoluteBoundingBox: { x: 0, y: 40, width: 10, height: 10 } },
      ],
    };
    const lib = extractLibrary({ fileKey: "F", fileVersion: "1", fileName: "Kit" }, [
      { page, components: { "10:1": { key: "k1", name: "Type=Blue", description: "", componentSetId: "10:0", remote: false } }, componentSets: { "10:0": { key: "sk", name: "Tag", description: "Tags label things.", remote: false } }, styles: {} },
    ]);
    const [set, base] = lib.components;
    expect(set).toMatchObject({ kind: "component-set", key: "sk", name: "Tag", page: "Tag", private: false, description: "Tags label things.", size: { width: 48, height: 24 } });
    expect(set!.props.map((p) => [p.name, p.type])).toEqual([["Type", "variant"], ["Label", "text"]]);
    expect(set!.variants.map((v) => v.values)).toEqual([{ Type: "Blue" }, { Type: "Red" }]);
    expect(base).toMatchObject({ kind: "component", private: true });
  });
});

describe("FigmaClient", () => {
  it("serves cached nodes without a request, and returns null for uncached ones offline", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tulpar-"));
    await mkdir(join(dir, "F", "nodes"), { recursive: true });
    await writeFile(join(dir, "F", "nodes", "1-1.json"), JSON.stringify({ name: "Fixture", version: "1", lastModified: "", entry }));
    const client = new FigmaClient({ token: "unused", cacheDir: dir, onRequest: () => { throw new Error("must not fetch"); } });
    client.offline = true;
    const res = await client.nodes("F", ["1:1", "9:9"]);
    expect(res.nodes["1:1"]?.document.name).toBe("Card");
    expect(res.nodes["9:9"]).toBeNull();
    expect(client.requestsSent).toBe(0);
  });
});

// Runs only where real Figma responses have been cached by `tulpar model` or `tulpar library`.
const realCache = ".cache/figma/b8xYgmx2Js30XaldxPkOs9/nodes";
describe.skipIf(!existsSync(realCache))("round trip on cached Carbon kit", () => {
  for (const f of existsSync(realCache) ? readdirSync(realCache) : []) {
    it(`reproduces every box in ${f}`, () => {
      const cached = JSON.parse(readFileSync(join(realCache, f), "utf8"));
      const doc: Figma.FigmaNode = cached.entry.document;
      // Pages have no bounds of their own; each top-level frame is its own tree.
      const roots = doc.type === "CANVAS" ? (doc.children ?? []).filter((c) => c.absoluteBoundingBox) : [doc];
      for (const root of roots) {
        const tree = normalizeTree(root, { fileKey: "b8xYgmx2Js30XaldxPkOs9", fileVersion: cached.version, ...cached.entry });
        const r = roundTrip(tree, root);
        expect(r.mismatches.slice(0, 5)).toEqual([]);
        expect(r.maxBoxError).toBe(0);
      }
    });
  }
});
