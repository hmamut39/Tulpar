// The Tulpar web page. No framework: the page is small, and nothing to build keeps it easy to host.

import { initAccount, refreshAllowance, showNotice, signedIn, upgrade } from "./account.js";

const $ = (id) => document.getElementById(id);
const TOKEN_KEY = "tulpar.figmaToken";
const FRAMEWORK_KEY = "tulpar.framework";
const FRAMEWORKS = { react: "React", vue: "Vue", angular: "Angular", svelte: "Svelte", "web-components": "Web Components", flutter: "Flutter" };
// Framework → the {language, styling} combinations it writes, its default first: from the adapters
// themselves (/api/config), so the lists are never more or less than what they write.
let OUTPUTS = {};
const LANGUAGE_LABELS = { typescript: "TypeScript", javascript: "JavaScript" };
const STYLING_LABELS = { css: "CSS", "css-modules": "CSS Modules", scss: "SCSS", less: "LESS", tailwind: "Tailwind CSS", "styled-components": "styled-components", emotion: "Emotion" };
// Vue and Svelte scope a plain style block to the component.
const SCOPED = new Set(["vue", "svelte"]);
const OUTPUT_KEY = "tulpar.output.";
// What the choice is, per framework.
const OUTPUT_HINTS = {
  react: "The language and styling your team writes React in.",
  vue: "Vue single-file components: the script language and the style block your team uses.",
  angular: "Angular is written in TypeScript; pick the stylesheet language your team uses.",
  svelte: "Svelte 5 components: the script language and the style block your team uses.",
  "web-components": "Web Components are one HTML file: markup, a CSS style block and JavaScript modules.",
  flutter: "Flutter widgets are written in Dart, styled from your app's Material theme.",
};
// Why there is no Python or C# here: a UI framework decides the language its components are written in.
const LANGUAGES_LATER = "C#, Swift and Kotlin arrive with their frameworks.";
const option = (value, label) => `<option value="${value}">${label}</option>`;
// Shown so people see what is coming, never selectable: each language arrives with its UI framework.
const LANGUAGES_SOON = `<optgroup label="Coming with their frameworks">${["C# · Blazor", "Swift · SwiftUI", "Kotlin · Jetpack Compose"].map((l) => `<option disabled>${l}</option>`).join("")}</optgroup>`;
function fillOutputs() {
  const adapter = $("framework").value;
  const list = OUTPUTS[adapter] ?? [];
  $("outputHint").textContent = `${OUTPUT_HINTS[adapter] ?? "Tulpar writes the files the way your codebase does."} ${LANGUAGES_LATER}`;
  // Never disabled: a greyed-out field reads as broken (on a phone, tapping it does nothing). One option says there is one way.
  if (!list.length) {
    const one = { "web-components": ["HTML · JavaScript", "CSS"], flutter: ["Dart", "Material theme"] }[adapter] ?? ["The framework's default", "Its default"];
    $("language").innerHTML = option("", one[0]) + LANGUAGES_SOON;
    $("styling").innerHTML = option("", one[1]);
    return;
  }
  const [savedLanguage, savedStyling] = (storage.get(OUTPUT_KEY + adapter) ?? "").split(":");
  const languages = [...new Set(list.map((o) => o.language))];
  $("language").innerHTML = languages.map((l) => option(l, LANGUAGE_LABELS[l] ?? l)).join("") + LANGUAGES_SOON;
  if (languages.includes(savedLanguage)) $("language").value = savedLanguage;
  fillStyling(savedStyling);
}
// The stylings the chosen language is written with in this framework.
function fillStyling(preferred) {
  const adapter = $("framework").value;
  // A design system written in one styling only (shadcn/ui: Tailwind) offers just that.
  const only = projects.find((p) => p.id === $("project").value)?.stylings;
  const stylings = (OUTPUTS[adapter] ?? []).filter((o) => o.language === $("language").value).map((o) => o.styling).filter((s) => !only || only.includes(s));
  if (!stylings.length) return;
  const keep = preferred ?? $("styling").value;
  $("styling").innerHTML = stylings.map((s) => option(s, s === "css" && SCOPED.has(adapter) ? "Scoped CSS" : STYLING_LABELS[s] ?? s)).join("");
  if (stylings.includes(keep)) $("styling").value = keep;
}
const saveOutput = () => storage.set(OUTPUT_KEY + $("framework").value, `${$("language").value}:${$("styling").value}`);
$("language").addEventListener("change", () => {
  fillStyling();
  saveOutput();
});
$("styling").addEventListener("change", saveOutput);

