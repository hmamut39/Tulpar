import { describe, expect, it } from "vitest";
import {
  PRIOR_MODEL,
  createMatcher,
  decide,
  evaluate,
  features,
  fit,
  fitCalibration,
  matchLibrary,
  normValue,
  prepareCode,
  score,
  valueOverlap,
  type CodeComponent,
  type ComponentDef,
  type ComponentIndex,
  type ExplicitLink,
  type Features,
  type Library,
} from "../src/index.ts";
import { commonPrefix, figmaNameTokens, headToken, jaroWinkler, tokens } from "../src/match/text.ts";

describe("names and values", () => {
  it("tokenises names written in any convention", () => {
    expect(tokens("TextInput")).toEqual(["text", "input"]);
    expect(tokens("cds-text-input")).toEqual(["cds", "text", "input"]);
    expect(tokens("CDSButton")).toEqual(["cds", "button"]);
    expect(tokens("UI shell - Left panel")).toEqual(["ui", "shell", "left", "panel"]);
    expect(tokens("NavBtn")).toEqual(["navigation", "button"]);
  });

  it("finds the head word and drops kit filler", () => {
    expect(figmaNameTokens("Data table toolbar item")).toEqual(["data", "table", "toolbar"]);
    expect(headToken("Data table toolbar item")).toBe("toolbar");
    expect(headToken("Tag - Read-only")).toBe("tag");
    expect(headToken("Text input / Fluid")).toBe("input");
    expect(headToken("_Modal footer item")).toBe("footer");
  });

  it("normalises size vocabularies and compares value sets", () => {
    expect(["Extra small", "Small", "Medium", "Large", "Extra large", "2X large"].map(normValue)).toEqual(["xs", "sm", "md", "lg", "xl", "2xl"]);
    expect(normValue("Large (48px)")).toBe("lg");
    expect(valueOverlap(["Large", "Medium", "Small"], ["lg", "md", "sm", "xl"])).toBe(0.75);
    expect(valueOverlap([], ["a"])).toBe(0);
  });

  it("finds a shared prefix only when most names carry it", () => {
    expect(commonPrefix(["cds-button", "cds-tag", "cds-modal"])).toBe("cds");
    expect(commonPrefix(["Button", "Tag", "Modal"])).toBeUndefined();
    expect(jaroWinkler("martha", "marhta")).toBeCloseTo(0.961, 3);
  });
});

// A tiny design system: Figma and code disagree on names and value spellings.
const code = (name: string, props: CodeComponent["props"] = [], slots: string[] = []): CodeComponent => ({
  id: `pkg#${name}`,
  name,
  module: `pkg/${name}.js`,
  props,
  slots: slots.map((s) => ({ name: s, provenance: { source: "test", confidence: "high" } })),
  events: [],
  provenance: { source: "test", confidence: "high" },
});
const prop = (name: string, type: NonNullable<CodeComponent["props"][number]["type"]>): CodeComponent["props"][number] => ({ name, aliases: [], type, required: false, provenance: {} });

const index: ComponentIndex = {
  adapter: "test",
  gaps: [],
  components: [
    code("x-button", [prop("kind", { kind: "enum", values: ["primary", "secondary", "danger"], open: false }), prop("size", { kind: "enum", values: ["sm", "md", "lg"], open: true }), prop("disabled", { kind: "boolean" })], ["", "icon"]),
    code("x-tag", [prop("type", { kind: "enum", values: ["red", "blue"], open: false }), prop("size", { kind: "enum", values: ["sm", "md"], open: false })]),
    code("x-table", [prop("size", { kind: "enum", values: ["sm", "md", "lg"], open: false }), prop("sortable", { kind: "boolean" })]),
    code("x-table-toolbar", [], [""]),
    code("x-modal", [prop("open", { kind: "boolean" })], ["", "footer"]),
  ],
};

const def = (id: string, name: string, page: string, props: ComponentDef["props"] = []): ComponentDef => ({
  kind: "component-set",
  id,
  name,
  description: "",
  links: [],
  page,
  private: name.startsWith("_"),
  props,
  variants: [{ id: `${id}v`, name: "", values: {} }],
  size: null,
});
const variant = (name: string, options: string[]) => ({ name, figmaName: name, type: "variant" as const, default: options[0]!, options });

const library: Library = {
  schemaVersion: "0.1",
  source: { fileKey: "F", fileVersion: "1", fileName: "Kit" },
  styles: [],
  components: [
    def("1:1", "Button", "Button", [variant("Style", ["Primary", "Secondary", "Danger"]), variant("Size", ["Large", "Medium", "Small"]), variant("State", ["Enabled", "Hover", "Disabled"]), { name: "Button text", figmaName: "Button text#1:0", type: "text", default: "Button" }]),
    def("2:1", "Tag", "Tag", [variant("Color", ["Red", "Blue"]), variant("Size", ["Medium", "Small"])]),
    def("3:1", "Data table toolbar item", "Data table", [variant("Size", ["Large", "Small"])]),
    def("4:1", "Modal", "Modal", [{ name: "Show footer", figmaName: "Show footer#2:0", type: "boolean", default: true }]),
    def("5:1", "Spacer", "Utilities"),
  ],
};

