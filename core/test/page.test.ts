// A whole page, split into its sections, and a page brief that places them instead of rebuilding them.

import { describe, expect, it } from "vitest";
import { buildBrief, pageSections, pascal, type ComponentIndex, type DesignNode, type DesignTree } from "../src/index.ts";

const base = { visible: true, opacity: 1, fills: [], effects: [], clips: false, tokens: {} };
const frame = (id: string, name: string, box: { x: number; y: number; width: number; height: number }, children: DesignNode[] = []) =>
  ({ ...base, id, name, kind: "container", figmaType: "FRAME", box, children }) as unknown as DesignNode;
const text = (id: string, characters: string, y: number) => ({ ...base, id, name: characters, kind: "text", characters, box: { x: 0, y, width: 200, height: 20 }, style: {} }) as unknown as DesignNode;

const page = frame("1:1", "Landing", { x: 0, y: 0, width: 1200, height: 900 }, [
  frame("1:2", "Content", { x: 0, y: 0, width: 1200, height: 900 }, [
    frame("2:1", "Site header", { x: 0, y: 0, width: 1200, height: 64 }, [text("2:2", "Tulpar", 20)]),
    frame("3:1", "hero", { x: 0, y: 64, width: 1200, height: 400 }, [text("3:2", "Design in.", 100)]),
    frame("4:1", "Card", { x: 0, y: 464, width: 1200, height: 300 }),
    frame("5:1", "Card", { x: 0, y: 764, width: 1200, height: 100 }),
    frame("6:1", "badge", { x: 20, y: 870, width: 80, height: 24 }),
    text("7:1", "© 2026", 880),
  ]),
]);

describe("a page's sections", () => {
  it("looks through a single wrapper and takes the wide, tall blocks, named uniquely", () => {
    expect(pageSections(page).map((s) => `${s.node.id} ${s.name}`)).toEqual(["2:1 SiteHeader", "3:1 Hero", "4:1 Card", "5:1 Card2"]);
  });

  it("is not a page with fewer than two sections", () => {
    expect(pageSections(frame("1:1", "Button row", { x: 0, y: 0, width: 640, height: 64 }, [frame("1:2", "row", { x: 0, y: 0, width: 640, height: 64 })]))).toEqual([]);
  });

  it("names a section after its layer", () => {
    expect(pascal("site header / main")).toBe("SiteHeaderMain");
    expect(pascal("2 columns")).toBe("Section2Columns");
    expect(pascal("—")).toBe("");
  });
});

describe("the page brief", () => {
  it("shows a built section as one line to import and place, without its layers", () => {
    const design: DesignTree = { schemaVersion: "0.1", source: { fileKey: "F", fileVersion: "1", nodeId: "1:1" }, origin: { x: 0, y: 0 }, root: page };
    const index: ComponentIndex = { adapter: "t", gaps: [], components: [] };
    const conventions = { language: "TS", framework: "React", files: [{ path: "{name}.tsx", role: "component" as const, description: "" }], entry: "{name}.tsx", rules: [], importExample: "" };
    const brief = buildBrief({ name: "Landing", design, mapping: new Map(), index, conventions, built: { "2:1": { name: "SiteHeader", importPath: "./SiteHeader" }, "3:1": { name: "Hero", importPath: "./Hero" } } });
    expect(brief.outline).toContain(`- BUILT id=2:1 "Site header" → SiteHeader (already written and verified: import it from './SiteHeader' and place it; do not rebuild it)`);
    expect(brief.outline).not.toContain('"Tulpar"');
    expect(brief.outline).not.toContain('"Design in."');
    expect(brief.outline).toContain('"© 2026"');
    expect(brief.built).toEqual([{ figmaId: "2:1", name: "SiteHeader", importPath: "./SiteHeader" }, { figmaId: "3:1", name: "Hero", importPath: "./Hero" }]);
  });
});

describe("Figma's transparent pictures", () => {
  it("are laid onto white before comparing, so a frame without a fill is not 'black'", async () => {
    const { PNG } = await import("pngjs");
    const { flatten } = await import("../src/index.ts");
    const img = new PNG({ width: 2, height: 1 });
    img.data.set([0, 0, 0, 0, 255, 0, 0, 255]); // transparent, then opaque red
    const out = PNG.sync.read(Buffer.from(flatten(PNG.sync.write(img).toString("base64")), "base64"));
    expect([...out.data]).toEqual([255, 255, 255, 255, 255, 0, 0, 255]);
    const opaque = PNG.sync.write(Object.assign(new PNG({ width: 1, height: 1 }), { data: Buffer.from([1, 2, 3, 255]) })).toString("base64");
    expect(flatten(opaque)).toBe(opaque);
  });
});
