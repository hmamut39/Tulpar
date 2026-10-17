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
// - one JSON log line per finished job (project, source, status, attempts, tokens, time, which invite
//   or account): never the token, the image, the code or the files.
//
// Accounts and payments, when configured (GITHUB_CLIENT_ID/SECRET + TULPAR_SESSION_SECRET; STRIPE_*):
// - visitors sign in with GitHub and get a free trial; Pro is a Stripe subscription (accounts.ts);
// - each generation is counted against the account's allowance, and refunded if it fails before
//   reaching the model; invite codes still work and are not counted (owner, testers).

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { loadDotEnv } from "@tulpar/cli/env";
import { DEFAULT_OPENAI_MODEL, OpenAiLlm, parseFigmaUrl, type Llm, type OutputChoice } from "@tulpar/core";
import { Accounts, type Account } from "./accounts.ts";
import { authFromEnv, clearSession, finishSignIn, sessionAccount, setSession, signInNext, startSignIn, type AuthConfig } from "./auth.ts";
import { applyEvent, billingFromEnv, checkoutUrl, portalUrl, revenue, verifyWebhook, type BillingConfig, type Revenue } from "./billing.ts";
import { addProject, type AddJob, type Framework } from "./custom-projects.ts";
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
  /** Ask the model to choose components no explicit link covers (default true; tests with a scripted model turn it off). */
  rerank?: boolean;
  /** Where generation results go; default out/<project>/generated/<name>. */
  resultsRoot?: string;
  /** GitHub sign-in; default from the environment. `null` turns it off. */
  auth?: AuthConfig | null;
  /** Stripe payments; default from the environment. `null` turns them off. */
  billing?: BillingConfig | null;
  /** The accounts store; default out/accounts.db when sign-in is on. */
  accounts?: Accounts;
  /** Replaces fetch for GitHub and Stripe calls (tests). */
  fetch?: typeof fetch;
  /** What the pricing section shows for Pro, e.g. "$29". */
  proPriceLabel?: string;
  /** GitHub logins that may open the owner dashboard; default TULPAR_ADMINS (comma-separated). */
  admins?: string[];
}

export interface ProjectInfo {
  id: string;
  dir: string;
  adapter: string;
  label: string;
}

const MAX_BODY = 12 * 1024 * 1024;
/** Clean URLs for the site's pages. */
const PAGES: Record<string, string> = { "/": "/index.html", "/pricing": "/pricing.html", "/about": "/about.html", "/terms": "/terms.html", "/privacy": "/privacy.html", "/refunds": "/refunds.html", "/admin": "/admin.html", "/connect": "/connect.html" };

export function listProjects(repoRoot: string): ProjectInfo[] {
  // The built-in examples, then design systems added from the page (out/projects).
  return [...projectsIn(join(repoRoot, "examples")), ...projectsIn(join(repoRoot, "out", "projects"))];
}

