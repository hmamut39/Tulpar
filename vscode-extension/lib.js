// Pure helpers for the extension, kept free of the vscode API so they can be tested.
"use strict";
const fs = require("node:fs");
const path = require("node:path");

/** The Tulpar repository: the setting, or an open folder that contains the CLI. */
function findRepo(setting, workspaceFolders) {
  const candidates = [setting, ...workspaceFolders].filter(Boolean);
  return candidates.find((d) => fs.existsSync(path.join(d, "cli", "src", "main.ts")));
}

/** Projects: the repository's examples, plus any open folder with a tulpar.json. */
function findProjects(repo, workspaceFolders) {
  const dirs = [];
  const examples = repo && path.join(repo, "examples");
  if (examples && fs.existsSync(examples)) for (const d of fs.readdirSync(examples)) dirs.push(path.join(examples, d));
  dirs.push(...workspaceFolders);
  const seen = new Set();
  return dirs
    .filter((d) => fs.existsSync(path.join(d, "tulpar.json")) && !seen.has(path.resolve(d)) && seen.add(path.resolve(d)))
    .map((d) => ({ dir: path.resolve(d), id: path.basename(d), adapter: JSON.parse(fs.readFileSync(path.join(d, "tulpar.json"), "utf8")).adapter }));
}

/** The nearest folder at or above `file` that has a tulpar.json. */
function projectOf(file) {
  for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, "tulpar.json"))) return dir;
    if (path.dirname(dir) === dir) return undefined;
  }
}

function isPascalCase(name) {
  return /^[A-Z][A-Za-z0-9]{0,63}$/.test(name);
}

function generateArgs({ repo, project, name, figmaUrl, screenshot }) {
  return [
    path.join(repo, "cli", "src", "main.ts"),
    "generate",
    project,
    "--name",
    name,
    ...(figmaUrl ? ["--figma", figmaUrl] : []),
    ...(screenshot ? ["--image", screenshot] : []),
    "--json",
  ];
}

function verifyArgs({ repo, project, entry, figmaUrl, test }) {
  return [path.join(repo, "cli", "src", "main.ts"), "verify", project, entry, "--figma", figmaUrl, ...(test ? ["--test", test] : []), "--json"];
}

/** The CLI prints one JSON object as its last stdout line in --json mode. */
function parseResult(stdout) {
  const line = stdout.trim().split(/\r?\n/).filter((l) => l.startsWith("{")).pop();
  if (!line) throw new Error("Tulpar printed no result.");
  return JSON.parse(line);
}

/** A test file that sits next to an implementation, by the usual naming conventions. */
function testFileFor(file) {
  const dir = path.dirname(file);
  const base = path.basename(file).replace(/\.(tsx?|jsx?|html)$/, "");
  return ["test.tsx", "test.ts", "spec.ts", "spec.tsx"].map((s) => path.join(dir, `${base}.${s}`)).find((f) => fs.existsSync(f));
}

function reportLines(report) {
  const mark = { pass: "✓", fail: "✗", "not-checked": "–" };
  return [
    `${report.frame.name} (${report.frame.id}) — ${report.verdict.toUpperCase()}`,
    ...report.checks.flatMap((c) => [`  ${mark[c.status]} ${c.status === "not-checked" ? `${c.title}: not checked (${c.summary})` : c.summary}`, ...c.details.filter((d) => !d.startsWith("✓")).map((d) => `      ${d}`)]),
    ...report.warnings.map((w) => `  ! ${w}`),
  ];
}

/** Files that would be replaced by writing `files` into `dir`. */
function collisions(dir, files) {
  return files.map((f) => path.join(dir, f.path)).filter((p) => fs.existsSync(p));
}

// ---- Working with tulparsi.com (the default: no repository or keys on this machine) ----

/** Language and styling each framework can write in, as the web page offers them: [value, label]. */
const OUTPUTS = {
  react: [["typescript:css", "TypeScript · CSS"], ["typescript:css-modules", "TypeScript · CSS Modules"], ["typescript:scss", "TypeScript · SCSS"], ["javascript:css", "JavaScript · CSS"], ["javascript:css-modules", "JavaScript · CSS Modules"], ["javascript:scss", "JavaScript · SCSS"], ["typescript:tailwind", "TypeScript · Tailwind CSS"], ["javascript:tailwind", "JavaScript · Tailwind CSS"]],
  vue: [["typescript:css", "TypeScript · scoped CSS"], ["typescript:scss", "TypeScript · SCSS"], ["typescript:less", "TypeScript · LESS"], ["typescript:css-modules", "TypeScript · CSS Modules"], ["javascript:css", "JavaScript · scoped CSS"], ["javascript:scss", "JavaScript · SCSS"], ["typescript:tailwind", "TypeScript · Tailwind CSS"], ["javascript:tailwind", "JavaScript · Tailwind CSS"]],
  angular: [["typescript:less", "TypeScript · LESS"], ["typescript:scss", "TypeScript · SCSS"], ["typescript:css", "TypeScript · CSS"]],
};

/** The page that signs the extension in: it hands a token back through the editor's own link scheme. */
function connectUrl(server, scheme, extensionId, state) {
  const url = new URL("/connect", server);
  url.searchParams.set("scheme", scheme);
  url.searchParams.set("ext", extensionId.toLowerCase());
  url.searchParams.set("state", state);
  return url.href;
}

/** The token from the link the browser opened, if it answers the sign-in this window started. */
function tokenFromCallback(query, expectedState) {
  const params = new URLSearchParams(query);
  const token = params.get("token") ?? "";
  const state = params.get("state") ?? "";
  if (!expectedState || state !== expectedState) return undefined;
  return /^tlp_[\w-]{43}$/.test(token) ? token : undefined;
}

/** A screenshot as the data URL the server takes. */
function imageDataUrl(file) {
  const ext = path.extname(file).toLowerCase();
  const mime = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" }[ext];
  if (!mime) throw new Error(`Unsupported image type ${ext}; use PNG, JPEG or WebP.`);
  return `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;
}

/** The request body for a generation. */
function jobBody({ project, name, figmaUrl, screenshot, figmaToken, output }) {
  const [language, styling] = (output ?? "").split(":");
  return {
    project,
    name,
    ...(figmaUrl && { figmaUrl }),
    ...(screenshot && { image: imageDataUrl(screenshot) }),
    ...(figmaToken && { figmaToken }),
    ...(language && { language }),
    ...(styling && { styling }),
  };
}

/** A finished job in the shape the CLI's --json result has, so both modes share the rest. */
function fromJob(job) {
  if (job.state === "error") return { ok: false, error: job.error || "The generation failed." };
  const r = job.result;
  return { ok: true, status: r.status, model: r.model, attempts: r.attempts.length, files: r.files, report: r.report };
}

module.exports = { findRepo, findProjects, projectOf, isPascalCase, generateArgs, verifyArgs, parseResult, testFileFor, reportLines, collisions, OUTPUTS, connectUrl, tokenFromCallback, imageDataUrl, jobBody, fromJob };
