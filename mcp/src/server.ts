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
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { loadDotEnv } from "@tulpar/cli/env";
import { generateCommand } from "@tulpar/cli/generate";
import { verifyCommand } from "@tulpar/cli/verify";
import { checkCommand } from "@tulpar/cli/check";
import { loadProject, withAdapter } from "@tulpar/cli/project";
import { parseFigmaUrl, type ComponentIndex, type Llm, type TokenSet, type VerifyReport } from "@tulpar/core";

export interface TulparMcpOptions {
  repoRoot: string;
  /** A model to use instead of OpenAI (tests). */
  llm?: Llm;
  /** Ask the model to choose components no explicit link covers (default true). */
  rerank?: boolean;
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
      description: "The design systems and frameworks Tulpar can generate for: each project pairs a component library with a framework (React, Vue, Angular, Svelte or Web Components). Use a project's id in tulpar_generate and tulpar_verify.",
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
        "Writes a UI component with the project's own design-system components and tokens, from a Figma frame link and/or a screenshot. Tulpar builds and renders it, checks it against the design (components used vs invented, tokens vs hard-coded values, layout, text, typeface, hover/pressed/focus states, its generated tests, pixels when a screenshot is given), and repairs failures. Returns the files and the verification report. Takes 30–120 seconds.",
      inputSchema: z.object({
        project: z.string().describe("Project id from tulpar_projects, or a directory containing a tulpar.json"),
        name: z.string().describe("PascalCase component name, e.g. CheckoutCard"),
        figmaUrl: z.string().optional().describe("A Figma frame link (right-click the frame → Copy link to selection)"),
        screenshot: z.string().optional().describe("Path to a PNG, JPEG or WebP screenshot of the design"),
        attempts: z.number().int().min(1).max(5).optional().describe("Generate-verify-repair attempts (default 3)"),
        candidates: z.number().int().min(1).max(4).optional().describe("Independent first drafts, each verified, before repairing the best (default 1; each is a model call)"),
        language: z.enum(["typescript", "javascript"]).optional().describe("React, Vue and Svelte: write TypeScript (default) or JavaScript, to match the codebase"),
        styling: z.enum(["css", "css-modules", "scss", "less", "tailwind", "styled-components", "emotion"]).optional().describe("React: css (default), css-modules, scss, less, tailwind, styled-components or emotion. Vue: css (scoped, default), scss, less, css-modules or tailwind. Svelte: css (scoped, default) or tailwind. Angular: less (default), scss or css"),
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
        ...(args.candidates && { candidates: args.candidates }),
        ...((args.language || args.styling) && { output: { ...(args.language && { language: args.language }), ...(args.styling && { styling: args.styling }) } }),
        ...(options.llm && { llm: options.llm }),
        ...(options.rerank === false && { noRerank: true }),
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
      description: "Builds and renders an existing implementation inside a Tulpar project, and checks it against a Figma frame: design-system components used vs invented, tokens vs hard-coded values, layout, text, typeface, hover/pressed/focus states, and its tests when given. Reports pass, fail or not-checked for each.",
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

  server.registerTool(
    "tulpar_check",
    {
      title: "Check code against the design system",
      description: "Reviews component files in a Tulpar project, whoever wrote them, with no model and no design: hard-coded colours, type and spacing that should be design tokens, and var(--…) tokens the design system does not have. Use it on code you just wrote. Each finding has its file and line.",
      inputSchema: z.object({
        project: z.string().describe("Project id from tulpar_projects, or a directory containing a tulpar.json"),
        files: z.array(z.string()).describe("Component files (or their stylesheets) to check, absolute or relative to the project"),
      }),
      outputSchema: z.object({ findings: z.array(z.object({ kind: z.string(), file: z.string(), line: z.number().optional(), message: z.string() })) }),
    },
    async (args) => {
      const project = findProject(options, args.project);
      const files = args.files.map((f) => (isAbsolute(f) ? f : join(project.dir, f)));
      const { findings } = await checkCommand(project.dir, files, { quiet: true });
      const text = findings.length ? findings.map((f) => `✗ ${f.file}${f.line ? `:${f.line}` : ""}  ${f.message}`).join("\n") : "No hard-coded values and no invented tokens.";
      return { content: [{ type: "text", text }], structuredContent: { findings } };
    },
  );

  // The design system as resources: any assistant can read the components and tokens, and write
  // design-system code even when it does not call tulpar_generate.
  const projectResources = (kind: string, label: string) =>
    new ResourceTemplate(`tulpar://projects/{id}/${kind}`, {
      list: () => ({ resources: listProjects(options).map((p) => ({ uri: `tulpar://projects/${p.id}/${kind}`, name: `${p.id} ${label}`, mimeType: "text/markdown" })) }),
    });
  server.registerResource("components", projectResources("components", "components"), { title: "Design-system components", description: "A project's design-system components: import path, props with their allowed values, slots, events, where each must be placed, and its theming CSS variables.", mimeType: "text/markdown" }, async (uri, vars) => {
    const project = await loadProject(findProject(options, String(vars.id)).dir);
    const index = await withAdapter(project, (h) => h.call("index", project.params));
    return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: componentsMarkdown(String(vars.id), index) }] };
  });
  server.registerResource("tokens", projectResources("tokens", "tokens"), { title: "Design tokens", description: "A project's design tokens as code writes them (var(--…)), with their values, grouped by kind.", mimeType: "text/markdown" }, async (uri, vars) => {
    const project = await loadProject(findProject(options, String(vars.id)).dir);
    const tokens = await withAdapter(project, async (h) => (h.manifest!.capabilities.tokens ? h.call("tokens", project.params) : undefined));
    return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: tokensMarkdown(String(vars.id), tokens) }] };
  });

  return server;
}

