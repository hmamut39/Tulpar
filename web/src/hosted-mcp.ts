// Tulpar as a hosted MCP server, at https://tulparsi.com/mcp: the verifier an agent calls without installing
// anything. The caller signs in with an account key (Authorization: Bearer tlp_…, the same key the VS Code
// extension and the Figma plugin use) and sends its files; Tulpar checks them in the project's design system and,
// with a Figma frame, builds, renders and verifies them. No model runs, so nothing is charged against generations.
//
// Submitted code is treated like generated code: it is written into a folder of its own inside the project,
// bundled, and run only in the sandboxed browser (or, for Java and C#, on the throwaway runner machines), never on
// this server; the folder is deleted when the call ends. A verification takes the job queue to itself, so it never
// builds beside a generation. A Figma token sent with a call is used for that call only, and the frame it fetched
// is deleted afterwards.

import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { findingsOf, parseFigmaUrl, type VerifyReport } from "@tulpar/core";
import { checkCommand } from "@tulpar/cli/check";
import { loadContext, verifyEntry } from "@tulpar/cli/pipeline";
import { loadProject, withAdapter } from "@tulpar/cli/project";

export interface HostedProject {
  id: string;
  dir: string;
  adapter: string;
  label: string;
}

export interface HostedOptions {
  repoRoot: string;
  /** The projects this account may use: the built-in ones and its own. */
  projects: HostedProject[];
  /** Runs a verification with the job queue to itself. */
  exclusive: <T>(fn: () => Promise<T>) => Promise<T>;
  /** False when the account has used its hourly allowance of hosted calls. */
  allow: () => boolean;
  /** The Figma file of a project's own kit, which stays cached for everyone. */
  kitFileKey: (projectDir: string) => string | undefined;
}

const MAX_FILES = 20;
const MAX_FILE_BYTES = 200_000;

const filesShape = z
  .array(z.object({ path: z.string().describe("Path relative to the component's folder, e.g. Card.tsx or styles/Card.css"), content: z.string() }))
  .min(1)
  .max(MAX_FILES)
  .describe(`The component's files as they are now (at most ${MAX_FILES}, ${MAX_FILE_BYTES / 1000} kB each)`);
const findingsShape = z.array(z.object({ check: z.string(), element: z.object({ id: z.string(), name: z.string() }).optional(), problem: z.string(), fix: z.string().optional() }));
const checksShape = z.array(z.object({ id: z.string(), status: z.enum(["pass", "fail", "not-checked"]), summary: z.string() }));

/** A safe relative path inside the call's folder, or undefined (absolute, "..", or odd characters). */
export function safePath(path: string): string | undefined {
  const p = normalize(path.replace(/\\/g, "/")).replace(/\\/g, "/");
  if (!p || isAbsolute(p) || p.startsWith("../") || p === ".." || p.split("/").some((s) => s === ".." || s.startsWith(".")) || !/^[\w./@ -]+$/.test(p)) return undefined;
  return p;
}

/** Writes the call's files into a folder of its own in the project; returns it, and a cleanup. */
function stage(projectDir: string, files: { path: string; content: string }[]): { dir: string; rel: (p: string) => string; done: () => void } {
  for (const f of files) {
    if (!safePath(f.path)) throw new Error(`"${f.path}" is not a relative path inside the component's folder.`);
    if (Buffer.byteLength(f.content) > MAX_FILE_BYTES) throw new Error(`${f.path} is larger than ${MAX_FILE_BYTES / 1000} kB.`);
  }
  const folder = join(".tulpar", "hosted", randomUUID());
  const dir = join(projectDir, folder);
  for (const f of files) {
    const target = resolve(dir, safePath(f.path)!);
    if (!target.startsWith(dir + sep)) throw new Error(`"${f.path}" is outside the component's folder.`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, f.content);
  }
  return { dir, rel: (p) => `${folder}/${safePath(p)}`.replace(/\\/g, "/"), done: () => rmSync(dir, { recursive: true, force: true }) };
}

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });
const refuse = (s: string) => ({ ...text(s), isError: true });

function reportText(report: VerifyReport): string {
  const lines = report.checks.map((c) => `${c.status === "pass" ? "✓" : c.status === "fail" ? "✗" : "–"} ${c.title}: ${c.summary}`);
  const findings = findingsOf(report).map((f) => `  ${f.check}: ${f.element ? `${f.element.name} (${f.element.id}): ` : ""}${f.problem}${f.fix ? ` — fix: ${f.fix}` : ""}`);
  return [`Verdict: ${report.verdict}`, ...lines, ...(findings.length ? ["", "What to fix:", ...findings] : []), ...(report.warnings.length ? ["", "Notes:", ...report.warnings.map((w) => `  ${w}`)] : [])].join("\n");
}

