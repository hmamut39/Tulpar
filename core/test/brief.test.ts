// The brief: what the model is told. Here, the team's own examples, for the components the design uses only.

import { describe, expect, it } from "vitest";
import { ScriptedLlm, buildBrief, generate, type ComponentIndex, type DesignNode, type DesignTree, type VerifyReport } from "../src/index.ts";

const base = { visible: true, opacity: 1, fills: [], effects: [], clips: false, tokens: {} };
const button: DesignNode = { ...base, id: "2:1", name: "Button", kind: "instance", box: { x: 0, y: 0, width: 100, height: 40 }, component: { id: "Bv", set: { id: "B", name: "Button" } }, props: [], children: [] } as DesignNode;
const design: DesignTree = { schemaVersion: "0.1", source: { fileKey: "F", fileVersion: "1", nodeId: "1:1" }, origin: { x: 0, y: 0 }, root: { ...base, id: "1:1", name: "Footer", kind: "container", figmaType: "FRAME", box: { x: 0, y: 0, width: 300, height: 40 }, children: [button] } as DesignNode };
const comp = (name: string) => ({ id: name, name, module: "m", props: [], slots: [], events: [], provenance: { source: "t", confidence: "high" as const } });
const index: ComponentIndex = { adapter: "t", gaps: [], components: [comp("Button"), comp("Modal")] };
const conventions = { language: "TS", framework: "React", files: [{ path: "{name}.tsx", role: "component" as const, description: "" }], entry: "{name}.tsx", rules: [], importExample: "" };

describe("brief", () => {
  it("carries the team's own uses of the components the design needs, and only those", () => {
    const brief = buildBrief({
      name: "Footer",
      design,
      mapping: new Map([["B", "Button"]]),
      index,
      conventions,
      examples: { Button: [{ file: "src/Checkout.tsx", code: '<Button kind="primary" size="md">' }], Modal: [{ file: "src/X.tsx", code: "<Modal open>" }] },
    });
    expect(brief.examples).toEqual([{ component: "Button", file: "src/Checkout.tsx", code: '<Button kind="primary" size="md">' }]);
  });

  it("has no examples when the codebase has none", () => {
    expect(buildBrief({ name: "Footer", design, mapping: new Map([["B", "Button"]]), index, conventions }).examples).toEqual([]);
  });
});

describe("repairs that look at the render", () => {
  const answer = { files: [{ path: "Footer.tsx", content: "export default () => null;" }], notes: "" };
  const report = (failing: string) => ({ frame: { id: "1:1", name: "F", width: 1, height: 1 }, verdict: "fail", headline: "", checks: [{ id: failing, title: failing, status: "fail", summary: failing, details: [] }], warnings: [] }) as unknown as VerifyReport;
  const run = async (failing: string) => {
    const llm = new ScriptedLlm([answer, answer]);
    const shown = report(failing);
    await generate({ llm, name: "Footer", design, mapping: new Map([["B", "Button"]]), index, conventions, maxAttempts: 2, image: { mime: "image/png", base64: "DESIGN" }, verify: async () => shown, renderOf: (r) => (r === shown ? { mime: "image/png", base64: "RENDER" } : undefined) });
    return llm.requests;
  };

  it("shows the model its own render beside the design after a visual failure", async () => {
    const [first, repair] = await run("layout");
    expect(first!.images!.map((i) => i.base64)).toEqual(["DESIGN"]);
    expect(repair!.images!.map((i) => i.base64)).toEqual(["DESIGN", "RENDER"]);
    expect(repair!.text).toMatch(/The second image is your previous attempt as it rendered/);
  });

  it("does not spend an image on a failure a picture cannot help with", async () => {
    const [, repair] = await run("colors");
    expect(repair!.images!.map((i) => i.base64)).toEqual(["DESIGN"]);
  });
});

describe("repairs start from the best attempt so far", () => {
  it("sets aside a repair that made things worse and repairs the better one", async () => {
    const files = (body: string) => ({ files: [{ path: "Footer.tsx", content: body }], notes: "" });
    const check = (id: string) => ({ id, title: id, status: "fail", summary: `${id} failed`, details: [] });
    const report = (...failing: string[]) => ({ frame: { id: "1:1", name: "F", width: 1, height: 1 }, verdict: "fail", headline: "", checks: failing.map(check), warnings: [] }) as unknown as VerifyReport;
    const llm = new ScriptedLlm([files("// first"), files("// second"), files("// third"), files("// fourth")]);
    const reports = [report("layout", "colors"), report("layout"), report("layout", "colors", "spacing")];
    let n = 0;
    await generate({ llm, name: "Footer", design, mapping: new Map([["B", "Button"]]), index, conventions, maxAttempts: 4, verify: async () => reports[n++] ?? report("layout") });
    // The fourth request repairs the second attempt (one failure), not the third (three).
    expect(llm.requests[3]!.text).toContain("// second");
    expect(llm.requests[3]!.text).not.toContain("// third");
  });
});
