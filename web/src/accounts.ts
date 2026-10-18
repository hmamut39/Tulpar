// Accounts, plans and usage, in one SQLite file on the data volume (Node's built-in node:sqlite).
//
// - Everyone signs in with GitHub; a new account starts on the free trial.
// - Trial: TULPAR_TRIAL_GENERATIONS generations in total (default 20), no card.
// - Pro: TULPAR_PRO_GENERATIONS generations per billing month (default 300), while the Stripe
//   subscription is active or trialing. Stripe's webhook is the only thing that changes the plan.
// - A generation is counted when it is accepted, and refunded if it fails before reaching the
//   model, so a server error never costs a user their trial.
// - Apps (the VS Code extension) act for an account with a personal token. Only its SHA-256 is
//   stored, so the database cannot give a token away; signing in to an app again replaces it.

import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type Plan = "trial" | "pro";

export interface Account {
  id: number;
  githubId: number;
  login: string;
  name: string | null;
  email: string | null;
  createdAt: string;
  plan: Plan;
  stripeCustomer: string | null;
  subscriptionStatus: string | null;
  /** Generations counted in the current allowance (all-time on the trial; this month on Pro). */
  used: number;
  /** When the current Pro month started (ISO), for the monthly reset. */
  periodStart: string | null;
}

export interface Allowance {
  plan: Plan;
  used: number;
  limit: number;
  remaining: number;
  /** Why the account cannot generate, if it cannot. */
  blocked?: string;
}

export interface GenerationRecord {
  at: string;
  account?: string | null;
  invite?: string | null;
  project: string;
  source: string;
  state: string;
  status?: string | null;
  attempts?: number | null;
  inputTokens: number;
  outputTokens: number;
  ms: number;
}

export interface DashboardStats {
  days: number;
  accounts: { total: number; recent: number; pro: number; lapsed: number };
  generations: { total: number; passed: number; failed: number; errors: number; invite: number; inputTokens: number; outputTokens: number; avgSeconds: number };
  series: { day: string; generations: number; signUps: number }[];
  topProjects: { project: string; generations: number }[];
  recentAccounts: { login: string; plan: string; status: string | null; used: number; createdAt: string }[];
}

export interface Limits {
  trial: number;
  pro: number;
}

export function limitsFromEnv(): Limits {
  return { trial: Number(process.env.TULPAR_TRIAL_GENERATIONS || 20), pro: Number(process.env.TULPAR_PRO_GENERATIONS || 300) };
}

const ACTIVE = new Set(["active", "trialing"]);

export class Accounts {
  readonly #db: DatabaseSync;
  readonly #limits: Limits;

