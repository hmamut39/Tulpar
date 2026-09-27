// The Tulpar web page. No framework: the page is small, and nothing to build keeps it easy to host.

const $ = (id) => document.getElementById(id);
const TOKEN_KEY = "tulpar.figmaToken";
const FRAMEWORKS = { react: "React", angular: "Angular", "web-components": "Web Components" };
let current = null; // the job being shown
let files = [];
let screenshot = null; // File

const storage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { value ? localStorage.setItem(key, value) : localStorage.removeItem(key); } catch { /* private mode */ } },
};

async function init() {
  const config = await (await fetch("/api/config")).json();
  $("project").innerHTML = config.projects.map((p) => `<option value="${esc(p.id)}">${esc(p.label)}</option>`).join("");
  $("stacks").innerHTML = [...new Set(config.projects.map((p) => FRAMEWORKS[p.adapter] ?? p.adapter))].map((f) => `<li>${esc(f)}</li>`).join("");
  $("accessField").hidden = !config.accessCodeRequired;
  $("modelNote").textContent = config.model ? `Runs on ${config.model.replace(/^openai:/, "OpenAI ")}` : "Generation is off: the server has no OpenAI key.";
  $("submit").disabled = !config.model;
  $("tokenHint").textContent = config.figmaTokenOnServer ? "optional" : "needed for new frames";
  const saved = storage.get(TOKEN_KEY);
  if (saved) { $("figmaToken").value = saved; $("rememberToken").checked = true; }
}

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
    ...(figmaToken && { figmaToken }),
    ...($("accessCode").value && { accessCode: $("accessCode").value }),
    ...(useImage && { image: await readAsDataUrl(screenshot) }),
  };
  setBusy(true);
  try {
    const res = await fetch("/api/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json();
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

function showFile(i) {
  $("code").textContent = files[i]?.content ?? "";
  for (const b of $("fileTabs").querySelectorAll("button")) b.setAttribute("aria-selected", String(Number(b.dataset.file) === i));
}

function selectTab(name) {
  for (const b of document.querySelectorAll("[data-tab]")) b.setAttribute("aria-selected", String(b.dataset.tab === name));
  for (const p of document.querySelectorAll("[data-panel]")) p.hidden = p.dataset.panel !== name;
}

document.querySelector(".tabs").addEventListener("click", (e) => { const t = e.target.closest("[data-tab]"); if (t) selectTab(t.dataset.tab); });
$("fileTabs").addEventListener("click", (e) => { const t = e.target.closest("[data-file]"); if (t) showFile(Number(t.dataset.file)); });
$("copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText($("code").textContent); $("copy").textContent = "Copied"; } catch { $("copy").textContent = "Copy failed"; }
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
