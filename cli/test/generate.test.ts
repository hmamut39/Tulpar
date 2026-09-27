// The generate → verify → repair loop, end to end on Carbon React, with a scripted model
// standing in for OpenAI: a bad first answer must be caught and fed back; the fix must pass.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ScriptedLlm } from "@tulpar/core";
import { generateCommand } from "../src/generate.ts";

const repo = resolve(import.meta.dirname, "../..");
const project = join(repo, "examples/carbon-react");
const ready = existsSync(join(project, "node_modules/@carbon/react")) && existsSync(join(repo, "out/library.json")) && existsSync(join(repo, ".cache/figma/b8xYgmx2Js30XaldxPkOs9/nodes/410-13792.json"));

const good = `import { Button, ModalFooter } from "@carbon/react";
import "./ModalActions.css";

export default function ModalActions() {
  return (
    <ModalFooter data-figma-id="3906:50588">
      <Button kind="secondary" size="xl" data-figma-id="4122:87677">Button</Button>
      <Button kind="primary" size="xl" data-figma-id="4122:86445">Button</Button>
    </ModalFooter>
  );
}
`;
// A typical AI mistake: a plain <button> and a hard-coded colour.
const bad = good
  .replace(`<Button kind="primary" size="xl" data-figma-id="4122:86445">Button</Button>`, `<button data-figma-id="4122:86445" style={{ backgroundColor: "#0f62fe" }}>Button</button>`);
const css = "/* The design-system components style themselves. */\n";
const test = `import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import ModalActions from "./ModalActions";

describe("ModalActions", () => {
  it("shows both actions", () => {
    render(<ModalActions />);
    expect(screen.getAllByText("Button")).toHaveLength(2);
  });
});
`;
const answer = (tsx: string, extra: { path: string; content: string }[] = []) => ({
  files: [{ path: "ModalActions.tsx", content: tsx }, { path: "ModalActions.css", content: css }, { path: "ModalActions.test.tsx", content: test }, ...extra],
  notes: "",
});

describe.skipIf(!ready)("tulpar generate on Carbon React", () => {
  it("catches a bad first answer, feeds the failures back, and verifies the repair", async () => {
    const llm = new ScriptedLlm([answer(bad), answer(good)]);
    const { result, outDir } = await generateCommand(project, { frame: "3906:50588", name: "ModalActions", out: join(repo, "out"), cache: join(repo, ".cache/figma"), llm, quiet: true });

    expect(result!.attempts).toHaveLength(2);
    const first = result!.attempts[0]!.report!;
    expect(first.checks.find((c) => c.id === "components")!.status).toBe("fail");
    expect(first.checks.find((c) => c.id === "colors")!.status).toBe("fail");

    // The repair request carries the exact failures and the previous files.
    const repair = llm.requests[1]!.text;
    expect(repair).toContain("YOUR PREVIOUS ATTEMPT FAILED THESE CHECKS");
    expect(repair).toContain("invented instead of the design-system component");
    expect(repair).toContain("#0f62fe");

    // No check fails after the repair; pixels and states remain honestly unchecked.
    expect(result!.status).toBe("unchecked-remain");
    expect(result!.report!.checks.filter((c) => c.status === "fail")).toEqual([]);
    expect(await readFile(join(outDir!, "ModalActions.test.tsx"), "utf8")).toBe(test);
    expect(JSON.parse(await readFile(join(outDir!, "tulpar-report.json"), "utf8"))).toMatchObject({ status: "unchecked-remain", attempts: 2 });
  }, 180_000);

  it("rejects files it did not ask for, and gives up honestly when attempts run out", async () => {
    const llm = new ScriptedLlm([answer(bad, [{ path: "../../escape.ts", content: "x" }])]);
    const { result, code } = await generateCommand(project, { frame: "3906:50588", name: "ModalActions", out: join(repo, "out"), cache: join(repo, ".cache/figma"), llm, attempts: 1, quiet: true });
    expect(code).toBe(1);
    expect(result!.status).toBe("failed");
    expect(result!.attempts[0]!.rejected).toEqual(['Unexpected file "../../escape.ts"; only ModalActions.tsx, ModalActions.css, ModalActions.test.tsx may be written.']);
    expect(result!.files.map((f) => f.path)).not.toContain("../../escape.ts");
  }, 180_000);

  it("gives the model the translated props and the design-system API", async () => {
    const llm = new ScriptedLlm([answer(good)]);
    await generateCommand(project, { frame: "3906:50588", name: "ModalActions", out: join(repo, "out"), cache: join(repo, ".cache/figma"), llm, attempts: 1, quiet: true });
    const text = llm.requests[0]!.text;
    expect(text).toContain('→ Button props {"hasIconOnly":false,"kind":"secondary","size":"xl"}');
    expect(text).toContain("ROOT maps to: ModalFooter");
    expect(text).toContain('kind: "primary" | "secondary"');
    // Only layers the code styles itself get token hints; instance internals don't.
    expect(text).not.toContain("ai-aura");
  }, 180_000);
});

describe.skipIf(!ready)("tulpar generate from a screenshot alone", () => {
  it("reads the picture, generates, checks the content placed into components, and compares pixels", async () => {
    const reading = {
      width: 640,
      height: 64,
      notes: [],
      elements: [
        { id: "e1", parent: "", kind: "component", component: "ButtonSet", props: [], text: "", x: 0, y: 0, width: 640, height: 64, fill: "", confidence: 0.9 },
        { id: "e2", parent: "e1", kind: "component", component: "Button", props: [{ name: "kind", value: "secondary" }, { name: "size", value: "xl" }], text: "Button", x: 0, y: 0, width: 320, height: 64, fill: "", confidence: 0.9 },
        { id: "e3", parent: "e1", kind: "component", component: "Button", props: [{ name: "kind", value: "primary" }, { name: "size", value: "xl" }], text: "Button", x: 320, y: 0, width: 320, height: 64, fill: "", confidence: 0.9 },
      ],
    };
    const tsx = `import { Button, ButtonSet } from "@carbon/react";
import "./FromShot.css";
export default function FromShot() {
  return (
    <div data-figma-id="screenshot">
      <ButtonSet fluid data-figma-id="e1">
        <Button kind="secondary" size="xl" data-figma-id="e2">Button</Button>
        <Button kind="primary" size="xl" data-figma-id="e3">Button</Button>
      </ButtonSet>
    </div>
  );
}
`;
    const llm = new ScriptedLlm([reading, { files: [{ path: "FromShot.tsx", content: tsx }, { path: "FromShot.css", content: "" }, { path: "FromShot.test.tsx", content: "// tests\n" }], notes: "" }]);
    const { result } = await generateCommand(project, { name: "FromShot", image: join(import.meta.dirname, "fixtures/footer-screenshot.png"), out: join(repo, "out"), cache: join(repo, ".cache/figma"), llm, quiet: true });

    // The code-writing request saw the buttons as content to place inside the ButtonSet.
    expect(llm.requests[1]!.text).toContain("content (place inside ButtonSet)");
    const report = result!.report!;
    expect(report.checks.find((c) => c.id === "components")!.summary).toBe("3 of 3 design-system components used, 0 invented");
    const visual = report.checks.find((c) => c.id === "visual")!;
    expect(visual.status).toBe("pass");
    expect(report.warnings[0]).toMatch(/read from a screenshot/);
    expect(result!.status).toBe("unchecked-remain");
  }, 180_000);
});
