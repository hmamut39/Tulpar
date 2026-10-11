// Payments with Stripe, through its REST API (no SDK).
//
// - Upgrade: a Stripe Checkout session for the Pro price, tied to the account's Stripe customer.
// - Manage: Stripe's billing portal (card, invoices, cancel), so Tulpar never handles card data.
// - The webhook is the only thing that changes a plan: every event's signature is verified
//   (Stripe-Signature, HMAC-SHA256 over "<timestamp>.<body>", 5-minute tolerance), and each event
//   is applied once.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { Account, Accounts } from "./accounts.ts";

export interface BillingConfig {
  secretKey: string;
  /** The Pro plan's recurring price id (price_…). */
  priceId: string;
  webhookSecret: string;
  origin: string;
}

export function billingFromEnv(): BillingConfig | undefined {
  const { STRIPE_SECRET_KEY, STRIPE_PRICE_ID, STRIPE_WEBHOOK_SECRET, TULPAR_ORIGIN } = process.env;
  if (!STRIPE_SECRET_KEY || !STRIPE_PRICE_ID || !STRIPE_WEBHOOK_SECRET) return undefined;
  return { secretKey: STRIPE_SECRET_KEY, priceId: STRIPE_PRICE_ID, webhookSecret: STRIPE_WEBHOOK_SECRET, origin: TULPAR_ORIGIN || "http://localhost:4173" };
}

/** A form-encoded call to the Stripe API. Nested objects use Stripe's bracket notation. */
export async function stripe<T = Record<string, unknown>>(config: Pick<BillingConfig, "secretKey">, method: "GET" | "POST", path: string, params: Record<string, unknown> = {}, fetchImpl: typeof fetch = fetch): Promise<T> {
  const body = new URLSearchParams();
  const add = (key: string, value: unknown) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) value.forEach((v, i) => add(`${key}[${i}]`, v));
    else if (typeof value === "object") for (const [k, v] of Object.entries(value)) add(`${key}[${k}]`, v);
    else body.append(key, String(value));
  };
  for (const [k, v] of Object.entries(params)) add(k, v);
  const res = await fetchImpl(`https://api.stripe.com/v1${path}${method === "GET" && [...body].length ? `?${body}` : ""}`, {
    method,
    headers: { authorization: `Bearer ${config.secretKey}`, "content-type": "application/x-www-form-urlencoded" },
    ...(method === "POST" && { body }),
  });
  const json = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(`Stripe: ${json.error?.message ?? res.status}`);
  return json;
}

/** The account's Stripe customer, created on first use. */
async function customerFor(account: Account, accounts: Accounts, config: BillingConfig, fetchImpl?: typeof fetch): Promise<string> {
  if (account.stripeCustomer) return account.stripeCustomer;
  const customer = await stripe<{ id: string }>(config, "POST", "/customers", { ...(account.email && { email: account.email }), name: account.name ?? account.login, metadata: { tulpar_account: account.id, github: account.login } }, fetchImpl);
  accounts.setCustomer(account.id, customer.id);
  return customer.id;
}

export async function checkoutUrl(account: Account, accounts: Accounts, config: BillingConfig, fetchImpl?: typeof fetch): Promise<string> {
  const customer = await customerFor(account, accounts, config, fetchImpl);
  const session = await stripe<{ url: string }>(
    config,
    "POST",
    "/checkout/sessions",
    {
      mode: "subscription",
      customer,
      client_reference_id: account.id,
      line_items: [{ price: config.priceId, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: `${config.origin}/?upgraded=1`,
      cancel_url: `${config.origin}/#pricing`,
    },
    fetchImpl,
  );
  return session.url;
}

export async function portalUrl(account: Account, accounts: Accounts, config: BillingConfig, fetchImpl?: typeof fetch): Promise<string> {
  const customer = await customerFor(account, accounts, config, fetchImpl);
  const session = await stripe<{ url: string }>(config, "POST", "/billing_portal/sessions", { customer, return_url: `${config.origin}/` }, fetchImpl);
  return session.url;
}

/** Verifies a webhook's Stripe-Signature header against the raw body. */
export function verifyWebhook(body: string, header: string | undefined, secret: string, now = Date.now()): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]).filter(([k]) => k === "t"));
  const t = Number(parts.t);
  const signatures = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!t || !signatures.length || Math.abs(now / 1000 - t) > 300) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${body}`).digest("hex"));
  return signatures.some((s) => s.length === expected.length && timingSafeEqual(Buffer.from(s), expected));
}

/** Applies one verified webhook event. Returns what it did, for the log. */
export function applyEvent(event: { id: string; type: string; data: { object: Record<string, unknown> } }, accounts: Accounts): string {
  if (!accounts.firstDelivery(event.id)) return "duplicate";
  const o = event.data.object;
  if (event.type === "checkout.session.completed") {
    // Links the customer to the account; the subscription events set the plan.
    const id = Number(o.client_reference_id);
    if (id && typeof o.customer === "string" && accounts.get(id) && !accounts.get(id)!.stripeCustomer) accounts.setCustomer(id, o.customer);
    return "linked";
  }
  if (event.type.startsWith("customer.subscription.")) {
    const status = event.type === "customer.subscription.deleted" ? "canceled" : String(o.status);
    // current_period_start lives on the subscription in older API versions, on its items in newer ones.
    const items = (o.items as { data?: { current_period_start?: number }[] } | undefined)?.data;
    const start = (o.current_period_start as number | undefined) ?? items?.[0]?.current_period_start;
    const account = typeof o.customer === "string" ? accounts.applySubscription(o.customer, status, start) : undefined;
    return account ? `${account.login}: ${status}` : "unknown customer";
  }
  return "ignored";
}
