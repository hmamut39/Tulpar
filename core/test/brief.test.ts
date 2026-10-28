// The brief: what the model is told. Here, the team's own examples, for the components the design uses only.

import { describe, expect, it } from "vitest";
import { ScriptedLlm, buildBrief, generate, generationCost, type ComponentIndex, type DesignNode, type DesignTree, type VerifyReport } from "../src/index.ts";

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

describe("several first drafts", () => {
  it("verifies each draft independently, then repairs the best one", async () => {
    const files = (body: string) => ({ files: [{ path: "Footer.tsx", content: body }], notes: "" });
    const check = (id: string) => ({ id, title: id, status: "fail", summary: `${id} failed`, details: [] });
    const report = (...failing: string[]) => ({ frame: { id: "1:1", name: "F", width: 1, height: 1 }, verdict: "fail", headline: "", checks: failing.map(check), warnings: [] }) as unknown as VerifyReport;
    const llm = new ScriptedLlm([files("// draft a"), files("// draft b"), files("// repair")]);
    const reports = [report("layout", "colors"), report("layout"), report()];
    let n = 0;
    const events: { attempt: number; repair: boolean }[] = [];
    const result = await generate({ llm, name: "Footer", design, mapping: new Map([["B", "Button"]]), index, conventions, candidates: 2, maxAttempts: 3, verify: async () => reports[n++]!, onEvent: (e) => e.type === "generating" && events.push({ attempt: e.attempt, repair: e.repair }) });
    // The second draft is a fresh start, not a repair of the first.
    expect(llm.requests[1]!.text).not.toContain("YOUR PREVIOUS ATTEMPT");
    expect(llm.requests[2]!.text).toContain("// draft b");
    expect(events).toEqual([{ attempt: 1, repair: false }, { attempt: 2, repair: false }, { attempt: 3, repair: true }]);
    // It stops once an attempt passes: 2 drafts + 1 repair, not 2 + 2.
    expect(result.attempts).toHaveLength(3);
    expect(result.files[0]!.content).toBe("// repair");
  });
});

describe("model routing", () => {
  const files = (body: string) => ({ files: [{ path: "Footer.tsx", content: body }], notes: "" });
  const check = (id: string) => ({ id, title: id, status: "fail", summary: `${id} failed`, details: [] });
  const report = (...failing: string[]) => ({ frame: { id: "1:1", name: "F", width: 1, height: 1 }, verdict: "fail", headline: "", checks: failing.map(check), warnings: [] }) as unknown as VerifyReport;
  // A model that answers in order and reports a million input tokens per call.
  const model = (name: string, answers: unknown[]) => {
    const requests: string[] = [];
    return { requests, llm: { name, complete: async (r: { text: string }) => (requests.push(r.text), { json: answers.shift(), model: name, usage: { inputTokens: 1_000_000, outputTokens: 0 } }) } };
  };

  it("writes first drafts with the cheaper model and repairs with the main one, priced each at its own rate", async () => {
    const cheap = model("cheap", [files("// draft")]);
    const main = model("main", [files("// repair")]);
    const reports = [report("layout"), report()];
    let n = 0;
    const result = await generate({ llm: main.llm as never, draftLlm: cheap.llm as never, name: "Footer", design, mapping: new Map([["B", "Button"]]), index, conventions, maxAttempts: 3, verify: async () => reports[n++]! });
    expect(cheap.requests).toHaveLength(1);
    expect(main.requests).toHaveLength(1);
    expect(main.requests[0]).toContain("// draft");
    expect(result.attempts.map((a) => [a.model, !!a.draft])).toEqual([["cheap", true], ["main", false]]);
    expect(result.model).toBe("main");
    expect(generationCost(result.attempts, { TULPAR_OPENAI_INPUT_PER_M: "10", TULPAR_OPENAI_DRAFT_INPUT_PER_M: "1" })).toBe(11);
    // No draft price: no cost, rather than the main price for the draft's tokens.
    expect(generationCost(result.attempts, { TULPAR_OPENAI_INPUT_PER_M: "10" })).toBeUndefined();
  });

  it("names the draft model when a draft passes on its own", async () => {
    const cheap = model("cheap", [files("// draft")]);
    const main = model("main", []);
    const result = await generate({ llm: main.llm as never, draftLlm: cheap.llm as never, name: "Footer", design, mapping: new Map([["B", "Button"]]), index, conventions, verify: async () => report() });
    expect(result.model).toBe("cheap");
    expect(main.requests).toHaveLength(0);
  });
});

