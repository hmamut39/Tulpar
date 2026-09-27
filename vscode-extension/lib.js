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

module.exports = { findRepo, findProjects, projectOf, isPascalCase, generateArgs, verifyArgs, parseResult, testFileFor, reportLines, collisions };