describe("features", () => {
  const button = prepareCode(index.components[0]!, "x");
  it("aligns props by name, type and values, and reads State=Disabled as a boolean", () => {
    const ev = features(library.components[0]!, button);
    expect(ev.props.map((p) => `${p.figma}→${p.code}`)).toEqual(expect.arrayContaining(["Size→size", "State→disabled", "Button text→slot \"\""]));
    expect(ev.features.values).toBeGreaterThan(0.7);
    expect(ev.features.head).toBe(1);
  });

  it("returns null for signals that cannot apply, never a low score", () => {
    const ev = features(library.components[4]!, button);
    expect(ev.features.props).toBeNull();
    expect(ev.features.values).toBeNull();
    expect(ev.features.description).toBeNull();
    expect(ev.features.docLink).toBeNull();
  });
});

describe("matching", () => {
  it("sees the head word, but with prior weights a parent sharing the props still wins (known limit)", () => {
    // Figma "Data table toolbar item" has Size values the parent table shares and the toolbar lacks.
    // The head-word signal points at the toolbar; the hand-set prior lets props outvote it.
    // On Carbon, the fitted leave-one-out model ranks the toolbar first (docs/04).
    const ranked = createMatcher(index).rank(library.components[2]!);
    const at = (name: string) => ranked.find((c) => c.component === name)!;
    expect(at("x-table-toolbar").features.head).toBe(1);
    expect(at("x-table").features.head).toBe(0);
    expect(ranked[0]!.component).toBe("x-table");
  });

  it("never calls an uncalibrated match likely, and abstains when unsure", () => {
    const results = matchLibrary(library, index);
    expect(results.some((r) => r.tier === "likely")).toBe(false);
    const byName = Object.fromEntries(results.map((r) => [r.figma.name, r]));
    expect(byName.Button).toMatchObject({ tier: "possible", best: { component: "x-button" } });
    expect(byName.Spacer!.tier).toBe("unmatched");
    expect(byName.Spacer!.probability).toBeUndefined();
  });

  it("marks explicit links as verified, even on a variant's node id", () => {
    const link: ExplicitLink = { figma: { nodeId: "2:1v" }, component: "x-tag", source: "tag.figma.ts", provenance: { source: "test", confidence: "high" } };
    const tag = matchLibrary(library, index, { links: [link] }).find((r) => r.figma.id === "2:1")!;
    expect(tag).toMatchObject({ tier: "verified", best: { component: "x-tag" }, link });
  });

  it("uses a calibration when one exists", () => {
    const ranked = createMatcher(index).rank(library.components[0]!);
    const cal = { a: 1, b: 0, c: 0, likely: 0.9, possible: 0.5, fittedOn: 40 };
    const result = decide(library.components[0]!, ranked, undefined, { calibration: cal });
    expect(result.probability).toBeCloseTo(ranked[0]!.score);
    expect(result.tier).toBe(ranked[0]!.score >= 0.9 ? "likely" : "possible");
  });
});

describe("model", () => {
  const f = (name: number, props: number | null): Features => ({ docLink: null, description: null, props, values: null, name, head: null, nameContained: name, page: null });
  it("fits weights that separate right from wrong pairs", () => {
    const examples = [
      ...Array.from({ length: 10 }, () => ({ features: f(0.9, 0.8), label: 1 as const })),
      ...Array.from({ length: 40 }, (_, i) => ({ features: f(0.1 + (i % 3) * 0.1, i % 2 ? null : 0.1), label: 0 as const })),
    ];
    const model = fit(examples);
    expect(model.kind).toBe("fitted");
    expect(score(model, f(0.9, 0.8))).toBeGreaterThan(0.9);
    expect(score(model, f(0.1, 0.1))).toBeLessThan(0.1);
  });

  it("prior weights rank a plain name match above a stranger", () => {
    expect(score(PRIOR_MODEL, f(1, null))).toBeGreaterThan(score(PRIOR_MODEL, f(0, null)));
  });

  it("calibrates a likely threshold that meets the precision target on its data", () => {
    const points = [
      ...Array.from({ length: 30 }, (_, i) => ({ score: 0.9 + i * 0.003, margin: 3, correct: true })),
      ...Array.from({ length: 10 }, (_, i) => ({ score: 0.5 + i * 0.02, margin: 0.2, correct: i > 7 })),
    ];
    const cal = fitCalibration(points);
    expect(cal.fittedOn).toBe(40);
    expect(cal.likely).toBeLessThan(1);
  });
});

describe("evaluate", () => {
  const link = (nodeId: string, component: string): ExplicitLink => ({ figma: { nodeId }, component, source: "t", provenance: { source: "test", confidence: "high" } });
  const links = [link("1:1", "x-button"), link("2:1", "x-tag"), link("3:1", "x-table-toolbar"), link("4:1", "x-modal"), link("9:9", "x-button"), link("1:1", "x-gone")];

  it("scores with labels hidden and says what it could not use", () => {
    const e = evaluate(library, index, links, "prior");
    expect(e.labelled).toBe(4);
    expect(e.unusable).toEqual({ "Figma node not in the library read so far": 1, "code component not in the index (or deprecated)": 1 });
    expect(e.top1).toBe(0.75);
    expect(e.errors.map((x) => x.expected[0])).toContain("x-table-toolbar");
    expect(e.tiers.likely.count).toBe(0);
    expect(e.notes.join(" ")).toContain("Not calibrated");
  });

  it("scores only held-out labels when asked, still training on the rest", () => {
    const e = evaluate(library, index, links, "leave-one-out", { scoreOnly: new Set(["1:1"]) });
    expect(e).toMatchObject({ subset: "held-out", labelled: 1 });
  });
});
