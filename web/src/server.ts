// The Tulpar web page's server. It runs the same pipeline as `tulpar generate`.
//
//   npm run web            → http://localhost:4173
//
// Hosting safety, from day one:
// - TULPAR_ACCESS_CODES (comma-separated invite codes, one per tester) or TULPAR_ACCESS_CODE: when set,
//   every generation needs one (each run spends the owner's OpenAI key). In production (NODE_ENV=production)
//   the server refuses to start without one, unless TULPAR_PUBLIC=1 says the page is open on purpose;
// - a per-visitor hourly limit (TULPAR_RUNS_PER_HOUR, default 10), a whole-server daily cap
//   (TULPAR_RUNS_PER_DAY, default 100, which bounds the OpenAI bill), a queue limit and a body size limit;
// - the visitor's address comes from x-forwarded-for only when TULPAR_TRUST_PROXY=1 (behind a hosting
//   proxy); otherwise anyone could fake the header to escape the limits;
// - a visitor's Figma token is used for their job only: never stored, logged or returned;
// - generated code is only bundled and rendered in headless Chromium with the network blocked;
// - one JSON log line per finished job (project, source, status, attempts, tokens, time, which invite):
//   never the token, the image, the code or the files.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { createHash, timingSafeEqual } from "node:crypto";
import { loadDotEnv } from "@tulpar/cli/env";
import { DEFAULT_OPENAI_MODEL, OpenAiLlm, parseFigmaUrl, type Llm } from "@tulpar/core";
import { JobQueue, type JobInput } from "./jobs.ts";
import { zipFiles } from "./zip.ts";