// Shown so people know what is coming, but never selectable before an adapter exists for it.
const COMING_SOON = ["SwiftUI (Swift)", "Jetpack Compose (Kotlin)"];
// Most-used first; the page opens on the first one unless the visitor chose another before.
const FRAMEWORK_ORDER = ["react", "vue", "angular", "svelte", "flutter", "web-components"];
// Product names for known packages; anything else shows its package name.
const PRODUCTS = {
  "@carbon/react": "Carbon (IBM)", "@carbon/web-components": "Carbon (IBM)", "carbon-components-angular": "Carbon (IBM)",
  "@mui/material": "Material UI (MUI)", "@chakra-ui/react": "Chakra UI", "@radix-ui/themes": "Radix Themes",
  "@shoelace-style/shoelace": "Shoelace", primeng: "PrimeNG", "element-plus": "Element Plus", "carbon-components-svelte": "Carbon (IBM)",
};
let projects = [];
let current = null; // the job being shown
let files = [];
let screenshot = null; // File

const storage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { value ? localStorage.setItem(key, value) : localStorage.removeItem(key); } catch { /* private mode */ } },
};

async function init() {
  const config = await (await fetch("/api/config")).json();
  projects = config.projects;
  OUTPUTS = config.outputs ?? {};
  // The hero's facts, from what this server really offers.
  const offered = [...new Set(projects.map((p) => p.adapter))];
  $("factFrameworks").textContent = String(offered.length);
  $("factOutputs").textContent = String(offered.reduce((n, a) => n + Math.max(1, (OUTPUTS[a] ?? []).length), 0));
  const rank = (a) => (FRAMEWORK_ORDER.includes(a) ? FRAMEWORK_ORDER.indexOf(a) : FRAMEWORK_ORDER.length);
  const adapters = [...new Set(projects.map((p) => p.adapter))].sort((a, b) => rank(a) - rank(b));
  $("framework").innerHTML =
    adapters.map((a) => `<option value="${esc(a)}">${esc(FRAMEWORKS[a] ?? a)}</option>`).join("") +
    COMING_SOON.map((f) => `<option disabled>${esc(f)} (coming soon)</option>`).join("");
  const savedFramework = storage.get(FRAMEWORK_KEY);
  if (savedFramework && adapters.includes(savedFramework)) $("framework").value = savedFramework;
  fillProjects();
  // Each chip picks its framework and takes the visitor to the form (they look tappable, so they are).
  $("stacks").innerHTML = adapters.map((a) => `<li><button type="button" data-framework="${esc(a)}">${esc(FRAMEWORKS[a] ?? a)}</button></li>`).join("");
  $("stacks").addEventListener("click", (e) => {
    const chip = e.target.closest("button[data-framework]");
    if (!chip) return;
    $("framework").value = chip.dataset.framework;
    $("framework").dispatchEvent(new Event("change"));
    $("framework").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("accessField").hidden = !config.accessCodeRequired;
  // With sign-in on, invite codes still work, behind a small link.
  $("inviteToggle").hidden = !(config.signIn && config.inviteCodes);
  await initAccount(config);
  $("modelNote").textContent = config.model ? `Runs on ${config.model.replace(/^openai:/, "OpenAI ")}` : "Generation is off: the server has no OpenAI key.";
  $("submit").disabled = !config.model;
  $("tokenHint").textContent = config.figmaTokenOnServer ? "optional" : "needed for new frames";
  const saved = storage.get(TOKEN_KEY);
  if (saved) { $("figmaToken").value = saved; $("rememberToken").checked = true; }
}

$("inviteToggle").addEventListener("click", () => {
  $("accessField").hidden = false;
  $("inviteToggle").hidden = true;
  $("accessCode").focus();
});

// Framework first, then the design systems built for it. Labels drop the framework, shown already.
function fillProjects() {
  const adapter = $("framework").value;
  $("project").innerHTML = projects
    .filter((p) => p.adapter === adapter)
    .map((p) => {
      const pkg = p.label.split(" · ").slice(1).join(" · ") || p.label;
      const [, name, version] = /^(.+)@([^@]+)$/.exec(pkg) ?? [pkg, pkg, ""];
      return `<option value="${esc(p.id)}">${esc(PRODUCTS[name] ?? name)}${version ? ` · v${esc(version)}` : ""}</option>`;
    })
    .join("");
  fillAddOption();
  $("addDs").hidden = true;
  fillOutputs();
}
// The last option in the list: add any design system from npm (web frameworks: Flutter's packages live on pub.dev).
const ADD = "__add__";
function fillAddOption() {
  if ($("framework").value === "flutter") return;
  $("project").insertAdjacentHTML("beforeend", `<option value="${ADD}">+ Add from npm…</option>`);
}
$("project").addEventListener("change", () => {
  const adding = $("project").value === ADD;
  $("addDs").hidden = !adding;
  fillStyling();
  if (adding) $("addPackage").focus();
});
$("addGo").addEventListener("click", async () => {
  const pkg = $("addPackage").value.trim();
  if (!pkg) return ($("addStatus").textContent = "Type the package name, e.g. @shoelace-style/shoelace.");
  $("addGo").disabled = true;
  $("addStatus").textContent = "Starting…";
  try {
    const res = await fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ package: pkg, version: $("addVersion").value.trim(), framework: $("framework").value, accessCode: $("accessCode").value }) });
    const data = await res.json();
    if (res.status === 401 && data.signIn) return showNotice(data.error, "Sign in with GitHub", () => (location.href = "/auth/github"));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
    for (;;) {
      await new Promise((r) => setTimeout(r, 1500));
      const job = await (await fetch(`/api/projects/jobs/${data.id}`)).json();
      $("addStatus").textContent = job.steps.at(-1);
      if (job.state === "error") throw new Error(job.error);
      if (job.state === "done") {
        if (job.project && !projects.some((p) => p.id === job.project.id)) projects.push(job.project);
        $("framework").value = job.project.adapter;
        fillProjects();
        $("project").value = job.project.id;
        $("addDs").hidden = true;
        $("addPackage").value = "";
        $("addVersion").value = "";
        break;
      }
    }
  } catch (err) {
    $("addStatus").textContent = err.message;
  } finally {
    $("addGo").disabled = false;
  }
});

