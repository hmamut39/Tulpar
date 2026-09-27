// The Tulpar web page's server. It runs the same pipeline as `tulpar generate`.
//
//   npm run web            → http://localhost:4173
//
// Hosting safety, from day one:
// - TULPAR_ACCESS_CODE: when set, every generation needs it (each run spends the owner's OpenAI key);
// - a per-visitor hourly limit (TULPAR_RUNS_PER_HOUR, default 10) and a body size limit;
// - a visitor's Figma token is used for their job only: never stored, logged or returned;
// - generated code is only bundled and rendered in headless Chromium with the network blocked.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { loadDotEnv } from "@tulpar/cli/env";
import { DEFAULT_OPENAI_MODEL, OpenAiLlm, parseFigmaUrl, type Llm } from "@tulpar/core";
import { JobQueue, type JobInput } from "./jobs.ts";
import { zipFiles } from "./zip.ts";

export interface ServerOptions {
  repoRoot: string;
  /** A model to use instead of OpenAI (tests). */
  llm?: () => Llm | undefined;
  accessCode?: string;
  runsPerHour?: number;
}

export interface ProjectInfo {
  id: string;
  dir: string;
  adapter: string;
  label: string;
}

const MAX_BODY = 12 * 1024 * 1024;

export function listProjects(repoRoot: string): ProjectInfo[] {
  const base = join(repoRoot, "examples");
  if (!existsSync(base)) return [];
  const labels: Record<string, string> = { react: "React", "web-components": "Web Components", angular: "Angular" };
  return readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(base, d.name, "tulpar.json")))
    .map((d) => {
      const cfg = JSON.parse(readFileSync(join(base, d.name, "tulpar.json"), "utf8"));
      const pkgs = (cfg[cfg.adapter]?.packages as string[] | undefined) ?? [];
      const pkg = pkgs[0] && existsSync(join(base, d.name, pkgs[0], "package.json")) ? JSON.parse(readFileSync(join(base, d.name, pkgs[0], "package.json"), "utf8")) : undefined;
      return { id: d.name, dir: join(base, d.name), adapter: cfg.adapter, label: `${labels[cfg.adapter] ?? cfg.adapter}${pkg ? ` · ${pkg.name}@${pkg.version}` : ""}` };
    });
}