describe("a change asked for on delivered files", () => {
  const files = (body: string) => ({ files: [{ path: "Footer.tsx", content: body }], notes: "" });
  const check = (id: string) => ({ id, title: id, status: "fail", summary: `${id} failed`, details: [`✗ ${id} detail`] });
  const report = (...failing: string[]) => ({ frame: { id: "1:1", name: "F", width: 1, height: 1 }, verdict: failing.length ? "fail" : "pass", headline: "", checks: failing.map(check), warnings: [] }) as unknown as VerifyReport;
  const change = { files: [{ path: "Footer.tsx", content: "// delivered" }], request: "Make the button full width." };

  it("applies the request to the files, and differences from the design are what was asked", async () => {
    const llm = new ScriptedLlm([files("// changed")]);
    const result = await generate({ llm, name: "Footer", design, mapping: new Map([["B", "Button"]]), index, conventions, change, verify: async () => report("layout", "visual") });
    expect(llm.requests[0]!.text).toContain("// delivered");
    expect(llm.requests[0]!.text).toMatch(/THE CHANGE THEY ASK FOR[^\n]*\nMake the button full width\./);
    // No repair to undo the change: the design comparisons do not count.
    expect(result.attempts).toHaveLength(1);
    expect(result).toMatchObject({ status: "verified", departures: ["layout", "visual"] });
  });

  it("repairs what the change broke, keeping the request in view", async () => {
    const llm = new ScriptedLlm([files("// changed"), files("// fixed")]);
    const reports = [report("colors", "layout"), report("layout")];
    let n = 0;
    const result = await generate({ llm, name: "Footer", design, mapping: new Map([["B", "Button"]]), index, conventions, change, verify: async () => reports[n++]! });
    expect(llm.requests[1]!.text).toMatch(/THE TEAM ASKED FOR THIS CHANGE[^\n]*\nMake the button full width\./);
    expect(llm.requests[1]!.text).toContain("colors failed");
    expect(llm.requests[1]!.text).not.toContain("layout failed");
    expect(result.files[0]!.content).toBe("// fixed");
    expect(result.status).toBe("verified");
  });
});

describe("repairs never weaken the tests", () => {
  const conv = { ...conventions, files: [...conventions.files, { path: "{name}.test.tsx", role: "test" as const, description: "" }] };
  const answer = (test: string) => ({ files: [{ path: "Footer.tsx", content: "export default () => null;" }, { path: "Footer.test.tsx", content: test }], notes: "" });
  const two = `it("a", () => { expect(1).toBe(1); expect(2).toBe(2); });\nit("b", () => { expect(3).toBe(3); });`;
  const fewer = `it("a", () => { expect(1).toBe(1); });`;
  const report = (...failing: string[]) => ({ frame: { id: "1:1", name: "F", width: 1, height: 1 }, verdict: failing.length ? "fail" : "pass", headline: "", checks: failing.map((id) => ({ id, title: id, status: "fail", summary: `${id} failed`, details: [] })), warnings: [] }) as unknown as VerifyReport;

  it("rejects a repair that drops tests or assertions, and says why", async () => {
    const llm = new ScriptedLlm([answer(two), answer(fewer), answer(two)]);
    const reports = [report("tests"), report(), report()];
    let n = 0;
    const result = await generate({ llm, name: "Footer", design, mapping: new Map([["B", "Button"]]), index, conventions: conv, maxAttempts: 3, verify: async () => reports[n++]! });
    expect(result.attempts[1]!.rejected.join()).toMatch(/Footer\.test\.tsx lost tests or assertions \(2 tests and 3 assertions before, 1 and 1 now\)/);
    // The weakened attempt passed its checks but is not delivered: the next repair is.
    expect(result.attempts).toHaveLength(3);
    expect(llm.requests[2]!.text).toContain("never remove or weaken a test");
  });

  it("counts test cases and assertions, not comments", async () => {
    const { testWeight } = await import("../src/index.ts");
    expect(testWeight(`// it("old", () => expect(x))\ntestWidgets("w", (t) async { expect(find.text("A"), findsOneWidget); });`)).toEqual({ tests: 1, assertions: 1 });
  });
});
