// The Tulpar web page. No framework: the page is small, and nothing to build keeps it easy to host.

const $ = (id) => document.getElementById(id);
const TOKEN_KEY = "tulpar.figmaToken";
let current = null; // the job being shown
let files = [];

const storage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { value ? localStorage.setItem(key, value) : localStorage.removeItem(key); } catch { /* private mode */ } },
};

async function init() {
  const res = await fetch("/api/config");
  const config = await res.json();
  $("project").innerHTML = config.projects.map((p) => `<option value="${esc(p.id)}">${esc(p.label)}</option>`).join("");
  $("accessField").hidden = !config.accessCodeRequired;
  $("modelNote").textContent = config.model
    ? `Model: ${config.model}.`
    : "Generation is disabled: the server has no OpenAI key (OPENAI_API_KEY).";
  $("submit").disabled = !config.model;
  if (!config.figmaTokenOnServer) $("tokenHint").textContent = "(needed for new frames)";
  const saved = storage.get(TOKEN_KEY);
  if (saved) { $("figmaToken").value = saved; $("rememberToken").checked = true; }
}

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("formError").textContent = "";
  const figmaToken = $("figmaToken").value.trim();
  storage.set(TOKEN_KEY, $("rememberToken").checked ? figmaToken : "");
  const body = {
    project: $("project").value,
    figmaUrl: $("figmaUrl").value.trim(),
    name: $("name").value.trim(),
    scale: $("scale").value,
    ...(figmaToken && { figmaToken }),
    ...($("accessCode").value && { accessCode: $("accessCode").value }),
  };
  const file = $("image").files[0];
  if (!body.figmaUrl && !file) return showError("Paste a Figma frame link, upload a screenshot, or both.");
  if (file) {
    if (file.size > 8 * 1024 * 1024) return showError("The screenshot must be under 8 MB.");
    body.image = await readAsDataUrl(file);
  }
  $("submit").disabled = true;
  try {
    const res = await fetch("/api/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
    current = data.id;
    $("result").hidden = true;
    $("progress").hidden = false;
    $("events").innerHTML = "";
    poll(data.id);
  } catch (err) {
    showError(err.message);
    $("submit").disabled = false;
  }
});

async function poll(id) {
  if (id !== current) return;
  const res = await fetch(`/api/jobs/${id}`);
  const job = await res.json();
  if (!res.ok) { showError(job.error); $("submit").disabled = false; return; }
  $("events").innerHTML = job.events.map((e, i) => `<li class="${i === job.events.length - 1 && job.state === "running" ? "current" : ""}">${esc(e.text)}</li>`).join("");
  if (job.state === "queued" || job.state === "running") return setTimeout(() => poll(id), 1000);
  $("submit").disabled = false;
  if (job.state === "error") return showError(job.error);
  showResult(job);
}

function showResult(job) {
  const r = job.result;
  const banner = $("banner");
  const text = {
    verified: ["pass", "Verified: every check ran and passed."],
    "unchecked-remain": ["skip", "No check failed. Some could not be checked; see below."],
    failed: ["fail", "Checks still fail after the last attempt. The files are the best attempt; see what failed below."],
  }[r.status];
  banner.className = `banner ${text[0]}`;
  banner.textContent = `${job.name}: ${text[1]}`;

  const report = r.report;
  $("checks").innerHTML = report
    ? report.checks.map((c) => {
        const mark = { pass: "✓", fail: "✗", "not-checked": "–" }[c.status];
        const label = c.status === "not-checked" ? `${c.title}: not checked (${c.summary})` : c.summary;
        const details = c.details.filter((d) => !d.startsWith("✓"));
        return `<li class="${c.status}"><span class="status">${mark}</span>${esc(label)}${details.length ? `<ul>${details.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>` : ""}</li>`;
      }).join("")
    : `<li class="fail"><span class="status">✗</span>No verification report: the model did not return a buildable component.</li>`;
  const attempts = r.attempts.length;
  $("meta").textContent = `${attempts} attempt${attempts === 1 ? "" : "s"} · ${r.model} · tokens in/out ${r.usage.inputTokens}/${r.usage.outputTokens}${report?.renderer ? ` · rendered with ${report.renderer.name} ${report.renderer.version}` : ""}`;

  $("render").src = job.hasRender ? `/api/jobs/${job.id}/render.png` : "";
  document.querySelector('[data-tab="render"]').hidden = !job.hasRender;
  files = r.files;
  $("fileTabs").innerHTML = files.map((f, i) => `<button type="button" data-file="${i}" aria-selected="${i === 0}">${esc(f.path)}</button>`).join("");
  showFile(0);
  $("download").href = `/api/jobs/${job.id}/download.zip`;
  $("download").hidden = !files.length;
  selectTab("report");
  $("result").hidden = false;
  $("result").scrollIntoView({ behavior: "smooth", block: "start" });
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
function readAsDataUrl(file) {
  return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(r.error); r.readAsDataURL(file); });
}

init().catch((err) => showError(`Could not reach the server: ${err.message}`));
