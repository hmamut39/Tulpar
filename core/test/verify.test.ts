import { describe, expect, it } from "vitest";
import { fontClass } from "../src/verify/fonts.ts";
import { tokenKind } from "../src/verify/token-kind.ts";
import { verify, visibleText, type AdapterManifest, type ComponentIndex, type DesignNode, type DesignTree, type RenderedElement, type RenderResult, type StateFact, type TokenSet, type VerifyInput } from "../src/index.ts";

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

  it("accepts what an element draws when its own box is wider, but not a drawn box that is also off", () => {
    const els = good();
    // A full-width host that draws a button-sized control: the drawn extent matches the design.
    els[1] = { ...els[1]!, box: box(0, 0, 300, 40), drawnBox: box(0, 0, 100, 40) };
    expect(status(verify(input(els)), "layout")).toBe("pass");
    els[1] = { ...els[1]!, box: box(0, 0, 300, 40), drawnBox: box(8, 0, 100, 40) };
    expect(status(verify(input(els)), "layout")).toBe("fail");
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

  it("fails a token of the wrong kind, but only when a token of the right kind exists", () => {
    const token = (name: string, type: string) => ({ name, path: [name], type, values: {}, provenance: { source: "t", confidence: "high" as const } });
    const withSpacing = { adapter: "t", modes: [], gaps: [], tokens: [token("ds-spacing-large", "dimension"), token("ds-font-size-x-large", "dimension"), token("ds-line-height-normal", "number")] };
    const fact = (property: "padding" | "lineHeight" | "gap", name: string) => ({ property, written: `var(--${name}, 24px)`, source: "token" as const, token: name, defined: true });
    const els = good();
    els[1] = { ...els[1]!, styles: [fact("padding", "ds-font-size-x-large")] };
    const r = verify(input(els, { tokens: withSpacing }));
    expect(r.checks.find((c) => c.id === "spacing")).toMatchObject({ status: "fail", summary: "0 hard-coded spacing or size values, 1 token of the wrong kind" });
    expect(r.checks.find((c) => c.id === "spacing")!.details.join()).toContain("a font-size token used for padding; use a spacing token");
    els[1] = { ...els[1]!, styles: [fact("padding", "ds-spacing-large"), fact("lineHeight", "ds-line-height-normal")] };
    expect(verify(input(els, { tokens: withSpacing })).checks.filter((c) => c.status === "fail")).toEqual([]);
    // No spacing tokens at all: a font-size token for a gap is not judged.
    const noSpacing = { ...withSpacing, tokens: [token("ds-font-size-x-large", "dimension")] };
    els[1] = { ...els[1]!, styles: [fact("gap", "ds-font-size-x-large")] };
    expect(status(verify(input(els, { tokens: noSpacing })), "spacing")).toBe("pass");
  });

  it("fails a border or background colour used for text, when the system has text colours", () => {
    const token = (name: string) => ({ name, path: [name], type: "color", values: {}, provenance: { source: "t", confidence: "high" as const } });
    const tokens = { adapter: "t", modes: [], gaps: [], tokens: [token("border-strong-01"), token("text-secondary"), token("layer-01")] };
    const fact = (property: "textColor" | "fill", name: string) => ({ property, written: `var(--cds-${name}, #8d8d8d)`, source: "token" as const, token: name, defined: true });
    const els = good();
    els[1] = { ...els[1]!, styles: [fact("textColor", "border-strong-01")] };
    const colors = verify(input(els, { tokens })).checks.find((c) => c.id === "colors")!;
    expect(colors.status).toBe("fail");
    expect(colors.details.join()).toContain("a border colour token used for text; use a text colour token, e.g. text-secondary");
    // A text colour as a fill is how icons are coloured; a background as a fill is what it is for.
    els[1] = { ...els[1]!, styles: [fact("textColor", "text-secondary"), fact("fill", "text-secondary"), fact("fill", "layer-01")] };
    expect(status(verify(input(els, { tokens })), "colors")).toBe("pass");
    els[1] = { ...els[1]!, styles: [fact("fill", "border-strong-01")] };
    expect(status(verify(input(els, { tokens })), "colors")).toBe("fail");
  });

  it("tells a token's kind from its name", () => {
    expect(["cds-spacing-05", "sl-font-size-small", "sl-border-radius-medium", "sl-panel-border-width", "sl-toggle-size-medium", "cds-layer-01", "body-compact-01"].map((n) => tokenKind(n, n === "cds-layer-01" ? "color" : "dimension"))).toEqual(["spacing", "font-size", "radius", "border-width", "size", "color", undefined]);
  });

  it("checks text exactly and the typeface actually drawn", () => {
    const els = good();
    els[1] = { ...els[1]!, text: "Cancel ", fonts: ["Arial"] };
    els[2] = { ...els[2]!, text: "save" };
    const r = verify(input(els));
    expect(r.checks.find((c) => c.id === "text")!.summary).toBe("text differs on 1 of 3 elements");
    expect(r.checks.find((c) => c.id === "typeface")!.details).toEqual(["✗ Button 2:1 (2:1): design uses Plex, drawn with Arial"]);
  });

  it("does not count a kit's placeholders or icons as components missing a mapping", () => {
    const slot = { ...instance("2:5", "S", 0, ""), name: "Slot", component: { id: "Sv", set: { id: "S", name: "Slot" } }, children: [] } as DesignNode;
    const icon = { ...instance("2:6", "C", 280, ""), name: "Close", box: box(280, 12, 16, 16), component: { id: "Cv", name: "Close" }, children: [] } as DesignNode;
    const withAside = { ...design, root: { ...design.root, children: [...(design.root as { children: DesignNode[] }).children, slot, icon] } } as DesignTree;
    const c = verify({ ...input(good()), design: withAside }).checks.find((x) => x.id === "components")!;
    expect(c.summary).toBe("2 of 2 design-system components used, 0 invented (1 unmapped, not checked)");
    expect(c.details).toEqual(expect.arrayContaining(["– Slot (2:5): a placeholder the team fills", "– Close (2:6): an icon, drawn with the icon set"]));
  });

  it("takes a font's face name as its family: Plex SemiBold is Plex", () => {
    const els = good();
    els[1] = { ...els[1]!, fonts: ["Plex SemiBold"] };
    els[2] = { ...els[2]!, fonts: ["Plex Bold Italic"] };
    expect(status(verify(input(els)), "typeface")).toBe("pass");
    els[1] = { ...els[1]!, fonts: ["Plex Serif"] };
    expect(status(verify(input(els)), "typeface")).toBe("fail");
  });

  it("sets aside an input's placeholder inside a form field, but still checks the field's own label", () => {
    const fieldInput = { ...instance("3:2", "B", 0, ""), children: [] } as DesignNode;
    const field = { ...instance("3:1", "B", 0, "Email"), children: [text("I3:1;1", "Email"), fieldInput] } as DesignNode;
    const formDesign: DesignTree = { ...design, root: { ...(design.root as Extract<DesignNode, { kind: "container" }>), children: [field] } };
    const run = (label: string) =>
      verify(input([el("1:1", "x-footer", box(0, 0, 300, 40), `${label} name@company.com`), el("3:1", "x-button", box(0, 0, 100, 40), `${label} name@company.com`), el("3:2", "x-button", box(0, 0, 100, 40), "name@company.com")], { design: formDesign }));
    expect(run("Email").checks.find((c) => c.id === "text")!.status).toBe("pass");
    expect(run("Emial").checks.find((c) => c.id === "text")!.details).toEqual(['✗ Button 3:1 (3:1): design says "Email", rendered "Emial name@company.com"']);
  });

  it("sets aside the text of an element the code nests inside a field while the design places it beside", () => {
    const label = { ...instance("4:1", "B", 0, "Email"), box: box(0, 0, 300, 70) } as DesignNode;
    const beside = { ...instance("4:2", "B", 0, "name@company.com"), box: box(0, 30, 300, 40) } as DesignNode;
    const formDesign: DesignTree = { ...design, root: { ...(design.root as Extract<DesignNode, { kind: "container" }>), children: [label, beside] } };
    const r = verify(input([el("1:1", "x-footer", box(0, 0, 300, 70), "Email name@company.com"), el("4:1", "x-button", box(0, 0, 300, 70), "Email name@company.com"), el("4:2", "x-button", box(0, 30, 300, 40), "name@company.com")], { design: formDesign }));
    expect(r.checks.find((c) => c.id === "text")!.status).toBe("pass");
  });

  it("counts the content placed into an instance as its text (a form field holding an input)", () => {
    const field = { ...instance("5:1", "B", 0, "Email"), content: [instance("5:2", "B", 0, "name@company.com")] } as DesignNode;
    const formDesign: DesignTree = { ...design, root: { ...(design.root as Extract<DesignNode, { kind: "container" }>), children: [field] } };
    const run = (text: string) => verify(input([el("1:1", "x-footer", box(0, 0, 300, 40), text), el("5:1", "x-button", box(0, 0, 100, 40), text), el("5:2", "x-button", box(0, 0, 100, 40), "name@company.com")], { design: formDesign }));
    expect(run("Email name@company.com").checks.find((c) => c.id === "text")!.status).toBe("pass");
    expect(run("Emial name@company.com").checks.find((c) => c.id === "text")!.status).toBe("fail");
  });

  describe("interaction states", () => {
    const withStates = (states: StateFact[], tokens?: TokenSet) => {
      const base = input(good(), { capabilities: { ...caps, forceStates: ["hover", "pressed", "focus"] }, ...(tokens && { tokens }) });
      return verify({ ...base, render: { ...(base.render as Extract<RenderResult, { status: "ok" }>), states } }).checks.find((c) => c.id === "states")!;
    };
    const fact = (state: StateFact["state"], changed: number, extra: Partial<StateFact> = {}): StateFact => ({ figmaId: "2:1", state, changed, shifted: false, colors: [], ...extra });
    const blue: TokenSet = { adapter: "t", modes: [], gaps: [], tokens: [{ name: "blue-60", path: ["blue-60"], type: "color", values: { default: { kind: "color", color: { space: "srgb", r: 15 / 255, g: 98 / 255, b: 254 / 255, a: 1 } } }, provenance: { source: "t", confidence: "high" } }] };

    it("passes elements whose focus is visible and whose states keep their layout and token colours", () => {
      const c = withStates([fact("hover", 0.3, { colors: ["rgb(15, 98, 254)"] }), fact("pressed", 0.3), fact("focus", 0.08)], blue);
      expect(c.status).toBe("pass");
      expect(c.details[0]).toMatch(/^✓ x-button \(2:1\): changes on hover 30%, pressed 30%, focus 8%/);
    });

    it("fails an invisible focus, a layout shift, and a state colour outside the design system", () => {
      const c = withStates([fact("hover", 0.3, { shifted: true, colors: ["rgb(255, 0, 255)"] }), fact("pressed", 0.3), fact("focus", 0)], blue);
      expect(c.status).toBe("fail");
      expect(c.details).toEqual([
        "✗ x-button (2:1): no visible focus indicator: keyboard users cannot see where they are",
        "✗ x-button (2:1): its box moves when hovered",
        expect.stringMatching(/^✗ x-button \(2:1\): hover paints #ff00ff, which is no design-system colour/),
      ]);
    });

    it("passes when nothing is interactive, and ignores translucent shadow colours", () => {
      expect(withStates([]).summary).toBe("no interactive elements to check");
      expect(withStates([fact("hover", 0.1, { colors: ["rgba(255, 0, 255, 0.3)"] }), fact("focus", 0.05)], blue).status).toBe("pass");
    });
  });

  it("gives a screenshot's text width slack for the font, but not its position, and not a Figma design's", () => {
    const heading = text("6:1", "Sign in", box(24, 24, 94, 24));
    const page = (fileKey: string): DesignTree => ({ ...design, source: { ...design.source, fileKey }, root: { ...(design.root as Extract<DesignNode, { kind: "container" }>), children: [heading] } });
    const layout = (fileKey: string, b: RenderedElement["box"]) =>
      verify(input([el("1:1", "x-footer", box(0, 0, 300, 40), "Sign in"), el("6:1", "h1", b, "Sign in")], { design: page(fileKey) })).checks.find((c) => c.id === "layout")!;
    expect(layout("screenshot", box(24, 24, 66, 24)).details.join()).not.toMatch(/6:1/);
    expect(layout("screenshot", box(24, 60, 66, 24)).details.join()).toMatch(/Label \(6:1\): y 24 → 60/);
    expect(layout("F", box(24, 24, 66, 24)).details.join()).toMatch(/Label \(6:1\): width 94 → 66/);
  });

  it("judges a component holding placed content (a card holding a form) on its own text", () => {
    const field = { ...instance("7:2", "B", 0, "name@company.com"), box: box(0, 40, 100, 40) } as DesignNode;
    const label = text("7:3", "Email", box(0, 20, 60, 18));
    const card = { ...instance("7:1", "B", 0, "Sign in"), box: box(0, 0, 300, 120), content: [label, field] } as DesignNode;
    const page: DesignTree = { ...design, root: { ...(design.root as Extract<DesignNode, { kind: "container" }>), children: [card] } };
    const run = (title: string) =>
      verify(input([el("1:1", "x-footer", box(0, 0, 300, 120), `${title} Email`), el("7:1", "x-button", box(0, 0, 300, 120), `${title} Email`), el("7:3", "span", box(0, 20, 60, 18), "Email"), el("7:2", "x-button", box(0, 40, 100, 40), "")], { design: page })).checks.find((c) => c.id === "text")!;
    expect(run("Sign in").details.join()).not.toMatch(/7:1/);
    expect(run("Log in").details.join()).toMatch(/Button 7:1 \(7:1\): design says "Sign in"/);
  });

  it("checks the typeface class when a screenshot names no font", () => {
    const shot = (fontClass: "sans-serif" | "serif") => ({
      ...design,
      root: { ...design.root, children: design.root.kind === "container" ? design.root.children.map((c) => (c.kind === "instance" ? { ...c, children: c.children.map((t) => (t.kind === "text" ? { ...t, style: { ...t.style, fontFamily: undefined, fontClass } } : t)) } : c)) : [] },
    }) as DesignTree;
    const els = good().map((e) => ({ ...e, fonts: ["Times New Roman"] }));
    const r = verify(input(els, { design: shot("sans-serif") }));
    expect(r.checks.find((c) => c.id === "typeface")).toMatchObject({ status: "fail", summary: "typeface class as designed on 0/3 elements" });
    expect(r.checks.find((c) => c.id === "typeface")!.details[0]).toContain("design shows sans-serif type, drawn in Times New Roman (serif)");
    expect(status(verify(input(els, { design: shot("serif") })), "typeface")).toBe("pass");
  });

  it("knows the class of common typefaces", () => {
    expect([fontClass("Times New Roman"), fontClass("IBM Plex Serif"), fontClass('"Georgia"')]).toEqual(["serif", "serif", "serif"]);
    expect([fontClass("JetBrains Mono"), fontClass("Consolas"), fontClass("monospace")]).toEqual(["monospace", "monospace", "monospace"]);
    expect([fontClass("IBM Plex Sans"), fontClass("Inter"), fontClass("Noto Sans Serif Display")]).toEqual(["sans-serif", "sans-serif", "sans-serif"]);
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