export interface ServerOptions {
  repoRoot: string;
  /** A model to use instead of OpenAI (tests). */
  llm?: () => Llm | undefined;
  /** One code or several invite codes; default from TULPAR_ACCESS_CODES / TULPAR_ACCESS_CODE. */
  accessCode?: string | string[];
  runsPerHour?: number;
  /** Generations per day across all visitors. */
  runsPerDay?: number;
  /** Jobs waiting or running before new ones are turned away. */
  maxQueue?: number;
  /** Take the visitor's address from x-forwarded-for (only behind a proxy that sets it). */
  trustProxy?: boolean;
  /** Where job log lines go; default stdout. */
  log?: (line: string) => void;
  /** Where generation results go; default out/<project>/generated/<name>. */
  resultsRoot?: string;
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

export function startServer(options: ServerOptions, port: number): Promise<{ url: string; close: () => Promise<void>; drain: () => Promise<void> }> {
  const projects = listProjects(options.repoRoot);
  const llm = options.llm ?? (() => OpenAiLlm.fromEnv());
  const codes = accessCodes(options.accessCode);
  const runsPerHour = options.runsPerHour ?? Number(process.env.TULPAR_RUNS_PER_HOUR || 10);
  const runsPerDay = options.runsPerDay ?? Number(process.env.TULPAR_RUNS_PER_DAY || 100);
  const maxQueue = options.maxQueue ?? 20;
  const trustProxy = options.trustProxy ?? process.env.TULPAR_TRUST_PROXY === "1";
  const log = options.log ?? ((line: string) => console.log(line));
  const runs = new Map<string, number[]>();
  const today: number[] = [];
  const invites = new Map<string, string>(); // job id → which invite (a hash, never the code)
  const queue = new JobQueue({
    repoRoot: options.repoRoot,
    llm,
    onFinish: (job, ms) => {
      const r = job.result;
      log(JSON.stringify({
        event: "job",
        at: new Date().toISOString(),
        project: basename(job.input.projectDir),
        source: job.source,
        state: job.state,
        ...(r && { status: r.status, attempts: r.attempts.length, tokens: r.usage.inputTokens + r.usage.outputTokens, model: r.model }),
        ...(job.error && { error: job.error.slice(0, 200) }),
        ms,
        invite: invites.get(job.id) ?? null,
      }));
      invites.delete(job.id);
    },
  });
  const publicDir = resolve(import.meta.dirname, "../public");

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const path = url.pathname;
      securityHeaders(res);

      if (req.method === "GET" && path === "/healthz") return json(res, 200, { ok: true, pending: queue.pending });

      if (req.method === "GET" && path === "/api/config") {
        const model = llm();
        return json(res, 200, {
          projects: projects.map(({ id, adapter, label }) => ({ id, adapter, label })),
          accessCodeRequired: codes.length > 0,
          model: model ? model.name : null,
          defaultModel: DEFAULT_OPENAI_MODEL,
          figmaTokenOnServer: !!process.env.FIGMA_TOKEN,
        });
      }

      if (req.method === "POST" && path === "/api/jobs") {
        const body = await readJson(req);
        const given = String(body.accessCode ?? "");
        const code = codes.find((c) => sameSecret(given, c));
        if (codes.length && !code) return json(res, 401, { error: "Wrong or missing access code." });
        const visitor = clientId(req, trustProxy);
        const recent = (runs.get(visitor) ?? []).filter((t) => Date.now() - t < 3_600_000);
        if (recent.length >= runsPerHour) return json(res, 429, { error: `Limit reached: ${runsPerHour} generations per hour.` });
        while (today.length && Date.now() - today[0]! > 86_400_000) today.shift();
        if (today.length >= runsPerDay) return json(res, 429, { error: "Tulpar has reached today's generation limit. Try again tomorrow." });
        if (queue.pending >= maxQueue) return json(res, 503, { error: "Tulpar is busy. Try again in a few minutes." });

        const project = projects.find((p) => p.id === body.project);
        if (!project) return json(res, 400, { error: "Pick a project." });
        const hasUrl = typeof body.figmaUrl === "string" && body.figmaUrl.trim() !== "";
        const ref = hasUrl ? parseFigmaUrl(body.figmaUrl as string) : undefined;
        if (hasUrl && !ref) return json(res, 400, { error: "That is not a Figma link." });
        if (ref && !ref.nodeId) return json(res, 400, { error: "That Figma link points at the whole file. In Figma, select the frame, then right-click → Copy link to selection." });
        const name = String(body.name ?? "");
        if (!/^[A-Z][A-Za-z0-9]{0,63}$/.test(name)) return json(res, 400, { error: "The component name must be PascalCase, e.g. CheckoutCard." });
        const image = parseImage(body.image);
        if (body.image && !image) return json(res, 400, { error: "The image must be a PNG, JPEG or WebP data URL." });
        if (!ref && !image) return json(res, 400, { error: "Paste a Figma frame link, upload a screenshot, or both." });
        const scale = body.scale === undefined || body.scale === "" || body.scale === "auto" ? undefined : Number(body.scale);
        if (scale !== undefined && ![1, 1.5, 2, 3].includes(scale)) return json(res, 400, { error: "Scale must be auto, 1, 1.5, 2 or 3." });
        if (!llm()) return json(res, 503, { error: "The server has no OpenAI key configured (OPENAI_API_KEY)." });

        recent.push(Date.now());
        runs.set(visitor, recent);
        today.push(Date.now());
        const input: JobInput = {
          projectDir: project.dir,
          name,
          ...(options.resultsRoot && { resultsDir: join(options.resultsRoot, project.id, name) }),
          ...(ref && { frame: ref.nodeId!, fileKey: ref.fileKey }),
          ...(scale && { scale }),
          // The visitor's own token first; the server's only as a fallback for the owner's own use.
          ...((typeof body.figmaToken === "string" && body.figmaToken.trim()) || process.env.FIGMA_TOKEN ? { figmaToken: (typeof body.figmaToken === "string" && body.figmaToken.trim()) || process.env.FIGMA_TOKEN! } : {}),
          ...(image && { image }),
        };
        const id = queue.add(input);
        if (code) invites.set(id, createHash("sha256").update(code).digest("hex").slice(0, 8));
        return json(res, 202, { id });
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

  // Node closes idle keep-alive connections after 5 s; a client (the page's polling, or a hosting
  // proxy, which keeps connections for 60 s) that reuses one at that instant gets a reset. Outlast them.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  return new Promise((resolveStart) => {
    server.listen(port, () => {
      const address = server.address();
      const actual = typeof address === "object" && address ? address.port : port;
      resolveStart({ url: `http://localhost:${actual}`, close: () => new Promise((r) => server.close(() => r())), drain: () => queue.idle() });
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

/** Invite codes from the option or the environment; blanks dropped. */
export function accessCodes(option?: string | string[]): string[] {
  const raw = option ?? `${process.env.TULPAR_ACCESS_CODES ?? ""},${process.env.TULPAR_ACCESS_CODE ?? ""}`;
  return [...new Set((Array.isArray(raw) ? raw : raw.split(",")).map((c) => c.trim()).filter(Boolean))];
}

function clientId(req: IncomingMessage, trustProxy: boolean): string {
  // The hosting proxy appends the address it saw, so the last entry is the one it vouches for;
  // earlier entries are whatever the visitor sent.
  const forwarded = trustProxy ? String(req.headers["x-forwarded-for"] ?? "").split(",").at(-1)!.trim() : "";
  return forwarded || req.socket.remoteAddress || "unknown";
}

// The page loads only its own files and Google Fonts; generated code never runs in it.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' blob: data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join("; ");

function securityHeaders(res: ServerResponse): void {
  res.setHeader("content-security-policy", CSP);
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
  if (process.env.NODE_ENV === "production") res.setHeader("strict-transport-security", "max-age=31536000; includeSubDomains");
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
  if (process.env.NODE_ENV === "production" && !accessCodes().length && process.env.TULPAR_PUBLIC !== "1") {
    console.error("Refusing to start: NODE_ENV=production and no TULPAR_ACCESS_CODES, so anyone could spend the OpenAI key. Set invite codes, or TULPAR_PUBLIC=1 if the page is meant to be open.");
    process.exit(1);
  }
  const port = Number(process.env.PORT || 4173);
  const server = await startServer({ repoRoot: resolve(import.meta.dirname, "../..") }, port);
  console.log(`Tulpar web page: ${server.url}`);
  if (!process.env.OPENAI_API_KEY) console.log("! OPENAI_API_KEY is not set: the page loads, but generation is disabled. See .env.example.");
  if (!accessCodes().length) console.log("! No access code is set: anyone who can reach this port can spend your OpenAI key. Fine on localhost only.");
  // On a deploy the platform sends SIGTERM: stop taking requests, let the running job finish (up to 2 minutes).
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, async () => {
      console.log(`${signal}: finishing the running generation, then stopping.`);
      setTimeout(() => process.exit(0), 120_000).unref();
      await Promise.all([server.close(), server.drain()]);
      process.exit(0);
    });
  }
}