$("framework").addEventListener("change", () => {
  storage.set(FRAMEWORK_KEY, $("framework").value);
  fillProjects();
});

// Design source: Figma link, screenshot, or both.
function mode() { return document.querySelector('input[name="mode"]:checked').value; }
for (const r of document.querySelectorAll('input[name="mode"]')) {
  r.addEventListener("change", () => {
    $("figmaBlock").hidden = mode() === "image";
    $("imageBlock").hidden = mode() === "figma";
  });
}

// Screenshot drop zone.
const dz = $("dropzone");
$("image").addEventListener("change", () => setScreenshot($("image").files[0]));
dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("over"); });
dz.addEventListener("dragleave", () => dz.classList.remove("over"));
dz.addEventListener("drop", (e) => { e.preventDefault(); dz.classList.remove("over"); setScreenshot(e.dataTransfer.files[0]); });
$("dzClear").addEventListener("click", (e) => { e.preventDefault(); setScreenshot(null); $("image").value = ""; });
function setScreenshot(file) {
  if (file && !/^image\/(png|jpeg|webp)$/.test(file.type)) return showError("The screenshot must be a PNG, JPEG or WebP image.");
  screenshot = file ?? null;
  $("dzEmpty").hidden = !!screenshot;
  $("dzFile").hidden = !screenshot;
  if (screenshot) {
    $("dzThumb").src = URL.createObjectURL(screenshot);
    $("dzName").textContent = screenshot.name;
    $("dzSize").textContent = `${Math.round(screenshot.size / 1024)} KB`;
  }
}

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  showError("");
  const m = mode();
  const figmaUrl = m === "image" ? "" : $("figmaUrl").value.trim();
  const useImage = m !== "figma";
  const figmaToken = $("figmaToken").value.trim();
  storage.set(TOKEN_KEY, $("rememberToken").checked ? figmaToken : "");
  if (m !== "image" && !figmaUrl) return showError("Paste the Figma frame link.");
  if (useImage && !screenshot) return showError("Add a screenshot.");
  if (!/^[A-Z][A-Za-z0-9]*$/.test($("name").value.trim())) return showError("Give the component a PascalCase name, e.g. CheckoutCard.");
  if (useImage && screenshot.size > 8 * 1024 * 1024) return showError("The screenshot must be under 8 MB.");

  const body = {
    project: $("project").value,
    figmaUrl,
    name: $("name").value.trim(),
    scale: useImage ? $("scale").value : "auto",
    ...($("language").value && { language: $("language").value }),
    ...($("styling").value && { styling: $("styling").value }),
    ...(figmaToken && { figmaToken }),
    ...(m === "figma" && $("wholePage").checked && !$("pageOption").hidden && { page: true }),
    ...($("accessCode").value && { accessCode: $("accessCode").value }),
    ...(useImage && { image: await readAsDataUrl(screenshot) }),
  };
  setBusy(true);
  try {
    const res = await fetch("/api/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json();
    if (res.status === 401 && data.signIn) {
      showNotice(data.error, "Sign in with GitHub", () => (location.href = "/auth/github"));
      throw new Error(data.error);
    }
    if (res.status === 402) {
      showNotice(data.error, data.upgrade ? "Upgrade to Pro" : "", data.upgrade ? upgrade : null);
      throw new Error(data.error);
    }
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
    current = data.id;
    show("progress");
    $("progressTitle").textContent = `Generating ${body.name}…`;
    $("events").innerHTML = "";
    poll(data.id);
  } catch (err) {
    showError(err.message);
    setBusy(false);
  }
});