function projectsIn(base: string): ProjectInfo[] {
  if (!existsSync(base)) return [];
  const labels: Record<string, string> = { react: "React", "web-components": "Web Components", angular: "Angular", vue: "Vue", svelte: "Svelte" };
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
  let projects = listProjects(options.repoRoot);
  const customRoot = join(options.repoRoot, "out", "projects");
  const addJobs = new Map<string, AddJob>();
  const addedToday = new Map<string, number[]>(); // who → when they added a design system
  let installing: Promise<unknown> = Promise.resolve(); // one install at a time
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
  const auth = options.auth === undefined ? authFromEnv() : (options.auth ?? undefined);
  const billing = options.billing === undefined ? billingFromEnv() : (options.billing ?? undefined);
  const accounts = auth ? (options.accounts ?? new Accounts(join(options.repoRoot, "out", "accounts.db"))) : undefined;
  const jobAccounts = new Map<string, { id: number; login: string }>(); // job id → the account it counts against
  const proPrice = options.proPriceLabel ?? process.env.TULPAR_PRO_PRICE_LABEL ?? "$29";
  const admins = new Set((options.admins ?? (process.env.TULPAR_ADMINS ?? "").split(",")).map((a) => a.trim().toLowerCase()).filter(Boolean));
  // OpenAI prices in dollars per million tokens, for the dashboard's cost estimate; unset means "not estimated".
  const inputPerM = Number(process.env.TULPAR_OPENAI_INPUT_PER_M || 0);
  const outputPerM = Number(process.env.TULPAR_OPENAI_OUTPUT_PER_M || 0);
  let revenueCache: { at: number; value: Revenue | { error: string } } | undefined;
  const queue = new JobQueue({
    repoRoot: options.repoRoot,
    llm,
    ...(options.rerank === false && { rerank: false }),
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
        account: jobAccounts.get(job.id)?.login ?? null,
      }));
      accounts?.recordGeneration({
        at: new Date().toISOString(),
        account: jobAccounts.get(job.id)?.login ?? null,
        invite: invites.get(job.id) ?? null,
        project: basename(job.input.projectDir),
        source: job.source,
        state: job.state,
        status: r?.status ?? null,
        attempts: r?.attempts.length ?? null,
        inputTokens: r?.usage.inputTokens ?? 0,
        outputTokens: r?.usage.outputTokens ?? 0,
        ms,
      });
      // Failed before the model ran (e.g. the Figma frame could not be read): the generation is given back.
      const owner = jobAccounts.get(job.id);
      if (owner && job.state === "error" && !r) accounts?.refund(owner.id);
      invites.delete(job.id);
      jobAccounts.delete(job.id);
    },
  });
  const publicDir = resolve(import.meta.dirname, "../public");

  /** Who is asking: an app's token (Authorization: Bearer tlp_…), else the page's session cookie. */
  const requester = (req: IncomingMessage): { account?: Account; badToken?: string } => {
    if (!auth || !accounts) return {};
    const bearer = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization ?? ""))?.[1];
    if (bearer) {
      const account = accounts.byToken(bearer);
      return account ? { account } : { badToken: "Your Tulpar sign-in has expired or was revoked. Sign in again." };
    }
    const id = sessionAccount(req, auth);
    const account = id === undefined ? undefined : accounts.get(id);
    return account ? { account } : {};
  };

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
          accessCodeRequired: codes.length > 0 && !auth,
          inviteCodes: codes.length > 0,
          signIn: !!auth,
          billing: !!billing,
          pricing: { trialGenerations: Number(process.env.TULPAR_TRIAL_GENERATIONS || 20), proGenerations: Number(process.env.TULPAR_PRO_GENERATIONS || 300), proPrice },
          model: model ? model.name : null,
          defaultModel: DEFAULT_OPENAI_MODEL,
          figmaTokenOnServer: !!process.env.FIGMA_TOKEN,
        });
      }

      // ---- Accounts: GitHub sign-in, who am I, payments ----
      if (auth && accounts) {
        if (req.method === "GET" && path === "/auth/github") return startSignIn(res, auth, url.searchParams.get("next"));
        if (req.method === "GET" && path === "/auth/github/callback") {
          try {
            const user = await finishSignIn(req, auth, options.fetch);
            const account = accounts.signIn(user);
            log(JSON.stringify({ event: "sign-in", at: new Date().toISOString(), account: account.login, new: Date.now() - Date.parse(account.createdAt) < 10_000 }));
            return setSession(res, account.id, auth, signInNext(req));
          } catch (err) {
            res.writeHead(302, { location: `/?signin_error=${encodeURIComponent((err as Error).message)}`, "cache-control": "no-store" });
            return res.end();
          }
        }
        if (req.method === "POST" && path === "/auth/logout") return clearSession(res, auth);
        if (req.method === "GET" && path === "/api/admin/stats") {
          const id = sessionAccount(req, auth);
          const account = id === undefined ? undefined : accounts.get(id);
          if (!account) return json(res, 401, { error: "Sign in first." });
          if (!admins.has(account.login.toLowerCase())) return json(res, 403, { error: "This page is for Tulpar's owner." });
          const days = Math.min(365, Math.max(1, Number(url.searchParams.get("days") || 30)));
          const stats = accounts.stats(days);
          if (billing && (!revenueCache || Date.now() - revenueCache.at > 300_000)) {
            revenueCache = { at: Date.now(), value: await revenue(billing, 30, options.fetch).catch((err: Error) => ({ error: err.message })) };
          }
          const g = stats.generations;
          const cost = inputPerM || outputPerM ? Math.round(((g.inputTokens / 1e6) * inputPerM + (g.outputTokens / 1e6) * outputPerM) * 100) / 100 : null;
          return json(res, 200, { ...stats, cost, costRates: inputPerM || outputPerM ? { inputPerM, outputPerM } : null, revenue: revenueCache?.value ?? null });
        }
        // An app (the VS Code extension) gets a token for the signed-in account. Only from the site itself:
        // the session cookie is SameSite and the JSON body needs a CORS preflight no other site passes.
        if (req.method === "POST" && path === "/api/tokens") {
          const id = sessionAccount(req, auth);
          if (id === undefined || !accounts.get(id)) return json(res, 401, { error: "Sign in first.", signIn: true });
          if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) return json(res, 415, { error: "Expected JSON." });
          const app = String((await readJson(req)).app ?? "");
          if (!/^[a-z][a-z-]{1,19}$/.test(app)) return json(res, 400, { error: "Which app?" });
          log(JSON.stringify({ event: "app-token", at: new Date().toISOString(), account: accounts.get(id)!.login, app }));
          return json(res, 200, { token: accounts.createToken(id, app) });
        }
        if (req.method === "POST" && path === "/api/tokens/revoke") {
          const id = sessionAccount(req, auth);
          if (id === undefined) return json(res, 401, { error: "Sign in first.", signIn: true });
          return json(res, 200, { revoked: accounts.revokeTokens(id) });
        }
        if (req.method === "GET" && path === "/api/me") {
          const who = requester(req);
          if (who.badToken) return json(res, 401, { error: who.badToken, signIn: true });
          const account = who.account;
          if (!account) return json(res, 200, { signedIn: false });
          return json(res, 200, { signedIn: true, login: account.login, name: account.name, allowance: accounts.allowance(account), subscription: account.subscriptionStatus, canManageBilling: !!billing && !!account.stripeCustomer });
        }
        if (req.method === "POST" && (path === "/api/billing/checkout" || path === "/api/billing/portal")) {
          if (!billing) return json(res, 503, { error: "Payments are not set up yet." });
          const id = sessionAccount(req, auth);
          const account = id === undefined ? undefined : accounts.get(id);
          if (!account) return json(res, 401, { error: "Sign in first.", signIn: true });
          const go = path.endsWith("checkout") ? checkoutUrl : portalUrl;
          return json(res, 200, { url: await go(account, accounts, billing, options.fetch) });
        }
      }
      if (billing && accounts && req.method === "POST" && path === "/api/stripe/webhook") {
        const raw = await readRaw(req);
        if (!verifyWebhook(raw, req.headers["stripe-signature"] as string | undefined, billing.webhookSecret)) return json(res, 400, { error: "Bad signature." });
        const event = JSON.parse(raw);
        log(JSON.stringify({ event: "stripe", at: new Date().toISOString(), type: event.type, result: applyEvent(event, accounts) }));
        return json(res, 200, { received: true });
      }

      if (req.method === "POST" && path === "/api/projects") {
        const body = await readJson(req);
        const given = String(body.accessCode ?? "");
        const code = given ? codes.find((c) => sameSecret(given, c)) : undefined;
        const asker = requester(req);
        if (asker.badToken) return json(res, 401, { error: asker.badToken, signIn: true });
        const account = asker.account;
        if ((auth || codes.length) && !code && !account) return json(res, 401, { error: auth ? "Sign in with GitHub to add your design system." : "Wrong or missing access code.", signIn: !!auth });
        const who = account ? `a${account.id}` : code ? `c${createHash("sha256").update(code).digest("hex").slice(0, 8)}` : clientId(req, trustProxy);
        const recent = (addedToday.get(who) ?? []).filter((t) => Date.now() - t < 86_400_000);
        if (recent.length >= 5) return json(res, 429, { error: "You can add 5 design systems a day." });
        const pkg = String(body.package ?? "").trim();
        if (!pkg) return json(res, 400, { error: "Type the npm package name of your design system." });
        const framework = ["react", "angular", "vue", "svelte", "web-components"].includes(String(body.framework)) ? (body.framework as Framework) : undefined;
        recent.push(Date.now());
        addedToday.set(who, recent);
        const job: AddJob = { id: randomUUID(), state: "running", steps: ["Waiting for the installer…"] };
        addJobs.set(job.id, job);
        installing = installing.then(() =>
          addProject(customRoot, { package: pkg, ...(typeof body.version === "string" && body.version.trim() && { version: body.version }), ...(framework && { framework }) }, (t) => job.steps.push(t), options.fetch)
            .then((id) => {
              projects = listProjects(options.repoRoot);
              job.projectId = id;
              job.state = "done";
              log(JSON.stringify({ event: "design-system-added", at: new Date().toISOString(), project: id, by: account?.login ?? null }));
            })
            .catch((err: Error) => {
              job.state = "error";
              job.error = err.message;
            }),
        );
        return json(res, 202, { id: job.id });
      }
      const addMatch = /^\/api\/projects\/jobs\/([a-f0-9-]{36})$/.exec(path);
      if (req.method === "GET" && addMatch) {
        const job = addJobs.get(addMatch[1]!);
        if (!job) return json(res, 404, { error: "No such job." });
        const project = job.projectId ? projects.find((p) => p.id === job.projectId) : undefined;
        return json(res, 200, { ...job, ...(project && { project: { id: project.id, adapter: project.adapter, label: project.label } }) });
      }

      if (req.method === "POST" && path === "/api/jobs") {
        const body = await readJson(req);
        const given = String(body.accessCode ?? "");
        const code = given ? codes.find((c) => sameSecret(given, c)) : undefined;
        if (given && !code) return json(res, 401, { error: "That invite code is not valid." });
        // Who pays for this run: an invite code (not counted), or a signed-in account's allowance.
        const who = !code ? requester(req) : {};
        if (who.badToken) return json(res, 401, { error: who.badToken, signIn: true });
        const account = who.account;
        if (!code && auth && !account) return json(res, 401, { error: "Sign in with GitHub to start your free trial.", signIn: true });
        if (!code && !auth && codes.length) return json(res, 401, { error: "Wrong or missing access code." });
        if (account) {
          const allowance = accounts!.allowance(account);
          if (allowance.blocked) return json(res, 402, { error: allowance.blocked, upgrade: !!billing });
        }
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
        // The team's language and styling, where the framework offers a choice.
        const language = body.language === "javascript" || body.language === "typescript" ? (body.language as "javascript" | "typescript") : undefined;
        const styling = ["css", "css-modules", "scss", "less", "tailwind", "styled-components", "emotion"].includes(String(body.styling)) ? (body.styling as NonNullable<OutputChoice["styling"]>) : undefined;
        const output = language || styling ? { ...(language && { language }), ...(styling && { styling }) } : undefined;

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
          ...(output && { output }),
        };
        if (account) {
          const counted = accounts!.consume(account.id);
          if (!counted.consumed) return json(res, 402, { error: counted.blocked, upgrade: !!billing });
        }
        const id = queue.add(input, { priority: !!code || (account && accounts!.allowance(accounts!.get(account.id)!).plan === "pro") });
        if (code) invites.set(id, createHash("sha256").update(code).digest("hex").slice(0, 8));
        if (account) jobAccounts.set(id, { id: account.id, login: account.login });
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

      if (req.method === "GET" || req.method === "HEAD") return serveStatic(res, publicDir, PAGES[path] ?? path, req.method === "HEAD");
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

/** The request body as text, exactly as sent (Stripe signs the raw bytes). */
async function readRaw(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, "Request too large (12 MB max).");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readRaw(req);
  try {
    const value = JSON.parse(raw);
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

const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml; charset=utf-8" };

async function serveStatic(res: ServerResponse, dir: string, path: string, headOnly = false): Promise<void> {
  const file = resolve(dir, `.${decodeURIComponent(path)}`);
  if (!file.startsWith(dir) || !existsSync(file) || !TYPES[extname(file)]) return json(res, 404, { error: "Not found." });
  res.writeHead(200, { "content-type": TYPES[extname(file)]!, "x-content-type-options": "nosniff" });
  res.end(headOnly ? undefined : await readFile(file));
}

// `node web/src/server.ts`
if (import.meta.filename === resolve(process.argv[1] ?? "")) {
  loadDotEnv();
  if (process.env.NODE_ENV === "production" && !accessCodes().length && !authFromEnv() && process.env.TULPAR_PUBLIC !== "1") {
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
