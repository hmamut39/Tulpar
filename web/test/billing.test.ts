// Accounts, sign-in and payments: the trial, Pro, Stripe's webhook, and what each costs.

import { createHmac } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ScriptedLlm } from "@tulpar/core";
import { Accounts } from "../src/accounts.ts";
import { applyEvent, verifyWebhook } from "../src/billing.ts";
import { startServer } from "../src/server.ts";

const repo = resolve(import.meta.dirname, "../..");
const FRAME = "https://www.figma.com/design/b8xYgmx2Js30XaldxPkOs9/Carbon?node-id=3906-50588";

describe("accounts", () => {
  it("gives a trial, counts it, and blocks when it is used", () => {
    const a = new Accounts(":memory:", { trial: 2, pro: 3 });
    const me = a.signIn({ githubId: 1, login: "ada", email: "ada@example.com" });
    expect(a.allowance(me)).toMatchObject({ plan: "trial", remaining: 2 });
    expect(a.consume(me.id)).toMatchObject({ consumed: true, remaining: 1 });
    expect(a.consume(me.id)).toMatchObject({ consumed: true, remaining: 0, blocked: expect.stringMatching(/Upgrade to Pro/) });
    expect(a.consume(me.id).consumed).toBe(false);
    a.refund(me.id);
    expect(a.allowance(a.get(me.id)!).remaining).toBe(1);
    // Signing in again keeps the account and its count.
    expect(a.signIn({ githubId: 1, login: "ada-renamed" })).toMatchObject({ id: me.id, login: "ada-renamed", used: 1, email: "ada@example.com" });
  });

  it("moves to Pro on an active subscription, resets monthly, and blocks on failed payment or cancel", () => {
    const a = new Accounts(":memory:", { trial: 2, pro: 3 });
    const me = a.signIn({ githubId: 2, login: "lin" });
    a.consume(me.id);
    a.consume(me.id);
    a.setCustomer(me.id, "cus_1");
    const start = Date.UTC(2026, 9, 1) / 1000;
    expect(a.applySubscription("cus_1", "active", start)).toMatchObject({ plan: "pro", used: 0 });
    for (let i = 0; i < 3; i++) a.consume(me.id, new Date(Date.UTC(2026, 9, 5)));
    expect(a.consume(me.id, new Date(Date.UTC(2026, 9, 6))).consumed).toBe(false);
    // A month later the allowance is back.
    expect(a.consume(me.id, new Date(Date.UTC(2026, 10, 2)))).toMatchObject({ consumed: true, remaining: 2 });
    // The month starts on the billing date (the 1st), not on the day of first use (the 2nd).
    expect(a.get(me.id)!.periodStart).toBe(new Date(Date.UTC(2026, 10, 1)).toISOString());
    // Stripe's renewal starts the next billing period: the month's generations come back on the billing date.
    expect(a.applySubscription("cus_1", "active", Date.UTC(2026, 11, 1) / 1000)).toMatchObject({ used: 0 });
    // The same period sent again (a retried or later update) gives nothing back.
    a.consume(me.id, new Date(Date.UTC(2026, 11, 2)));
    expect(a.applySubscription("cus_1", "active", Date.UTC(2026, 11, 1) / 1000)).toMatchObject({ used: 1 });
    a.applySubscription("cus_1", "past_due");
    expect(a.allowance(a.get(me.id)!).blocked).toMatch(/payment did not go through/);
    a.applySubscription("cus_1", "canceled");
    expect(a.allowance(a.get(me.id)!)).toMatchObject({ plan: "trial", remaining: 0 });
  });
});

