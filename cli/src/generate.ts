// tulpar generate <projectDir> --frame <nodeId> --name <ComponentName> [--image design.png] [--attempts 3]
//
// Writes the component for the project's framework, verifies it against the Figma frame,
// feeds failures back for repair, and saves the files with their verification report.

import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { OpenAiLlm, fillName, generate, type GeneratedFile, type GenerationEvent, type GenerationResult, type Llm, type LlmImage } from "@tulpar/core";
import { loadContext, loadScreenshotContext, verifyEntry } from "./pipeline.ts";
import { loadProject, withAdapter, type Project } from "./project.ts";
import { printReport } from "./verify.ts";

export interface GenerateCommandOptions {
  /** A Figma frame (node id). Without one, the image alone is the design (screenshot mode). */
  frame?: string;
  /** Screenshot pixels per design point; guessed from the image width when absent. */
  scale?: number;
  /** Figma file of the frame; defaults to the project's. */
  fileKey?: string;
  /** Token to fetch the frame with when it isn't cached (the user's own). */
  figmaToken?: string;
  name: string;
  out: string;
  cache: string;
  /** A picture of the design: a file path (CLI) or the image itself (web). */
  image?: string | LlmImage;
  attempts?: number;
  theme?: string;
  /** A model to use instead of OpenAI (tests, offline development). */
  llm?: Llm;
  quiet?: boolean;
  onEvent?: (e: GenerationEvent) => void;
}

export interface GenerateOutcome {
  code: number;
  result?: GenerationResult;
  outDir?: string;
  /** Why nothing was generated, when code is 2. */
  error?: string;
  /** The last render, PNG base64. */
  png?: string;
}

export async function generateCommand(projectDir: string, options: GenerateCommandOptions): Promise<GenerateOutcome> {
  const fail = (error: string): GenerateOutcome => {
    if (!options.quiet) console.error(error);
    return { code: 2, error };
  };
  if (!/^[A-Z][A-Za-z0-9]*$/.test(options.name)) return fail(`The component name must be PascalCase, e.g. CheckoutCard (got "${options.name}").`);
  const llm = options.llm ?? OpenAiLlm.fromEnv();
  if (!llm) return fail("No model: set OPENAI_API_KEY in .env (copy .env.example) or in your system environment.");
  if (!options.frame && !options.image) return fail("Give a Figma frame link, a screenshot, or both.");
  let image: LlmImage | undefined;
  try {
    image = options.image === undefined ? undefined : typeof options.image === "string" ? await readImage(options.image) : options.image;
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
  const project = await loadProject(projectDir);
  const log = options.quiet ? () => undefined : (s: string) => console.log(s);

  let result: GenerationResult;
  let png: string | undefined;
  try {
    result = await withAdapter(project, async (host) => {
    const ctx = options.frame
      ? await loadContext(host, project, { frame: options.frame, ...(options.fileKey && { fileKey: options.fileKey }), ...(options.figmaToken && { figmaToken: options.figmaToken }) }, options.out, options.cache)
      : await loadScreenshotContext(host, project, { image: image!, llm, ...(options.scale && { scale: options.scale }) }, options.out);
    if (ctx.source === "screenshot") log(`Read the screenshot: ${ctx.mapping.size} design-system component types found.${ctx.notes.slice(1).map((n) => `
  note: ${n}`).join("")}`);
    const conventions = await host.call("conventions", project.params);
    const tokens = ctx.tokens;
    const workDir = join(".tulpar", "generated", options.name);
    let attempt = 0;

    return generate({
      llm,
      name: options.name,
      design: ctx.design,
      mapping: ctx.mapping,
      index: ctx.index,
      conventions,
      ...(tokens && { tokens }),
      ...(ctx.library && { library: ctx.library }),
      maxAttempts: options.attempts ?? 3,
      ...(image && { image }),
      onEvent: (e) => {
        options.onEvent?.(e);
        if (e.type === "generating") log(`Attempt ${(attempt = e.attempt)}: asking ${llm.name}…`);
        if (e.type === "generated") log(`  wrote ${e.files.join(", ") || "no files"}`);
        if (e.type === "verified") log(`  verification: ${e.report.verdict}${e.report.checks.filter((c) => c.status === "fail").map((c) => `; ✗ ${c.summary}`).join("")}`);
      },
      verify: async (files) => {
        await writeFiles(project, workDir, files);
        const entry = join(workDir, conventions.entry.replace(/\{(name|kebab)\}/g, (p) => fillName(p, options.name))).replace(/\\/g, "/");
        const verified = await verifyEntry(host, project, ctx, entry, options.theme);
        png = verified.png;
        return verified.report;
      },
    });
  });
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }

  const outDir = join(options.out, basename(project.root), "generated", options.name);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  for (const f of result.files) {
    await mkdir(dirname(join(outDir, f.path)), { recursive: true });
    await writeFile(join(outDir, f.path), f.content);
  }
  if (png) await writeFile(join(outDir, "tulpar-render.png"), Buffer.from(png, "base64"));
  if (result.report) await writeFile(join(outDir, "tulpar-report.json"), JSON.stringify({ status: result.status, model: result.model, usage: result.usage, attempts: result.attempts.length, report: result.report }, null, 2));

  if (!options.quiet) {
    console.log("");
    if (result.report) printReport(result.report);
    const label = { verified: "VERIFIED", "unchecked-remain": "NO FAILURES (some checks could not run)", failed: "FAILED" }[result.status];
    console.log(`\nGeneration: ${label} after ${result.attempts.length} attempt(s) with ${result.model}; tokens in/out ${result.usage.inputTokens}/${result.usage.outputTokens}`);
    console.log(`Files: ${outDir}`);
  }
  return { code: result.status === "failed" ? 1 : 0, result, outDir, ...(png && { png }) };
}

async function writeFiles(project: Project, workDir: string, files: GeneratedFile[]): Promise<void> {
  const dir = join(project.root, workDir);
  await rm(dir, { recursive: true, force: true });
  for (const f of files) {
    const path = join(dir, f.path);
    // Generated paths come from a model: keep them inside the work directory.
    if (!path.startsWith(dir)) throw new Error(`Refusing to write outside the work directory: ${f.path}`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, f.content);
  }
}

async function readImage(path: string): Promise<LlmImage> {
  if (!existsSync(path)) throw new Error(`Image not found: ${path}`);
  const ext = extname(path).toLowerCase();
  const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : undefined;
  if (!mime) throw new Error(`Unsupported image type ${ext}; use PNG, JPEG or WebP.`);
  return { mime, base64: (await readFile(path)).toString("base64") };
}
