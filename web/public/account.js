// The account area every page shares: sign in with GitHub, the plan and what is left, upgrade,
// billing, sign out, and notices. Pricing-page parts are filled in only where the page has them.

const $ = (id) => document.getElementById(id);
const on = (id, event, fn) => $(id)?.addEventListener(event, fn);

let me = { signedIn: false };
let billingOn = false;

export const signedIn = () => me.signedIn;

/** Reads who is signed in and fills the header (and the pricing cards, on the pricing page). */
export async function initAccount(config) {
  if (!config.signIn) return;
  billingOn = config.billing;
  $("account").hidden = false;
  if ($("pricingLink")) $("pricingLink").hidden = false;
  if ($("trialNote")) {
    $("trialNote").hidden = false;
    $("trialNoteCount").textContent = config.pricing.trialGenerations;
  }
  if ($("trialCount")) $("trialCount").textContent = config.pricing.trialGenerations;
  if ($("proCount")) $("proCount").textContent = config.pricing.proGenerations;
  for (const el of document.querySelectorAll("[data-pro-price]")) el.textContent = config.pricing.proPrice;
  me = await (await fetch("/api/me")).json();
  $("signIn").hidden = me.signedIn;
  $("me").hidden = !me.signedIn;
  if (me.signedIn) {
    showAllowance();
    $("upgradeBtn").hidden = !billingOn || me.allowance.plan === "pro";
    $("billingBtn").hidden = !me.canManageBilling;
    if ($("trialCta")) {
      $("trialCta").textContent = me.allowance.plan === "pro" ? "Included in Pro" : "You're on the free trial";
      $("trialCta").removeAttribute("href");
      $("trialCta").classList.add("current");
    }
    if ($("proCta")) $("proCta").textContent = me.allowance.plan === "pro" ? "Manage your plan" : "Upgrade to Pro";
  }
  if ($("proCta")) {
    $("proCta").disabled = !billingOn;
    if (!billingOn) $("proCta").textContent = "Coming very soon";
  }
  const params = new URLSearchParams(location.search);
  if (params.get("upgraded")) showNotice("Welcome to Pro. Your monthly generations are ready.", "", null);
  if (params.get("signin_error")) showNotice(params.get("signin_error"), "Try again", () => (location.href = "/auth/github"));
  if (params.size) history.replaceState(null, "", location.pathname + location.hash);
}

/** After a generation: the count in the header. */
export async function refreshAllowance() {
  me = await (await fetch("/api/me")).json();
  if (me.signedIn) showAllowance();
}

function showAllowance() {
  const a = me.allowance;
  $("meName").textContent = me.login;
  $("meLeft").textContent = a.plan === "pro" ? `Pro · ${a.remaining} left this month` : `Trial · ${a.remaining} of ${a.limit} left`;
}

export async function upgrade() {
  if (!me.signedIn) return (location.href = "/auth/github");
  await goTo("/api/billing/checkout");
}

async function goTo(endpoint) {
  try {
    const res = await fetch(endpoint, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
    location.href = data.url;
  } catch (err) {
    showNotice(err.message, "", null);
  }
}

export function showNotice(text, actionLabel, action) {
  $("noticeText").textContent = text;
  $("noticeAction").hidden = !actionLabel;
  $("noticeAction").textContent = actionLabel || "";
  $("noticeAction").onclick = action;
  $("notice").hidden = false;
  $("notice").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

on("upgradeBtn", "click", upgrade);
on("billingBtn", "click", () => goTo("/api/billing/portal"));
on("proCta", "click", () => (me.allowance?.plan === "pro" ? goTo("/api/billing/portal") : upgrade()));
on("signOut", "click", async () => {
  await fetch("/auth/logout", { method: "POST", redirect: "manual" });
  location.reload();
});
