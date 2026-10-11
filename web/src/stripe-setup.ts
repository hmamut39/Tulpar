// One-time Stripe setup for Tulpar's Pro plan, from the STRIPE_SECRET_KEY in .env:
//
//   node web/src/stripe-setup.ts [--origin https://tulparsi.com] [--price 2900]
//
// Creates (or finds, so it can run again) the "Tulpar Pro" product and its monthly price, the
// webhook endpoint for subscription events, and a customer billing-portal configuration. The price
// id and webhook signing secret are written to .env, never printed.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadDotEnv } from "@tulpar/cli/env";
import { stripe } from "./billing.ts";

const { values } = parseArgs({ options: { origin: { type: "string", default: "https://tulparsi.com" }, price: { type: "string", default: "2900" } } });
loadDotEnv();
const secretKey = process.env.STRIPE_SECRET_KEY;
if (!secretKey) {
  console.error("Add STRIPE_SECRET_KEY=sk_test_… (or sk_live_…) to .env first.");
  process.exit(2);
}
const config = { secretKey };
const mode = secretKey.startsWith("sk_live_") ? "live" : "test";
console.log(`Stripe ${mode} mode`);

type List<T> = { data: T[] };

// Product and price: found by a metadata marker, so a second run reuses them.
const products = await stripe<List<{ id: string; metadata: Record<string, string> }>>(config, "GET", "/products", { limit: 100, active: true });
let product = products.data.find((p) => p.metadata.tulpar_plan === "pro");
product ??= await stripe<{ id: string; metadata: Record<string, string> }>(config, "POST", "/products", { name: "Tulpar Pro", description: `${process.env.TULPAR_PRO_GENERATIONS || 300} verified component generations a month`, metadata: { tulpar_plan: "pro" } });
console.log(`✓ product ${product.id}`);

const amount = Number(values.price);
const prices = await stripe<List<{ id: string; unit_amount: number; recurring?: { interval: string } }>>(config, "GET", "/prices", { product: product.id, active: true, limit: 100 });
let price = prices.data.find((p) => p.unit_amount === amount && p.recurring?.interval === "month");
price ??= await stripe<{ id: string; unit_amount: number; recurring?: { interval: string } }>(config, "POST", "/prices", { product: product.id, currency: "usd", unit_amount: amount, recurring: { interval: "month" }, metadata: { tulpar_plan: "pro" } });
console.log(`✓ price $${(amount / 100).toFixed(2)}/month`);

// Webhook: the signing secret is only returned when the endpoint is created.
const url = `${values.origin.replace(/\/$/, "")}/api/stripe/webhook`;
const events = ["checkout.session.completed", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"];
const hooks = await stripe<List<{ id: string; url: string }>>(config, "GET", "/webhook_endpoints", { limit: 100 });
let webhookSecret: string | undefined;
const existing = hooks.data.find((h) => h.url === url);
if (existing && process.env.STRIPE_WEBHOOK_SECRET) {
  await stripe(config, "POST", `/webhook_endpoints/${existing.id}`, { enabled_events: events });
  console.log(`✓ webhook ${url} (kept; its secret is already in .env)`);
} else {
  if (existing) await stripe(config, "POST", `/webhook_endpoints/${existing.id}`, { disabled: true }); // secret unknown: replace it
  const created = await stripe<{ id: string; secret: string }>(config, "POST", "/webhook_endpoints", { url, enabled_events: events, description: "Tulpar plans" });
  webhookSecret = created.secret;
  console.log(`✓ webhook ${url}`);
}

// Billing portal: customers update their card, see invoices and cancel.
const portals = await stripe<List<{ id: string; is_default: boolean }>>(config, "GET", "/billing_portal/configurations", { limit: 10, active: true });
if (!portals.data.length) {
  await stripe(config, "POST", "/billing_portal/configurations", {
    business_profile: { headline: "Manage your Tulpar plan" },
    features: { customer_update: { enabled: true, allowed_updates: ["email", "address"] }, invoice_history: { enabled: true }, payment_method_update: { enabled: true }, subscription_cancel: { enabled: true, mode: "at_period_end" } },
  });
}
console.log("✓ customer billing portal");

// .env: replace or add the two values, without printing them.
const envPath = resolve(import.meta.dirname, "../../.env");
let env = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
const set = (key: string, value: string) => {
  const line = `${key}=${value}`;
  env = new RegExp(`^${key}=.*$`, "m").test(env) ? env.replace(new RegExp(`^${key}=.*$`, "m"), line) : `${env.trimEnd()}\n${line}\n`;
};
set("STRIPE_PRICE_ID", price.id);
if (webhookSecret) set("STRIPE_WEBHOOK_SECRET", webhookSecret);
writeFileSync(envPath, env);
console.log("✓ STRIPE_PRICE_ID" + (webhookSecret ? " and STRIPE_WEBHOOK_SECRET" : "") + " saved to .env");
