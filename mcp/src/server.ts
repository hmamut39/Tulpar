#!/usr/bin/env node
// Tulpar as an MCP server (stdio), so any MCP client can use it: Claude Code, Cursor,
// VS Code (Copilot agent mode), and others. It runs the same pipeline as the CLI and
// the web page, on this machine, with this machine's keys (.env).
//
//   claude mcp add tulpar -- node <repo>/mcp/src/server.ts
//
// Tools: tulpar_projects, tulpar_generate, tulpar_verify.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { loadDotEnv } from "@tulpar/cli/env";
import { generateCommand } from "@tulpar/cli/generate";
import { verifyCommand } from "@tulpar/cli/verify";
import { parseFigmaUrl, type Llm, type VerifyReport } from "@tulpar/core";

export interface TulparMcpOptions {
  repoRoot: string;
  /** A model to use instead of OpenAI (tests). */
  llm?: Llm;
  /** Extra project directories (each with a tulpar.json), e.g. the user's own repository. */
  projectDirs?: string[];
}

interface Project {
  id: string;
  dir: string;
  adapter: string;
}

export function listProjects(options: TulparMcpOptions): Project[] {
  const dirs = [
    ...(existsSync(join(options.repoRoot, "examples")) ? readdirSync(join(options.repoRoot, "examples")).map((d) => join(options.repoRoot, "examples", d)) : []),
    ...(options.projectDirs ?? []),
  ];
  return dirs
    .filter((d) => existsSync(join(d, "tulpar.json")))
    .map((d) => ({ id: basename(d), dir: resolve(d), adapter: JSON.parse(readFileSync(join(d, "tulpar.json"), "utf8")).adapter as string }));
}

function findProject(options: TulparMcpOptions, idOrPath: string): Project {
  const byId = listProjects(options).find((p) => p.id === idOrPath);
  if (byId) return byId;
  const dir = resolve(idOrPath);
  if (existsSync(join(dir, "tulpar.json"))) return { id: basename(dir), dir, adapter: JSON.parse(readFileSync(join(dir, "tulpar.json"), "utf8")).adapter };
  throw new Error(`Unknown project "${idOrPath}". Call tulpar_projects, or pass a directory containing a tulpar.json.`);
}

/** The report as plain text for the model: every check, with its details. */
export function reportText(r: VerifyReport): string {
  const mark = { pass: "✓", fail: "✗", "not-checked": "–" } as const;
  return [
    `${r.frame.name} (${r.frame.id}) — verdict: ${r.verdict.toUpperCase()}`,
    ...r.checks.flatMap((c) => [`${mark[c.status]} ${c.status === "not-checked" ? `${c.title}: not checked (${c.summary})` : c.summary}`, ...c.details.filter((d) => !d.startsWith("✓")).map((d) => `    ${d}`)]),
    ...r.warnings.map((w) => `! ${w}`),
  ].join("\n");
}

const checksShape = z.array(z.object({ id: z.string(), status: z.enum(["pass", "fail", "not-checked"]), summary: z.string() }));