  constructor(file: string, limits: Limits = limitsFromEnv()) {
    if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
    this.#db = new DatabaseSync(file);
    this.#limits = limits;
    this.#db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY,
        github_id INTEGER NOT NULL UNIQUE,
        login TEXT NOT NULL,
        name TEXT,
        email TEXT,
        created_at TEXT NOT NULL,
        plan TEXT NOT NULL DEFAULT 'trial',
        stripe_customer TEXT UNIQUE,
        subscription_status TEXT,
        used INTEGER NOT NULL DEFAULT 0,
        period_start TEXT
      );
      CREATE TABLE IF NOT EXISTS stripe_events (id TEXT PRIMARY KEY, received_at TEXT NOT NULL);
      -- A charged generation until it finishes. Rows left when the server starts are runs a stop or a
      -- deploy cut short: they are refunded.
      CREATE TABLE IF NOT EXISTS open_runs (job TEXT PRIMARY KEY, account INTEGER NOT NULL, started_at TEXT NOT NULL);
      -- One row per finished generation, for the owner's dashboard: no design, code or token.
      CREATE TABLE IF NOT EXISTS generations (
        id INTEGER PRIMARY KEY,
        at TEXT NOT NULL,
        account TEXT,
        invite TEXT,
        project TEXT NOT NULL,
        source TEXT NOT NULL,
        state TEXT NOT NULL,
        status TEXT,
        attempts INTEGER,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        ms INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS generations_at ON generations (at);
      CREATE TABLE IF NOT EXISTS api_tokens (
        id INTEGER PRIMARY KEY,
        account INTEGER NOT NULL REFERENCES accounts (id),
        hash TEXT NOT NULL UNIQUE,
        app TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_used TEXT
      );
    `);
  }

  /** The account for a GitHub user, created on first sign-in (on the trial). */
  signIn(user: { githubId: number; login: string; name?: string | null; email?: string | null }): Account {
    const now = new Date().toISOString();
    this.#db
      .prepare(`INSERT INTO accounts (github_id, login, name, email, created_at) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(github_id) DO UPDATE SET login = excluded.login, name = excluded.name, email = COALESCE(excluded.email, accounts.email)`)
      .run(user.githubId, user.login, user.name ?? null, user.email ?? null, now);
    return this.byGithub(user.githubId)!;
  }

  get(id: number): Account | undefined {
    return row(this.#db.prepare("SELECT * FROM accounts WHERE id = ?").get(id));
  }

  byGithub(githubId: number): Account | undefined {
    return row(this.#db.prepare("SELECT * FROM accounts WHERE github_id = ?").get(githubId));
  }

  byCustomer(customer: string): Account | undefined {
    return row(this.#db.prepare("SELECT * FROM accounts WHERE stripe_customer = ?").get(customer));
  }

  setCustomer(id: number, customer: string): void {
    this.#db.prepare("UPDATE accounts SET stripe_customer = ? WHERE id = ?").run(customer, id);
  }

  allowance(account: Account, now = new Date()): Allowance {
    if (account.plan === "pro" && ACTIVE.has(account.subscriptionStatus ?? "")) {
      const used = this.#monthStarted(account, now) ? 0 : account.used;
      return { plan: "pro", used, limit: this.#limits.pro, remaining: Math.max(0, this.#limits.pro - used), ...(used >= this.#limits.pro && { blocked: `You have used this month's ${this.#limits.pro} generations. They reset at the start of your next billing month.` }) };
    }
    // Pro whose payment failed (past_due, unpaid): blocked until the card is fixed, nothing else lost.
    if (account.plan === "pro") {
      return { plan: "pro", used: account.used, limit: this.#limits.pro, remaining: 0, blocked: "Your subscription payment did not go through. Update your payment method to keep generating." };
    }
    const limit = this.#limits.trial;
    const remaining = Math.max(0, limit - account.used);
    return { plan: "trial", used: account.used, limit, remaining, ...(!remaining && { blocked: `Your free trial's ${limit} generations are used. Upgrade to Pro to keep generating.` }) };
  }

  /**
   * Counts one generation if the allowance has room: `consumed` says whether it did. Synchronous,
   * so two requests at once cannot both take the last generation.
   */
  consume(id: number, now = new Date()): Allowance & { consumed: boolean } {
    const account = this.get(id);
    if (!account) return { plan: "trial", used: 0, limit: 0, remaining: 0, blocked: "No such account.", consumed: false };
    const before = this.allowance(account, now);
    if (before.blocked) return { ...before, consumed: false };
    if (account.plan === "pro" && this.#monthStarted(account, now)) {
      // The new month starts on the billing date, not on the day of first use: periods never drift.
      this.#db.prepare("UPDATE accounts SET used = 1, period_start = ? WHERE id = ?").run(currentPeriod(account.periodStart!, now), id);
    } else {
      this.#db.prepare("UPDATE accounts SET used = used + 1 WHERE id = ?").run(id);
    }
    return { ...this.allowance(this.get(id)!, now), consumed: true };
  }

  /** Gives a generation back (it failed before reaching the model). */
  refund(id: number): void {
    this.#db.prepare("UPDATE accounts SET used = MAX(0, used - 1) WHERE id = ?").run(id);
  }

  /** Notes a charged generation as running. */
  openRun(job: string, account: number): void {
    this.#db.prepare("INSERT OR REPLACE INTO open_runs (job, account, started_at) VALUES (?, ?, ?)").run(job, account, new Date().toISOString());
  }

  /** The generation finished (whatever its outcome): it is no longer open. */
  closeRun(job: string): void {
    this.#db.prepare("DELETE FROM open_runs WHERE job = ?").run(job);
  }