export function hostedServer(o: HostedOptions): McpServer {
  const server = new McpServer({ name: "tulpar", version: "1.0.0" });
  const project = (id: string) => o.projects.find((p) => p.id === id);
  const unknown = (id: string) => refuse(`No project "${id}". Call tulpar_projects for the ids.`);

  server.registerTool(
    "tulpar_projects",
    {
      title: "List the design systems",
      description: "The design systems and frameworks this Tulpar account can check code against (built in, and any the account added). Call it first for the project id that matches the code's framework and component library.",
      inputSchema: z.object({}),
      outputSchema: z.object({ projects: z.array(z.object({ id: z.string(), adapter: z.string(), label: z.string() })) }),
    },
    async () => {
      const projects = o.projects.map(({ id, adapter, label }) => ({ id, adapter, label }));
      return { ...text(projects.map((p) => `${p.id}: ${p.label}`).join("\n")), structuredContent: { projects } };
    },
  );

  server.registerTool(
    "tulpar_check",
    {
      title: "Check UI code against the design system",
      description:
        "Call after writing or changing UI component files, before saying they are done. Finds hard-coded colours, sizes and spacing that should be the design system's tokens, tokens that do not exist (with the real one of that family and value), and unsafe code a component never needs (network calls, code from strings, cookies, stored data or secrets, raw HTML). Fast; no model runs. Send the component's files.",
      inputSchema: z.object({ project: z.string().describe("Project id from tulpar_projects"), files: filesShape }),
      outputSchema: z.object({ findings: z.array(z.object({ kind: z.string(), file: z.string(), line: z.number().optional(), message: z.string() })) }),
    },
    async (args) => {
      const p = project(args.project);
      if (!p) return unknown(args.project);
      if (!o.allow()) return refuse("This account has used its hourly allowance of hosted checks. Try again later.");
      let staged: ReturnType<typeof stage>;
      try {
        staged = stage(p.dir, args.files);
      } catch (e) {
        return refuse((e as Error).message);
      }
      try {
        const { findings } = await checkCommand(p.dir, args.files.map((f) => join(staged.dir, safePath(f.path)!)), { quiet: true });
        // Paths as the caller sent them, not the server's folders.
        const back = findings.map((f) => ({ ...f, file: relative(staged.dir, resolve(f.file)).replace(/\\/g, "/") }));
        const summary = back.length ? back.map((f) => `${f.file}${f.line ? `:${f.line}` : ""} ${f.kind}: ${f.message}`).join("\n") : "No hard-coded values, no invented tokens, nothing unsafe.";
        return { ...text(summary), structuredContent: { findings: back } };
      } finally {
        staged.done();
      }
    },
  );

  server.registerTool(
    "tulpar_verify",
    {
      title: "Verify UI code against a Figma frame",
      description:
        "Call when code implements a Figma frame, before saying it is done. Tulpar builds and renders the files in a sandbox and checks them against the frame: the design system's components used rather than look-alikes, tokens rather than hard-coded values, layout, text, typeface, hover/pressed/focus states, its tests when given, and no unsafe code. Returns each check, and `findings`: each failure's element (its Figma id, which is the data-figma-id in the code), what is wrong and the fix (usually the exact token). Apply the fixes and call again until it passes. Elements must carry data-figma-id attributes with the frame's layer ids. No model runs.",
      inputSchema: z.object({
        project: z.string().describe("Project id from tulpar_projects"),
        files: filesShape,
        entry: z.string().describe("Which of the files is the component's entry (e.g. Card.tsx)"),
        test: z.string().optional().describe("Which of the files is its test, to run in the sandbox"),
        figmaUrl: z.string().optional().describe("The Figma frame link it implements (right-click the frame → Copy link to selection)"),
        figmaToken: z.string().optional().describe("A Figma personal access token to read the frame (used for this call only, never stored). Not needed with figmaNode."),
        figmaNode: z.record(z.string(), z.unknown()).optional().describe("The frame as Figma's REST JSON ({ document, components, componentSets, styles }), instead of a link and token"),
      }),
      outputSchema: z.object({ verdict: z.enum(["pass", "fail", "incomplete"]), checks: checksShape, findings: findingsShape, notes: z.array(z.string()) }),
    },
    async (args) => {
      const p = project(args.project);
      if (!p) return unknown(args.project);
      if (!args.files.some((f) => f.path === args.entry)) return refuse(`The entry "${args.entry}" is not one of the files sent.`);
      if (args.test && !args.files.some((f) => f.path === args.test)) return refuse(`The test "${args.test}" is not one of the files sent.`);
      const ref = args.figmaUrl ? parseFigmaUrl(args.figmaUrl) : undefined;
      const node = args.figmaNode as { document?: { id?: string } } | undefined;
      const frame = ref?.nodeId ?? node?.document?.id;
      if (!frame) return refuse("Give the Figma frame: figmaUrl (a link with node-id) and figmaToken, or figmaNode.");
      if (!o.allow()) return refuse("This account has used its hourly allowance of hosted verifications. Try again later.");
      let staged: ReturnType<typeof stage>;
      try {
        staged = stage(p.dir, args.files);
      } catch (e) {
        return refuse((e as Error).message);
      }
      try {
        const report = await o.exclusive(async () => {
          const proj = await loadProject(p.dir);
          return withAdapter(proj, async (host) => {
            const input = { frame, ...(ref?.fileKey && { fileKey: ref.fileKey }), ...(args.figmaToken && { figmaToken: args.figmaToken }), ...(node?.document && { node: node as never }) };
            const ctx = await loadContext(host, proj, input, join(o.repoRoot, "out"), join(o.repoRoot, ".cache/figma"));
            return (await verifyEntry(host, proj, ctx, staged.rel(args.entry), undefined, args.test ? staged.rel(args.test) : undefined, args.files.map((f) => ({ path: staged.rel(f.path), content: f.content })))).report;
          });
        });
        const structured = { verdict: report.verdict, checks: report.checks.map(({ id, status, summary }) => ({ id, status, summary })), findings: findingsOf(report), notes: report.warnings };
        return { ...text(reportText(report)), structuredContent: structured };
      } catch (e) {
        return refuse(`Could not verify: ${(e as Error).message}`);
      } finally {
        staged.done();
        // The frame fetched with the caller's token is theirs: not kept after the call.
        const key = ref?.fileKey;
        if (args.figmaToken && key && key !== o.kitFileKey(p.dir) && /^[\w-]+$/.test(key)) rmSync(resolve(o.repoRoot, ".cache/figma", key), { recursive: true, force: true });
      }
    },
  );

  return server;
}
