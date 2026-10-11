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
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  const never = { name: "never", complete: () => new Promise<never>(() => {}) } as unknown as ScriptedLlm;
  const auth = { clientId: "id", clientSecret: "secret", sessionSecret: "s3cret", origin: "http://localhost", secureCookies: false };
  const billing = { secretKey: "sk_test", priceId: "price_pro", webhookSecret: "whsec_srv", origin: "http://localhost" };
  let cookie = "";

  beforeAll(async () => {
    server = await startServer({ repoRoot: repo, llm: () => never, accessCode: "invite-1", auth, billing, accounts, fetch: fakeFetch, runsPerHour: 100, log: () => {} }, 0);
  });
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
  });

  it("does not accept a tampered session cookie", async () => {
    const [name, value] = cookie.split("=");
    const tampered = `${name}=${value!.replace(/^./, (c) => (c === "e" ? "f" : "e"))}`;
    expect((await (await fetch(`${server.url}/api/me`, { headers: { cookie: tampered } })).json()).signedIn).toBe(false);
  });
});