  /** At start-up: generations still open were cut short by a stop or a deploy, so each is given back. Returns how many. */
  refundLostRuns(): number {
    const lost = this.#db.prepare("SELECT job, account FROM open_runs").all() as { job: string; account: number }[];
    for (const run of lost) {
      this.refund(run.account);
      this.closeRun(run.job);
    }
    return lost.length;
  }

  /**
   * Applies a subscription's state from Stripe. Becoming Pro starts a fresh month; anything that
   * is not active or trialing leaves the account unable to generate until payment is fixed.
   */
  applySubscription(customer: string, status: string, periodStart?: number): Account | undefined {
    const account = this.byCustomer(customer);
    if (!account) return undefined;
    const active = ACTIVE.has(status);
    const start = periodStart ? new Date(periodStart * 1000).toISOString() : new Date().toISOString();
    const becomingPro = active && !(account.plan === "pro" && ACTIVE.has(account.subscriptionStatus ?? ""));
    // A renewal (Stripe starts a new billing period) gives the month's generations back, on the billing date.
    const renewed = active && !becomingPro && !!periodStart && (!account.periodStart || start > account.periodStart);
    const fresh = becomingPro || renewed;
    this.#db
      .prepare("UPDATE accounts SET plan = ?, subscription_status = ?, used = CASE WHEN ? THEN 0 ELSE used END, period_start = CASE WHEN ? THEN ? ELSE period_start END WHERE id = ?")
      .run(active || status === "past_due" || status === "unpaid" ? "pro" : status === "canceled" ? "trial" : account.plan, status, fresh ? 1 : 0, fresh ? 1 : 0, start, account.id);
    if (status === "canceled") this.#db.prepare("UPDATE accounts SET used = ? WHERE id = ?").run(this.#limits.trial, account.id); // back on a used-up trial
    return this.get(account.id);
  }

  /** True the first time an event id is seen (Stripe retries deliveries). */
  firstDelivery(eventId: string): boolean {
    const result = this.#db.prepare("INSERT OR IGNORE INTO stripe_events (id, received_at) VALUES (?, ?)").run(eventId, new Date().toISOString());
    return Number(result.changes) > 0;
  }

