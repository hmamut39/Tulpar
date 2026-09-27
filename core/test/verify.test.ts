import { describe, expect, it } from "vitest";
import { verify, visibleText, type AdapterManifest, type ComponentIndex, type DesignNode, type DesignTree, type RenderedElement, type VerifyInput } from "../src/index.ts";

const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
const base = { visible: true, opacity: 1, fills: [], effects: [], clips: false, tokens: {} };
const text = (id: string, characters: string, b = box(16, 16, 44, 18)): DesignNode => ({
  ...base,
  id,
  name: "Label",
  kind: "text",
  box: b,
  characters,
  style: { fontFamily: "Plex", italic: false, align: "start", verticalAlign: "top", truncate: false, tokens: {} },
  runs: [],
});
const instance = (id: string, set: string, x: number, label: string, visible = true): DesignNode => ({
  ...base,
  id,
  name: `Button ${id}`,
  visible,
  kind: "instance",
  box: box(x, 0, 100, 40),
  component: { id: `${set}v`, set: { id: set, name: "Button" } },
  props: [],
  children: [text(`I${id};1`, label, box(x + 16, 11, 44, 18))],
});

const design: DesignTree = {
  schemaVersion: "0.1",
  source: { fileKey: "F", fileVersion: "1", nodeId: "1:1" },
  origin: { x: 0, y: 0 },
  root: {
    ...base,
    id: "1:1",
    name: "Footer",
    kind: "container",
    figmaType: "FRAME",
    box: box(0, 0, 300, 40),
    children: [instance("2:1", "B", 0, "Cancel"), instance("2:2", "B", 100, "Save"), instance("2:3", "B", 200, "Hidden", false), instance("2:4", "Unmapped", 200, "Help")],
  },
};

const index: ComponentIndex = {
  adapter: "t",
  gaps: [],
  components: [
    { id: "x-button", name: "x-button", module: "m", props: [], slots: [], events: [], provenance: { source: "t", confidence: "high" } },
    { id: "x-footer-button", name: "x-footer-button", extends: ["x-button"], module: "m", props: [], slots: [], events: [], provenance: { source: "t", confidence: "high" } },
    { id: "x-tag", name: "x-tag", module: "m", props: [], slots: [], events: [], provenance: { source: "t", confidence: "high" } },
  ],
};

const caps: AdapterManifest["capabilities"] = {
  index: true,
  tokens: true,
  links: true,
  emit: false,
  build: true,
  render: { supported: true, hostOS: ["linux"] },
  runtimeStyleProvenance: true,
  staticProvenance: true,
  forceStates: [],
  themes: true,
};

const el = (figmaId: string, component: string, b: RenderedElement["box"], text: string, extra: Partial<RenderedElement> = {}): RenderedElement => ({
  figmaId,
  component,
  defined: true,
  box: b,
  text,
  fonts: ["Plex"],
  visible: true,
  styles: [],
  ...extra,
});

const good = (): RenderedElement[] => [
  el("1:1", "x-footer", box(0, 0, 300, 40), "Cancel Save Help"),
  el("2:1", "x-button", box(0, 0, 100, 40), "Cancel"),
  el("2:2", "x-footer-button", box(100.6, 0, 100, 40), "Save"),
  el("2:4", "x-help", box(200, 0, 100, 40), "Help"),
];

const input = (elements: RenderedElement[], extra: Partial<VerifyInput> = {}): VerifyInput => ({
  design,
  mapping: new Map([["B", "x-button"]]),
  index,
  capabilities: caps,
  build: { ok: true, log: "" },
  render: { status: "ok", png: "", elements, renderer: { name: "r", version: "1", os: "test" }, warnings: [] },
  analysis: { componentsUsed: [], literals: [] },
  ...extra,
});

const status = (r: ReturnType<typeof verify>, id: string) => r.checks.find((c) => c.id === id)!.status;