export function startServer(options: ServerOptions, port: number): Promise<{ url: string; close: () => Promise<void> }> {
  const projects = listProjects(options.repoRoot);
  const llm = options.llm ?? (() => OpenAiLlm.fromEnv());
  const queue = new JobQueue({ repoRoot: options.repoRoot, llm });
  const accessCode = options.accessCode ?? process.env.TULPAR_ACCESS_CODE ?? "";
  const runsPerHour = options.runsPerHour ?? Number(process.env.TULPAR_RUNS_PER_HOUR || 10);
  const runs = new Map<string, number[]>();
  const publicDir = resolve(import.meta.dirname, "../public");

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const path = url.pathname;

      if (req.method === "GET" && path === "/api/config") {
        const model = llm();
        return json(res, 200, {
          projects: projects.map(({ id, adapter, label }) => ({ id, adapter, label })),
          accessCodeRequired: !!accessCode,
          model: model ? model.name : null,
          defaultModel: DEFAULT_OPENAI_MODEL,
          figmaTokenOnServer: !!process.env.FIGMA_TOKEN,
        });
      }

      if (req.method === "POST" && path === "/api/jobs") {
        const body = await readJson(req);
        if (accessCode && !sameSecret(String(body.accessCode ?? ""), accessCode)) return json(res, 401, { error: "Wrong or missing access code." });
        const visitor = clientId(req);
        const recent = (runs.get(visitor) ?? []).filter((t) => Date.now() - t < 3_600_000);
        if (recent.length >= runsPerHour) return json(res, 429, { error: `Limit reached: ${runsPerHour} generations per hour.` });

        const project = projects.find((p) => p.id === body.project);
        if (!project) return json(res, 400, { error: "Pick a project." });
        const ref = typeof body.figmaUrl === "string" ? parseFigmaUrl(body.figmaUrl) : undefined;
        if (!ref) return json(res, 400, { error: "That is not a Figma link." });
        if (!ref.nodeId) return json(res, 400, { error: "That Figma link points at the whole file. In Figma, select the frame, then right-click → Copy link to selection." });
        const name = String(body.name ?? "");
        if (!/^[A-Z][A-Za-z0-9]{0,63}$/.test(name)) return json(res, 400, { error: "The component name must be PascalCase, e.g. CheckoutCard." });
        const image = parseImage(body.image);
        if (body.image && !image) return json(res, 400, { error: "The image must be a PNG, JPEG or WebP data URL." });
        if (!llm()) return json(res, 503, { error: "The server has no OpenAI key configured (OPENAI_API_KEY)." });

        recent.push(Date.now());
        runs.set(visitor, recent);
        const input: JobInput = {
          projectDir: project.dir,
          name,
          frame: ref.nodeId,
          fileKey: ref.fileKey,
          // The visitor's own token first; the server's only as a fallback for the owner's own use.
          ...((typeof body.figmaToken === "string" && body.figmaToken.trim()) || process.env.FIGMA_TOKEN ? { figmaToken: (typeof body.figmaToken === "string" && body.figmaToken.trim()) || process.env.FIGMA_TOKEN! } : {}),
          ...(image && { image }),
        };
        return json(res, 202, { id: queue.add(input) });
      }

      const jobMatch = /^\/api\/jobs\/([a-f0-9-]{36})(\/render\.png|\/download\.zip)?$/.exec(path);
      if (req.method === "GET" && jobMatch) {
        const job = queue.get(jobMatch[1]!);
        if (!job) return json(res, 404, { error: "No such job (jobs are kept for an hour)." });
        if (!jobMatch[2]) return json(res, 200, queue.view(job));
        if (jobMatch[2] === "/render.png") {
          if (!job.png) return json(res, 404, { error: "No render." });
          res.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" });
          return res.end(Buffer.from(job.png, "base64"));
        }
        if (!job.result?.files.length) return json(res, 404, { error: "No files." });
        const zip = zipFiles([...job.result.files.map((f) => ({ path: `${job.input.name}/${f.path}`, content: f.content })), ...(job.result.report ? [{ path: `${job.input.name}/tulpar-report.json`, content: JSON.stringify({ status: job.result.status, report: job.result.report }, null, 2) }] : [])]);
        res.writeHead(200, { "content-type": "application/zip", "content-disposition": `attachment; filename="${job.input.name}.zip"`, "cache-control": "no-store" });
        return res.end(zip);
      }

      if (req.method === "GET") return serveStatic(res, publicDir, path === "/" ? "/index.html" : path);
      return json(res, 404, { error: "Not found." });
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      return json(res, status, { error: status === 500 ? "Server error." : (err as Error).message });
    }
  });

  return new Promise((resolveStart) => {
    server.listen(port, () => {
      const address = server.address();
      const actual = typeof address === "object" && address ? address.port : port;
      resolveStart({ url: `http://localhost:${actual}`, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, "Request too large (12 MB max).");
    chunks.push(chunk as Buffer);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "Expected a JSON object.");
  }
}

function parseImage(value: unknown): JobInput["image"] | undefined {
  if (typeof value !== "string") return undefined;
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(value);
  return m ? { mime: m[1] as "image/png" | "image/jpeg" | "image/webp", base64: m[2]! } : undefined;
}

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function clientId(req: IncomingMessage): string {
  // Behind a proxy the platform sets x-forwarded-for; its first entry is the visitor.
  const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",")[0]!.trim();
  return forwarded || req.socket.remoteAddress || "unknown";
}

const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png" };

async function serveStatic(res: ServerResponse, dir: string, path: string): Promise<void> {
  const file = resolve(dir, `.${decodeURIComponent(path)}`);
  if (!file.startsWith(dir) || !existsSync(file) || !TYPES[extname(file)]) return json(res, 404, { error: "Not found." });
  res.writeHead(200, { "content-type": TYPES[extname(file)]!, "x-content-type-options": "nosniff" });
  res.end(await readFile(file));
}

// `node web/src/server.ts`
if (import.meta.filename === resolve(process.argv[1] ?? "")) {
  loadDotEnv();
  const port = Number(process.env.PORT || 4173);
  const { url } = await startServer({ repoRoot: resolve(import.meta.dirname, "../..") }, port);
  console.log(`Tulpar web page: ${url}`);
  if (!process.env.OPENAI_API_KEY) console.log("! OPENAI_API_KEY is not set: the page loads, but generation is disabled. See .env.example.");
  if (!process.env.TULPAR_ACCESS_CODE) console.log("! TULPAR_ACCESS_CODE is not set: anyone who can reach this port can spend your OpenAI key. Fine on localhost only.");
}
