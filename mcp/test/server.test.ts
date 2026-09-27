// The MCP server, driven by a real MCP client over an in-memory transport: what Claude
// Code, Cursor or VS Code see. Generation uses a scripted model.

import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { ScriptedLlm } from "@tulpar/core";
import { createServer } from "../src/server.ts";

const repo = resolve(import.meta.dirname, "../..");
const ready = existsSync(join(repo, "examples/carbon-react/node_modules/@carbon/react")) && existsSync(join(repo, "out/library.json")) && existsSync(join(repo, ".cache/figma/b8xYgmx2Js30XaldxPkOs9/nodes/410-13792.json"));
const FRAME = "https://www.figma.com/design/b8xYgmx2Js30XaldxPkOs9/Carbon?node-id=3906-50588";

const tsx = `import { Button, ModalFooter } from "@carbon/react";
import "./McpActions.css";
export default function McpActions() {
  return (
    <ModalFooter data-figma-id="3906:50588">
      <Button kind="secondary" size="xl" data-figma-id="4122:87677">Button</Button>
      <Button kind="primary" size="xl" data-figma-id="4122:86445">Button</Button>
    </ModalFooter>
  );
}
`;
const test = `import { render, screen } from "@testing-library/react";
import McpActions from "./McpActions";
describe("McpActions", () => { it("shows two actions", () => { render(<McpActions />); expect(screen.getAllByRole("button")).toHaveLength(2); }); });
`;
const answer = { files: [{ path: "McpActions.tsx", content: tsx }, { path: "McpActions.css", content: "" }, { path: "McpActions.test.tsx", content: test }], notes: "" };

let client: Client;
const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<{ content: { type: string; text: string }[]; structuredContent?: Record<string, any>; isError?: boolean }>;

describe("Tulpar MCP server", () => {
  beforeAll(async () => {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createServer({ repoRoot: repo, llm: new ScriptedLlm([answer]) }).connect(serverSide);
    client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(clientSide);
  });
  afterAll(() => client.close());

  it("offers three tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["tulpar_generate", "tulpar_projects", "tulpar_verify"]);
  });

  it("lists the projects", async () => {
    const r = await call("tulpar_projects", {});
    expect(r.structuredContent!.projects.map((p: { id: string }) => p.id)).toEqual(expect.arrayContaining(["carbon", "carbon-react", "carbon-angular"]));
  });

  it("explains bad input instead of failing silently", async () => {
    expect((await call("tulpar_generate", { project: "carbon-react", name: "X" })).content[0]!.text).toBe("Give a Figma frame link, a screenshot path, or both.");
    expect((await call("tulpar_generate", { project: "carbon-react", name: "X", figmaUrl: "https://example.com" })).isError).toBe(true);
    expect((await call("tulpar_generate", { project: "nope", name: "X", figmaUrl: FRAME })).isError).toBe(true);
  });

  it.skipIf(!ready)("generates, verifies, runs the tests, and writes the files into the workspace", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tulpar-mcp-"));
    const r = await call("tulpar_generate", { project: "carbon-react", name: "McpActions", figmaUrl: FRAME, writeTo: dir, attempts: 1 });
    expect(r.structuredContent!.status).toBe("unchecked-remain");
    expect(r.structuredContent!.checks.find((c: { id: string }) => c.id === "tests").summary).toMatch(/^1 of 1 generated tests pass/);
    expect(await readFile(join(dir, "McpActions.tsx"), "utf8")).toBe(tsx);
    expect(r.content[0]!.text).toContain("3 of 3 design-system components used, 0 invented");

    // A second run must not overwrite the developer's files unless asked.
    await writeFile(join(dir, "McpActions.tsx"), "// edited by the developer\n");
    const again = await call("tulpar_generate", { project: "carbon-react", name: "McpActions", figmaUrl: FRAME, writeTo: dir });
    expect(again.isError).toBe(true);
    expect(again.content[0]!.text).toMatch(/already exist/);
    expect(await readFile(join(dir, "McpActions.tsx"), "utf8")).toBe("// edited by the developer\n");
  }, 180_000);

  it.skipIf(!ready)("verifies existing code against a Figma frame", async () => {
    const r = await call("tulpar_verify", { project: "carbon-react", entry: "impl/modal-footer.tsx", figmaUrl: FRAME });
    expect(r.structuredContent!.verdict).toBe("incomplete");
    expect(r.content[0]!.text).toContain("✓ 3 of 3 design-system components used, 0 invented");
  }, 180_000);
});
