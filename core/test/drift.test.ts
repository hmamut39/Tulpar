import { describe, expect, it } from "vitest";
import { compareIndexes, signature, type CodeComponent, type CodeProp, type ComponentDef, type ComponentIndex } from "../src/index.ts";

const prop = (name: string, type: CodeProp["type"], extra: Partial<CodeProp> = {}): CodeProp => ({ name, aliases: [], ...(type && { type }), required: false, provenance: {}, ...extra });
const comp = (name: string, props: CodeProp[], extra: Partial<CodeComponent> = {}): CodeComponent => ({
  id: name,
  name,
  module: "m",
  sourcePath: `src/${name}.ts`,
  props,
  slots: [{ name: "", provenance: { source: "t", confidence: "high" } }],
  events: [],
  provenance: { source: "t", confidence: "high" },
  ...extra,
});
const index = (version: string, components: CodeComponent[]): ComponentIndex => ({ adapter: "t", package: { name: "ds", version }, components, gaps: [] });

const size = (values: string[]) => prop("size", { kind: "enum", values, open: false });
const button = (props: CodeProp[]) => comp("x-button", props);

// A Figma Button whose Size variant the matcher aligns to the code prop `size`.
const figmaButton: ComponentDef = {
  kind: "component-set",
  id: "1:1",
  name: "Button",
  description: "",
  links: [],
  page: "Button",
  private: false,
  props: [{ name: "Size", figmaName: "Size", type: "variant", default: "Large", options: ["Small", "Medium", "Large"] }],
  variants: [],
  size: null,
};
const confirmed = new Map([["x-button", [figmaButton]]]);

describe("drift", () => {
  it("reports nothing for identical releases, and hashes signatures stably", () => {
    const a = index("1", [button([size(["sm", "md", "lg"]), prop("disabled", { kind: "boolean" })])]);
    const b = index("2", [button([prop("disabled", { kind: "boolean" }), size(["sm", "md", "lg"])])]);
    expect(signature(a.components[0]!)).toBe(signature(b.components[0]!));
    const r = compareIndexes(a, b, { confirmed });
    expect(r.findings).toEqual([]);
    expect(r.summary).toMatchObject({ unchanged: 1, changed: 0 });
  });

  it("marks a removed prop that a Figma property leans on as breaking the mapping", () => {
    const r = compareIndexes(index("1", [button([size(["sm", "md", "lg"]), prop("kind", { kind: "string" })])]), index("2", [button([prop("kind", { kind: "string" })])]), { confirmed });
    expect(r.findings).toEqual([
      { severity: "breaks-mapping", kind: "prop-removed", component: "x-button", detail: "prop size (3 values) removed", figma: ["Button"], alignedFigmaProps: ["Button › Size"] },
    ]);
  });

  it("detects a renamed prop, and a removed enum value on an aligned prop", () => {
    const before = index("1", [button([size(["sm", "md", "lg"]), prop("isDisabled", { kind: "boolean" })])]);
    const after = index("2", [button([size(["sm", "md"]), prop("disabled", { kind: "boolean" })])]);
    const r = compareIndexes(before, after, { confirmed });
    expect(r.findings.map((f) => [f.severity, f.kind, f.detail])).toEqual([
      ["affects-mapping", "prop-renamed", "prop isDisabled → disabled"],
      ["affects-mapping", "enum-values-changed", 'prop size: removed "lg"'],
    ]);
    expect(r.findings[1]!.alignedFigmaProps).toEqual(["Button › Size"]);
  });

  it("detects a renamed component by its source file, and keeps unmapped changes informational", () => {
    const before = index("1", [comp("x-chip", [prop("tone", { kind: "string" })])]);
    const after = index("2", [comp("x-tag", [prop("tone", { kind: "string" })], { sourcePath: "src/x-chip.ts" }), comp("x-new", [])]);
    const r = compareIndexes(before, after);
    expect(r.summary).toMatchObject({ renamed: 1, added: 1, removed: 0 });
    expect(r.findings.map((f) => [f.severity, f.kind, f.component, f.detail])).toEqual([
      ["info", "component-renamed", "x-chip", "renamed to x-tag"],
      ["info", "component-added", "x-new", "new in the library"],
    ]);
  });

  it("marks a removed mapped component as breaking", () => {
    const r = compareIndexes(index("1", [button([])]), index("2", []), { confirmed });
    expect(r.findings).toEqual([{ severity: "breaks-mapping", kind: "component-removed", component: "x-button", detail: "no longer in the library", figma: ["Button"] }]);
    expect(r.bySeverity).toEqual({ "breaks-mapping": 1, "affects-mapping": 0, info: 0 });
  });

  it("reports type, default, deprecation, slot and event changes, ignoring internal props", () => {
    const before = index("1", [button([prop("label", { kind: "string" }), prop("styles", { kind: "string" }, { internal: "static" }), prop("href", { kind: "string" }, { defaultText: '""' })])]);
    const after = index("2", [
      {
        ...button([prop("label", { kind: "enum", values: ["a"], open: true }), prop("href", { kind: "string" }, { deprecated: true })]),
        slots: [{ name: "icon", provenance: { source: "t", confidence: "high" } }],
        events: [{ name: "x-click", provenance: { source: "t", confidence: "high" } }],
      },
    ]);
    const kinds = compareIndexes(before, after, { confirmed }).findings.map((f) => f.kind).sort();
    expect(kinds).toEqual(["default-changed", "event-added", "prop-deprecated", "prop-type-changed", "slot-added", "slot-removed"]);
  });
});