async function poll(id) {
  if (id !== current) return;
  const res = await fetch(`/api/jobs/${id}`);
  const job = await res.json();
  if (!res.ok) { showError(job.error); setBusy(false); return; }
  const running = job.state === "queued" || job.state === "running";
  renderStages(job, running);
  $("events").innerHTML = job.events.map((e) => `<li>${esc(e.text)}</li>`).join("");
  if (running) return setTimeout(() => poll(id), 1000);
  setBusy(false);
  if (signedIn()) refreshAllowance();
  if (job.state === "error") { show("empty"); return showError(job.error); }
  showResult(job);
}

function showResult(job) {
  const r = job.result;
  const [cls, text] = {
    verified: ["pass", "Verified — every check ran and passed."],
    "unchecked-remain": ["skip", "No check failed. Some couldn't be checked; they're listed below."],
    failed: ["fail", "Some checks still fail after the last attempt. The files are the best attempt."],
  }[r.status];
  $("banner").className = `banner ${cls}`;
  $("banner").textContent = text;
  $("resultName").textContent = job.name;
  const report = r.report;
  $("meta").textContent = `${r.attempts.length} attempt${r.attempts.length === 1 ? "" : "s"} · ${r.model.replace(/^openai:/, "")} · ${fmt(r.usage.inputTokens + r.usage.outputTokens)} tokens`;

  $("checks").innerHTML = report
    ? report.checks.map((c) => {
        const icon = { pass: "✓", fail: "✕", "not-checked": "–" }[c.status];
        const what = c.status === "not-checked" ? `${c.title}: not checked — ${c.summary}` : cap(c.summary);
        const details = c.details.filter((d) => !d.startsWith("✓")).map((d) => d.replace(/^[✗–]\s*/, ""));
        return `<li class="${c.status}"><span class="icon">${icon}</span><div><div class="what">${esc(what)}</div>${details.length ? `<ul>${details.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>` : ""}</div></li>`;
      }).join("") + (report.warnings.length ? `<li class="not-checked"><span class="icon">!</span><div><div class="what">Notes</div><ul>${report.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div></li>` : "")
    : `<li class="fail"><span class="icon">✕</span><div class="what">No verification report: the model didn't return a buildable component.</div></li>`;

  $("render").src = job.hasRender ? `/api/jobs/${job.id}/render.png` : "";
  document.querySelector('[data-tab="render"]').hidden = !job.hasRender;
  files = r.files;
  $("fileTabs").innerHTML = files.map((f, i) => `<button type="button" data-file="${i}" aria-selected="${i === 0}">${esc(f.path)}</button>`).join("");
  showFile(0);
  $("download").href = `/api/jobs/${job.id}/download.zip`;
  $("download").hidden = !files.length;
  resetFeedback(job.id);
  selectTab("report");
  show("result");
  if (window.innerWidth <= 900) $("result").scrollIntoView({ behavior: "smooth", block: "start" });
}

// Four stages, advanced by the job's events; a failed check sends it back to "write" (repair).
const STAGES = ["Read the design", "Write the code", "Build, render, test and check", "Ready"];
function renderStages(job, running) {
  let stage = 0;
  let repairs = 0;
  let warned = false;
  for (const e of job.events) {
    const t = e.text;
    if (/^Read the (design|screenshot)/.test(t)) stage = 1;
    else if (/^Repairing/.test(t)) { stage = 1; repairs++; warned = false; }
    else if (/^Wrote/.test(t) || /^Building/.test(t)) stage = 2;
    else if (/^Checks failed/.test(t)) warned = true;
    else if (/^All checks/.test(t)) stage = 3;
  }
  if (!running) stage = 4;
  $("stages").innerHTML = STAGES.map((label, i) => {
    const cls = i < stage ? "done" : i === stage && running ? "current" : "";
    const extra = i === 1 && repairs ? ` <span class="tag">repair ${repairs}</span>` : i === 2 && warned && running ? ` <span class="tag warn">checks failed — repairing</span>` : "";
    return `<li class="${cls}">${label}${extra}</li>`;
  }).join("");
}

function show(which) {
  $("emptyState").hidden = which !== "empty";
  $("progress").hidden = which !== "progress";
  $("result").hidden = which !== "result";
}

function setBusy(busy) {
  $("submit").disabled = busy;
  $("submit").classList.toggle("busy", busy);
  $("submitLabel").textContent = busy ? "Generating…" : "Generate component";
}

// Code reads as in an editor: colours by language, and line numbers. highlight.js escapes what it shows.
const LANGUAGE = { tsx: "typescript", ts: "typescript", jsx: "javascript", js: "javascript", mjs: "javascript", vue: "xml", svelte: "xml", html: "xml", css: "css", scss: "scss", less: "less", json: "json" };
function showFile(i) {
  const content = files[i]?.content ?? "";
  const language = LANGUAGE[(files[i]?.path ?? "").split(".").pop()];
  const code = $("code");
  code.dataset.raw = content;
  if (window.hljs && language) code.innerHTML = window.hljs.highlight(content, { language, ignoreIllegals: true }).value;
  else code.textContent = content;
  $("gutter").textContent = content.split("\n").map((_, n) => n + 1).join("\n");
  for (const b of $("fileTabs").querySelectorAll("button")) b.setAttribute("aria-selected", String(Number(b.dataset.file) === i));
}

function selectTab(name) {
  for (const b of document.querySelectorAll("[data-tab]")) b.setAttribute("aria-selected", String(b.dataset.tab === name));
  for (const p of document.querySelectorAll("[data-panel]")) p.hidden = p.dataset.panel !== name;
}

document.querySelector(".tabs").addEventListener("click", (e) => { const t = e.target.closest("[data-tab]"); if (t) selectTab(t.dataset.tab); });
$("fileTabs").addEventListener("click", (e) => { const t = e.target.closest("[data-file]"); if (t) showFile(Number(t.dataset.file)); });
$("copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText($("code").dataset.raw ?? $("code").textContent); $("copy").textContent = "Copied"; } catch { $("copy").textContent = "Copy failed"; }
  setTimeout(() => ($("copy").textContent = "Copy"), 1500);
});