export function createServer(options: TulparMcpOptions): McpServer {
  const server = new McpServer({ name: "tulpar", version: "0.1.0" });
  const out = join(options.repoRoot, "out");
  const cache = join(options.repoRoot, ".cache", "figma");

  server.registerTool(
    "tulpar_projects",
    {
      title: "List Tulpar projects",
      description: "The design systems and frameworks Tulpar can generate for: each project pairs a component library with a framework (React, Angular, Web Components…). Use a project's id in tulpar_generate and tulpar_verify.",
      inputSchema: z.object({}),
      outputSchema: z.object({ projects: z.array(z.object({ id: z.string(), adapter: z.string(), dir: z.string() })) }),
    },
    async () => {
      const projects = listProjects(options).map(({ id, adapter, dir }) => ({ id, adapter, dir }));
      return { content: [{ type: "text", text: projects.map((p) => `${p.id} (${p.adapter}) — ${p.dir}`).join("\n") || "No projects found." }], structuredContent: { projects } };
    },
  );

  server.registerTool(
    "tulpar_generate",
    {
      title: "Generate a verified component from Figma or a screenshot",
      description:
        "Writes a UI component with the project's own design-system components and tokens, from a Figma frame link and/or a screenshot. Tulpar builds and renders it, checks it against the design (components used vs invented, tokens vs hard-coded values, layout, text, typeface, its generated tests, pixels when a screenshot is given), and repairs failures. Returns the files and the verification report. Takes 30–120 seconds.",
      inputSchema: z.object({
        project: z.string().describe("Project id from tulpar_projects, or a directory containing a tulpar.json"),
        name: z.string().describe("PascalCase component name, e.g. CheckoutCard"),
        figmaUrl: z.string().optional().describe("A Figma frame link (right-click the frame → Copy link to selection)"),
        screenshot: z.string().optional().describe("Path to a PNG, JPEG or WebP screenshot of the design"),
        attempts: z.number().int().min(1).max(5).optional().describe("Generate-verify-repair attempts (default 3)"),
        writeTo: z.string().optional().describe("Directory to write the files into, e.g. inside the user's workspace"),
        overwrite: z.boolean().optional().describe("Allow replacing existing files in writeTo (default false)"),
      }),
      outputSchema: z.object({
        status: z.enum(["verified", "unchecked-remain", "failed"]),
        files: z.array(z.object({ path: z.string(), content: z.string() })),
        checks: checksShape,
        written: z.array(z.string()),
        attempts: z.number(),
      }),
    },
    async (args) => {
      const project = findProject(options, args.project);
      const ref = args.figmaUrl ? parseFigmaUrl(args.figmaUrl) : undefined;
      if (args.figmaUrl && !ref?.nodeId) return error("That is not a Figma frame link. In Figma: select the frame → right-click → Copy link to selection.");
      if (!ref && !args.screenshot) return error("Give a Figma frame link, a screenshot path, or both.");
      if (args.screenshot && !existsSync(args.screenshot)) return error(`Screenshot not found: ${args.screenshot}`);
      if (args.writeTo) {
        const existing = await existingTargets(args.writeTo, project, args.name);
        if (existing.length && !args.overwrite) return error(`These files already exist in ${args.writeTo}: ${existing.join(", ")}. Pass overwrite: true to replace them.`);
      }
      const outcome = await generateCommand(project.dir, {
        name: args.name,
        out,
        cache,
        quiet: true,
        ...(ref && { frame: ref.nodeId!, fileKey: ref.fileKey }),
        ...(process.env.FIGMA_TOKEN && { figmaToken: process.env.FIGMA_TOKEN }),
        ...(args.screenshot && { image: args.screenshot }),
        ...(args.attempts && { attempts: args.attempts }),
        ...(options.llm && { llm: options.llm }),
      });
      if (outcome.error || !outcome.result) return error(outcome.error ?? "Generation failed.");
      const r = outcome.result;
      const written: string[] = [];
      if (args.writeTo) {
        for (const f of r.files) {
          const target = resolve(args.writeTo, f.path);
          if (!target.startsWith(resolve(args.writeTo))) continue; // paths come from a model
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, f.content);
          written.push(target);
        }
      }
      const statusLine = { verified: "VERIFIED: every check ran and passed.", "unchecked-remain": "No check failed; some could not be checked (see below).", failed: "Checks still FAIL after the last attempt; the files are the best attempt." }[r.status];
      const text = [
        `${args.name}: ${statusLine} (${r.attempts.length} attempt${r.attempts.length === 1 ? "" : "s"}, ${r.model})`,
        written.length ? `Written: ${written.join(", ")}` : `Files are in the result${outcome.outDir ? ` and in ${outcome.outDir}` : ""}.`,
        "",
        r.report ? reportText(r.report) : "No verification report: no buildable component was produced.",
        "",
        ...r.files.map((f) => `--- ${f.path}\n${f.content}`),
      ].join("\n");
      return {
        content: [{ type: "text", text }],
        structuredContent: { status: r.status, files: r.files, checks: (r.report?.checks ?? []).map(({ id, status, summary }) => ({ id, status, summary })), written, attempts: r.attempts.length },
      };
    },
  );

  server.registerTool(
    "tulpar_verify",
    {
      title: "Verify a component against a Figma frame",
      description: "Builds and renders an existing implementation inside a Tulpar project, and checks it against a Figma frame: design-system components used vs invented, tokens vs hard-coded values, layout, text, typeface, and its tests when given. Reports pass, fail or not-checked for each.",
      inputSchema: z.object({
        project: z.string().describe("Project id from tulpar_projects, or a directory containing a tulpar.json"),
        entry: z.string().describe("The implementation's entry file, relative to the project (e.g. src/Card.tsx)"),
        figmaUrl: z.string().describe("The Figma frame link it implements"),
        test: z.string().optional().describe("Its test file, relative to the project"),
      }),
      outputSchema: z.object({ verdict: z.enum(["pass", "fail", "incomplete"]), checks: checksShape }),
    },
    async (args) => {
      const project = findProject(options, args.project);
      const ref = parseFigmaUrl(args.figmaUrl);
      if (!ref?.nodeId) return error("That is not a Figma frame link.");
      const entry = isAbsolute(args.entry) ? relative(project.dir, args.entry) : args.entry;
      const { report } = await verifyCommand(project.dir, entry, { frame: ref.nodeId, out, cache, quiet: true, ...(args.test && { test: args.test }) });
      if (!report) return error("Verification could not start (see the project's configuration).");
      return { content: [{ type: "text", text: reportText(report) }], structuredContent: { verdict: report.verdict, checks: report.checks.map(({ id, status, summary }) => ({ id, status, summary })) } };
    },
  );

  return server;
}

function error(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}

async function existingTargets(dir: string, project: Project, name: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  if (!statSync(dir).isDirectory()) return [dir];
  const kebab = name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
  return readdirSync(dir).filter((f) => f.startsWith(`${name}.`) || f.startsWith(`${kebab}.`) || (project.adapter === "web-components" && f === `${name}.html`));
}

// `node mcp/src/server.ts`: serve over stdio. stdout carries protocol messages only.
if (import.meta.filename === resolve(process.argv[1] ?? "")) {
  loadDotEnv();
  const repoRoot = resolve(import.meta.dirname, "../..");
  const cwd = process.cwd();
  const server = createServer({ repoRoot, ...(cwd !== repoRoot && existsSync(join(cwd, "tulpar.json")) && { projectDirs: [cwd] }) });
  await server.connect(new StdioServerTransport());
}

