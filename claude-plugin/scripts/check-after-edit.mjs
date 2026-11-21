#!/usr/bin/env node
// PostToolUse hook: after the agent edits a UI file, Tulpar checks the component (the file and its same-named
// siblings, e.g. Card.tsx with Card.css) against the project's design system and hands the findings back to the
// agent. Needs TULPAR_KEY (an account key from https://tulparsi.com/connect) and TULPAR_PROJECT (a project id,
// e.g. carbon-react); without them, or on any error, it says nothing and never blocks the agent.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const UI = /\.(tsx|jsx|vue|svelte|html|css|scss|less|dart)$|\.component\.ts$/;
const MAX_FILES = 10;
const MAX_BYTES = 200_000;

async function main() {
  const key = process.env.TULPAR_KEY;
  const project = process.env.TULPAR_PROJECT;
  if (!key || !project) return;
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const file = JSON.parse(input || "{}")?.tool_input?.file_path;
  if (typeof file !== "string" || !UI.test(file)) return;

  // The component: files in the same folder whose names start with the edited file's stem.
  const dir = dirname(file);
  const stem = basename(file).split(".")[0];
  const names = readdirSync(dir).filter((n) => n.split(".")[0] === stem && UI.test(n) && statSync(join(dir, n)).size <= MAX_BYTES).slice(0, MAX_FILES);
  if (!names.length) return;
  const files = names.map((n) => ({ path: n, content: readFileSync(join(dir, n), "utf8") }));

  const base = (process.env.TULPAR_URL || "https://tulparsi.com").replace(/\/+$/, "");
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${key}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "tulpar_check", arguments: { project, files } } }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return;
  const raw = await res.text();
  // The answer comes as JSON or as server-sent events ("data: {…}").
  const json = raw.trimStart().startsWith("{") ? raw : raw.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).at(-1);
  const findings = JSON.parse(json ?? "{}")?.result?.structuredContent?.findings;
  if (!Array.isArray(findings) || !findings.length) return;
  const lines = findings.slice(0, 15).map((f) => `- ${f.file}${f.line ? `:${f.line}` : ""} ${f.kind}: ${f.message}`);
  const context = [`Tulpar checked ${stem} against the ${project} design system and found ${findings.length} problem${findings.length === 1 ? "" : "s"}:`, ...lines, "Fix them with the design system's own tokens and components (remove anything unsafe) before going on."].join("\n");
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: context } }));
}

// Ends on its own (exit code 0) once the answer is written: forcing an exit while the HTTP client is still
// closing crashes Node on Windows. Any error is swallowed: a check that cannot run must never block the agent.
main().catch(() => {});
