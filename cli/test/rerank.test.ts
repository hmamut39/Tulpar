// The generation pipeline's second opinion on components no explicit link covers.

import { describe, expect, it } from "vitest";
import { LlmError, ScriptedLlm, type ComponentDef, type ComponentIndex, type DesignNode, type Library, type Llm } from "@tulpar/core";
import { rerankUnlinked, type Context } from "../src/pipeline.ts";

const base = { visible: true, opacity: 1, fills: [], effects: [], clips: false, tokens: {} };
const box = { x: 0, y: 0, width: 100, height: 40 };
const def = (id: string, name: string): ComponentDef => ({ kind: "component-set", id, name, description: "", links: [], page: "Components", private: false, props: [], variants: [{ id: `${id}v`, name: "Default", values: {} }], size: null });
const instance = (id: string, set: string): DesignNode => ({ ...base, id, name: id, kind: "instance", box, component: { id: `${set}v`, set: { id: set, name: set } }, props: [], children: [] });
const code = (name: string) => ({ id: name, name, module: "m", props: [], slots: [], events: [], provenance: { source: "t", confidence: "high" as const } });

const library: Library = { schemaVersion: "0.1", source: { fileKey: "F", fileVersion: "1", fileName: "Kit" }, components: [def("A", "Accordion item"), def("B", "Button")], styles: [] };
const index: ComponentIndex = { adapter: "t", gaps: [], components: [code("x-accordion"), code("x-accordion-item"), code("x-button")] };
const context = (): Context => ({
  design: { schemaVersion: "0.1", source: { fileKey: "F", fileVersion: "1", nodeId: "1:1" }, origin: { x: 0, y: 0 }, root: { ...base, id: "1:1", name: "Frame", kind: "container", figmaType: "FRAME", box, children: [instance("2:1", "A"), instance("2:2", "B")] } },
  index,
  links: [{ figma: { nodeId: "B" }, component: "x-button", source: "button.figma.ts", provenance: { source: "t", confidence: "high" } }],
  mapping: new Map([["B", "x-button"], ["Bv", "x-button"]]),
  library,
  source: "figma",
  notes: [],
});

describe("second opinion on unlinked components", () => {
  it("asks only about unlinked components, and maps the pick with a note saying it is unconfirmed", async () => {
    const ctx = context();
    const llm = new ScriptedLlm([{ choice: "x-accordion-item", confidence: "medium", reason: "an item, not the whole accordion" }]);
    const { notes } = await rerankUnlinked(ctx, llm);
    expect(llm.requests).toHaveLength(1);
    expect(llm.requests[0]!.text).toContain("name: Accordion item");
    expect(ctx.mapping.get("Av")).toBe("x-accordion-item");
    expect(notes).toEqual(['"Accordion item" → x-accordion-item: the model\'s pick among the matcher\'s top 3 (medium confidence), not confirmed by a link. an item, not the whole accordion']);
  });

  it("ignores low-confidence picks and model failures", async () => {
    const low = context();
    expect((await rerankUnlinked(low, new ScriptedLlm([{ choice: "x-accordion", confidence: "low", reason: "" }]))).notes).toEqual([]);
    expect(low.mapping.has("A")).toBe(false);
    const failing: Llm = { name: "down", complete: () => Promise.reject(new LlmError("503")) };
    expect((await rerankUnlinked(context(), failing)).notes).toEqual([]);
  });
});