describe("Stripe webhook", () => {
  const secret = "whsec_test";
  const signed = (body: string, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;

  it("accepts only a correctly signed, fresh event", () => {
    const body = JSON.stringify({ id: "evt_1" });
    expect(verifyWebhook(body, signed(body), secret)).toBe(true);
    expect(verifyWebhook(body + " ", signed(body), secret)).toBe(false);
    expect(verifyWebhook(body, signed(body, Math.floor(Date.now() / 1000) - 3600), secret)).toBe(false);
    expect(verifyWebhook(body, undefined, secret)).toBe(false);
  });

  it("applies each event once, reading the period from the subscription items", () => {
    const a = new Accounts(":memory:", { trial: 2, pro: 3 });
    const me = a.signIn({ githubId: 3, login: "kim" });
    expect(applyEvent({ id: "evt_a", type: "checkout.session.completed", data: { object: { client_reference_id: String(me.id), customer: "cus_9" } } }, a)).toBe("linked");
    const sub = { id: "evt_b", type: "customer.subscription.created", data: { object: { customer: "cus_9", status: "active", items: { data: [{ current_period_start: 1_790_000_000 }] } } } };
    expect(applyEvent(sub, a)).toBe("kim: active");
    expect(applyEvent(sub, a)).toBe("duplicate");
    expect(a.get(me.id)).toMatchObject({ plan: "pro", periodStart: new Date(1_790_000_000_000).toISOString() });
  });
});

describe("web API with sign-in and payments", () => {
  let server: { url: string; close: () => Promise<void> };
  const accounts = new Accounts(":memory:", { trial: 1, pro: 5 });
  const stripeCalls: string[] = [];
  // GitHub and Stripe, faked.
  const fakeFetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    if (url.includes("login/oauth/access_token")) return ok({ access_token: "gho_x" });
    if (url.endsWith("api.github.com/user")) return ok({ id: 42, login: "octo", name: "Octo Cat", email: null });
    if (url.endsWith("/user/emails")) return ok([{ email: "octo@example.com", primary: true, verified: true }]);
    if (url.includes("api.stripe.com")) {
      stripeCalls.push(`${init?.method} ${new URL(url).pathname} ${String(init?.body ?? "")}`);
      if (url.endsWith("/customers")) return ok({ id: "cus_octo" });
      if (url.endsWith("/checkout/sessions")) return ok({ url: "https://checkout.stripe.com/c/pay/cs_test" });
      if (url.endsWith("/billing_portal/sessions")) return ok({ url: "https://billing.stripe.com/p/session/x" });
      if (url.includes("/v1/subscriptions")) return ok({ data: url.includes("status=active") ? [{ status: "active", items: { data: [{ quantity: 1, price: { id: "price_pro", unit_amount: 2900, currency: "usd" } }] } }] : [] });
      // Two paid invoices: one for Tulpar, one for another product on the same Stripe account.
      if (url.includes("/v1/invoices")) return ok({ data: [{ amount_paid: 2900, currency: "usd", lines: { data: [{ amount: 2900, pricing: { price_details: { price: "price_pro" } } }] } }, { amount_paid: 1500, currency: "usd", lines: { data: [{ amount: 1500, price: { id: "price_other" } }] } }] });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  const never = { name: "never", complete: () => new Promise<never>(() => {}) } as unknown as ScriptedLlm;
  const auth = { clientId: "id", clientSecret: "secret", sessionSecret: "s3cret", origin: "http://localhost", secureCookies: false };
  const billing = { secretKey: "sk_test", priceId: "price_pro", webhookSecret: "whsec_srv", origin: "http://localhost" };
  let cookie = "";

  beforeAll(async () => {
    server = await startServer({ repoRoot: repo, llm: () => never, accessCode: "invite-1", auth, billing, accounts, fetch: fakeFetch, runsPerHour: 100, log: () => {}, admins: ["Octo"] }, 0);
    // The first config waits for every framework's adapter to say what it writes: slow on a busy machine.
    await fetch(`${server.url}/api/config`);
  }, 120_000);
  afterAll(() => server.close());

  const post = (path: string, body: unknown = {}, headers: Record<string, string> = {}) =>
    fetch(`${server.url}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(cookie && { cookie }), ...headers }, body: JSON.stringify(body), redirect: "manual" });
  const job = (extra: Record<string, unknown> = {}) => post("/api/jobs", { project: "carbon-react", name: "Card", figmaUrl: FRAME, ...extra });

  it("asks visitors to sign in, but still accepts an invite code", async () => {
    const res = await job();
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ signIn: true });
    expect((await job({ accessCode: "invite-1" })).status).toBe(202);
    expect((await job({ accessCode: "wrong" })).status).toBe(401);
  });

  it("signs in with GitHub, checking the state it set", async () => {
    const start = await fetch(`${server.url}/auth/github`, { redirect: "manual" });
    expect(start.status).toBe(302);
    const location = new URL(start.headers.get("location")!);
    expect(location.host).toBe("github.com");
    const state = location.searchParams.get("state")!;
    const stateCookie = start.headers.get("set-cookie")!.split(";")[0]!;
    // A callback without the state cookie is refused.
    const forged = await fetch(`${server.url}/auth/github/callback?code=c&state=${state}`, { redirect: "manual" });
    expect(forged.headers.get("location")).toMatch(/signin_error/);
    const back = await fetch(`${server.url}/auth/github/callback?code=c&state=${state}`, { headers: { cookie: stateCookie }, redirect: "manual" });
    expect(back.headers.get("location")).toBe("/");
    cookie = back.headers.getSetCookie().find((c) => c.startsWith("tulpar_session="))!.split(";")[0]!;
    const me = await (await fetch(`${server.url}/api/me`, { headers: { cookie } })).json();
    expect(me).toMatchObject({ signedIn: true, login: "octo", allowance: { plan: "trial", remaining: 1 } });
    expect(accounts.byGithub(42)?.email).toBe("octo@example.com");
  });

  it("spends the trial, then asks for an upgrade, and sends the account to Stripe Checkout", async () => {
    expect((await job()).status).toBe(202);
    const blocked = await job();
    expect(blocked.status).toBe(402);
    expect(await blocked.json()).toMatchObject({ upgrade: true, error: expect.stringMatching(/Upgrade to Pro/) });
    const checkout = await (await post("/api/billing/checkout")).json();
    expect(checkout.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    expect(stripeCalls.join("\n")).toMatch(/POST \/v1\/checkout\/sessions .*price%5D=price_pro/);
    expect(stripeCalls.join("\n")).toMatch(/client_reference_id=\d+/);
    // Tulpar's own terms, on Tulpar's checkout only.
    expect(new URLSearchParams(stripeCalls.find((c) => c.includes("/checkout/sessions"))!.split(" ").slice(2).join(" ")).get("custom_text[submit][message]")).toMatch(/^By subscribing you agree to Tulpar's Terms \(http:\/\/localhost\/terms\)/);
  });

  it("becomes Pro only through a signed webhook", async () => {
    const event = JSON.stringify({ id: "evt_pro", type: "customer.subscription.created", data: { object: { customer: "cus_octo", status: "active", items: { data: [{ current_period_start: Math.floor(Date.now() / 1000) }] } } } });
    expect((await post("/api/stripe/webhook", JSON.parse(event), { "stripe-signature": "t=1,v1=forged" })).status).toBe(400);
    const t = Math.floor(Date.now() / 1000);
    const signature = `t=${t},v1=${createHmac("sha256", "whsec_srv").update(`${t}.${event}`).digest("hex")}`;
    const ok = await fetch(`${server.url}/api/stripe/webhook`, { method: "POST", headers: { "stripe-signature": signature, "content-type": "application/json" }, body: event });
    expect(ok.status).toBe(200);
    const me = await (await fetch(`${server.url}/api/me`, { headers: { cookie } })).json();
    expect(me).toMatchObject({ allowance: { plan: "pro", remaining: 5 }, canManageBilling: true });
    expect((await job()).status).toBe(202);
    expect((await (await post("/api/billing/portal")).json()).url).toMatch(/billing\.stripe\.com/);
    // Already paying: a checkout click goes to Billing, never to a second subscription.
    const sessions = stripeCalls.filter((c) => c.includes("/checkout/sessions")).length;
    expect((await (await post("/api/billing/checkout")).json()).url).toMatch(/billing\.stripe\.com/);
    expect(stripeCalls.filter((c) => c.includes("/checkout/sessions")).length).toBe(sessions);
  });

  it("shows the owner's dashboard to admins only, counting only Tulpar's revenue", async () => {
    expect((await fetch(`${server.url}/api/admin/stats`)).status).toBe(401);
    accounts.recordGeneration({ at: new Date().toISOString(), account: "octo", project: "radix", source: "screenshot", state: "done", status: "verified", attempts: 2, inputTokens: 1000, outputTokens: 500, ms: 90_000 });
    const stats = await (await fetch(`${server.url}/api/admin/stats?days=7`, { headers: { cookie } })).json();
    expect(stats).toMatchObject({ days: 7, accounts: { total: 1, pro: 1 }, generations: { total: 1, passed: 1, inputTokens: 1000, outputTokens: 500, avgSeconds: 90 }, revenue: { subscribers: 1, mrr: 29, collected: 29 } });
    expect(stats.series).toHaveLength(7);
    expect(stats.series.at(-1).generations).toBe(1);
    expect(stats.recentAccounts[0]).toMatchObject({ login: "octo", plan: "pro" });
    // Someone else, signed in, is not the owner.
    const other = accounts.signIn({ githubId: 77, login: "mallory" });
    const payload = Buffer.from(JSON.stringify({ a: other.id, e: Date.now() + 60_000 })).toString("base64url");
    const forged = `tulpar_session=${payload}.${createHmac("sha256", "s3cret").update(payload).digest("base64url")}`;
    expect((await fetch(`${server.url}/api/admin/stats`, { headers: { cookie: forged } })).status).toBe(403);
  });

  it("does not accept a tampered session cookie", async () => {
    const [name, value] = cookie.split("=");
    const tampered = `${name}=${value!.replace(/^./, (c) => (c === "e" ? "f" : "e"))}`;
    expect((await (await fetch(`${server.url}/api/me`, { headers: { cookie: tampered } })).json()).signedIn).toBe(false);
  });

  it("returns to the page that asked for the sign-in, but only to a page on this site", async () => {
    const signIn = async (next: string) => {
      const start = await fetch(`${server.url}/auth/github?next=${encodeURIComponent(next)}`, { redirect: "manual" });
      const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
      const cookies = start.headers.getSetCookie().map((c) => c.split(";")[0]!).join("; ");
      const back = await fetch(`${server.url}/auth/github/callback?code=c&state=${state}`, { headers: { cookie: cookies }, redirect: "manual" });
      return back.headers.get("location");
    };
    expect(await signIn("/connect?scheme=vscode&state=ab")).toBe("/connect?scheme=vscode&state=ab");
    expect(await signIn("//evil.example/x")).toBe("/");
    expect(await signIn("/\\evil.example")).toBe("/");
    expect(await signIn("https://evil.example/")).toBe("/");
  });

  it("gives an app a token that acts for the account, until it is revoked", async () => {
    // Only for a signed-in session, and only as JSON (a form post from another site can't get one).
    expect((await fetch(`${server.url}/api/tokens`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"app":"vscode"}' })).status).toBe(401);
    expect((await fetch(`${server.url}/api/tokens`, { method: "POST", headers: { cookie, "content-type": "text/plain" }, body: '{"app":"vscode"}' })).status).toBe(415);
    const { token } = await (await post("/api/tokens", { app: "vscode" })).json();
    expect(token).toMatch(/^tlp_[\w-]{43}$/);
    const asApp = (t: string) => fetch(`${server.url}/api/me`, { headers: { authorization: `Bearer ${t}` } });
    expect(await (await asApp(token)).json()).toMatchObject({ signedIn: true, login: "octo" });
    // A wrong token is refused outright, not treated as signed out.
    expect((await asApp(`tlp_${"x".repeat(43)}`)).status).toBe(401);
    // Connecting again replaces the old token.
    const { token: second } = await (await post("/api/tokens", { app: "vscode" })).json();
    expect((await asApp(token)).status).toBe(401);
    expect((await asApp(second)).status).toBe(200);
    expect(await (await post("/api/tokens/revoke")).json()).toEqual({ revoked: 1 });
    expect((await asApp(second)).status).toBe(401);
  });
});