function componentsMarkdown(id: string, index: ComponentIndex): string {
  const pkg = index.package?.name ?? index.components[0]?.module ?? "the design system";
  const lines = [`# ${id}: design-system components`, "", `Import from \`${pkg}\`. Use these components; never re-create them with plain elements.`, ""];
  for (const c of index.components.filter((x) => !x.deprecated)) {
    const props = c.props.filter((p) => !p.internal && !p.deprecated).map((p) => `${p.name}${p.required ? "" : "?"}: ${p.type?.kind === "enum" ? p.type.values.slice(0, 12).map((v) => JSON.stringify(v)).join(" | ") : (p.typeText ?? p.type?.kind ?? "unknown")}`);
    lines.push(`## ${c.name}`);
    if (c.markup) lines.push(`Written as: \`${c.markup}\``);
    if (props.length) lines.push(`Props: ${props.join("; ")}`);
    if (c.slots.length) lines.push(`Slots: ${c.slots.map((s) => s.name || "default").join(", ")}`);
    if (c.events.length) lines.push(`Events: ${c.events.map((e) => e.name).join(", ")}`);
    if (c.insideOf?.length) lines.push(`Must be placed inside: ${c.insideOf.join(" or ")}`);
    if (c.cssProperties?.length) lines.push(`Theming CSS variables: ${c.cssProperties.slice(0, 16).map((p) => p.name).join(", ")}`);
    lines.push("");
  }
  return lines.join("\n");
}

function tokensMarkdown(id: string, set: TokenSet | undefined): string {
  if (!set?.tokens.length) return `# ${id}: design tokens\n\nNo tokens are configured for this project.`;
  const lines = [`# ${id}: design tokens`, "", "Write every colour, type and spacing value as one of these, with its value as the fallback: var(--name, value).", ""];
  const byType = new Map<string, string[]>();
  for (const t of set.tokens) {
    const v = t.values.default ?? Object.values(t.values)[0];
    const hex = (x: number) => Math.round(x * 255).toString(16).padStart(2, "0");
    const value = v?.kind === "color" ? `#${hex(v.color.r)}${hex(v.color.g)}${hex(v.color.b)}` : v?.kind === "dimension" ? `${v.points}px` : v?.kind === "number" ? String(v.value) : "";
    if (!value) continue;
    byType.set(t.type, [...(byType.get(t.type) ?? []), `- \`${t.codeRef ?? t.name}\`: ${value}`]);
  }
  for (const [type, items] of byType) lines.push(`## ${type}`, ...items.slice(0, 400), "");
  return lines.join("\n");
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

