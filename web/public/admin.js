// The owner's dashboard: sign-ups, subscribers, revenue, generations and their cost.
import { initAccount } from "./account.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const money = (n, cur = "usd") => new Intl.NumberFormat("en-US", { style: "currency", currency: cur.toUpperCase(), maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);
const num = (n) => new Intl.NumberFormat("en-US").format(n);
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "–");

const config = await (await fetch("/api/config")).json();
await initAccount(config);

async function load(days) {
  const res = await fetch(`/api/admin/stats?days=${days}`);
  const data = await res.json();
  if (!res.ok) {
    $("dashState").textContent = res.status === 401 ? "Sign in with GitHub to see the dashboard." : data.error;
    return;
  }
  $("dashState").hidden = true;
  const g = data.generations;
  const r = data.revenue;
  const rev = r && !r.error;
  const tiles = [
    ["Sign-ups", num(data.accounts.total), `${num(data.accounts.recent)} in the last ${days} days`],
    ["Pro subscribers", rev ? num(r.subscribers) : num(data.accounts.pro), data.accounts.lapsed ? `${data.accounts.lapsed} with a failed payment` : "active"],
    ["Monthly recurring revenue", rev ? money(r.mrr, r.currency) : "–", rev ? `${money(r.collected, r.currency)} collected in 30 days` : (r?.error ?? "payments not set up")],
    ["Generations", num(g.total), `${pct(g.passed, g.total)} passed · ${num(g.failed)} failed · ${num(g.errors)} errors`],
    ["AI tokens", num(g.inputTokens + g.outputTokens), `${num(g.inputTokens)} in · ${num(g.outputTokens)} out`],
    ["OpenAI cost", data.cost === null ? "–" : money(data.cost), data.cost === null ? "set TULPAR_OPENAI_INPUT_PER_M and _OUTPUT_PER_M" : `about ${money(g.total ? data.cost / g.total : 0)} per generation`],
  ];
  $("tiles").innerHTML = tiles.map(([label, value, sub]) => `<div class="tile"><p class="tile-label">${esc(label)}</p><p class="tile-value">${esc(value)}</p><p class="tile-sub">${esc(sub)}</p></div>`).join("");
  $("tiles").hidden = false;

  bars($("genChart"), data.series.map((d) => ({ day: d.day, value: d.generations })), "generations");
  bars($("signChart"), data.series.map((d) => ({ day: d.day, value: d.signUps })), "sign-ups");
  $("genTotal").textContent = `${num(g.total)} in ${days} days · ${g.avgSeconds}s average`;
  $("signTotal").textContent = `${num(data.accounts.recent)} in ${days} days`;
  $("charts").hidden = false;

  $("projects").innerHTML = data.topProjects.length
    ? data.topProjects.map((p) => `<tr><td>${esc(p.project)}</td><td class="num">${num(p.generations)}</td></tr>`).join("")
    : `<tr><td colspan="2" class="hint">No generations yet.</td></tr>`;
  $("accounts").innerHTML = data.recentAccounts.length
    ? data.recentAccounts
        .map((a) => `<tr><td>${esc(a.login)}</td><td>${a.plan === "pro" ? `Pro${a.status && a.status !== "active" ? ` (${esc(a.status)})` : ""}` : "Trial"}</td><td class="num">${num(a.used)}</td><td>${esc(a.createdAt.slice(0, 10))}</td></tr>`)
        .join("")
    : `<tr><td colspan="4" class="hint">No accounts yet.</td></tr>`;
  $("tables").hidden = false;
}

// One series per chart: thin bars from the baseline, a quiet axis, a tooltip per bar.
function bars(el, points, noun) {
  const max = Math.max(1, ...points.map((p) => p.value));
  el.setAttribute("aria-label", `${noun} per day, highest ${max}`);
  el.innerHTML =
    `<div class="bars-plot">${points.map((p) => `<span class="bar-hit" data-day="${p.day}" data-value="${p.value}" data-noun="${noun}"><span class="bar"></span></span>`).join("")}</div>` +
    `<div class="bars-axis"><span>${points[0]?.day.slice(5) ?? ""}</span><span>max ${max}</span><span>${points.at(-1)?.day.slice(5) ?? ""}</span></div>`;
  // Heights are set from script: the page's security policy blocks inline style attributes.
  el.querySelectorAll(".bar").forEach((bar, i) => {
    const v = points[i].value;
    bar.style.height = `${v ? Math.max(3, (v / max) * 100) : 0}%`;
  });
}

const tip = $("tip");
document.addEventListener("pointerover", (e) => {
  const hit = e.target.closest?.(".bar-hit");
  if (!hit) {
    tip.hidden = true;
    return;
  }
  const d = new Date(`${hit.dataset.day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  tip.textContent = `${d}: ${hit.dataset.value} ${hit.dataset.noun}`;
  tip.hidden = false;
  const r = hit.getBoundingClientRect();
  tip.style.left = `${Math.min(innerWidth - tip.offsetWidth - 8, Math.max(8, r.left + r.width / 2 - tip.offsetWidth / 2))}px`;
  tip.style.top = `${r.top + scrollY - tip.offsetHeight - 8}px`;
});

for (const radio of document.querySelectorAll('input[name="days"]')) radio.addEventListener("change", () => load(radio.value));
load(30);