describe("verify", () => {
  it("passes a faithful render, accepts a subclass, and never calls a partial result a pass", () => {
    const r = verify(input(good()));
    expect(r.checks.filter((c) => c.status === "fail")).toEqual([]);
    expect(r.checks.find((c) => c.id === "components")!.summary).toBe("2 of 2 design-system components used, 0 invented (1 unmapped, not checked)");
    expect(r.verdict).toBe("incomplete");
    expect(r.headline).toContain("layout within tolerance on 4/4 elements");
    expect(r.headline).not.toContain("Pixel");
  });

  it("ignores hidden design layers, but fails an element rendered for one", () => {
    const r = verify(input([...good(), el("2:3", "x-button", box(200, 0, 100, 40), "Hidden")]));
    expect(status(r, "layout")).toBe("fail");
    expect(r.checks.find((c) => c.id === "layout")!.details.join()).toContain("hidden in the design");
  });

  it("fails a box outside tolerance and names the difference", () => {
    const els = good();
    els[1] = { ...els[1]!, box: box(8, 0, 100, 40) };
    const r = verify(input(els));
    expect(r.checks.find((c) => c.id === "layout")!.details).toContain("✗ Button 2:1 (2:1): x 0 → 8 (+8) (tolerance ±1)");
  });

  it("tells a wrong design-system component from an invented one and a missing one", () => {
    const els = good().filter((e) => e.figmaId !== "2:2");
    els[1] = { ...els[1]!, component: "x-tag" };
    const r = verify(input([...els, el("2:2", "button", box(100, 0, 100, 40), "Save")]));
    const details = r.checks.find((c) => c.id === "components")!.details.join("\n");
    expect(details).toContain("got x-tag (another design-system component)");
    expect(details).toContain("got <button> — invented");
    const missing = verify(input(good().filter((e) => e.figmaId !== "2:1")));
    expect(missing.checks.find((c) => c.id === "components")!.details.join()).toContain("no rendered element carries this Figma id");
  });

  it("counts hard-coded values from the render and the static scan, once each", () => {
    const lit = { property: "fill" as const, written: "#f00", source: "literal" as const, at: "impl.html:3" };
    const els = good();
    els[1] = { ...els[1]!, styles: [lit, { property: "gap", written: "var(--x-space)", source: "token", token: "space" }] };
    const r = verify(input(els, { analysis: { componentsUsed: [], literals: [lit, { property: "fontSize", written: "13px", source: "literal", at: "impl.html:9" }] } }));
    expect(r.checks.find((c) => c.id === "colors")!.summary).toBe("1 hard-coded colours");
    expect(status(r, "type")).toBe("fail");
    expect(status(r, "spacing")).toBe("pass");
  });

  it("fails invented tokens and fallback-less undefined ones, and accepts a known token with its fallback", () => {
    const tokens = { adapter: "t", modes: [], gaps: [], tokens: [{ name: "space-1", path: ["space-1"], type: "dimension", values: {}, provenance: { source: "t", confidence: "high" as const } }] };
    const fact = (written: string, token: string, defined: boolean) => ({ property: "gap" as const, written, source: "token" as const, token, defined });
    const els = good();
    els[1] = { ...els[1]!, styles: [fact("var(--x-space-1, 4px)", "space-1", false)] };
    expect(status(verify(input(els, { tokens })), "spacing")).toBe("pass");
    els[1] = { ...els[1]!, styles: [fact("var(--x-space-1)", "space-1", false)] };
    expect(verify(input(els, { tokens })).checks.find((c) => c.id === "spacing")!.details.join()).toContain("write its fallback");
    els[1] = { ...els[1]!, styles: [fact("var(--x-made-up, 4px)", "made-up", false)] };
    const r = verify(input(els, { tokens }));
    expect(r.checks.find((c) => c.id === "spacing")!.summary).toBe("0 hard-coded spacing or size values, 1 undefined token");
    expect(r.checks.find((c) => c.id === "spacing")!.details.join()).toContain("no such token");
    els[1] = { ...els[1]!, styles: [fact("var(--x-page-var)", "page-var", true)] };
    expect(status(verify(input(els, { tokens })), "spacing")).toBe("pass");
  });

  it("checks text exactly and the typeface actually drawn", () => {
    const els = good();
    els[1] = { ...els[1]!, text: "Cancel ", fonts: ["Arial"] };
    els[2] = { ...els[2]!, text: "save" };
    const r = verify(input(els));
    expect(r.checks.find((c) => c.id === "text")!.summary).toBe("text differs on 1 of 3 elements");
    expect(r.checks.find((c) => c.id === "typeface")!.details).toEqual(["✗ Button 2:1 (2:1): design uses Plex, drawn with Arial"]);
  });

  it("says 'not checked' for everything a failed build prevents", () => {
    const r = verify(input([], { build: { ok: false, log: "x.js:1: Could not resolve" }, render: undefined }));
    expect(status(r, "build")).toBe("fail");
    for (const id of ["render", "components", "layout", "text"]) expect(status(r, id)).toBe("not-checked");
    expect(r.checks.find((c) => c.id === "render")!.summary).toBe("nothing to render: the build failed");
    expect(r.verdict).toBe("fail");
  });

  it("does not check what the adapter says it cannot do", () => {
    const r = verify(input([], { capabilities: { ...caps, build: false, render: { supported: false, hostOS: [], reason: "needs macOS" }, runtimeStyleProvenance: false, staticProvenance: false }, build: undefined, render: undefined }));
    expect(r.checks.filter((c) => c.status !== "not-checked")).toEqual([]);
    expect(r.checks.find((c) => c.id === "render")!.summary).toBe("needs macOS");
    expect(r.verdict).toBe("incomplete");
  });

  it("reads a node's visible text in order", () => {
    expect(visibleText(design.root)).toBe("Cancel Save Help");
  });
});

describe("generated tests check", () => {
  const withTests = (tests: VerifyInput["tests"]) => verify(input(good(), { ...(tests && { tests }) })).checks.find((c) => c.id === "tests")!;

  it("passes when every test ran and passed", () => {
    expect(withTests({ status: "ran", runner: "r", tests: [{ name: "a", status: "passed" }, { name: "b", status: "passed" }] })).toMatchObject({ status: "pass", summary: "2 of 2 generated tests pass · r" });
  });

  it("fails on a failing test, a broken file, or a file with no tests", () => {
    expect(withTests({ status: "ran", runner: "r", tests: [{ name: "a", status: "passed" }, { name: "b", status: "failed", error: "expected 2, got 4" }] })).toMatchObject({ status: "fail", details: ["✗ b: expected 2, got 4"] });
    expect(withTests({ status: "ran", runner: "r", tests: [], fileError: "SyntaxError" }).summary).toBe("the test file did not run");
    expect(withTests({ status: "ran", runner: "r", tests: [] }).summary).toBe("the test file declares no tests");
  });

  it("does not blame the tests when the runner itself is unavailable", () => {
    expect(withTests({ status: "unsupported", reason: "no Vitest installed" })).toMatchObject({ status: "not-checked", summary: "no Vitest installed" });
    expect(withTests(undefined)).toMatchObject({ status: "not-checked", summary: "the adapter cannot run tests in a sandbox" });
  });
});