function showError(message) { $("formError").textContent = message; }
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); }
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function fmt(n) { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n); }
function readAsDataUrl(file) {
  return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(r.error); r.readAsDataURL(file); });
}

init().catch((err) => showError(`Could not reach the server: ${err.message}`));

// "Was this result useful?": one rating per result; a thumbs down may say what was wrong.
let feedbackJob = null;
function resetFeedback(jobId) {
  feedbackJob = jobId;
  for (const b of document.querySelectorAll("#feedback .vote")) {
    b.disabled = false;
    b.setAttribute("aria-pressed", "false");
  }
  $("feedbackMore").hidden = true;
  $("feedbackText").value = "";
  $("feedbackThanks").hidden = true;
}
async function sendFeedback(rating, comment) {
  if (!feedbackJob) return;
  try {
    await fetch(`/api/jobs/${feedbackJob}/feedback`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rating, ...(comment && { comment }) }) });
  } catch {
    // feedback is best effort
  }
}
for (const b of document.querySelectorAll("#feedback .vote")) {
  b.addEventListener("click", () => {
    const rating = b.dataset.rating;
    for (const o of document.querySelectorAll("#feedback .vote")) {
      o.disabled = true;
      o.setAttribute("aria-pressed", String(o === b));
    }
    if (rating === "up") {
      void sendFeedback("up");
      $("feedbackThanks").hidden = false;
    } else {
      $("feedbackMore").hidden = false;
      $("feedbackText").focus();
    }
  });
}
$("feedbackMore").addEventListener("submit", (e) => {
  e.preventDefault();
  void sendFeedback("down", $("feedbackText").value.trim());
  $("feedbackMore").hidden = true;
  $("feedbackThanks").hidden = false;
});

// "Whole page" splits a Figma frame: offered with a Figma link alone, for frameworks whose components import one another.
function showPageOption() {
  $("pageOption").hidden = mode() !== "figma" || $("framework").value === "web-components";
}
for (const r of document.querySelectorAll('input[name="mode"]')) r.addEventListener("change", showPageOption);
$("framework").addEventListener("change", showPageOption);
showPageOption();