  /** Records a finished generation (what ran and what it cost; never the design, the code or a token). */
  recordGeneration(g: GenerationRecord): void {
    this.#db
      .prepare("INSERT INTO generations (at, account, invite, project, source, state, status, attempts, input_tokens, output_tokens, ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(g.at, g.account ?? null, g.invite ?? null, g.project, g.source, g.state, g.status ?? null, g.attempts ?? null, g.inputTokens, g.outputTokens, g.ms);
  }

  /** What the owner's dashboard shows, from this database (revenue comes from Stripe). */
  stats(days = 30, now = new Date()): DashboardStats {
    const since = new Date(now.getTime() - days * 86_400_000).toISOString();
    const one = (sql: string, ...args: (string | number)[]) => this.#db.prepare(sql).get(...args) as Record<string, number | null>;
    const all = (sql: string, ...args: (string | number)[]) => this.#db.prepare(sql).all(...args) as Record<string, unknown>[];
    const acc = one(`SELECT COUNT(*) AS total, SUM(created_at >= ?) AS recent, SUM(plan = 'pro' AND subscription_status IN ('active','trialing')) AS pro, SUM(plan = 'pro' AND subscription_status NOT IN ('active','trialing')) AS lapsed FROM accounts`, since);
    const gen = one(
      `SELECT COUNT(*) AS total, SUM(state = 'done' AND status IN ('verified','unchecked-remain')) AS passed, SUM(state = 'done' AND status = 'failed') AS failed, SUM(state = 'error') AS errors,
              SUM(input_tokens) AS input, SUM(output_tokens) AS output, AVG(ms) AS avgMs, SUM(invite IS NOT NULL) AS invite FROM generations WHERE at >= ?`,
      since,
    );
    const perDay = (table: string, column: string) =>
      Object.fromEntries(all(`SELECT substr(${column}, 1, 10) AS day, COUNT(*) AS n FROM ${table} WHERE ${column} >= ? GROUP BY day`, since).map((x) => [String(x.day), Number(x.n)]));
    const generationsPerDay = perDay("generations", "at");
    const signUpsPerDay = perDay("accounts", "created_at");
    const series = Array.from({ length: days }, (_, i) => new Date(now.getTime() - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10)).map((day) => ({ day, generations: generationsPerDay[day] ?? 0, signUps: signUpsPerDay[day] ?? 0 }));
    return {
      days,
      accounts: { total: Number(acc.total ?? 0), recent: Number(acc.recent ?? 0), pro: Number(acc.pro ?? 0), lapsed: Number(acc.lapsed ?? 0) },
      generations: { total: Number(gen.total ?? 0), passed: Number(gen.passed ?? 0), failed: Number(gen.failed ?? 0), errors: Number(gen.errors ?? 0), invite: Number(gen.invite ?? 0), inputTokens: Number(gen.input ?? 0), outputTokens: Number(gen.output ?? 0), avgSeconds: Math.round(Number(gen.avgMs ?? 0) / 1000) },
      series,
      topProjects: all(`SELECT project, COUNT(*) AS n FROM generations WHERE at >= ? GROUP BY project ORDER BY n DESC LIMIT 8`, since).map((x) => ({ project: String(x.project), generations: Number(x.n) })),
      recentAccounts: all(`SELECT login, plan, subscription_status AS status, used, created_at AS createdAt FROM accounts ORDER BY created_at DESC LIMIT 15`).map((x) => ({ login: String(x.login), plan: String(x.plan), status: (x.status as string | null) ?? null, used: Number(x.used), createdAt: String(x.createdAt) })),
    };
  }

  /** A new token for an app to act as the account. Shown once; one per app, so signing in again replaces the old one. */
  createToken(accountId: number, app: string): string {
    const token = `tlp_${randomBytes(32).toString("base64url")}`;
    this.#db.prepare("DELETE FROM api_tokens WHERE account = ? AND app = ?").run(accountId, app);
    this.#db.prepare("INSERT INTO api_tokens (account, hash, app, created_at) VALUES (?, ?, ?, ?)").run(accountId, tokenHash(token), app, new Date().toISOString());
    return token;
  }

  /** The account a token acts for, or undefined for an unknown or revoked one. */
  byToken(token: string): Account | undefined {
    if (!/^tlp_[\w-]{43}$/.test(token)) return undefined;
    const found = this.#db.prepare("SELECT id, account FROM api_tokens WHERE hash = ?").get(tokenHash(token)) as { id: number; account: number } | undefined;
    if (!found) return undefined;
    this.#db.prepare("UPDATE api_tokens SET last_used = ? WHERE id = ?").run(new Date().toISOString(), found.id);
    return this.get(found.account);
  }

  /** Signs every app out of the account. */
  revokeTokens(accountId: number): number {
    return Number(this.#db.prepare("DELETE FROM api_tokens WHERE account = ?").run(accountId).changes);
  }

  close(): void {
    this.#db.close();
  }

  /** A Pro month has passed since the period started: the allowance resets on the next generation. */
  #monthStarted(account: Account, now: Date): boolean {
    if (!account.periodStart) return false;
    const next = new Date(account.periodStart);
    next.setUTCMonth(next.getUTCMonth() + 1);
    return now >= next;
  }
}

function row(r: unknown): Account | undefined {
  if (!r) return undefined;
  const x = r as Record<string, unknown>;
  return {
    id: Number(x.id),
    githubId: Number(x.github_id),
    login: String(x.login),
    name: (x.name as string | null) ?? null,
    email: (x.email as string | null) ?? null,
    createdAt: String(x.created_at),
    plan: x.plan === "pro" ? "pro" : "trial",
    stripeCustomer: (x.stripe_customer as string | null) ?? null,
    subscriptionStatus: (x.subscription_status as string | null) ?? null,
    used: Number(x.used),
    periodStart: (x.period_start as string | null) ?? null,
  };
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** The start of the billing month that contains `now`, counted in whole months from the first period's start. */
function currentPeriod(first: string, now: Date): string {
  const start = new Date(first);
  let months = (now.getUTCFullYear() - start.getUTCFullYear()) * 12 + now.getUTCMonth() - start.getUTCMonth();
  const at = (m: number) => {
    const d = new Date(start);
    d.setUTCMonth(start.getUTCMonth() + m);
    return d;
  };
  if (at(months) > now) months--;
  return at(months).toISOString();
}
