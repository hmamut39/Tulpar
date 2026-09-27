// Tulpar for VS Code: generate a component from a Figma frame or a screenshot into the
// workspace, and verify the open file against a Figma frame. It runs the Tulpar CLI (the
// same pipeline as the web page and the MCP server) with the machine's own keys (.env).
"use strict";
const vscode = require("vscode");
const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const lib = require("./lib.js");

let output;

function activate(context) {
  output = vscode.window.createOutputChannel("Tulpar");
  context.subscriptions.push(output, vscode.commands.registerCommand("tulpar.generate", generate), vscode.commands.registerCommand("tulpar.verify", verify));
}

function settings() {
  const c = vscode.workspace.getConfiguration("tulpar");
  const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
  return { repo: lib.findRepo(c.get("repoPath"), folders), node: c.get("nodePath") || "node", folders };
}

function runCli(node, repo, args, token) {
  return new Promise((resolve, reject) => {
    const child = spawn(node, args, { cwd: repo });
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => output.append(String(d)));
    token?.onCancellationRequested(() => child.kill());
    child.on("error", (e) => reject(new Error(`Could not start ${node}: ${e.message}. Set "tulpar.nodePath" to Node.js 24 or newer.`)));
    child.on("close", () => {
      try {
        resolve(lib.parseResult(stdout));
      } catch (e) {
        reject(e);
      }
    });
  });
}

async function generate() {
  const { repo, node, folders } = settings();
  if (!repo) return vscode.window.showErrorMessage('Tulpar: set "tulpar.repoPath" to the Tulpar repository, or open it as a workspace folder.');
  const projects = lib.findProjects(repo, folders);
  const pick = await vscode.window.showQuickPick(
    projects.map((p) => ({ label: p.id, description: p.adapter, project: p })),
    { title: "Tulpar: which design system and framework?" },
  );
  if (!pick) return;
  const source = await vscode.window.showQuickPick(["Figma frame link", "Screenshot", "Both"], { title: "Generate from" });
  if (!source) return;
  let figmaUrl;
  let screenshot;
  if (source !== "Screenshot") {
    figmaUrl = await vscode.window.showInputBox({ title: "Figma frame link", prompt: "In Figma: select the frame → right-click → Copy link to selection", ignoreFocusOut: true, validateInput: (v) => (/figma\.com\/.+node-id=/.test(v) ? undefined : "A Figma link to a frame (it contains node-id=)") });
    if (!figmaUrl) return;
  }
  if (source !== "Figma frame link") {
    const files = await vscode.window.showOpenDialog({ title: "Screenshot of the design", canSelectMany: false, filters: { Images: ["png", "jpg", "jpeg", "webp"] } });
    if (!files?.[0]) return;
    screenshot = files[0].fsPath;
  }
  const name = await vscode.window.showInputBox({ title: "Component name", prompt: "PascalCase, e.g. CheckoutCard", ignoreFocusOut: true, validateInput: (v) => (lib.isPascalCase(v) ? undefined : "PascalCase, e.g. CheckoutCard") });
  if (!name) return;
  const active = vscode.window.activeTextEditor?.document.uri.fsPath;
  const target = await vscode.window.showOpenDialog({
    title: "Where should the files go?",
    canSelectFiles: false,
    canSelectFolders: true,
    ...(active || folders[0] ? { defaultUri: vscode.Uri.file(active ? path.dirname(active) : folders[0]) } : {}),
  });
  if (!target?.[0]) return;
  const targetDir = target[0].fsPath;

  output.clear();
  output.show(true);
  output.appendLine(`Generating ${name} for ${pick.project.id}…`);
  let result;
  try {
    result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Tulpar: generating ${name} (writing, building, rendering, checking — about a minute)`, cancellable: true },
      (_progress, token) => runCli(node, repo, lib.generateArgs({ repo, project: pick.project.dir, name, figmaUrl, screenshot }), token),
    );
  } catch (e) {
    return vscode.window.showErrorMessage(`Tulpar: ${e.message}`);
  }
  if (!result.ok) return vscode.window.showErrorMessage(`Tulpar: ${result.error}`);

  const clashes = lib.collisions(targetDir, result.files);
  if (clashes.length) {
    const answer = await vscode.window.showWarningMessage(`These files already exist:\n${clashes.map((c) => path.basename(c)).join(", ")}`, { modal: true }, "Replace them");
    if (answer !== "Replace them") {
      output.appendLine(`Not written: files exist. The generated files are in ${result.outDir}`);
      return;
    }
  }
  for (const f of result.files) {
    const dest = path.join(targetDir, f.path);
    if (!path.resolve(dest).startsWith(path.resolve(targetDir))) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, f.content);
  }
  if (result.report) output.appendLine(lib.reportLines(result.report).join("\n"));
  output.appendLine(`\n${result.attempts} attempt(s) with ${result.model}. Files written to ${targetDir}`);
  const main = result.files[0];
  if (main) await vscode.window.showTextDocument(vscode.Uri.file(path.join(targetDir, main.path)));
  const status = { verified: "verified: every check passed", "unchecked-remain": "no check failed; some could not be checked", failed: "some checks still fail — see the Tulpar output" }[result.status];
  (result.status === "failed" ? vscode.window.showWarningMessage : vscode.window.showInformationMessage)(`Tulpar: ${name} — ${status}.`, "Show report").then((a) => a && output.show());
}

async function verify() {
  const { repo, node } = settings();
  if (!repo) return vscode.window.showErrorMessage('Tulpar: set "tulpar.repoPath" to the Tulpar repository, or open it as a workspace folder.');
  const file = vscode.window.activeTextEditor?.document.uri.fsPath;
  if (!file) return vscode.window.showErrorMessage("Tulpar: open the implementation file to verify.");
  const project = lib.projectOf(file);
  if (!project) return vscode.window.showErrorMessage("Tulpar: this file is not inside a Tulpar project (no tulpar.json above it).");
  const figmaUrl = await vscode.window.showInputBox({ title: "The Figma frame this file implements", ignoreFocusOut: true, validateInput: (v) => (/figma\.com\/.+node-id=/.test(v) ? undefined : "A Figma link to a frame (it contains node-id=)") });
  if (!figmaUrl) return;
  const test = lib.testFileFor(file);
  output.clear();
  output.show(true);
  try {
    const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Tulpar: verifying against the design", cancellable: true }, (_p, token) =>
      runCli(node, repo, lib.verifyArgs({ repo, project, entry: path.relative(project, file), figmaUrl, ...(test && { test: path.relative(project, test) }) }), token),
    );
    if (!result.ok) return vscode.window.showErrorMessage("Tulpar: verification could not start; see the Tulpar output.");
    output.appendLine(lib.reportLines(result.report).join("\n"));
    const msg = { pass: "passes every check", incomplete: "no check failed; some could not be checked", fail: "fails some checks" }[result.report.verdict];
    (result.report.verdict === "fail" ? vscode.window.showWarningMessage : vscode.window.showInformationMessage)(`Tulpar: ${path.basename(file)} ${msg}.`);
  } catch (e) {
    vscode.window.showErrorMessage(`Tulpar: ${e.message}`);
  }
}

function deactivate() {}

module.exports = { activate, deactivate };
