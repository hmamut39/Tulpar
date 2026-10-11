// Accounts, plans and usage, in one SQLite file on the data volume (Node's built-in node:sqlite).
//
// - Everyone signs in with GitHub; a new account starts on the free trial.
// - Trial: TULPAR_TRIAL_GENERATIONS generations in total (default 20), no card.
// - Pro: TULPAR_PRO_GENERATIONS generations per billing month (default 300), while the Stripe
//   subscription is active or trialing. Stripe's webhook is the only thing that changes the plan.
// - A generation is counted when it is accepted, and refunded if it fails before reaching the
//   model, so a server error never costs a user their trial.

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
      this.#db.prepare("UPDATE accounts SET used = 1, period_start = ? WHERE id = ?").run(now.toISOString(), id);
    } else {
      this.#db.prepare("UPDATE accounts SET used = used + 1 WHERE id = ?").run(id);
    }
    return { ...this.allowance(this.get(id)!, now), consumed: true };
  }

  /** Gives a generation back (it failed before reaching the model). */
  refund(id: number): void {
    this.#db.prepare("UPDATE accounts SET used = MAX(0, used - 1) WHERE id = ?").run(id);
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
    this.#db
      .prepare("UPDATE accounts SET plan = ?, subscription_status = ?, used = CASE WHEN ? THEN 0 ELSE used END, period_start = CASE WHEN ? THEN ? ELSE period_start END WHERE id = ?")
      .run(active || status === "past_due" || status === "unpaid" ? "pro" : status === "canceled" ? "trial" : account.plan, status, becomingPro ? 1 : 0, becomingPro ? 1 : 0, start, account.id);
    if (status === "canceled") this.#db.prepare("UPDATE accounts SET used = ? WHERE id = ?").run(this.#limits.trial, account.id); // back on a used-up trial
    return this.get(account.id);
  }

  /** True the first time an event id is seen (Stripe retries deliveries). */
  firstDelivery(eventId: string): boolean {
    const result = this.#db.prepare("INSERT OR IGNORE INTO stripe_events (id, received_at) VALUES (?, ?)").run(eventId, new Date().toISOString());
    return Number(result.changes) > 0;
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
